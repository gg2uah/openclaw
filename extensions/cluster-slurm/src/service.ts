import fs from "node:fs/promises";
import path from "node:path";
import { defaultCommandRunner } from "./exec.js";
import {
  resolveRunsRoot,
  resolveWorkspacePath,
  sanitizeRunId,
  ensureDir,
  toPosixRemotePath,
} from "./paths.js";
import { shellQuote, sshExec, scpUpload, scpDownload } from "./shell.js";
import { mergeSlurmHeader, parseSubmittedJobId, renderSlurmScript } from "./slurm.js";
import { getRun, upsertRun } from "./store.js";
import type {
  ClusterProfile,
  ClusterRunRecord,
  ClusterSlurmConfig,
  CommandRunner,
  SlurmHeader,
} from "./types.js";

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function jobTimestamp(now: () => Date): string {
  const d = now();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${day}-${hh}${mm}${ss}`;
}

function parseSqueue(stdout: string): Record<string, string> | null {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  if (!line) {
    return null;
  }
  const [jobId, state, elapsed, timeLimit, nodes, reason] = line.split("|");
  return {
    source: "squeue",
    jobId: jobId ?? "",
    state: state ?? "",
    elapsed: elapsed ?? "",
    timeLimit: timeLimit ?? "",
    nodes: nodes ?? "",
    reason: reason ?? "",
    raw: line,
  };
}

function parseSacct(stdout: string): Record<string, string> | null {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0 && !item.endsWith(".batch"));
  if (!line) {
    return null;
  }
  const [jobId, state, exitCode, elapsed, maxRss, nodeList] = line.split("|");
  return {
    source: "sacct",
    jobId: jobId ?? "",
    state: state ?? "",
    exitCode: exitCode ?? "",
    elapsed: elapsed ?? "",
    maxRss: maxRss ?? "",
    nodeList: nodeList ?? "",
    raw: line,
  };
}

export type ClusterSlurmServiceParams = {
  config: ClusterSlurmConfig;
  workspaceDir: string;
  runner?: CommandRunner;
  now?: () => Date;
};

export class ClusterSlurmService {
  private readonly config: ClusterSlurmConfig;
  private readonly workspaceDir: string;
  private readonly runsRoot: string;
  private readonly runner: CommandRunner;
  private readonly now: () => Date;

  constructor(params: ClusterSlurmServiceParams) {
    this.config = params.config;
    this.workspaceDir = path.resolve(params.workspaceDir);
    this.runsRoot = resolveRunsRoot(this.workspaceDir, this.config.localRunsDir);
    this.runner = params.runner ?? defaultCommandRunner;
    this.now = params.now ?? (() => new Date());
  }

  listClusters() {
    const clusters = Object.values(this.config.clusters).map((cluster) => ({
      id: cluster.id,
      sshTarget: cluster.sshTarget,
      remoteRoot: cluster.remoteRoot,
      scheduler: cluster.scheduler,
    }));

    return {
      defaultCluster: this.config.defaultCluster,
      clusters,
    };
  }

  resolveCluster(clusterId?: string): ClusterProfile {
    const requested = clusterId?.trim();
    const effective = requested || this.config.defaultCluster;
    if (!effective) {
      throw new Error("cluster is required (no defaultCluster configured)");
    }
    const cluster = this.config.clusters[effective];
    if (!cluster) {
      throw new Error(
        `Unknown cluster \"${effective}\". Available: ${Object.keys(this.config.clusters).join(", ") || "none"}`,
      );
    }
    return cluster;
  }

  async createRun(params: { cluster?: string; runId?: string; prefix?: string }) {
    const cluster = this.resolveCluster(params.cluster);
    const rawRunId =
      params.runId?.trim() ||
      [params.prefix?.trim(), jobTimestamp(this.now)].filter(Boolean).join("-") ||
      `run-${jobTimestamp(this.now)}`;
    const runId = sanitizeRunId(rawRunId);
    const localRunDir = path.join(this.runsRoot, runId);
    const remoteRunDir = toPosixRemotePath(cluster.remoteRoot, runId);

    await ensureDir(localRunDir);
    await sshExec(this.runner, cluster.sshTarget, `mkdir -p ${shellQuote(remoteRunDir)}`);

    const createdAt = nowIso(this.now);
    const run: ClusterRunRecord = {
      runId,
      clusterId: cluster.id,
      localRunDir,
      remoteRunDir,
      createdAt,
      updatedAt: createdAt,
      jobs: [],
    };

    await upsertRun(this.runsRoot, run);

    return {
      run,
      created: true,
    };
  }

  async upload(params: {
    cluster?: string;
    runId?: string;
    localPath?: string;
    localPaths?: string[];
    remoteDir?: string;
  }) {
    const cluster = this.resolveCluster(params.cluster);
    const run = params.runId ? await getRun(this.runsRoot, sanitizeRunId(params.runId)) : undefined;

    const candidates = [
      ...(params.localPath ? [params.localPath] : []),
      ...(params.localPaths ?? []).filter((entry) => entry.trim().length > 0),
    ];

    if (candidates.length === 0) {
      throw new Error("localPath or localPaths is required for upload");
    }

    const localPaths = candidates.map((entry) => resolveWorkspacePath(this.workspaceDir, entry));
    for (const filePath of localPaths) {
      await fs.access(filePath);
    }

    const remoteDir =
      params.remoteDir?.trim() ||
      run?.remoteRunDir ||
      toPosixRemotePath(cluster.remoteRoot, sanitizeRunId(params.runId ?? "default"));

    await sshExec(this.runner, cluster.sshTarget, `mkdir -p ${shellQuote(remoteDir)}`);
    await scpUpload(this.runner, cluster.sshTarget, localPaths, remoteDir);

    return {
      cluster: cluster.id,
      runId: run?.runId,
      remoteDir,
      uploaded: localPaths,
    };
  }

  async renderJob(params: {
    cluster?: string;
    runId?: string;
    scriptPath?: string;
    scriptName?: string;
    commands: string[];
    env?: Record<string, string>;
    setupCommands?: string[];
    modules?: string[];
    headerOverrides?: Partial<SlurmHeader>;
  }) {
    const cluster = this.resolveCluster(params.cluster);

    const run = params.runId ? await getRun(this.runsRoot, sanitizeRunId(params.runId)) : undefined;
    if (params.runId && !run) {
      throw new Error(`Unknown runId: ${params.runId}`);
    }

    const mergedHeader = mergeSlurmHeader(cluster.slurmDefaults, params.headerOverrides);
    const script = renderSlurmScript({
      header: mergedHeader,
      commands: params.commands,
      env: params.env,
      modules: params.modules,
      setupCommands: [...cluster.setupCommands, ...(params.setupCommands ?? [])],
    });

    const localScriptPath = (() => {
      if (params.scriptPath) {
        return resolveWorkspacePath(this.workspaceDir, params.scriptPath);
      }
      if (run) {
        return path.join(run.localRunDir, params.scriptName?.trim() || "job.slurm");
      }
      const ephemeralRunId = sanitizeRunId(`adhoc-${jobTimestamp(this.now)}`);
      return path.join(this.runsRoot, ephemeralRunId, params.scriptName?.trim() || "job.slurm");
    })();

    await ensureDir(path.dirname(localScriptPath));
    await fs.writeFile(localScriptPath, script, "utf8");

    if (run) {
      const updatedRun: ClusterRunRecord = {
        ...run,
        latestScriptPath: localScriptPath,
        updatedAt: nowIso(this.now),
      };
      await upsertRun(this.runsRoot, updatedRun);
    }

    return {
      cluster: cluster.id,
      runId: run?.runId,
      localScriptPath,
      script,
    };
  }

  async submitJob(params: {
    cluster?: string;
    runId?: string;
    scriptPath?: string;
    remoteDir?: string;
    submitArgs?: string[];
  }) {
    const cluster = this.resolveCluster(params.cluster);
    const run = params.runId ? await getRun(this.runsRoot, sanitizeRunId(params.runId)) : undefined;
    if (params.runId && !run) {
      throw new Error(`Unknown runId: ${params.runId}`);
    }

    const localScriptPath = (() => {
      if (params.scriptPath) {
        return resolveWorkspacePath(this.workspaceDir, params.scriptPath);
      }
      if (run?.latestScriptPath) {
        return run.latestScriptPath;
      }
      throw new Error("scriptPath is required (or renderJob must be called first for this run)");
    })();

    await fs.access(localScriptPath);

    const remoteDir =
      params.remoteDir?.trim() ||
      run?.remoteRunDir ||
      toPosixRemotePath(cluster.remoteRoot, sanitizeRunId(params.runId ?? "adhoc"));
    const remoteScriptPath = toPosixRemotePath(remoteDir, path.basename(localScriptPath));

    await sshExec(this.runner, cluster.sshTarget, `mkdir -p ${shellQuote(remoteDir)}`);
    await scpUpload(this.runner, cluster.sshTarget, [localScriptPath], remoteDir);

    const submitArgs = [...cluster.submitArgs, ...(params.submitArgs ?? [])]
      .map((arg) => arg.trim())
      .filter((arg) => arg.length > 0)
      .map((arg) => shellQuote(arg));

    const remoteSetup = cluster.setupCommands
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");

    const remoteSubmitCommand = [
      "set -euo pipefail",
      remoteSetup,
      `cd ${shellQuote(remoteDir)}`,
      `sbatch ${submitArgs.join(" ")} ${shellQuote(remoteScriptPath)}`.trim(),
    ]
      .filter((line) => line.trim().length > 0)
      .join("\n");

    const submitResult = await sshExec(this.runner, cluster.sshTarget, remoteSubmitCommand);
    const jobId = parseSubmittedJobId(submitResult.stdout || submitResult.stderr);

    if (run) {
      const nextJob = {
        jobId,
        remoteScriptPath,
        localScriptPath,
        submittedAt: nowIso(this.now),
        submitOutput: (submitResult.stdout || submitResult.stderr).trim(),
      };
      const updatedRun: ClusterRunRecord = {
        ...run,
        lastJobId: jobId,
        latestScriptPath: localScriptPath,
        updatedAt: nowIso(this.now),
        jobs: [...run.jobs, nextJob],
      };
      await upsertRun(this.runsRoot, updatedRun);
    }

    return {
      cluster: cluster.id,
      runId: run?.runId,
      jobId,
      remoteScriptPath,
      submitOutput: (submitResult.stdout || submitResult.stderr).trim(),
    };
  }

  async jobStatus(params: { cluster?: string; jobId: string; includeAccounting?: boolean }) {
    const cluster = this.resolveCluster(params.cluster);
    const jobId = params.jobId.trim();
    if (!jobId) {
      throw new Error("jobId is required");
    }

    const squeueCmd = `squeue -h -j ${shellQuote(jobId)} -o '%i|%T|%M|%l|%D|%R'`;
    const squeue = await sshExec(this.runner, cluster.sshTarget, squeueCmd);
    const squeueParsed = parseSqueue(squeue.stdout);

    if (squeueParsed) {
      return {
        cluster: cluster.id,
        jobId,
        status: squeueParsed,
      };
    }

    if (params.includeAccounting !== false) {
      const sacctCmd = `sacct -n -P -j ${shellQuote(jobId)} -o JobIDRaw,State,ExitCode,Elapsed,MaxRSS,NodeList`;
      const sacct = await sshExec(this.runner, cluster.sshTarget, sacctCmd);
      const sacctParsed = parseSacct(sacct.stdout);
      if (sacctParsed) {
        return {
          cluster: cluster.id,
          jobId,
          status: sacctParsed,
        };
      }
    }

    return {
      cluster: cluster.id,
      jobId,
      status: {
        source: "unknown",
        state: "NOT_FOUND",
      },
    };
  }

  async jobLogs(params: {
    cluster?: string;
    runId?: string;
    jobId?: string;
    remotePath?: string;
    tail?: number;
  }) {
    const cluster = this.resolveCluster(params.cluster);
    const tail = params.tail && params.tail > 0 ? Math.floor(params.tail) : 200;

    const remotePath = (() => {
      if (params.remotePath?.trim()) {
        return params.remotePath.trim();
      }
      if (params.runId?.trim() && params.jobId?.trim()) {
        const safeRun = sanitizeRunId(params.runId.trim());
        return toPosixRemotePath(cluster.remoteRoot, safeRun, `slurm-${params.jobId.trim()}.out`);
      }
      throw new Error("remotePath is required (or provide runId + jobId)");
    })();

    const cmd = `if [ -f ${shellQuote(remotePath)} ]; then tail -n ${tail} ${shellQuote(remotePath)}; else echo '__OPENCLAW_LOG_MISSING__'; fi`;
    const result = await sshExec(this.runner, cluster.sshTarget, cmd);

    const log = result.stdout.trim();
    const missing = log === "__OPENCLAW_LOG_MISSING__";

    return {
      cluster: cluster.id,
      remotePath,
      missing,
      log: missing ? "" : result.stdout,
    };
  }

  async download(params: { cluster?: string; remotePath: string; localPath: string }) {
    const cluster = this.resolveCluster(params.cluster);
    const remotePath = params.remotePath.trim();
    if (!remotePath) {
      throw new Error("remotePath is required");
    }
    const localPath = resolveWorkspacePath(this.workspaceDir, params.localPath);
    await ensureDir(path.dirname(localPath));
    await scpDownload(this.runner, cluster.sshTarget, remotePath, localPath);

    return {
      cluster: cluster.id,
      remotePath,
      localPath,
    };
  }

  async cancelJob(params: { cluster?: string; jobId: string }) {
    const cluster = this.resolveCluster(params.cluster);
    const jobId = params.jobId.trim();
    if (!jobId) {
      throw new Error("jobId is required");
    }

    const result = await sshExec(this.runner, cluster.sshTarget, `scancel ${shellQuote(jobId)}`);

    return {
      cluster: cluster.id,
      jobId,
      output: (result.stdout || result.stderr).trim(),
      cancelled: true,
    };
  }
}

import path from "node:path";
import { Type } from "@sinclair/typebox";
import { stringEnum } from "openclaw/plugin-sdk";
import { parseClusterSlurmConfig } from "./config.js";
import { selectClusterForWorkload, shouldFallbackToGpu } from "./routing.js";
import { ClusterSlurmService } from "./service.js";
import type { ClusterRunRecord, ClusterSlurmConfig, CommandRunner, SlurmHeader } from "./types.js";

const ACTIONS = [
  "list_clusters",
  "init_run",
  "upload",
  "render_job",
  "submit_job",
  "job_status",
  "job_logs",
  "download",
  "cancel_job",
  "run_workload",
  "check_workload",
  "fetch_workload_logs",
  "download_workload_outputs",
] as const;

const TERMINAL_STATES = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMEOUT",
  "OUT_OF_MEMORY",
  "PREEMPTED",
  "BOOT_FAIL",
  "DEADLINE",
]);

const HeaderOverridesSchema = Type.Object(
  {
    jobName: Type.Optional(Type.String()),
    partition: Type.Optional(Type.String()),
    account: Type.Optional(Type.String()),
    qos: Type.Optional(Type.String()),
    constraint: Type.Optional(Type.String()),
    time: Type.Optional(Type.String()),
    nodes: Type.Optional(Type.Number({ minimum: 1 })),
    ntasks: Type.Optional(Type.Number({ minimum: 1 })),
    ntasksPerNode: Type.Optional(Type.Number({ minimum: 1 })),
    cpusPerTask: Type.Optional(Type.Number({ minimum: 1 })),
    mem: Type.Optional(Type.String()),
    gpus: Type.Optional(Type.Number({ minimum: 1 })),
    gpusPerNode: Type.Optional(Type.Number({ minimum: 1 })),
    gres: Type.Optional(Type.String()),
    output: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    modules: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export const ClusterSlurmToolSchema = Type.Object(
  {
    action: stringEnum(ACTIONS, {
      description: `Action to perform: ${ACTIONS.join(", ")}`,
    }),
    cluster: Type.Optional(Type.String({ description: "Configured cluster profile id" })),
    runId: Type.Optional(Type.String({ description: "Run id in local ledger" })),
    prefix: Type.Optional(Type.String({ description: "Optional prefix for generated run ids" })),
    localPath: Type.Optional(
      Type.String({ description: "Workspace-relative local file/directory" }),
    ),
    localPaths: Type.Optional(
      Type.Array(Type.String(), { description: "Workspace-relative local files/directories" }),
    ),
    remoteDir: Type.Optional(Type.String({ description: "Remote directory on cluster" })),
    remotePath: Type.Optional(Type.String({ description: "Remote file/directory path" })),
    remoteFile: Type.Optional(
      Type.String({
        description:
          "Remote output filename relative to run directory (used by download_workload_outputs)",
      }),
    ),
    scriptPath: Type.Optional(Type.String({ description: "Workspace-relative job script path" })),
    scriptName: Type.Optional(Type.String({ description: "Generated job filename" })),
    command: Type.Optional(Type.String({ description: "Single shell command for render_job" })),
    commands: Type.Optional(
      Type.Array(Type.String(), { description: "Command list for render_job" }),
    ),
    workload: Type.Optional(
      Type.String({
        description:
          "Natural-language task summary used for CPU/GPU profile selection in run_workload",
      }),
    ),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
    setupCommands: Type.Optional(Type.Array(Type.String())),
    modules: Type.Optional(Type.Array(Type.String())),
    headerOverrides: Type.Optional(HeaderOverridesSchema),
    submitArgs: Type.Optional(Type.Array(Type.String())),
    jobId: Type.Optional(Type.String({ description: "SLURM job id" })),
    includeAccounting: Type.Optional(
      Type.Boolean({ description: "Use sacct fallback in job_status" }),
    ),
    autoFallbackToGpu: Type.Optional(
      Type.Boolean({
        description:
          "Override routing.autoFallbackToGpuOnSignatures for run_workload fallback behavior",
      }),
    ),
    allowEnvOverrides: Type.Optional(
      Type.Boolean({
        description: "Allow explicit environment overrides for low-level render_job calls",
      }),
    ),
    tail: Type.Optional(Type.Number({ minimum: 1, maximum: 20000 })),
  },
  { additionalProperties: false },
);

type ToolParams = {
  action: (typeof ACTIONS)[number];
  cluster?: string;
  runId?: string;
  prefix?: string;
  localPath?: string;
  localPaths?: string[];
  remoteDir?: string;
  remotePath?: string;
  remoteFile?: string;
  scriptPath?: string;
  scriptName?: string;
  command?: string;
  commands?: string[];
  workload?: string;
  env?: Record<string, string>;
  setupCommands?: string[];
  modules?: string[];
  headerOverrides?: Partial<SlurmHeader>;
  submitArgs?: string[];
  jobId?: string;
  includeAccounting?: boolean;
  autoFallbackToGpu?: boolean;
  allowEnvOverrides?: boolean;
  tail?: number;
};

function json(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function requiredString(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

function collectCommands(params: ToolParams): string[] {
  const merged = [
    ...(params.command ? [params.command] : []),
    ...(params.commands ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0),
  ];
  if (merged.length === 0) {
    throw new Error("command or commands is required");
  }
  return merged;
}

const INLINE_ENV_BOOTSTRAP_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^\s*(module|ml)\b/i, label: "module command" },
  { pattern: /^\s*source\s+activate\b/i, label: "source activate" },
  { pattern: /^\s*conda\s+activate\b/i, label: "conda activate" },
  { pattern: /^\s*eval\s+["']?\$\(\s*conda\s+shell\./i, label: "conda shell hook" },
];

function detectInlineEnvBootstrap(commands: string[]): { label: string; line: string } | undefined {
  for (const command of commands) {
    const lines = command.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      for (const candidate of INLINE_ENV_BOOTSTRAP_PATTERNS) {
        if (candidate.pattern.test(trimmed)) {
          return { label: candidate.label, line: trimmed };
        }
      }
    }
  }
  return undefined;
}

function hasNonEmptyEntries(entries: string[] | undefined): boolean {
  return (entries ?? []).some((entry) => entry.trim().length > 0);
}

function collectEnvOverrideFields(params: ToolParams): string[] {
  const fields: string[] = [];
  if (hasNonEmptyEntries(params.setupCommands)) {
    fields.push("setupCommands");
  }
  if (hasNonEmptyEntries(params.modules)) {
    fields.push("modules");
  }
  if (hasNonEmptyEntries(params.headerOverrides?.modules)) {
    fields.push("headerOverrides.modules");
  }
  return fields;
}

function withoutHeaderModules(
  header: Partial<SlurmHeader> | undefined,
): Partial<SlurmHeader> | undefined {
  if (!header) {
    return undefined;
  }
  const { modules: _ignoredModules, ...rest } = header;
  return rest;
}

function collectLocalPaths(params: ToolParams): string[] {
  return [...(params.localPath ? [params.localPath] : []), ...(params.localPaths ?? [])]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeState(status: unknown): string | undefined {
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    return undefined;
  }
  const state = (status as Record<string, unknown>).state;
  if (typeof state !== "string") {
    return undefined;
  }
  return state.toUpperCase();
}

function isTerminalState(state: string | undefined): boolean {
  if (!state) {
    return false;
  }
  return TERMINAL_STATES.has(state.toUpperCase());
}

function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function detectMissingPythonModule(logText: string): string | undefined {
  const patterns = [
    /ModuleNotFoundError:\s+No module named ['"]([^'"]+)['"]/i,
    /ImportError:\s+No module named ['"]?([A-Za-z0-9_.-]+)['"]?/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(logText);
    const moduleName = match?.[1]?.trim();
    if (moduleName) {
      return moduleName;
    }
  }

  return undefined;
}

function buildMissingPackageHint(moduleName: string, cluster: string) {
  return {
    module: moduleName,
    strategy: "install-into-profile-env",
    note: `Install with run_workload on cluster profile "${cluster}". The profile setupCommands already load the target environment.`,
    suggestedCommands: [
      `python3 -m pip install ${moduleName}`,
      `python3 -c "import ${moduleName}; print(${moduleName}.__version__)"`,
    ],
  };
}

export function buildClusterSlurmTool(params: {
  config: ClusterSlurmConfig;
  workspaceDir: string;
  runner?: CommandRunner;
}) {
  const service = new ClusterSlurmService({
    config: params.config,
    workspaceDir: params.workspaceDir,
    runner: params.runner,
  });

  async function runWorkload(raw: ToolParams) {
    const commands = collectCommands(raw);
    const localUploadPaths = collectLocalPaths(raw);
    const existingRun = raw.runId ? await service.getRunRecord(raw.runId) : undefined;
    if (raw.allowEnvOverrides) {
      throw new Error(
        "run_workload does not support allowEnvOverrides. Configure environment bootstrap in the selected cluster profile.",
      );
    }

    const envOverrideFields = collectEnvOverrideFields(raw);
    if (envOverrideFields.length > 0) {
      throw new Error(
        `run_workload rejected call-level environment overrides (${envOverrideFields.join(", ")}). Configure setupCommands/slurmDefaults.modules in the cluster profile instead.`,
      );
    }

    const inlineEnvBootstrap = detectInlineEnvBootstrap(commands);
    if (inlineEnvBootstrap) {
      throw new Error(
        `run_workload rejected inline ${inlineEnvBootstrap.label} (${inlineEnvBootstrap.line}). Use profile setupCommands/moduleInitScripts in cluster config.`,
      );
    }

    const explicitCluster = raw.cluster?.trim();
    if (existingRun && explicitCluster && existingRun.clusterId !== explicitCluster) {
      throw new Error(
        `runId ${existingRun.runId} belongs to cluster "${existingRun.clusterId}" (requested "${explicitCluster}")`,
      );
    }

    const selection = selectClusterForWorkload({
      config: params.config,
      explicitCluster: explicitCluster,
      workloadSignals: [...(raw.workload ? [raw.workload] : []), ...commands],
    });

    const primaryCluster = explicitCluster ?? existingRun?.clusterId ?? selection.clusterId;

    const executeSubmit = async (
      clusterId: string,
      run?: ClusterRunRecord,
      seed?: { runId?: string; prefix?: string },
    ) => {
      const activeRun =
        run ??
        (
          await service.createRun({
            cluster: clusterId,
            runId: seed?.runId,
            prefix: seed?.prefix,
          })
        ).run;

      if (localUploadPaths.length > 0) {
        await service.upload({
          cluster: clusterId,
          runId: activeRun.runId,
          localPaths: localUploadPaths,
        });
      }

      const rendered = await service.renderJob({
        cluster: clusterId,
        runId: activeRun.runId,
        scriptPath: raw.scriptPath,
        scriptName: raw.scriptName,
        commands,
        env: raw.env,
        headerOverrides: withoutHeaderModules(raw.headerOverrides),
      });

      const submitted = await service.submitJob({
        cluster: clusterId,
        runId: activeRun.runId,
        scriptPath: rendered.localScriptPath,
        remoteDir: raw.remoteDir,
        submitArgs: raw.submitArgs,
      });

      return {
        run: activeRun,
        rendered,
        submitted,
      };
    };

    try {
      const started = await executeSubmit(primaryCluster, existingRun, {
        runId: existingRun ? undefined : raw.runId,
        prefix: existingRun ? undefined : raw.prefix,
      });
      return {
        mode: "run_workload",
        cluster: primaryCluster,
        clusterSelection: selection,
        runId: started.run.runId,
        jobId: started.submitted.jobId,
        remoteRunDir: started.run.remoteRunDir,
        localScriptPath: started.rendered.localScriptPath,
        submitOutput: started.submitted.submitOutput,
        allowEnvOverrides: false,
        fallback: {
          triggered: false,
        },
      };
    } catch (error) {
      const fallbackDecision = shouldFallbackToGpu({
        config: params.config,
        selectedClusterId: primaryCluster,
        errorText: toErrorText(error),
        overrideEnabled: raw.autoFallbackToGpu,
      });

      if (!fallbackDecision.fallback || !fallbackDecision.toClusterId) {
        throw error;
      }
      if (existingRun && localUploadPaths.length === 0) {
        throw new Error(
          `Automatic GPU fallback requires localPath/localPaths when re-routing an existing run (${existingRun.runId})`,
        );
      }

      const fallbackPrefix = `${raw.prefix?.trim() || "run"}-gpu-fallback`;
      const fallback = await executeSubmit(fallbackDecision.toClusterId, undefined, {
        prefix: fallbackPrefix,
      });
      return {
        mode: "run_workload",
        cluster: fallbackDecision.toClusterId,
        clusterSelection: selection,
        runId: fallback.run.runId,
        jobId: fallback.submitted.jobId,
        remoteRunDir: fallback.run.remoteRunDir,
        localScriptPath: fallback.rendered.localScriptPath,
        submitOutput: fallback.submitted.submitOutput,
        allowEnvOverrides: false,
        fallback: {
          triggered: true,
          fromCluster: primaryCluster,
          toCluster: fallbackDecision.toClusterId,
          matchedSignature: fallbackDecision.matchedSignature,
          originalError: toErrorText(error),
        },
      };
    }
  }

  async function checkWorkload(raw: ToolParams) {
    const run = raw.runId ? await service.getRunRecord(raw.runId) : undefined;
    const cluster = raw.cluster?.trim() || run?.clusterId;
    const jobId = raw.jobId?.trim() || run?.lastJobId;

    if (!jobId) {
      throw new Error("jobId is required (or provide runId with a submitted job)");
    }

    const status = await service.jobStatus({
      cluster,
      jobId,
      includeAccounting: raw.includeAccounting,
    });
    const state = normalizeState(status.status);

    return {
      mode: "check_workload",
      runId: run?.runId,
      cluster: status.cluster,
      jobId: status.jobId,
      status: status.status,
      state,
      done: isTerminalState(state),
    };
  }

  async function fetchWorkloadLogs(raw: ToolParams) {
    const run = raw.runId ? await service.getRunRecord(raw.runId) : undefined;
    const cluster = raw.cluster?.trim() || run?.clusterId;
    const jobId = raw.jobId?.trim() || run?.lastJobId;

    if (!raw.remotePath?.trim() && !jobId) {
      throw new Error("jobId is required (or provide remotePath directly)");
    }

    if (!raw.remotePath?.trim() && run && jobId) {
      const stdoutPath = path.posix.join(run.remoteRunDir, `slurm-${jobId}.out`);
      const stderrPath = path.posix.join(run.remoteRunDir, `slurm-${jobId}.err`);
      const [stdoutLogs, stderrLogs] = await Promise.all([
        service.jobLogs({
          cluster,
          runId: run.runId,
          remotePath: stdoutPath,
          tail: raw.tail,
        }),
        service.jobLogs({
          cluster,
          runId: run.runId,
          remotePath: stderrPath,
          tail: raw.tail,
        }),
      ]);

      const mergedLog = [stdoutLogs.log, stderrLogs.log]
        .filter((entry) => entry.length > 0)
        .join("\n");
      const missingModule = detectMissingPythonModule(mergedLog);

      return {
        mode: "fetch_workload_logs",
        runId: run.runId,
        jobId,
        cluster: stdoutLogs.cluster,
        missing: stdoutLogs.missing && stderrLogs.missing,
        log: mergedLog,
        logs: {
          stdout: stdoutLogs,
          stderr: stderrLogs,
        },
        missingPackageHint:
          missingModule && cluster ? buildMissingPackageHint(missingModule, cluster) : undefined,
      };
    }

    const logs = await service.jobLogs({
      cluster,
      runId: run?.runId ?? raw.runId,
      jobId,
      remotePath: raw.remotePath,
      tail: raw.tail,
    });

    const missingModule = detectMissingPythonModule(logs.log);

    return {
      mode: "fetch_workload_logs",
      runId: run?.runId,
      jobId,
      ...logs,
      missingPackageHint:
        missingModule && logs.cluster
          ? buildMissingPackageHint(missingModule, logs.cluster)
          : undefined,
    };
  }

  async function downloadWorkloadOutputs(raw: ToolParams) {
    const run = raw.runId ? await service.getRunRecord(raw.runId) : undefined;
    const cluster = raw.cluster?.trim() || run?.clusterId;
    const remotePath = (() => {
      const explicit = raw.remotePath?.trim();
      if (explicit) {
        return explicit;
      }
      if (run) {
        const remoteFile = raw.remoteFile?.trim() || "result.json";
        return path.posix.join(run.remoteRunDir, remoteFile.replace(/^\/+/, ""));
      }
      throw new Error("remotePath is required (or provide runId to resolve from run directory)");
    })();

    const localPath =
      raw.localPath?.trim() ||
      path.join("downloads", run?.runId ?? "cluster-run", path.posix.basename(remotePath));

    const downloaded = await service.download({
      cluster,
      remotePath,
      localPath,
    });

    return {
      mode: "download_workload_outputs",
      runId: run?.runId,
      ...downloaded,
    };
  }

  return {
    name: "cluster_slurm",
    label: "Cluster SLURM",
    description:
      "Cluster orchestration over SSH for SLURM: submit asynchronous workloads, inspect status/logs (including missing-package hints), and retrieve artifacts using profile-driven routing.",
    parameters: ClusterSlurmToolSchema,
    async execute(_toolCallId: string, raw: ToolParams) {
      switch (raw.action) {
        case "list_clusters":
          return json(service.listClusters());

        case "init_run":
          return json(
            await service.createRun({
              cluster: raw.cluster,
              runId: raw.runId,
              prefix: raw.prefix,
            }),
          );

        case "upload":
          return json(
            await service.upload({
              cluster: raw.cluster,
              runId: raw.runId,
              localPath: raw.localPath,
              localPaths: raw.localPaths,
              remoteDir: raw.remoteDir,
            }),
          );

        case "render_job": {
          const commands = collectCommands(raw);
          const allowEnvOverrides = raw.allowEnvOverrides === true;
          if (!allowEnvOverrides) {
            const inlineEnvBootstrap = detectInlineEnvBootstrap(commands);
            if (inlineEnvBootstrap) {
              throw new Error(
                `render_job rejected inline ${inlineEnvBootstrap.label} (${inlineEnvBootstrap.line}). Use profile setupCommands/moduleInitScripts, or set allowEnvOverrides=true for explicit override.`,
              );
            }
            const envOverrideFields = collectEnvOverrideFields(raw);
            if (envOverrideFields.length > 0) {
              throw new Error(
                `render_job rejected call-level environment overrides (${envOverrideFields.join(", ")}). Use profile setupCommands/slurmDefaults.modules, or set allowEnvOverrides=true for explicit override.`,
              );
            }
          }
          return json(
            await service.renderJob({
              cluster: raw.cluster,
              runId: raw.runId,
              scriptPath: raw.scriptPath,
              scriptName: raw.scriptName,
              commands,
              env: raw.env,
              setupCommands: allowEnvOverrides ? raw.setupCommands : undefined,
              modules: allowEnvOverrides ? raw.modules : undefined,
              headerOverrides: allowEnvOverrides
                ? raw.headerOverrides
                : withoutHeaderModules(raw.headerOverrides),
            }),
          );
        }

        case "submit_job":
          return json(
            await service.submitJob({
              cluster: raw.cluster,
              runId: raw.runId,
              scriptPath: raw.scriptPath,
              remoteDir: raw.remoteDir,
              submitArgs: raw.submitArgs,
            }),
          );

        case "job_status":
          return json(
            await service.jobStatus({
              cluster: raw.cluster,
              jobId: requiredString(raw.jobId, "jobId"),
              includeAccounting: raw.includeAccounting,
            }),
          );

        case "job_logs":
          return json(
            await service.jobLogs({
              cluster: raw.cluster,
              runId: raw.runId,
              jobId: raw.jobId,
              remotePath: raw.remotePath,
              tail: raw.tail,
            }),
          );

        case "download":
          return json(
            await service.download({
              cluster: raw.cluster,
              remotePath: requiredString(raw.remotePath, "remotePath"),
              localPath: requiredString(raw.localPath, "localPath"),
            }),
          );

        case "cancel_job":
          return json(
            await service.cancelJob({
              cluster: raw.cluster,
              jobId: requiredString(raw.jobId, "jobId"),
            }),
          );

        case "run_workload":
          return json(await runWorkload(raw));

        case "check_workload":
          return json(await checkWorkload(raw));

        case "fetch_workload_logs":
          return json(await fetchWorkloadLogs(raw));

        case "download_workload_outputs":
          return json(await downloadWorkloadOutputs(raw));

        default:
          raw.action satisfies never;
          throw new Error(`Unsupported action: ${String(raw.action)}`);
      }
    },
  };
}

export { parseClusterSlurmConfig };

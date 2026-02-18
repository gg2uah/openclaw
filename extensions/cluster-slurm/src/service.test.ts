import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseClusterSlurmConfig } from "./config.js";
import { ClusterSlurmService } from "./service.js";
import { loadLedger } from "./store.js";
import type { CommandRunner } from "./types.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

function createMockRunner() {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: CommandRunner = vi.fn(async (command, args) => {
    calls.push({ command, args });

    if (command === "ssh") {
      const remoteCmd = args[args.length - 1] ?? "";
      if (remoteCmd.includes("sbatch")) {
        return { code: 0, stdout: "Submitted batch job 12345\n", stderr: "" };
      }
      if (remoteCmd.includes("squeue")) {
        return { code: 0, stdout: "12345|RUNNING|00:01:00|01:00:00|1|none\n", stderr: "" };
      }
      if (remoteCmd.includes("tail -n")) {
        return { code: 0, stdout: "line-1\nline-2\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    }

    if (command === "scp") {
      return { code: 0, stdout: "", stderr: "" };
    }

    return { code: 1, stdout: "", stderr: `unexpected command: ${command}` };
  });

  return { runner, calls };
}

describe("cluster-slurm service", () => {
  it("executes end-to-end run flow with mocked SSH/SCP", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-slurm-workspace-"));
    tmpDirs.push(workspace);

    const inputFile = path.join(workspace, "input.txt");
    await fs.writeFile(inputFile, "hello\n", "utf8");

    const cfg = parseClusterSlurmConfig({
      defaultCluster: "gautschi",
      clusters: {
        gautschi: {
          sshTarget: "gautschi",
          remoteRoot: "~/runs",
          setupCommands: ["source ~/.bashrc"],
          slurmDefaults: {
            partition: "gpu",
            time: "00:30:00",
            cpusPerTask: 2,
            mem: "4G",
          },
        },
      },
    });

    const { runner, calls } = createMockRunner();
    const service = new ClusterSlurmService({ config: cfg, workspaceDir: workspace, runner });

    const init = await service.createRun({ prefix: "paper-repl" });
    expect(init.run.runId).toMatch(/^paper-repl-/);

    const upload = await service.upload({ runId: init.run.runId, localPath: "input.txt" });
    expect(upload.uploaded).toHaveLength(1);

    const render = await service.renderJob({
      runId: init.run.runId,
      commands: ["python3 train.py --input input.txt"],
      headerOverrides: { jobName: "paper-repl" },
    });
    expect(render.localScriptPath.endsWith("job.slurm")).toBe(true);
    expect(render.script).toContain("#SBATCH --job-name=paper-repl");

    const submit = await service.submitJob({ runId: init.run.runId });
    expect(submit.jobId).toBe("12345");

    const status = await service.jobStatus({ jobId: submit.jobId });
    expect(status.status.source).toBe("squeue");
    expect(status.status.state).toBe("RUNNING");

    const logs = await service.jobLogs({ runId: init.run.runId, jobId: submit.jobId, tail: 50 });
    expect(logs.missing).toBe(false);
    expect(logs.log).toContain("line-1");

    const download = await service.download({
      remotePath: "~/runs/output/stats.json",
      localPath: "downloads/stats.json",
    });
    expect(download.localPath.endsWith(path.join("downloads", "stats.json"))).toBe(true);

    const cancel = await service.cancelJob({ jobId: submit.jobId });
    expect(cancel.cancelled).toBe(true);

    const ledger = await loadLedger(path.join(workspace, ".openclaw", "cluster-runs"));
    const recorded = ledger.runs[init.run.runId];
    expect(recorded?.lastJobId).toBe("12345");
    expect(recorded?.jobs).toHaveLength(1);

    const joinedCalls = calls.map((entry) => `${entry.command} ${entry.args.join(" ")}`).join("\n");
    expect(joinedCalls).toContain("ssh -o BatchMode=yes gautschi");
    expect(joinedCalls).toContain("scp -o BatchMode=yes -r");
    expect(joinedCalls).toContain("sbatch");
    expect(joinedCalls).toContain("squeue");
    expect(joinedCalls).toContain("scancel");
  });

  it("blocks paths outside workspace", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-slurm-guard-"));
    tmpDirs.push(workspace);

    const cfg = parseClusterSlurmConfig({
      defaultCluster: "gautschi",
      clusters: {
        gautschi: {
          sshTarget: "gautschi",
          remoteRoot: "~/runs",
        },
      },
    });

    const { runner } = createMockRunner();
    const service = new ClusterSlurmService({ config: cfg, workspaceDir: workspace, runner });

    await expect(
      service.download({
        remotePath: "~/runs/output/stats.json",
        localPath: "../escape.txt",
      }),
    ).rejects.toThrow(/inside workspace/);
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseClusterSlurmConfig } from "./config.js";
import { buildClusterSlurmTool } from "./tool.js";
import type { CommandRunner } from "./types.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

function createToolRunner(options?: {
  cpuSubmitFailsWithGpuSignature?: boolean;
  stderrModuleNotFound?: string;
}) {
  const calls: Array<{ command: string; args: string[] }> = [];

  const runner: CommandRunner = vi.fn(async (command, args) => {
    calls.push({ command, args });
    if (command === "ssh") {
      const target = args[2] ?? "";
      const remoteCmd = args[3] ?? "";

      if (remoteCmd.includes("sbatch")) {
        if (options?.cpuSubmitFailsWithGpuSignature && target === "cpu-host") {
          return { code: 1, stdout: "", stderr: "sbatch: gpu is required for this job" };
        }
        return { code: 0, stdout: "Submitted batch job 67890\n", stderr: "" };
      }

      if (remoteCmd.includes("squeue")) {
        return { code: 0, stdout: "67890|RUNNING|00:01:00|01:00:00|1|none\n", stderr: "" };
      }

      if (remoteCmd.includes("tail -n")) {
        if (options?.stderrModuleNotFound && remoteCmd.includes(".err")) {
          return {
            code: 0,
            stdout: `Traceback (most recent call last):
  File "/tmp/job.py", line 1, in <module>
    import ${options.stderrModuleNotFound}
ModuleNotFoundError: No module named '${options.stderrModuleNotFound}'
`,
            stderr: "",
          };
        }
        return { code: 0, stdout: "line-1\nline-2\n", stderr: "" };
      }

      return { code: 0, stdout: "", stderr: "" };
    }

    if (command === "scp") {
      return { code: 0, stdout: "", stderr: "" };
    }

    return { code: 1, stdout: "", stderr: `unexpected command: ${command}` };
  });

  return {
    runner,
    calls,
  };
}

function detailsOf(result: unknown): Record<string, unknown> {
  const parsed = result as { details?: unknown };
  if (!parsed || typeof parsed !== "object" || !parsed.details) {
    throw new Error("tool response missing details");
  }
  return parsed.details as Record<string, unknown>;
}

describe("cluster-slurm tool", () => {
  it("supports natural run/check/log/download flow", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-slurm-tool-"));
    tmpDirs.push(workspace);
    await fs.writeFile(path.join(workspace, "input.json"), '{"values":[1,2,3]}\n', "utf8");
    await fs.writeFile(path.join(workspace, "analyze.py"), "print('ok')\n", "utf8");

    const cfg = parseClusterSlurmConfig({
      defaultCluster: "gautschi-cpu",
      clusters: {
        "gautschi-cpu": {
          sshTarget: "cpu-host",
          remoteRoot: "~/runs/cpu",
        },
        "gautschi-gpu": {
          sshTarget: "gpu-host",
          remoteRoot: "~/runs/gpu",
        },
      },
      routing: {
        defaultProfile: "gautschi-cpu",
        gpuProfile: "gautschi-gpu",
        gpuIndicators: ["torch.cuda"],
      },
    });

    const { runner, calls } = createToolRunner();
    const tool = buildClusterSlurmTool({
      config: cfg,
      workspaceDir: workspace,
      runner,
    });

    const runResult = detailsOf(
      await tool.execute("tc1", {
        action: "run_workload",
        workload: "preprocess data",
        command: "python3 analyze.py input.json result.json",
        localPaths: ["input.json", "analyze.py"],
      }),
    );
    expect(runResult.cluster).toBe("gautschi-cpu");
    expect(runResult.jobId).toBe("67890");
    expect((runResult.fallback as { triggered?: boolean }).triggered).toBe(false);

    const runId = String(runResult.runId ?? "");
    expect(runId.length).toBeGreaterThan(0);

    const statusResult = detailsOf(
      await tool.execute("tc2", {
        action: "check_workload",
        runId,
      }),
    );
    expect(statusResult.mode).toBe("check_workload");
    expect(statusResult.done).toBe(false);
    expect(statusResult.state).toBe("RUNNING");

    const logsResult = detailsOf(
      await tool.execute("tc3", {
        action: "fetch_workload_logs",
        runId,
      }),
    );
    expect(logsResult.mode).toBe("fetch_workload_logs");
    expect(logsResult.missing).toBe(false);

    const downloadResult = detailsOf(
      await tool.execute("tc4", {
        action: "download_workload_outputs",
        runId,
      }),
    );
    expect(downloadResult.mode).toBe("download_workload_outputs");
    expect(String(downloadResult.localPath ?? "")).toContain(path.join("downloads", runId));

    const joinedCalls = calls.map((entry) => `${entry.command} ${entry.args.join(" ")}`).join("\n");
    expect(joinedCalls).toContain("cpu-host");
    expect(joinedCalls).toContain("sbatch");
    expect(joinedCalls).toContain("squeue");
    expect(joinedCalls).toContain("tail -n");
  });

  it("falls back once from cpu to gpu when submit error matches signature", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-slurm-tool-fallback-"));
    tmpDirs.push(workspace);
    await fs.writeFile(path.join(workspace, "analyze.py"), "print('ok')\n", "utf8");

    const cfg = parseClusterSlurmConfig({
      defaultCluster: "gautschi-cpu",
      clusters: {
        "gautschi-cpu": {
          sshTarget: "cpu-host",
          remoteRoot: "~/runs/cpu",
        },
        "gautschi-gpu": {
          sshTarget: "gpu-host",
          remoteRoot: "~/runs/gpu",
        },
      },
      routing: {
        defaultProfile: "gautschi-cpu",
        gpuProfile: "gautschi-gpu",
        gpuRequiredErrorSignatures: ["gpu is required"],
      },
    });

    const { runner, calls } = createToolRunner({ cpuSubmitFailsWithGpuSignature: true });
    const tool = buildClusterSlurmTool({
      config: cfg,
      workspaceDir: workspace,
      runner,
    });

    const runResult = detailsOf(
      await tool.execute("tc5", {
        action: "run_workload",
        workload: "run python workload",
        command: "python3 analyze.py",
        localPath: "analyze.py",
      }),
    );

    expect(runResult.cluster).toBe("gautschi-gpu");
    const fallback = runResult.fallback as Record<string, unknown>;
    expect(fallback.triggered).toBe(true);
    expect(fallback.fromCluster).toBe("gautschi-cpu");
    expect(fallback.toCluster).toBe("gautschi-gpu");
    expect(fallback.matchedSignature).toBe("gpu is required");

    const joinedCalls = calls.map((entry) => `${entry.command} ${entry.args.join(" ")}`).join("\n");
    expect(joinedCalls).toContain("cpu-host");
    expect(joinedCalls).toContain("gpu-host");
  });

  it("enforces profile-managed environment bootstrap in run_workload", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-slurm-tool-env-"));
    tmpDirs.push(workspace);
    await fs.writeFile(path.join(workspace, "analyze.py"), "print('ok')\n", "utf8");

    const cfg = parseClusterSlurmConfig({
      defaultCluster: "gautschi-cpu",
      clusters: {
        "gautschi-cpu": {
          sshTarget: "cpu-host",
          remoteRoot: "~/runs/cpu",
        },
      },
    });

    const { runner } = createToolRunner();
    const tool = buildClusterSlurmTool({
      config: cfg,
      workspaceDir: workspace,
      runner,
    });

    const baseline = detailsOf(
      await tool.execute("tc6", {
        action: "run_workload",
        command: "python3 analyze.py",
        localPath: "analyze.py",
      }),
    );
    const baselineScript = await fs.readFile(String(baseline.localScriptPath), "utf8");
    expect(baselineScript).not.toContain("OPENCLAW_SETUP_OVERRIDE");
    expect(baselineScript).not.toContain("module load openclaw/module");
    expect(baseline.allowEnvOverrides).toBe(false);

    await expect(
      tool.execute("tc7", {
        action: "run_workload",
        command: "python3 analyze.py",
        localPath: "analyze.py",
        setupCommands: ["echo OPENCLAW_SETUP_OVERRIDE"],
        modules: ["openclaw/module"],
      }),
    ).rejects.toThrow(/rejected call-level environment overrides/);

    await expect(
      tool.execute("tc7b", {
        action: "run_workload",
        command: "python3 analyze.py",
        localPath: "analyze.py",
        allowEnvOverrides: true,
      }),
    ).rejects.toThrow(/allowEnvOverrides is disabled by cluster-slurm config/);

    await expect(
      tool.execute("tc7c", {
        action: "run_workload",
        command: "python3 analyze.py",
        localPath: "analyze.py",
        headerOverrides: {
          modules: ["anaconda"],
        },
      }),
    ).rejects.toThrow(/headerOverrides\.modules/);
  });

  it("rejects inline environment bootstrap commands in run_workload", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-slurm-tool-inline-env-"));
    tmpDirs.push(workspace);
    await fs.writeFile(path.join(workspace, "analyze.py"), "print('ok')\n", "utf8");

    const cfg = parseClusterSlurmConfig({
      defaultCluster: "gautschi-cpu",
      clusters: {
        "gautschi-cpu": {
          sshTarget: "cpu-host",
          remoteRoot: "~/runs/cpu",
        },
      },
    });

    const { runner } = createToolRunner();
    const tool = buildClusterSlurmTool({
      config: cfg,
      workspaceDir: workspace,
      runner,
    });

    await expect(
      tool.execute("tc8", {
        action: "run_workload",
        command: "module load anaconda\npython3 analyze.py",
        localPath: "analyze.py",
      }),
    ).rejects.toThrow(/rejected inline module command/);

    await expect(
      tool.execute("tc8b", {
        action: "run_workload",
        command: "conda create -y -p /scratch/envs/test python=3.11\npython3 analyze.py",
        localPath: "analyze.py",
      }),
    ).rejects.toThrow(/rejected custom environment mutation/);
  });

  it("allows custom environment mutation in run_workload only when explicit override is enabled", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-slurm-run-override-"));
    tmpDirs.push(workspace);
    await fs.writeFile(path.join(workspace, "analyze.py"), "print('ok')\n", "utf8");

    const cfg = parseClusterSlurmConfig({
      defaultCluster: "gautschi-cpu",
      clusters: {
        "gautschi-cpu": {
          sshTarget: "cpu-host",
          remoteRoot: "~/runs/cpu",
        },
      },
      execution: {
        allowCustomEnvOverride: true,
      },
    });

    const { runner } = createToolRunner();
    const tool = buildClusterSlurmTool({
      config: cfg,
      workspaceDir: workspace,
      runner,
    });

    const started = detailsOf(
      await tool.execute("tc9", {
        action: "run_workload",
        command:
          "conda create -y -p /scratch/envs/test python=3.11\nsource activate /scratch/envs/test\npython3 analyze.py",
        localPath: "analyze.py",
        allowEnvOverrides: true,
      }),
    );

    expect(started.allowEnvOverrides).toBe(true);
    const runScript = await fs.readFile(String(started.localScriptPath ?? ""), "utf8");
    expect(runScript).toContain("conda create -y -p /scratch/envs/test python=3.11");
    expect(runScript).toContain("source activate /scratch/envs/test");
  });

  it("applies explicit env override gating to render_job", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-slurm-render-guard-"));
    tmpDirs.push(workspace);

    const cfg = parseClusterSlurmConfig({
      defaultCluster: "gautschi-cpu",
      clusters: {
        "gautschi-cpu": {
          sshTarget: "cpu-host",
          remoteRoot: "~/runs/cpu",
        },
      },
    });

    const { runner } = createToolRunner();
    const tool = buildClusterSlurmTool({
      config: cfg,
      workspaceDir: workspace,
      runner,
    });

    await expect(
      tool.execute("tc10", {
        action: "render_job",
        command: "module load anaconda\npython3 app.py",
      }),
    ).rejects.toThrow(/render_job rejected inline module command/);

    await expect(
      tool.execute("tc10b", {
        action: "render_job",
        command: "python3 app.py",
        setupCommands: ["module load conda"],
      }),
    ).rejects.toThrow(/render_job rejected call-level environment overrides/);

    await expect(
      tool.execute("tc10c", {
        action: "render_job",
        command: "python3 app.py",
        headerOverrides: {
          modules: ["anaconda"],
        },
      }),
    ).rejects.toThrow(/headerOverrides\.modules/);

    await expect(
      tool.execute("tc11", {
        action: "render_job",
        command: "python3 app.py",
        allowEnvOverrides: true,
      }),
    ).rejects.toThrow(/allowEnvOverrides is disabled by cluster-slurm config/);

    const cfgWithOverride = parseClusterSlurmConfig({
      defaultCluster: "gautschi-cpu",
      clusters: {
        "gautschi-cpu": {
          sshTarget: "cpu-host",
          remoteRoot: "~/runs/cpu",
        },
      },
      execution: {
        allowCustomEnvOverride: true,
      },
    });
    const toolWithOverride = buildClusterSlurmTool({
      config: cfgWithOverride,
      workspaceDir: workspace,
      runner,
    });

    const rendered = detailsOf(
      await toolWithOverride.execute("tc11b", {
        action: "render_job",
        command:
          "conda create -y -p /scratch/envs/test python=3.11\nsource activate /scratch/envs/test\npython3 app.py",
        allowEnvOverrides: true,
      }),
    );
    const renderedScript = await fs.readFile(String(rendered.localScriptPath ?? ""), "utf8");
    expect(renderedScript).toContain("conda create -y -p /scratch/envs/test python=3.11");
    expect(renderedScript).toContain("source activate /scratch/envs/test");
  });

  it("returns missing-package hint when stderr reports ModuleNotFoundError", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-slurm-missing-pkg-"));
    tmpDirs.push(workspace);
    await fs.writeFile(path.join(workspace, "analyze.py"), "print('ok')\n", "utf8");

    const cfg = parseClusterSlurmConfig({
      defaultCluster: "gautschi-cpu",
      clusters: {
        "gautschi-cpu": {
          sshTarget: "cpu-host",
          remoteRoot: "~/runs/cpu",
        },
      },
    });

    const { runner } = createToolRunner({ stderrModuleNotFound: "matplotlib" });
    const tool = buildClusterSlurmTool({
      config: cfg,
      workspaceDir: workspace,
      runner,
    });

    const started = detailsOf(
      await tool.execute("tc12", {
        action: "run_workload",
        command: "python3 analyze.py",
        localPath: "analyze.py",
      }),
    );
    const runId = String(started.runId ?? "");

    const logs = detailsOf(
      await tool.execute("tc13", {
        action: "fetch_workload_logs",
        runId,
      }),
    );

    const hint = logs.missingPackageHint as Record<string, unknown>;
    expect(hint.module).toBe("matplotlib");
    expect(hint.strategy).toBe("install-into-profile-env");
    expect(Array.isArray(hint.suggestedCommands)).toBe(true);
    expect((hint.suggestedCommands as string[]).join("\n")).toContain(
      "python3 -m pip install matplotlib",
    );
  });
});

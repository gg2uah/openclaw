import { describe, expect, it } from "vitest";
import { parseClusterSlurmConfig } from "./config.js";

describe("cluster-slurm config", () => {
  it("returns defaults for empty config", () => {
    const cfg = parseClusterSlurmConfig(undefined);
    expect(cfg.localRunsDir).toBe(".openclaw/cluster-runs");
    expect(cfg.clusters).toEqual({});
    expect(cfg.routing.defaultProfile).toBeUndefined();
    expect(cfg.routing.gpuIndicators.length).toBeGreaterThan(0);
    expect(cfg.routing.autoFallbackToGpuOnSignatures).toBe(true);
    expect(cfg.execution.allowCustomEnvOverride).toBe(false);
  });

  it("parses a valid cluster profile", () => {
    const cfg = parseClusterSlurmConfig({
      defaultCluster: "gautschi",
      clusters: {
        gautschi: {
          sshTarget: "gautschi",
          remoteRoot: "~/agentic-labs/runs",
          loginShell: true,
          moduleInitScripts: ["/etc/profile.d/modules.sh"],
          slurmDefaults: {
            partition: "gpu",
            time: "01:00:00",
            gpusPerNode: 1,
          },
        },
      },
    });

    expect(cfg.defaultCluster).toBe("gautschi");
    expect(cfg.clusters.gautschi?.sshTarget).toBe("gautschi");
    expect(cfg.clusters.gautschi?.slurmDefaults.partition).toBe("gpu");
    expect(cfg.clusters.gautschi?.slurmDefaults.gpusPerNode).toBe(1);
    expect(cfg.clusters.gautschi?.pythonCommand).toBe("python3");
    expect(cfg.clusters.gautschi?.loginShell).toBe(true);
    expect(cfg.clusters.gautschi?.moduleInitScripts).toEqual(["/etc/profile.d/modules.sh"]);
    expect(cfg.routing.defaultProfile).toBe("gautschi");
    expect(cfg.execution.allowCustomEnvOverride).toBe(false);
  });

  it("defaults loginShell to false", () => {
    const cfg = parseClusterSlurmConfig({
      clusters: {
        gautschi: {
          sshTarget: "gautschi",
          remoteRoot: "~/runs",
        },
      },
    });
    expect(cfg.clusters.gautschi?.loginShell).toBe(false);
  });

  it("fails when both gpus and gpusPerNode are set", () => {
    expect(() =>
      parseClusterSlurmConfig({
        clusters: {
          gautschi: {
            sshTarget: "gautschi",
            remoteRoot: "~/runs",
            slurmDefaults: {
              gpus: 1,
              gpusPerNode: 1,
            },
          },
        },
      }),
    ).toThrow(/both gpus and gpusPerNode/);
  });

  it("fails when defaultCluster points to missing profile", () => {
    expect(() =>
      parseClusterSlurmConfig({
        defaultCluster: "bell",
        clusters: {
          gautschi: {
            sshTarget: "gautschi",
            remoteRoot: "~/runs",
          },
        },
      }),
    ).toThrow(/defaultCluster/);
  });

  it("parses routing config and validates profile references", () => {
    const cfg = parseClusterSlurmConfig({
      clusters: {
        "gautschi-cpu": {
          sshTarget: "gautschi",
          remoteRoot: "~/runs",
        },
        "gautschi-gpu": {
          sshTarget: "gautschi",
          remoteRoot: "~/runs",
        },
      },
      routing: {
        defaultProfile: "gautschi-cpu",
        gpuProfile: "gautschi-gpu",
        gpuIndicators: ["torch.cuda", "/--device\\s+cuda/i"],
        autoFallbackToGpuOnSignatures: false,
        gpuRequiredErrorSignatures: ["cuda is required"],
      },
      execution: {
        allowCustomEnvOverride: true,
      },
    });

    expect(cfg.routing.defaultProfile).toBe("gautschi-cpu");
    expect(cfg.routing.gpuProfile).toBe("gautschi-gpu");
    expect(cfg.routing.gpuIndicators).toEqual(["torch.cuda", "/--device\\s+cuda/i"]);
    expect(cfg.routing.autoFallbackToGpuOnSignatures).toBe(false);
    expect(cfg.routing.gpuRequiredErrorSignatures).toEqual(["cuda is required"]);
    expect(cfg.execution.allowCustomEnvOverride).toBe(true);
  });

  it("fails when routing profile references a missing cluster", () => {
    expect(() =>
      parseClusterSlurmConfig({
        clusters: {
          "gautschi-cpu": {
            sshTarget: "gautschi",
            remoteRoot: "~/runs",
          },
        },
        routing: {
          gpuProfile: "gautschi-gpu",
        },
      }),
    ).toThrow(/routing\.gpuProfile/);
  });
});

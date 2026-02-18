import { describe, expect, it } from "vitest";
import { parseClusterSlurmConfig } from "./config.js";

describe("cluster-slurm config", () => {
  it("returns defaults for empty config", () => {
    const cfg = parseClusterSlurmConfig(undefined);
    expect(cfg.localRunsDir).toBe(".openclaw/cluster-runs");
    expect(cfg.clusters).toEqual({});
  });

  it("parses a valid cluster profile", () => {
    const cfg = parseClusterSlurmConfig({
      defaultCluster: "gautschi",
      clusters: {
        gautschi: {
          sshTarget: "gautschi",
          remoteRoot: "~/agentic-labs/runs",
          slurmDefaults: {
            partition: "gpu",
            time: "01:00:00",
            gpus: 1,
          },
        },
      },
    });

    expect(cfg.defaultCluster).toBe("gautschi");
    expect(cfg.clusters.gautschi?.sshTarget).toBe("gautschi");
    expect(cfg.clusters.gautschi?.slurmDefaults.partition).toBe("gpu");
    expect(cfg.clusters.gautschi?.pythonCommand).toBe("python3");
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
});

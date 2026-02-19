import { describe, expect, it } from "vitest";
import { parseClusterSlurmConfig } from "./config.js";
import { selectClusterForWorkload, shouldFallbackToGpu } from "./routing.js";

describe("cluster-slurm routing", () => {
  const config = parseClusterSlurmConfig({
    defaultCluster: "gautschi-cpu",
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
      gpuProfile: "gautschi-gpu",
      gpuIndicators: ["torch.cuda", "/--device\\s+cuda/i"],
      gpuRequiredErrorSignatures: ["cuda is required", "gpu is required"],
    },
  });

  it("prefers explicit cluster over routing signals", () => {
    const selected = selectClusterForWorkload({
      config,
      explicitCluster: "gautschi-cpu",
      workloadSignals: ["train with torch.cuda"],
    });

    expect(selected.clusterId).toBe("gautschi-cpu");
    expect(selected.reason).toBe("explicit_cluster");
  });

  it("routes to gpu profile when indicator matches", () => {
    const selected = selectClusterForWorkload({
      config,
      workloadSignals: ["run this with --device cuda"],
    });

    expect(selected.clusterId).toBe("gautschi-gpu");
    expect(selected.reason).toBe("gpu_indicator");
    expect(selected.matchedIndicator).toBe("/--device\\s+cuda/i");
  });

  it("keeps cpu default when indicators are absent", () => {
    const selected = selectClusterForWorkload({
      config,
      workloadSignals: ["preprocess csv files"],
    });

    expect(selected.clusterId).toBe("gautschi-cpu");
    expect(selected.reason).toBe("configured_default");
  });

  it("enables fallback when gpu-required signature appears on cpu", () => {
    const fallback = shouldFallbackToGpu({
      config,
      selectedClusterId: "gautschi-cpu",
      errorText: "RuntimeError: CUDA is required for this workload",
    });

    expect(fallback.fallback).toBe(true);
    expect(fallback.toClusterId).toBe("gautschi-gpu");
    expect(fallback.matchedSignature).toBe("cuda is required");
  });

  it("does not fallback when already on gpu profile", () => {
    const fallback = shouldFallbackToGpu({
      config,
      selectedClusterId: "gautschi-gpu",
      errorText: "cuda is required",
    });

    expect(fallback.fallback).toBe(false);
  });
});

import type { ClusterSlurmConfig } from "./types.js";

const DEFAULT_GPU_INDICATORS = [
  "torch.cuda",
  "--device cuda",
  "device=cuda",
  "jax[cuda]",
  "jaxlib",
  "tensorflow-gpu",
  "cupy",
  "triton",
  "nvidia-smi",
  "cuda",
];

const DEFAULT_GPU_REQUIRED_ERROR_SIGNATURES = [
  "cuda is required",
  "cuda required",
  "gpu is required",
  "gpu required",
  "no cuda devices",
  "no cuda device",
  "found no nvidia driver",
  "torch.cuda.is_available() is false",
];

type IndicatorMatch = {
  matched: boolean;
  indicator?: string;
};

function matchIndicator(text: string, indicator: string): boolean {
  const normalized = indicator.trim();
  if (!normalized) {
    return false;
  }

  const regexMatch = /^\/(.+)\/([a-z]*)$/.exec(normalized);
  if (regexMatch) {
    const pattern = regexMatch[1];
    const flags = regexMatch[2];
    try {
      return new RegExp(pattern, flags).test(text);
    } catch {
      // If regex syntax is invalid, fall back to plain substring matching.
    }
  }

  return text.toLowerCase().includes(normalized.toLowerCase());
}

function findIndicatorMatch(text: string, indicators: string[]): IndicatorMatch {
  for (const indicator of indicators) {
    if (matchIndicator(text, indicator)) {
      return {
        matched: true,
        indicator: indicator.trim(),
      };
    }
  }
  return { matched: false };
}

export function selectClusterForWorkload(params: {
  config: ClusterSlurmConfig;
  explicitCluster?: string;
  workloadSignals?: string[];
}) {
  const explicitCluster = params.explicitCluster?.trim();
  if (explicitCluster) {
    return {
      clusterId: explicitCluster,
      reason: "explicit_cluster",
    };
  }

  const gpuProfile = params.config.routing.gpuProfile;
  if (gpuProfile) {
    const searchable = (params.workloadSignals ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .join("\n");
    if (searchable.length > 0) {
      const match = findIndicatorMatch(searchable, params.config.routing.gpuIndicators);
      if (match.matched) {
        return {
          clusterId: gpuProfile,
          reason: "gpu_indicator",
          matchedIndicator: match.indicator,
        };
      }
    }
  }

  const configuredDefault =
    params.config.routing.defaultProfile ?? params.config.defaultCluster ?? undefined;
  if (configuredDefault) {
    return {
      clusterId: configuredDefault,
      reason: "configured_default",
    };
  }

  const profiles = Object.keys(params.config.clusters);
  if (profiles.length === 1) {
    return {
      clusterId: profiles[0] ?? "",
      reason: "single_profile",
    };
  }

  throw new Error(
    "Unable to select cluster profile: configure routing.defaultProfile/defaultCluster or pass cluster explicitly",
  );
}

export function shouldFallbackToGpu(params: {
  config: ClusterSlurmConfig;
  selectedClusterId: string;
  errorText: string;
  overrideEnabled?: boolean;
}) {
  const enabled = params.overrideEnabled ?? params.config.routing.autoFallbackToGpuOnSignatures;
  if (!enabled) {
    return {
      fallback: false,
      reason: "disabled",
    };
  }

  const gpuProfile = params.config.routing.gpuProfile;
  if (!gpuProfile) {
    return {
      fallback: false,
      reason: "no_gpu_profile",
    };
  }

  if (params.selectedClusterId === gpuProfile) {
    return {
      fallback: false,
      reason: "already_gpu",
    };
  }

  const signatures = params.config.routing.gpuRequiredErrorSignatures;
  const match = findIndicatorMatch(params.errorText, signatures);
  if (!match.matched) {
    return {
      fallback: false,
      reason: "no_signature_match",
    };
  }

  return {
    fallback: true,
    toClusterId: gpuProfile,
    matchedSignature: match.indicator,
  };
}

export { DEFAULT_GPU_INDICATORS, DEFAULT_GPU_REQUIRED_ERROR_SIGNATURES };

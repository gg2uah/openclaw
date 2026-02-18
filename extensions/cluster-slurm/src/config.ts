import type { ClusterProfile, ClusterSlurmConfig, SlurmHeader } from "./types.js";

const DEFAULT_LOCAL_RUNS_DIR = ".openclaw/cluster-runs";

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, field: string): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown, field: string): number | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error(`${field} must be a positive number`);
  }
  return Math.floor(value);
}

function readStringArray(value: unknown, field: string): string[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of strings`);
  }
  const entries = value
    .map((entry, idx) => {
      if (typeof entry !== "string") {
        throw new Error(`${field}[${idx}] must be a string`);
      }
      return entry.trim();
    })
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(entries));
}

function parseSlurmDefaults(value: unknown, field: string): SlurmHeader {
  if (value == null) {
    return {};
  }
  const obj = asObject(value, field);
  return {
    jobName: readString(obj.jobName, `${field}.jobName`),
    partition: readString(obj.partition, `${field}.partition`),
    account: readString(obj.account, `${field}.account`),
    qos: readString(obj.qos, `${field}.qos`),
    constraint: readString(obj.constraint, `${field}.constraint`),
    time: readString(obj.time, `${field}.time`),
    nodes: readNumber(obj.nodes, `${field}.nodes`),
    ntasksPerNode: readNumber(obj.ntasksPerNode, `${field}.ntasksPerNode`),
    cpusPerTask: readNumber(obj.cpusPerTask, `${field}.cpusPerTask`),
    mem: readString(obj.mem, `${field}.mem`),
    gpus: readNumber(obj.gpus, `${field}.gpus`),
    gres: readString(obj.gres, `${field}.gres`),
    output: readString(obj.output, `${field}.output`),
    error: readString(obj.error, `${field}.error`),
    modules: readStringArray(obj.modules, `${field}.modules`),
  };
}

function parseCluster(id: string, value: unknown): ClusterProfile {
  const base = `clusters.${id}`;
  const obj = asObject(value, base);
  const sshTarget = readString(obj.sshTarget, `${base}.sshTarget`);
  const remoteRoot = readString(obj.remoteRoot, `${base}.remoteRoot`);
  if (!sshTarget) {
    throw new Error(`${base}.sshTarget is required`);
  }
  if (!remoteRoot) {
    throw new Error(`${base}.remoteRoot is required`);
  }

  const scheduler = readString(obj.scheduler, `${base}.scheduler`) ?? "slurm";
  if (scheduler !== "slurm") {
    throw new Error(`${base}.scheduler must be \"slurm\"`);
  }

  return {
    id,
    sshTarget,
    remoteRoot,
    scheduler,
    pythonCommand: readString(obj.pythonCommand, `${base}.pythonCommand`) ?? "python3",
    submitArgs: readStringArray(obj.submitArgs, `${base}.submitArgs`),
    setupCommands: readStringArray(obj.setupCommands, `${base}.setupCommands`),
    slurmDefaults: parseSlurmDefaults(obj.slurmDefaults, `${base}.slurmDefaults`),
  };
}

export function parseClusterSlurmConfig(value: unknown): ClusterSlurmConfig {
  if (value == null) {
    return {
      localRunsDir: DEFAULT_LOCAL_RUNS_DIR,
      clusters: {},
    };
  }

  const obj = asObject(value, "cluster-slurm config");
  const clustersObj = obj.clusters == null ? {} : asObject(obj.clusters, "clusters");
  const clusters: Record<string, ClusterProfile> = {};

  for (const [id, entry] of Object.entries(clustersObj)) {
    const trimmedId = id.trim();
    if (!trimmedId) {
      continue;
    }
    clusters[trimmedId] = parseCluster(trimmedId, entry);
  }

  const defaultCluster = readString(obj.defaultCluster, "defaultCluster");
  if (defaultCluster && !clusters[defaultCluster]) {
    throw new Error(
      `defaultCluster \"${defaultCluster}\" does not exist in clusters (${Object.keys(clusters).join(", ") || "none"})`,
    );
  }

  const localRunsDir = readString(obj.localRunsDir, "localRunsDir") ?? DEFAULT_LOCAL_RUNS_DIR;

  return {
    defaultCluster,
    localRunsDir,
    clusters,
  };
}

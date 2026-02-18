export type SlurmHeader = {
  jobName?: string;
  partition?: string;
  account?: string;
  qos?: string;
  constraint?: string;
  time?: string;
  nodes?: number;
  ntasks?: number;
  ntasksPerNode?: number;
  cpusPerTask?: number;
  mem?: string;
  gpus?: number;
  gpusPerNode?: number;
  gres?: string;
  output?: string;
  error?: string;
  modules?: string[];
};

export type ClusterProfile = {
  id: string;
  sshTarget: string;
  remoteRoot: string;
  scheduler: "slurm";
  pythonCommand: string;
  submitArgs: string[];
  setupCommands: string[];
  slurmDefaults: SlurmHeader;
};

export type ClusterSlurmConfig = {
  defaultCluster?: string;
  localRunsDir: string;
  clusters: Record<string, ClusterProfile>;
};

export type ClusterRunJob = {
  jobId: string;
  remoteScriptPath: string;
  localScriptPath: string;
  submittedAt: string;
  submitOutput: string;
};

export type ClusterRunRecord = {
  runId: string;
  clusterId: string;
  localRunDir: string;
  remoteRunDir: string;
  createdAt: string;
  updatedAt: string;
  latestScriptPath?: string;
  lastJobId?: string;
  jobs: ClusterRunJob[];
};

export type ClusterRunsLedger = {
  runs: Record<string, ClusterRunRecord>;
};

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
) => Promise<CommandResult>;

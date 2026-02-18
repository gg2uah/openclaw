import { Type } from "@sinclair/typebox";
import { stringEnum } from "openclaw/plugin-sdk";
import { parseClusterSlurmConfig } from "./config.js";
import { ClusterSlurmService } from "./service.js";
import type { ClusterSlurmConfig, CommandRunner } from "./types.js";

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
] as const;

const HeaderOverridesSchema = Type.Object(
  {
    jobName: Type.Optional(Type.String()),
    partition: Type.Optional(Type.String()),
    account: Type.Optional(Type.String()),
    qos: Type.Optional(Type.String()),
    constraint: Type.Optional(Type.String()),
    time: Type.Optional(Type.String()),
    nodes: Type.Optional(Type.Number({ minimum: 1 })),
    ntasksPerNode: Type.Optional(Type.Number({ minimum: 1 })),
    cpusPerTask: Type.Optional(Type.Number({ minimum: 1 })),
    mem: Type.Optional(Type.String()),
    gpus: Type.Optional(Type.Number({ minimum: 1 })),
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
    cluster: Type.Optional(Type.String({ description: "Configured cluster id" })),
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
    scriptPath: Type.Optional(Type.String({ description: "Workspace-relative job script path" })),
    scriptName: Type.Optional(Type.String({ description: "Generated job filename" })),
    command: Type.Optional(Type.String({ description: "Single shell command for render_job" })),
    commands: Type.Optional(
      Type.Array(Type.String(), { description: "Command list for render_job" }),
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
  scriptPath?: string;
  scriptName?: string;
  command?: string;
  commands?: string[];
  env?: Record<string, string>;
  setupCommands?: string[];
  modules?: string[];
  headerOverrides?: Record<string, unknown>;
  submitArgs?: string[];
  jobId?: string;
  includeAccounting?: boolean;
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

  return {
    name: "cluster_slurm",
    label: "Cluster SLURM",
    description:
      "Cluster orchestration over SSH for SLURM: list clusters, create runs, upload files, render/submit jobs, inspect status/logs, download outputs, and cancel jobs.",
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

        case "render_job":
          return json(
            await service.renderJob({
              cluster: raw.cluster,
              runId: raw.runId,
              scriptPath: raw.scriptPath,
              scriptName: raw.scriptName,
              commands: collectCommands(raw),
              env: raw.env,
              setupCommands: raw.setupCommands,
              modules: raw.modules,
              headerOverrides: raw.headerOverrides,
            }),
          );

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

        default:
          raw.action satisfies never;
          throw new Error(`Unsupported action: ${String(raw.action)}`);
      }
    },
  };
}

export { parseClusterSlurmConfig };

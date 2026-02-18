import type { SlurmHeader } from "./types.js";

function formatDirective(flag: string, value: string | number | undefined): string[] {
  if (value == null || value === "") {
    return [];
  }
  return [`#SBATCH --${flag}=${String(value)}`];
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function mergeSlurmHeader(
  defaults: SlurmHeader,
  overrides?: Partial<SlurmHeader>,
): SlurmHeader {
  if (!overrides) {
    return { ...defaults, modules: [...(defaults.modules ?? [])] };
  }
  return {
    ...defaults,
    ...overrides,
    modules: overrides.modules ?? defaults.modules ?? [],
  };
}

export function renderSlurmScript(params: {
  header: SlurmHeader;
  commands: string[];
  env?: Record<string, string>;
  setupCommands?: string[];
  modules?: string[];
}): string {
  if (!params.commands || params.commands.length === 0) {
    throw new Error("At least one command is required to render a SLURM script");
  }

  const lines: string[] = ["#!/bin/bash"];
  const h = params.header;

  lines.push(...formatDirective("job-name", h.jobName));
  lines.push(...formatDirective("partition", h.partition));
  lines.push(...formatDirective("account", h.account));
  lines.push(...formatDirective("qos", h.qos));
  lines.push(...formatDirective("constraint", h.constraint));
  lines.push(...formatDirective("time", h.time));
  lines.push(...formatDirective("nodes", h.nodes));
  lines.push(...formatDirective("ntasks-per-node", h.ntasksPerNode));
  lines.push(...formatDirective("cpus-per-task", h.cpusPerTask));
  lines.push(...formatDirective("mem", h.mem));
  lines.push(...formatDirective("gpus", h.gpus));
  lines.push(...formatDirective("gres", h.gres));
  lines.push(...formatDirective("output", h.output));
  lines.push(...formatDirective("error", h.error));

  lines.push("", "set -euo pipefail", "");

  if (params.env) {
    for (const [key, value] of Object.entries(params.env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`Invalid environment variable name: ${key}`);
      }
      lines.push(`export ${key}=${shellEscape(String(value))}`);
    }
    lines.push("");
  }

  const modules = Array.from(
    new Set([...(h.modules ?? []), ...(params.modules ?? [])].map((entry) => entry.trim())),
  ).filter((entry) => entry.length > 0);

  for (const mod of modules) {
    lines.push(`module load ${mod}`);
  }

  for (const setup of params.setupCommands ?? []) {
    const trimmed = setup.trim();
    if (trimmed.length > 0) {
      lines.push(trimmed);
    }
  }

  if (modules.length > 0 || (params.setupCommands?.length ?? 0) > 0) {
    lines.push("");
  }

  for (const command of params.commands) {
    const trimmed = command.trim();
    if (trimmed.length > 0) {
      lines.push(trimmed);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function parseSubmittedJobId(stdout: string): string {
  const text = stdout.trim();
  const strict = /Submitted\s+batch\s+job\s+(\d+)/i.exec(text);
  if (strict?.[1]) {
    return strict[1];
  }
  const loose = /\bjob\s+(\d+)\b/i.exec(text);
  if (loose?.[1]) {
    return loose[1];
  }
  const bare = /\b(\d{3,})\b/.exec(text);
  if (bare?.[1]) {
    return bare[1];
  }
  throw new Error(`Unable to parse job id from sbatch output: ${text || "<empty>"}`);
}

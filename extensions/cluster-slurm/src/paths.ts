import fs from "node:fs/promises";
import path from "node:path";

export function sanitizeRunId(input: string): string {
  const safe = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  if (!safe) {
    throw new Error("runId cannot be empty after sanitization");
  }
  return safe;
}

export function resolveRunsRoot(workspaceDir: string, localRunsDir: string): string {
  const base = path.resolve(workspaceDir);
  const candidate = path.resolve(base, localRunsDir);
  if (!isPathInside(base, candidate)) {
    throw new Error(`localRunsDir must stay inside workspace (${workspaceDir})`);
  }
  return candidate;
}

export function isPathInside(base: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function resolveWorkspacePath(workspaceDir: string, inputPath: string): string {
  const base = path.resolve(workspaceDir);
  const resolved = path.resolve(base, inputPath);
  if (!isPathInside(base, resolved)) {
    throw new Error(`Path must stay inside workspace: ${inputPath}`);
  }
  return resolved;
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export function toPosixRemotePath(...parts: string[]): string {
  const cleaned = parts
    .filter((part) => part.trim().length > 0)
    .map((part) => part.replace(/\\/g, "/"));
  const joined = cleaned.join("/").replace(/\/+/g, "/");
  return joined;
}

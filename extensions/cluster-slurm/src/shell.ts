import path from "node:path";
import { runChecked } from "./exec.js";
import type { CommandRunner, CommandResult } from "./types.js";

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function scpTarget(sshTarget: string, remotePath: string): string {
  const normalized = remotePath.replace(/\\/g, "/");
  return `${sshTarget}:${normalized}`;
}

export async function sshExec(
  runner: CommandRunner,
  sshTarget: string,
  remoteCommand: string,
  timeoutMs?: number,
): Promise<CommandResult> {
  return await runChecked(
    runner,
    "ssh",
    ["-o", "BatchMode=yes", sshTarget, remoteCommand],
    timeoutMs != null ? { timeoutMs } : undefined,
  );
}

export async function scpUpload(
  runner: CommandRunner,
  sshTarget: string,
  localPaths: string[],
  remoteDir: string,
  timeoutMs?: number,
): Promise<CommandResult> {
  const args = ["-o", "BatchMode=yes", "-r", ...localPaths, scpTarget(sshTarget, remoteDir)];
  return await runChecked(runner, "scp", args, timeoutMs != null ? { timeoutMs } : undefined);
}

export async function scpDownload(
  runner: CommandRunner,
  sshTarget: string,
  remotePath: string,
  localDestination: string,
  timeoutMs?: number,
): Promise<CommandResult> {
  const args = [
    "-o",
    "BatchMode=yes",
    "-r",
    scpTarget(sshTarget, remotePath),
    path.resolve(localDestination),
  ];
  return await runChecked(runner, "scp", args, timeoutMs != null ? { timeoutMs } : undefined);
}

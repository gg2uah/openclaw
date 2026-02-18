import { spawn } from "node:child_process";
import type { CommandResult, CommandRunner } from "./types.js";

export const defaultCommandRunner: CommandRunner = async (command, args, options = {}) => {
  const timeoutMs = options.timeoutMs ?? 0;
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | null = null;

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      if (timer) {
        clearTimeout(timer);
      }
      reject(err);
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, timeoutMs);
    }

    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
};

export async function runChecked(
  runner: CommandRunner,
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
): Promise<CommandResult> {
  const result = await runner(command, args, options);
  if (result.code !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const detail = stderr || stdout || `exit code ${result.code}`;
    throw new Error(`${command} failed: ${detail}`);
  }
  return result;
}

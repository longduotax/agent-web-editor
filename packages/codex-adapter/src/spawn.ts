import { spawn } from "node:child_process";

import type { CodexTransport } from "./client.js";

export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Runs `codex app-server` and presents its stdio as newline-delimited frames.
 *
 * Codex writes one JSON object per line, but a pipe delivers bytes, not lines:
 * a single frame can arrive in several chunks and several frames can arrive in
 * one. The buffer here is what makes "a line" a real boundary.
 */
export async function spawnCodexTransport(
  command: string,
  args: string[],
  options: SpawnOptions,
): Promise<CodexTransport> {
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });

  let lineListener: ((line: string) => void) | undefined;
  let exitListener:
    | ((info: { code: number | null; signal: string | null }) => void)
    | undefined;
  let settled = false;
  const announceExit = (info: {
    code: number | null;
    signal: string | null;
  }): void => {
    if (settled) return;
    settled = true;
    exitListener?.(info);
  };

  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim() !== "") lineListener?.(line);
      newline = buffer.indexOf("\n");
    }
  });

  // A failed spawn emits "error", never "exit"; both must reach the same
  // listener or a missing binary would hang instead of failing.
  child.on("error", () => {
    announceExit({ code: null, signal: null });
  });
  child.on("exit", (code, signal) => {
    announceExit({ code, signal });
  });

  return await Promise.resolve({
    send(line: string): void {
      if (child.stdin.writable) child.stdin.write(`${line}\n`);
    },
    onLine(listener: (line: string) => void): void {
      lineListener = listener;
    },
    onExit(
      listener: (info: { code: number | null; signal: string | null }) => void,
    ): void {
      exitListener = listener;
    },
    close(): void {
      if (!child.killed) child.kill();
    },
  });
}

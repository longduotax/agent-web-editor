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
    | ((info: {
        code: number | null;
        signal: string | null;
        error?: Error;
      }) => void)
    | undefined;
  let exitInfo:
    | {
        code: number | null;
        signal: string | null;
        error?: Error;
      }
    | undefined;
  const announceExit = (info: {
    code: number | null;
    signal: string | null;
    error?: Error;
  }): void => {
    if (exitInfo !== undefined) return;
    exitInfo = info;
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

  // A failed spawn emits "error", never "exit". Carrying the error through is
  // what lets a missing binary be reported as such rather than as a mysterious
  // stop with an unknown exit code. Stdin errors (notably EPIPE during an exit
  // race) use the same path so they cannot become unhandled process errors.
  child.on("error", (error: Error) => {
    announceExit({ code: null, signal: null, error });
  });
  child.stdin.on("error", (error: Error) => {
    announceExit({ code: null, signal: null, error });
  });
  child.on("exit", (code, signal) => {
    announceExit({ code, signal });
  });

  return await Promise.resolve({
    send(line: string): void {
      if (exitInfo !== undefined) return;
      if (!child.stdin.writable) {
        announceExit({
          code: null,
          signal: null,
          error: new Error("Codex app-server stdin is not writable."),
        });
        return;
      }
      try {
        child.stdin.write(`${line}\n`, (error) => {
          if (error !== null && error !== undefined)
            announceExit({ code: null, signal: null, error });
        });
      } catch (error) {
        announceExit({
          code: null,
          signal: null,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    },
    onLine(listener: (line: string) => void): void {
      lineListener = listener;
    },
    onExit(
      listener: (info: {
        code: number | null;
        signal: string | null;
        error?: Error;
      }) => void,
    ): void {
      exitListener = listener;
      if (exitInfo !== undefined) listener(exitInfo);
    },
    close(): void {
      if (!child.killed) child.kill();
    },
  });
}

import { spawn } from "node:child_process";
import process from "node:process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();

const child = spawn(pnpm, ["exec", "vitest", "run", ...args], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "test" },
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal !== null) {
      reject(new Error(`Vitest stopped after signal ${signal}.`));
      return;
    }
    resolve(code ?? 1);
  });
});

process.exitCode = exitCode;

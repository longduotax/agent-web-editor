import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { z } from "zod";

export interface ServerConfig {
  host: "127.0.0.1";
  port: number;
  devPort: number;
  stateDirectory: string;
  bodyLimit: number;
  production: boolean;
  allowedHosts: ReadonlySet<string>;
  allowedOrigins: ReadonlySet<string>;
}

export interface ParseConfigOptions {
  argv?: string[];
  environment?: NodeJS.ProcessEnv;
  allowTestPortZero?: boolean;
}

const portTextSchema = z.string().regex(/^\d+$/);

function cliPort(argv: string[]): string | undefined {
  let result: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--port") {
      const next = argv[index + 1];
      if (next === undefined || result !== undefined)
        throw new Error("--port requires exactly one value");
      result = next;
      index += 1;
    } else if (value?.startsWith("--port=")) {
      if (result !== undefined)
        throw new Error("--port may only be provided once");
      result = value.slice("--port=".length);
    }
  }
  return result;
}

export function parsePort(raw: string | undefined, allowZero = false): number {
  const value = raw ?? "3001";
  const parsed = portTextSchema.safeParse(value);
  if (!parsed.success)
    throw new Error("Port must be an integer from 1 through 65535");
  const port = Number(parsed.data);
  if ((!allowZero && port === 0) || port < 0 || port > 65_535)
    throw new Error("Port must be an integer from 1 through 65535");
  return port;
}

export function parseConfig(options: ParseConfigOptions = {}): ServerConfig {
  const argv = options.argv ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const port = parsePort(
    cliPort(argv) ?? environment.PI_WEB_PORT,
    options.allowTestPortZero === true,
  );
  const devPort = parsePort(environment.PI_WEB_DEV_PORT ?? "5173");
  const configuredState = environment.PI_WEB_STATE_DIR;
  const stateDirectory =
    configuredState ?? join(homedir(), ".pi", "web-workspace");
  if (!isAbsolute(stateDirectory))
    throw new Error("PI_WEB_STATE_DIR must be an absolute path");
  const normalizedState = resolve(stateDirectory);
  const origin = `http://127.0.0.1:${String(port)}`;
  const production = environment.NODE_ENV === "production";
  const hosts = new Set([`127.0.0.1:${String(port)}`]);
  const origins = new Set([origin]);
  if (port === 80) hosts.add("127.0.0.1");
  if (!production) origins.add(`http://127.0.0.1:${String(devPort)}`);
  return {
    host: "127.0.0.1",
    port,
    devPort,
    stateDirectory: normalizedState,
    bodyLimit: 1_048_576,
    production,
    allowedHosts: hosts,
    allowedOrigins: origins,
  };
}

import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import type { CodexSandbox } from "@pi-web/codex-adapter";
import type { RuntimeKind } from "@pi-web/contracts";
import { z } from "zod";

const namingModelTextSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._:/-]+$/);

export interface NamingModelSelector {
  provider: string;
  id: string;
}

export function parseNamingModelSelector(
  value: string | undefined,
): NamingModelSelector | null {
  if (value === undefined) return null;
  const parsed = namingModelTextSchema.safeParse(value);
  if (!parsed.success)
    throw new Error("PI_WEB_NAMING_MODEL must be provider/model");
  const separator = parsed.data.indexOf("/");
  return {
    provider: parsed.data.slice(0, separator),
    id: parsed.data.slice(separator + 1),
  };
}

const runtimeKindTextSchema = z.enum(["pi", "codex"]);
const codexSandboxTextSchema = z.enum([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
const codexCommandTextSchema = z.string().min(1);

export interface ServerConfig {
  host: "127.0.0.1";
  port: number;
  devPort: number;
  stateDirectory: string;
  bodyLimit: number;
  production: boolean;
  namingModel: NamingModelSelector | null;
  /** Backend for chats created without an explicit choice (AGB-02). */
  defaultRuntime: RuntimeKind;
  /** File and network boundary every Codex chat runs under (AGB-06). */
  codexSandbox: CodexSandbox;
  codexCommand: string;
  codexHome: string | undefined;
  codexReplayTools: boolean;
  allowedHosts: ReadonlySet<string>;
  allowedOrigins: ReadonlySet<string>;
}

export interface ParseConfigOptions {
  argv?: string[];
  environment?: NodeJS.ProcessEnv;
  allowTestPortZero?: boolean;
}

const portTextSchema = z.string().regex(/^\d+$/);

/**
 * Every spelling of the loopback address this server is bound to. They all
 * name the SAME machine, so the host/origin allowlist must treat them
 * identically: allowlisting only `127.0.0.1` left a browser opened at
 * `http://localhost:<port>` able to read but unable to write, because every
 * mutation was rejected with 403 `forbidden_request`.
 *
 * This list is exhaustive and closed on purpose. The allowlist is this
 * local-first app's DNS-rebinding defence: an attacker-controlled name that
 * resolves to 127.0.0.1 still fails both the host and the origin check,
 * because neither is a substring match — both are exact set membership over
 * `<authority>` / `http://<authority>` built from these three literals and
 * the ports this server actually serves. Never widen it to a wildcard, a
 * suffix match, or a caller-supplied value.
 */
const LOOPBACK_AUTHORITIES = ["127.0.0.1", "localhost", "[::1]"] as const;

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

/**
 * Reads one optional environment value, falling back to a default and naming
 * the variable on failure so a misconfigured machine says which line to fix.
 */
function parseEnum<T>(
  schema: z.ZodType<T>,
  value: string | undefined,
  fallback: T,
  variable: string,
): T {
  if (value === undefined) return fallback;
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new Error(`${variable} is not a supported value: ${value}`);
  return parsed.data;
}

export function parseConfig(options: ParseConfigOptions = {}): ServerConfig {
  const argv = options.argv ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const port = parsePort(
    cliPort(argv) ?? environment.PI_WEB_PORT,
    options.allowTestPortZero === true,
  );
  const devPort = parsePort(environment.PI_WEB_DEV_PORT ?? "5173");
  const namingModel = parseNamingModelSelector(environment.PI_WEB_NAMING_MODEL);
  const defaultRuntime = parseEnum(
    runtimeKindTextSchema,
    environment.PI_WEB_DEFAULT_RUNTIME,
    "codex",
    "PI_WEB_DEFAULT_RUNTIME",
  );
  const codexSandbox = parseEnum(
    codexSandboxTextSchema,
    environment.PI_WEB_CODEX_SANDBOX,
    "workspace-write",
    "PI_WEB_CODEX_SANDBOX",
  );
  const codexCommand = parseEnum(
    codexCommandTextSchema,
    environment.PI_WEB_CODEX_BIN,
    "codex",
    "PI_WEB_CODEX_BIN",
  );
  const configuredCodexHome =
    environment.PI_WEB_CODEX_HOME ?? environment.CODEX_HOME;
  if (configuredCodexHome !== undefined && !isAbsolute(configuredCodexHome))
    throw new Error(
      `${environment.PI_WEB_CODEX_HOME === undefined ? "CODEX_HOME" : "PI_WEB_CODEX_HOME"} must be an absolute path`,
    );
  const codexHome =
    configuredCodexHome === undefined
      ? undefined
      : resolve(configuredCodexHome);
  const codexReplayTools =
    parseEnum(
      z.enum(["on", "off"]),
      environment.PI_WEB_CODEX_REPLAY_TOOLS,
      "on",
      "PI_WEB_CODEX_REPLAY_TOOLS",
    ) === "on";
  const configuredState = environment.PI_WEB_STATE_DIR;
  const stateDirectory =
    configuredState ?? join(homedir(), ".pi", "web-workspace");
  if (!isAbsolute(stateDirectory))
    throw new Error("PI_WEB_STATE_DIR must be an absolute path");
  const normalizedState = resolve(stateDirectory);
  const production = environment.NODE_ENV === "production";
  const hosts = new Set<string>();
  const origins = new Set<string>();
  for (const loopback of LOOPBACK_AUTHORITIES) {
    hosts.add(`${loopback}:${String(port)}`);
    origins.add(`http://${loopback}:${String(port)}`);
    if (port === 80) {
      hosts.add(loopback);
      origins.add(`http://${loopback}`);
    }
    if (!production) origins.add(`http://${loopback}:${String(devPort)}`);
  }
  return {
    host: "127.0.0.1",
    port,
    devPort,
    stateDirectory: normalizedState,
    bodyLimit: 1_048_576,
    production,
    namingModel,
    defaultRuntime,
    codexSandbox,
    codexCommand,
    codexHome,
    codexReplayTools,
    allowedHosts: hosts,
    allowedOrigins: origins,
  };
}

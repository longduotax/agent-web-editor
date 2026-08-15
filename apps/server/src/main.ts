import { fileURLToPath } from "node:url";

import { config as loadEnvironment } from "dotenv";

import { buildServer } from "./app.js";
import { parseConfig } from "./config.js";

loadEnvironment({
  path: fileURLToPath(new URL("../../../.env.local", import.meta.url)),
  quiet: true,
});

try {
  const config = parseConfig();
  const server = await buildServer({ config });
  await server.listen({ host: config.host, port: config.port });
  server.log.info("Pi Web Workspace is listening on loopback only.");
  process.stdout.write(`Open ${server.workspaceContext.launchUrl}\n`);
} catch (error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unknown startup failure";
  process.stderr.write(`Pi Web Workspace failed to start: ${message}\n`);
  process.exitCode = 1;
}

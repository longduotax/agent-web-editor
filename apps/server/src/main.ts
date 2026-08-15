import { buildServer } from "./app.js";

const server = buildServer();

try {
  await server.listen({ host: "127.0.0.1", port: 3001 });
} catch (error: unknown) {
  server.log.error(error);
  process.exitCode = 1;
}

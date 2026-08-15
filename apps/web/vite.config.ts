import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

function port(raw: string | undefined, fallback: number, name: string): number {
  const value = raw ?? String(fallback);
  if (!/^\d+$/.test(value))
    throw new Error(`${name} must be an integer from 1 through 65535`);
  const parsed = Number(value);
  if (parsed < 1 || parsed > 65_535)
    throw new Error(`${name} must be an integer from 1 through 65535`);
  return parsed;
}

export default defineConfig(({ mode }) => {
  const repositoryRoot = resolve(import.meta.dirname, "../..");
  const fileEnvironment = loadEnv(mode, repositoryRoot, "");
  const environment = { ...fileEnvironment, ...process.env };
  const backendPort = port(environment.PI_WEB_PORT, 3001, "PI_WEB_PORT");
  const devPort = port(environment.PI_WEB_DEV_PORT, 5173, "PI_WEB_DEV_PORT");

  return {
    envDir: repositoryRoot,
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: devPort,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${String(backendPort)}`,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});

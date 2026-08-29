import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("test"),
  },
  test: {
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.ts"],
    // Keep test-only React resolution and browser globals inside isolated
    // workers rather than changing the process that loads this config.
    env: { NODE_ENV: "test" },
    isolate: true,
    unstubGlobals: true,
    coverage: {
      reporter: ["text", "json", "html"],
    },
  },
});

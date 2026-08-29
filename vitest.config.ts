import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.ts"],
    setupFiles: ["./apps/web/src/testSetup.ts"],
    coverage: {
      reporter: ["text", "json", "html"],
    },
  },
});

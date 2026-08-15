import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const typeScriptFiles = ["**/*.{ts,tsx}"];
const typeCheckedConfigs = [
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
].map((config) => ({ ...config, files: typeScriptFiles }));

export default defineConfig(
  globalIgnores(["**/dist/**", "**/coverage/**", "**/node_modules/**"]),
  eslint.configs.recommended,
  ...typeCheckedConfigs,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["apps/server/**/*.ts", "packages/**/*.ts", "*.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  prettier,
);

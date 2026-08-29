import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { beforeAll, describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "../../..");
let bootstrapSource = "";

beforeAll(async () => {
  bootstrapSource = await readFile(
    resolve(webRoot, "public/theme-init.js"),
    "utf8",
  );
});

function appliedTheme(storedPreference: string | null): string | null {
  let theme: string | null = null;
  const context = {
    localStorage: {
      getItem: (): string | null => storedPreference,
    },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string): void => {
          if (name === "data-theme") theme = value;
        },
      },
    },
  };

  runInNewContext(bootstrapSource, context);
  return theme;
}

describe("theme bootstrap", () => {
  it("loads the same-origin bootstrap synchronously before the app bundle", async () => {
    const index = await readFile(resolve(webRoot, "index.html"), "utf8");
    const bootstrapPosition = index.indexOf(
      '<script src="/theme-init.js"></script>',
    );
    const appPosition = index.indexOf(
      '<script type="module" src="/src/main.tsx"></script>',
    );

    expect(bootstrapPosition).toBeGreaterThan(-1);
    expect(bootstrapPosition).toBeLessThan(appPosition);
    expect(index).not.toContain("localStorage.getItem");
  });

  it("applies a valid pinned Light preference", () => {
    expect(appliedTheme(JSON.stringify({ version: 1, choice: "light" }))).toBe(
      "light",
    );
  });

  it("leaves System and invalid preferences to the CSS media query", () => {
    expect(
      appliedTheme(JSON.stringify({ version: 1, choice: "system" })),
    ).toBeNull();
    expect(
      appliedTheme(JSON.stringify({ version: 99, choice: "dark" })),
    ).toBeNull();
    expect(appliedTheme("{not json")).toBeNull();
  });
});

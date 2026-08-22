import { describe, expect, it } from "vitest";

import { classifyDiff, classifyDiffLine } from "./diffLines.js";

describe("unified diff line classification", () => {
  it("distinguishes added, removed, hunk and context lines", () => {
    expect(classifyDiffLine("+const added = 1;")).toBe("add");
    expect(classifyDiffLine("-const removed = 1;")).toBe("remove");
    expect(classifyDiffLine("@@ -1,7 +1,9 @@ function main() {")).toBe("hunk");
    expect(classifyDiffLine(" unchanged")).toBe("context");
    expect(classifyDiffLine("")).toBe("context");
  });

  it("never paints a file header as an addition or a removal", () => {
    // The trap: `+++`/`---` start with `+`/`-`.
    expect(classifyDiffLine("+++ b/apps/web/src/App.tsx")).toBe("meta");
    expect(classifyDiffLine("--- a/apps/web/src/App.tsx")).toBe("meta");
    expect(classifyDiffLine("diff --git a/a.ts b/a.ts")).toBe("meta");
    expect(classifyDiffLine("index 1234567..89abcde 100644")).toBe("meta");
    expect(classifyDiffLine("new file mode 100644")).toBe("meta");
    expect(classifyDiffLine("deleted file mode 100644")).toBe("meta");
    expect(classifyDiffLine("rename from old.ts")).toBe("meta");
    expect(classifyDiffLine("\\ No newline at end of file")).toBe("meta");
  });

  it("classifies a whole diff line by line and preserves blank lines", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,3 +1,3 @@",
      " keep",
      "-gone",
      "+new",
      "",
    ].join("\n");

    expect(classifyDiff(diff)).toEqual([
      { kind: "meta", text: "diff --git a/a.ts b/a.ts" },
      { kind: "meta", text: "--- a/a.ts" },
      { kind: "meta", text: "+++ b/a.ts" },
      { kind: "hunk", text: "@@ -1,3 +1,3 @@" },
      { kind: "context", text: " keep" },
      { kind: "remove", text: "-gone" },
      { kind: "add", text: "+new" },
      { kind: "context", text: "" },
    ]);
  });

  it("returns nothing for an empty diff", () => {
    expect(classifyDiff("")).toEqual([]);
  });
});

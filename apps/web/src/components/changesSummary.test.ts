import { describe, expect, it } from "vitest";
import type { GitFileStatus } from "@pi-web/contracts";

import { summarizeChanges } from "./changesSummary.js";

function file(
  path: string,
  kind: GitFileStatus["kind"],
  originalPath: string | null = null,
): GitFileStatus {
  return {
    path,
    originalPath,
    indexStatus: " ",
    worktreeStatus: " ",
    kind,
  };
}

describe("summarizeChanges", () => {
  it("reports a clean worktree", () => {
    expect(summarizeChanges([])).toBe("No changes");
  });

  it("reports a single file without pluralising the count away", () => {
    expect(summarizeChanges([file("a.ts", "modified")])).toBe("1 modified");
    expect(summarizeChanges([file("a.ts", "added")])).toBe("1 added");
    expect(summarizeChanges([file("a.ts", "deleted")])).toBe("1 deleted");
  });

  it("counts an untracked file as an addition", () => {
    expect(summarizeChanges([file("new.ts", "untracked")])).toBe("1 added");
  });

  it("counts renamed, copied and conflicted files as modifications", () => {
    expect(
      summarizeChanges([
        file("b.ts", "renamed", "a.ts"),
        file("c.ts", "copied", "a.ts"),
        file("d.ts", "conflicted"),
      ]),
    ).toBe("3 modified");
  });

  it("joins the three buckets in a fixed order and omits empty ones", () => {
    expect(
      summarizeChanges([
        file("a.ts", "deleted"),
        file("b.ts", "untracked"),
        file("c.ts", "modified"),
        file("d.ts", "added"),
        file("e.ts", "deleted"),
      ]),
    ).toBe("2 added, 1 modified, 2 deleted");
    expect(
      summarizeChanges([file("a.ts", "added"), file("b.ts", "deleted")]),
    ).toBe("1 added, 1 deleted");
  });
});

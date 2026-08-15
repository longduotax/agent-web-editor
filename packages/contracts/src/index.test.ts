import { describe, expect, it } from "vitest";

import {
  AddProjectRequestSchema,
  ProjectIdSchema,
  RelativePathSchema,
  TerminalClientFrameSchema,
} from "./index.js";

const id = "00000000-0000-4000-8000-000000000001";

describe("wire contracts", () => {
  it("constructs opaque identifiers and strict command bodies", () => {
    expect(ProjectIdSchema.parse(id)).toBe(id);
    expect(
      AddProjectRequestSchema.safeParse({
        path: "/tmp/project",
        idempotencyKey: id,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it.each([
    "../secret",
    "a/../secret",
    "/etc/passwd",
    "C:/secret",
    "a\\b",
    "a/%2e%2e/b",
    "a//b",
    "a\0b",
  ])("rejects unsafe relative path %s", (path) => {
    expect(RelativePathSchema.safeParse(path).success).toBe(false);
  });

  it("accepts a normalized project-relative path", () => {
    expect(RelativePathSchema.parse("src/features/App.tsx")).toBe(
      "src/features/App.tsx",
    );
  });

  it("does not coerce terminal dimensions", () => {
    expect(
      TerminalClientFrameSchema.safeParse({
        version: 1,
        type: "resize",
        projectId: id,
        columns: "80",
        rows: 24,
      }).success,
    ).toBe(false);
  });
});

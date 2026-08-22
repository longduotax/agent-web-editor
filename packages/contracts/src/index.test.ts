import { describe, expect, it } from "vitest";

import {
  ArchiveThreadRequestSchema,
  ArchiveThreadResponseSchema,
  UnarchiveThreadRequestSchema,
  UnarchiveThreadResponseSchema,
  BrowseProjectRequestSchema,
  BrowseProjectResponseSchema,
  LiveDiagnosticSchema,
  ProjectIdSchema,
  SessionIdSchema,
  RelativePathSchema,
  StartThreadRequestSchema,
  GitBranchSchema,
  TerminalClientFrameSchema,
} from "./index.js";

const id = "00000000-0000-4000-8000-000000000001";
const threadId = "00000000-0000-4000-8000-000000000003";

describe("wire contracts", () => {
  it("constructs opaque identifiers", () => {
    expect(ProjectIdSchema.parse(id)).toBe(id);
    expect(SessionIdSchema.parse(id)).toBe(id);
  });

  it("parses strict browse requests and selected or cancelled outcomes", () => {
    expect(BrowseProjectRequestSchema.parse({ idempotencyKey: id })).toEqual({
      idempotencyKey: id,
    });
    expect(
      BrowseProjectRequestSchema.safeParse({
        idempotencyKey: id,
        path: "/tmp/project",
      }).success,
    ).toBe(false);
    expect(BrowseProjectResponseSchema.parse({ outcome: "cancelled" })).toEqual(
      { outcome: "cancelled" },
    );
    expect(
      BrowseProjectResponseSchema.safeParse({
        outcome: "cancelled",
        path: "/tmp/project",
      }).success,
    ).toBe(false);
  });

  it("parses explicit clean and local-change worktree starts", () => {
    expect(
      StartThreadRequestSchema.parse({
        prompt: "Build worktrees",
        workspace: {
          mode: "worktree",
          baseBranch: "main",
          sourceChanges: "none",
        },
        idempotencyKey: id,
      }).workspace,
    ).toMatchObject({ mode: "worktree", sourceChanges: "none" });
    expect(
      StartThreadRequestSchema.safeParse({
        prompt: "Build worktrees",
        workspace: {
          mode: "worktree",
          baseBranch: "main",
          sourceChanges: "tracked_and_untracked",
          path: "/tmp/unsafe",
        },
        idempotencyKey: id,
      }).success,
    ).toBe(false);
  });

  it.each(["../main", "main..next", "main/", "-main", "main branch"])(
    "rejects malformed Git branch %s",
    (branch) => {
      expect(GitBranchSchema.safeParse(branch).success).toBe(false);
    },
  );

  it("parses strict archive commands and acknowledgements", () => {
    expect(ArchiveThreadRequestSchema.parse({ idempotencyKey: id })).toEqual({
      idempotencyKey: id,
    });
    expect(
      ArchiveThreadRequestSchema.safeParse({
        idempotencyKey: id,
        archived: true,
      }).success,
    ).toBe(false);
    expect(ArchiveThreadResponseSchema.parse({ archived: true })).toEqual({
      archived: true,
    });
    expect(
      ArchiveThreadResponseSchema.safeParse({ archived: false }).success,
    ).toBe(false);
  });

  it("parses strict unarchive commands and acknowledgements", () => {
    expect(UnarchiveThreadRequestSchema.parse({ idempotencyKey: id })).toEqual({
      idempotencyKey: id,
    });
    expect(
      UnarchiveThreadRequestSchema.safeParse({
        idempotencyKey: id,
        archived: false,
      }).success,
    ).toBe(false);
    expect(UnarchiveThreadResponseSchema.parse({ archived: false })).toEqual({
      archived: false,
    });
    // The two acknowledgements are not interchangeable in either direction.
    expect(
      UnarchiveThreadResponseSchema.safeParse({ archived: true }).success,
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

  it("requires a terminal ID for terminal controls", () => {
    const terminalId = "00000000-0000-4000-8000-000000000002";
    expect(
      TerminalClientFrameSchema.parse({
        version: 1,
        type: "input",
        projectId: id,
        threadId,
        terminalId,
        data: "echo ready",
      }),
    ).toMatchObject({ type: "input", terminalId });
    for (const frame of [
      { version: 1, type: "input", projectId: id, data: "echo missing" },
      {
        version: 1,
        type: "resize",
        projectId: id,
        terminalId: "not-a-uuid",
        columns: 80,
        rows: 24,
      },
      { version: 1, type: "restart", projectId: id },
      { version: 1, type: "terminate", projectId: id },
    ])
      expect(TerminalClientFrameSchema.safeParse(frame).success).toBe(false);
  });

  it("requires a thread ID for every terminal frame", () => {
    const terminalId = "00000000-0000-4000-8000-000000000002";
    for (const frame of [
      { version: 1, type: "attach", projectId: id },
      {
        version: 1,
        type: "input",
        projectId: id,
        terminalId,
        data: "echo missing",
      },
      {
        version: 1,
        type: "resize",
        projectId: id,
        terminalId,
        columns: 80,
        rows: 24,
      },
      { version: 1, type: "restart", projectId: id, terminalId },
      { version: 1, type: "terminate", projectId: id, terminalId },
    ])
      expect(TerminalClientFrameSchema.safeParse(frame).success).toBe(false);
  });
});

// `LiveEventSchema.payload` is `unknown` because four event types share one
// envelope, so a diagnostic payload has to be asserted at the point of use —
// the same arrangement `transcript` already has with TranscriptItemSchema.
// Before this existed there was nothing to assert it WITH, which is part of
// why the client used diagnostics only as a refetch trigger.
describe("LiveDiagnosticSchema", () => {
  it("accepts the payload the server republishes, code and all", () => {
    expect(
      LiveDiagnosticSchema.parse({
        type: "diagnostic",
        level: "warning",
        code: "provider_retry",
        message: "Provider retry 2 of 5.",
      }),
    ).toEqual({
      type: "diagnostic",
      level: "warning",
      code: "provider_retry",
      message: "Provider retry 2 of 5.",
    });
  });

  it("accepts a runtime that predates the code field", () => {
    expect(
      LiveDiagnosticSchema.safeParse({
        type: "diagnostic",
        level: "info",
        message: "Compacted the session.",
      }).success,
    ).toBe(true);
  });

  it("rejects payloads from the envelope's other event types", () => {
    for (const payload of [
      { type: "transcript", level: "warning", message: "x" },
      { type: "diagnostic", level: "fatal", message: "x" },
      { type: "diagnostic", level: "warning", message: "" },
      { type: "diagnostic", level: "warning" },
    ])
      expect(LiveDiagnosticSchema.safeParse(payload).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  ArchiveThreadRequestSchema,
  ArchiveThreadResponseSchema,
  UnarchiveThreadRequestSchema,
  UnarchiveThreadResponseSchema,
  BrowseProjectRequestSchema,
  BrowseProjectResponseSchema,
  ProjectIdSchema,
  SessionIdSchema,
  RelativePathSchema,
  StartThreadRequestSchema,
  CreateThreadRequestSchema,
  ImportThreadRequestSchema,
  RuntimeKindSchema,
  SessionDescriptorSchema,
  ThreadSummarySchema,
  GitBranchSchema,
  TerminalClientFrameSchema,
  TranscriptCursorSchema,
  TranscriptPageSchema,
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

describe("bounded transcript pages", () => {
  const message = (index: number) => ({
    id: `message-${String(index)}`,
    kind: "message" as const,
    role: "assistant" as const,
    text: `message ${String(index)}`,
    timestamp: null,
  });

  it("accepts one strict bounded chronological page", () => {
    const cursor = TranscriptCursorSchema.parse("abcdefghijklmnop");
    expect(
      TranscriptPageSchema.parse({
        items: [message(1), message(2)],
        olderCursor: cursor,
        atLatest: true,
      }).items,
    ).toHaveLength(2);
    expect(
      TranscriptPageSchema.safeParse({
        items: [],
        olderCursor: null,
        atLatest: true,
        nativePath: "/private/history.jsonl",
      }).success,
    ).toBe(false);
  });

  it("rejects more than 100 wire items and malformed cursors", () => {
    expect(
      TranscriptPageSchema.safeParse({
        items: Array.from({ length: 101 }, (_, index) => message(index)),
        olderCursor: null,
        atLatest: false,
      }).success,
    ).toBe(false);
    expect(TranscriptCursorSchema.safeParse("../history").success).toBe(false);
  });
});

describe("agent backend runtime kind", () => {
  const summary = {
    id: threadId,
    projectId: id,
    title: "A chat",
    createdAt: "2026-08-22T00:00:00.000Z",
    lastActivityAt: "2026-08-22T00:00:00.000Z",
    runState: null,
    unread: false,
    runtimeAvailable: true,
    runtime: "codex",
    workspace: { mode: "shared", branchName: "main", available: true },
  };

  it("accepts exactly the two supported backends", () => {
    expect(RuntimeKindSchema.parse("pi")).toBe("pi");
    expect(RuntimeKindSchema.parse("codex")).toBe("codex");
    for (const value of ["claude", "PI", "", "codex ", null, 1])
      expect(RuntimeKindSchema.safeParse(value).success).toBe(false);
  });

  it("requires a backend on every thread summary", () => {
    expect(ThreadSummarySchema.parse(summary).runtime).toBe("codex");
    const { runtime, ...withoutRuntime } = summary;
    expect(runtime).toBe("codex");
    expect(ThreadSummarySchema.safeParse(withoutRuntime).success).toBe(false);
    expect(
      ThreadSummarySchema.safeParse({ ...summary, runtime: "claude" }).success,
    ).toBe(false);
  });

  it("treats the backend as optional when starting a chat", () => {
    const request = {
      prompt: "Start on Codex",
      workspace: { mode: "shared" as const },
      idempotencyKey: id,
    };
    expect(StartThreadRequestSchema.parse(request).runtime).toBeUndefined();
    expect(
      StartThreadRequestSchema.parse({ ...request, runtime: "pi" }).runtime,
    ).toBe("pi");
    expect(
      StartThreadRequestSchema.safeParse({ ...request, runtime: "claude" })
        .success,
    ).toBe(false);
  });

  it("treats the backend as optional when creating or importing a chat", () => {
    expect(
      CreateThreadRequestSchema.parse({ idempotencyKey: id }).runtime,
    ).toBeUndefined();
    expect(
      CreateThreadRequestSchema.parse({ idempotencyKey: id, runtime: "codex" })
        .runtime,
    ).toBe("codex");
    expect(
      ImportThreadRequestSchema.parse({
        runtimeSessionId: id,
        idempotencyKey: id,
      }).runtime,
    ).toBeUndefined();
    expect(
      ImportThreadRequestSchema.parse({
        runtimeSessionId: id,
        idempotencyKey: id,
        runtime: "pi",
      }).runtime,
    ).toBe("pi");
  });

  it("accepts a Codex UUIDv7 session identifier unchanged", () => {
    const codexThreadId = "019fa011-c136-7dc0-8c67-e5f7926bd517";
    expect(SessionIdSchema.parse(codexThreadId)).toBe(codexThreadId);
    expect(
      ImportThreadRequestSchema.parse({
        runtimeSessionId: codexThreadId,
        idempotencyKey: id,
        runtime: "codex",
      }).runtimeSessionId,
    ).toBe(codexThreadId);
  });

  it("labels every discovered session with the backend that owns it", () => {
    const descriptor = {
      id,
      name: null,
      createdAt: "2026-08-22T00:00:00.000Z",
      modifiedAt: "2026-08-22T00:00:00.000Z",
      messageCount: 2,
      preview: "hello",
      imported: false,
      runtime: "codex",
    };
    expect(SessionDescriptorSchema.parse(descriptor).runtime).toBe("codex");
    const { runtime, ...withoutRuntime } = descriptor;
    expect(runtime).toBe("codex");
    expect(SessionDescriptorSchema.safeParse(withoutRuntime).success).toBe(
      false,
    );
  });
});

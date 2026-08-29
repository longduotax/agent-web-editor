import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  open: vi.fn(),
  createAgentSession: vi.fn(),
  modelCreate: vi.fn(),
  settingsCreate: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  SessionManager: {
    create: sdk.create,
    list: sdk.list,
    open: sdk.open,
  },
  createAgentSession: sdk.createAgentSession,
  ModelRuntime: { create: sdk.modelCreate },
  SettingsManager: { create: sdk.settingsCreate },
}));

import { parseGeneratedTitle, PiAgentRuntime } from "./index.js";

const roots: string[] = [];
const sessionId = "10000000-0000-4000-8000-000000000001";

afterEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function manager(
  id: unknown,
  cwd = "/project",
  sessionFile = "/agent/session.jsonl",
): {
  appendSessionInfo(name: string): void;
  getEntries(): unknown[];
  getHeader(): unknown;
  getSessionFile(): string;
  getSessionId(): unknown;
} {
  let name = "New thread";
  return {
    appendSessionInfo: (value) => {
      name = value;
    },
    getEntries: () => [
      {
        type: "session_info",
        id: "session-info",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        name,
      },
    ],
    getHeader: () => ({
      type: "session",
      version: 3,
      id,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd,
    }),
    getSessionFile: () => sessionFile,
    getSessionId: () => id,
  };
}

function openedManager(branch: unknown = []): {
  getSessionId(): string;
  getBranch(): unknown;
} {
  return { getSessionId: () => sessionId, getBranch: () => branch };
}

function descriptor(cwd: string, path: unknown): unknown {
  return {
    id: sessionId,
    cwd,
    path,
    created: new Date("2026-01-01T00:00:00.000Z"),
    modified: new Date("2026-01-01T00:00:00.000Z"),
    messageCount: 1,
    firstMessage: "Hello",
  };
}

async function fixture(): Promise<{
  root: string;
  project: string;
  sessionDirectory: string;
  sessionPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-pi-adapter-"));
  roots.push(root);
  const projectPath = join(root, "project");
  const agentDirectory = join(root, "agent");
  await mkdir(projectPath);
  const project = await realpath(projectPath);
  const encodedProject = `--${project.slice(1).replaceAll("/", "-")}--`;
  const sessionDirectory = join(agentDirectory, "sessions", encodedProject);
  const sessionFile = join(sessionDirectory, `${sessionId}.jsonl`);
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(sessionFile, "{}\n", "utf8");
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDirectory);
  return {
    root,
    project,
    sessionDirectory,
    sessionPath: await realpath(sessionFile),
  };
}

function namingHandle(
  provider: string,
  id: string,
): {
  provider: string;
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  input: ["text"];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
} {
  return {
    provider,
    id,
    name: id,
    api: "openai-completions",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 16_000,
    maxTokens: 1_000,
  };
}

describe("PiAgentRuntime session creation boundary", () => {
  async function creationFixture(): Promise<{
    agentDirectory: string;
    project: string;
    sessionDirectory: string;
    sessionPath: string;
  }> {
    const root = await mkdtemp(join(tmpdir(), "pi-web-pi-adapter-create-"));
    roots.push(root);
    const projectPath = join(root, "project");
    const agentDirectory = join(root, "agent");
    await mkdir(projectPath);
    const project = await realpath(projectPath);
    const encodedProject = `--${project.slice(1).replaceAll("/", "-")}--`;
    const sessionDirectory = join(agentDirectory, "sessions", encodedProject);
    const sessionPath = join(sessionDirectory, `${sessionId}.jsonl`);
    await mkdir(sessionDirectory, { recursive: true });
    return { agentDirectory, project, sessionDirectory, sessionPath };
  }

  it("returns a parsed UUID only after persisting the new session", async () => {
    const context = await creationFixture();
    sdk.create.mockReturnValue(
      manager(sessionId, context.project, context.sessionPath),
    );

    await expect(
      new PiAgentRuntime(context.agentDirectory).create(
        context.project,
        "Implement thread workspaces",
      ),
    ).resolves.toEqual({ sessionId });
    expect(sdk.create).toHaveBeenCalledWith(
      context.project,
      context.sessionDirectory,
    );
    const persisted = await readFile(context.sessionPath, "utf8");
    expect(persisted).toContain(`"id":"${sessionId}"`);
    expect(persisted).toContain(`"name":"Implement thread workspaces"`);
  });

  it("does not overwrite an existing native session file", async () => {
    const context = await creationFixture();
    await writeFile(context.sessionPath, "existing\n", "utf8");
    sdk.create.mockReturnValue(
      manager(sessionId, context.project, context.sessionPath),
    );

    await expect(
      new PiAgentRuntime(context.agentDirectory).create(context.project),
    ).rejects.toMatchObject({
      code: "unavailable",
      message: "The native session could not be created.",
    });
    await expect(readFile(context.sessionPath, "utf8")).resolves.toBe(
      "existing\n",
    );
  });

  it("rejects a created session path outside its Pi session directory", async () => {
    const context = await creationFixture();
    const outside = join(dirname(context.sessionDirectory), "outside.jsonl");
    sdk.create.mockReturnValue(manager(sessionId, context.project, outside));

    await expect(
      new PiAgentRuntime(context.agentDirectory).create(context.project),
    ).rejects.toMatchObject({
      code: "malformed",
      message: "The native session returned malformed creation state.",
    });
  });

  it("rejects malformed SDK session identifiers before persistence", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-pi-adapter-"));
    roots.push(root);
    sdk.create.mockReturnValue(manager("not-a-uuid"));

    await expect(new PiAgentRuntime().create(root)).rejects.toMatchObject({
      code: "malformed",
      message: "The native session returned an invalid identifier.",
    });
  });
});

describe("PiAgentRuntime naming-model boundary", () => {
  it("constructs only non-empty normalized title results", () => {
    expect(parseGeneratedTitle("  ** Implement worktrees!  ")).toEqual({
      outcome: "available",
      title: "Implement worktrees",
    });
    expect(parseGeneratedTitle("... ***")).toEqual({ outcome: "unavailable" });
    expect(parseGeneratedTitle("x".repeat(61))).toEqual({
      outcome: "unavailable",
    });
  });

  it("selects a parsed explicit model and reports malformed SDK responses unavailable", async () => {
    const context = await fixture();
    const getAvailable = vi.fn().mockResolvedValue([
      {
        provider: "test",
        id: "cheap",
        cost: { input: 0, output: 0 },
      },
      { provider: "test", id: "invalid", cost: { input: -1, output: 0 } },
    ]);
    const completeSimple = vi.fn().mockResolvedValue({
      stopReason: "stop",
      content: [{ type: "text", text: "Implement worktrees" }],
    });
    const getModel = vi.fn((provider: string, id: string) =>
      provider === "test" && id === "cheap"
        ? namingHandle(provider, id)
        : undefined,
    );
    sdk.modelCreate.mockResolvedValue({
      getAvailable,
      getModel,
      completeSimple,
    });
    const runtime = new PiAgentRuntime(context.root, {
      provider: "test",
      id: "cheap",
    });

    await expect(
      runtime.suggestTitle(context.project, "Do the work"),
    ).resolves.toEqual({ outcome: "unavailable" });

    getAvailable.mockResolvedValue([
      { provider: "test", id: "cheap", cost: { input: 0, output: 0 } },
    ]);
    await expect(
      runtime.suggestTitle(context.project, "Do the work"),
    ).resolves.toEqual({ outcome: "available", title: "Implement worktrees" });
    expect(completeSimple).toHaveBeenCalledOnce();
    expect(completeSimple).toHaveBeenCalledWith(
      namingHandle("test", "cheap"),
      expect.any(Object),
      expect.any(Object),
    );

    completeSimple.mockResolvedValue({
      stopReason: "stop",
      content: [
        { type: "text", text: "One" },
        { type: "text", text: "Two" },
      ],
    });
    await expect(
      runtime.suggestTitle(context.project, "Do the work"),
    ).resolves.toEqual({ outcome: "unavailable" });
  });

  it("selects the configured default model and strips additive response metadata", async () => {
    const context = await fixture();
    const getModel = vi.fn((provider: string, id: string) =>
      provider === "test" && ["default", "cheap"].includes(id)
        ? namingHandle(provider, id)
        : undefined,
    );
    const completeSimple = vi.fn().mockResolvedValue({
      stopReason: "stop",
      content: [
        {
          type: "text",
          text: "Implement worktrees",
          textSignature: '{"provider":"metadata"}',
        },
      ],
    });
    sdk.settingsCreate.mockReturnValue({
      getDefaultProvider: () => "test",
      getDefaultModel: () => "default",
    });
    sdk.modelCreate.mockResolvedValue({
      getAvailable: vi.fn().mockResolvedValue([
        { provider: "other", id: "cheapest", cost: { input: 0, output: 0 } },
        { provider: "test", id: "default", cost: { input: 2, output: 2 } },
        { provider: "test", id: "cheap", cost: { input: 0, output: 0 } },
      ]),
      getModel,
      completeSimple,
    });

    await expect(
      new PiAgentRuntime(context.root).suggestTitle(
        context.project,
        "Do the work",
      ),
    ).resolves.toEqual({ outcome: "available", title: "Implement worktrees" });
    expect(getModel).toHaveBeenCalledOnce();
    expect(getModel).toHaveBeenCalledWith("test", "default");
    expect(completeSimple).toHaveBeenCalledWith(
      namingHandle("test", "default"),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("does not substitute another model when the configured default is unavailable", async () => {
    const context = await fixture();
    const getModel = vi.fn();
    const completeSimple = vi.fn();
    sdk.settingsCreate.mockReturnValue({
      getDefaultProvider: () => "test",
      getDefaultModel: () => "default",
    });
    sdk.modelCreate.mockResolvedValue({
      getAvailable: vi
        .fn()
        .mockResolvedValue([
          { provider: "test", id: "cheap", cost: { input: 0, output: 0 } },
        ]),
      getModel,
      completeSimple,
    });

    await expect(
      new PiAgentRuntime(context.root).suggestTitle(
        context.project,
        "Do the work",
      ),
    ).resolves.toEqual({ outcome: "unavailable" });
    expect(getModel).not.toHaveBeenCalled();
    expect(completeSimple).not.toHaveBeenCalled();
  });

  it.each([
    ["provider", undefined, "default"],
    ["provider", "", "default"],
    ["provider", 1, "default"],
    ["model", "test", undefined],
    ["model", "test", ""],
    ["model", "test", 1],
  ])(
    "does not look up or complete when the automatic default %s is malformed",
    async (_field, provider: unknown, id: unknown) => {
      const context = await fixture();
      const getModel = vi.fn();
      const completeSimple = vi.fn();
      sdk.settingsCreate.mockReturnValue({
        getDefaultProvider: () => provider,
        getDefaultModel: () => id,
      });
      sdk.modelCreate.mockResolvedValue({
        getAvailable: vi.fn().mockResolvedValue([]),
        getModel,
        completeSimple,
      });

      await expect(
        new PiAgentRuntime(context.root).suggestTitle(
          context.project,
          "Do the work",
        ),
      ).resolves.toEqual({ outcome: "unavailable" });
      expect(getModel).not.toHaveBeenCalled();
      expect(completeSimple).not.toHaveBeenCalled();
    },
  );

  it("constructs a completion handle and rejects malformed SDK handles", async () => {
    const context = await fixture();
    const completeSimple = vi.fn().mockResolvedValue({
      stopReason: "stop",
      content: [{ type: "text", text: "Implement worktrees" }],
    });
    const rawHandle = { ...namingHandle("test", "cheap"), untrusted: true };
    const getModel = vi.fn().mockReturnValue(rawHandle);
    sdk.modelCreate.mockResolvedValue({
      getAvailable: vi
        .fn()
        .mockResolvedValue([
          { provider: "test", id: "cheap", cost: { input: 0, output: 0 } },
        ]),
      getModel,
      completeSimple,
    });
    const runtime = new PiAgentRuntime(context.root, {
      provider: "test",
      id: "cheap",
    });

    await expect(
      runtime.suggestTitle(context.project, "Do the work"),
    ).resolves.toEqual({
      outcome: "available",
      title: "Implement worktrees",
    });
    const completedHandle: unknown = completeSimple.mock.calls[0]?.[0];
    expect(completedHandle).toEqual(namingHandle("test", "cheap"));
    expect(completedHandle).not.toBe(rawHandle);

    getModel.mockReturnValue({ provider: "test", id: "cheap" });
    await expect(
      runtime.suggestTitle(context.project, "Do the work"),
    ).resolves.toEqual({
      outcome: "unavailable",
    });
    expect(completeSimple).toHaveBeenCalledOnce();
  });
});

describe("PiAgentRuntime session open boundary", () => {
  it("parses the agent-directory setting before native operations", () => {
    expect(() => new PiAgentRuntime(undefined)).not.toThrow();
    expect(() => new PiAgentRuntime("relative-agent-directory")).toThrow(
      "The Pi agent directory configuration is invalid.",
    );
    expect(sdk.list).not.toHaveBeenCalled();
    expect(sdk.open).not.toHaveBeenCalled();
  });

  it("exposes a creation ID only for a valid UUID marker", async () => {
    const context = await fixture();
    const valid = "20000000-0000-4000-8000-000000000001";
    const malformed = "a".repeat(36);
    sdk.list.mockResolvedValue([
      {
        id: sessionId,
        cwd: context.project,
        path: context.sessionPath,
        name: `Work [pi-create:${valid}]`,
        created: new Date("2026-01-01T00:00:00.000Z"),
        modified: new Date("2026-01-01T00:00:00.000Z"),
        messageCount: 1,
        firstMessage: "Hello",
      },
    ]);

    await expect(
      new PiAgentRuntime().discover(context.project),
    ).resolves.toMatchObject({
      sessions: [expect.objectContaining({ name: "Work", creationId: valid })],
    });

    sdk.list.mockResolvedValue([
      {
        id: sessionId,
        cwd: context.project,
        path: context.sessionPath,
        name: `Work [pi-create:${malformed}]`,
        created: new Date("2026-01-01T00:00:00.000Z"),
        modified: new Date("2026-01-01T00:00:00.000Z"),
        messageCount: 1,
        firstMessage: "Hello",
      },
    ]);
    await expect(
      new PiAgentRuntime().discover(context.project),
    ).resolves.toMatchObject({
      sessions: [
        expect.objectContaining({ name: `Work [pi-create:${malformed}]` }),
      ],
    });
  });

  it("discovers and opens an authorized native session file", async () => {
    const context = await fixture();
    sdk.list.mockResolvedValue([
      descriptor(context.project, context.sessionPath),
    ]);
    sdk.open.mockReturnValue(openedManager());
    sdk.createAgentSession.mockResolvedValue({
      session: { subscribe: () => () => undefined },
    });

    const runtime = new PiAgentRuntime(
      join(context.sessionDirectory, "..", ".."),
    );
    await expect(runtime.discover(context.project)).resolves.toEqual({
      sessions: [
        {
          id: sessionId,
          name: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          modifiedAt: "2026-01-01T00:00:00.000Z",
          messageCount: 1,
          preview: "Hello",
        },
      ],
      diagnostics: [],
    });

    await expect(
      runtime.open(context.project, sessionId),
    ).resolves.toBeDefined();
    expect(sdk.open).toHaveBeenCalledWith(
      context.sessionPath,
      undefined,
      context.project,
    );
  });

  it("omits a duplicate discovery descriptor before filesystem validation", async () => {
    const context = await fixture();
    sdk.list.mockResolvedValue([
      descriptor(context.project, context.sessionPath),
      descriptor(join(context.root, "missing-project"), context.sessionPath),
    ]);

    await expect(
      new PiAgentRuntime().discover(context.project),
    ).resolves.toEqual({
      sessions: [
        {
          id: sessionId,
          name: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          modifiedAt: "2026-01-01T00:00:00.000Z",
          messageCount: 1,
          preview: "Hello",
        },
      ],
      diagnostics: ["A duplicate Pi session identifier was omitted."],
    });
  });

  it("omits a native descriptor whose name exceeds the shared contract limit", async () => {
    const context = await fixture();
    sdk.list.mockResolvedValue([
      {
        id: sessionId,
        cwd: context.project,
        path: context.sessionPath,
        name: "n".repeat(201),
        created: new Date("2026-01-01T00:00:00.000Z"),
        modified: new Date("2026-01-01T00:00:00.000Z"),
        messageCount: 1,
        firstMessage: "Hello",
      },
    ]);

    await expect(
      new PiAgentRuntime().discover(context.project),
    ).resolves.toEqual({
      sessions: [],
      diagnostics: ["A malformed Pi session descriptor was omitted."],
    });
  });

  it("does not open malformed or duplicate matching listed descriptors", async () => {
    const context = await fixture();
    sdk.list.mockResolvedValue([
      { id: sessionId },
      descriptor(context.project, context.sessionPath),
      descriptor(context.project, context.sessionPath),
    ]);

    await expect(
      new PiAgentRuntime().open(context.project, sessionId),
    ).rejects.toMatchObject({
      code: "malformed",
      message: "The native session is unavailable.",
    });
    expect(sdk.open).not.toHaveBeenCalled();
  });

  it("rejects a malformed native session list before opening", async () => {
    const context = await fixture();
    sdk.list.mockResolvedValue({ sessions: [] });

    await expect(
      new PiAgentRuntime().open(context.project, sessionId),
    ).rejects.toMatchObject({
      code: "malformed",
      message: "The native session list is malformed.",
    });
    expect(sdk.open).not.toHaveBeenCalled();
  });

  it("rejects a malformed native session list during discovery", async () => {
    const context = await fixture();
    sdk.list.mockResolvedValue({ sessions: [] });

    await expect(
      new PiAgentRuntime().discover(context.project),
    ).rejects.toMatchObject({
      code: "malformed",
      message: "The native session list is malformed.",
    });
  });

  it.each([
    [
      "a non-string path",
      (context: Awaited<ReturnType<typeof fixture>>) =>
        descriptor(context.project, 7),
      "unavailable",
    ],
    [
      "a relative path",
      (context: Awaited<ReturnType<typeof fixture>>) =>
        descriptor(context.project, "session.jsonl"),
      "malformed",
    ],
    [
      "an absent path",
      (context: Awaited<ReturnType<typeof fixture>>) =>
        descriptor(
          context.project,
          join(context.sessionDirectory, "missing.jsonl"),
        ),
      "unavailable",
    ],
    [
      "a non-regular path",
      (context: Awaited<ReturnType<typeof fixture>>) =>
        descriptor(context.project, context.sessionDirectory),
      "malformed",
    ],
    [
      "a path outside the project session directory",
      (context: Awaited<ReturnType<typeof fixture>>) =>
        descriptor(context.project, join(context.root, "outside.jsonl")),
      "malformed",
    ],
    [
      "a descriptor from another canonical project",
      (context: Awaited<ReturnType<typeof fixture>>) =>
        descriptor(join(context.root, "other-project"), context.sessionPath),
      "unauthorized",
    ],
  ])(
    "rejects %s without opening a native session",
    async (_name, build, code) => {
      const context = await fixture();
      if (_name === "a path outside the project session directory")
        await writeFile(join(context.root, "outside.jsonl"), "{}\n", "utf8");
      if (_name === "a descriptor from another canonical project")
        await mkdir(join(context.root, "other-project"));
      sdk.list.mockResolvedValue([build(context)]);

      let failure: unknown;
      try {
        await new PiAgentRuntime().open(context.project, sessionId);
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code });
      expect(String(failure)).not.toContain(context.root);
      expect(sdk.open).not.toHaveBeenCalled();
    },
  );

  it("omits malformed compaction and displayed custom messages from snapshots", async () => {
    const context = await fixture();
    sdk.list.mockResolvedValue([
      descriptor(context.project, context.sessionPath),
    ]);
    sdk.open.mockReturnValue(
      openedManager([
        {
          id: "valid-message",
          type: "message",
          timestamp: "2026-01-01T00:00:00.000Z",
          message: { role: "user", content: "Retained" },
        },
        {
          id: "c".repeat(201),
          type: "compaction",
          timestamp: "2026-01-01T00:00:00.000Z",
          summary: "Too long identifier",
        },
        {
          id: "m".repeat(201),
          type: "custom_message",
          timestamp: "2026-01-01T00:00:00.000Z",
          display: true,
          content: "Too long identifier",
        },
      ]),
    );
    sdk.createAgentSession.mockResolvedValue({
      session: { subscribe: () => () => undefined },
    });

    const opened = await new PiAgentRuntime().open(context.project, sessionId);
    await expect(opened.snapshot()).resolves.toEqual({
      sessionId,
      transcript: [
        {
          id: "valid-message",
          kind: "message",
          role: "user",
          text: "Retained",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ],
      diagnostics: [
        "A malformed native session entry was omitted.",
        "A malformed native session entry was omitted.",
      ],
    });
  });

  it("rejects malformed native history collections from snapshots", async () => {
    const context = await fixture();
    sdk.list.mockResolvedValue([
      descriptor(context.project, context.sessionPath),
    ]);
    sdk.open.mockReturnValue(openedManager({ entries: [] }));
    sdk.createAgentSession.mockResolvedValue({
      session: { subscribe: () => () => undefined },
    });

    const opened = await new PiAgentRuntime().open(context.project, sessionId);
    await expect(opened.snapshot()).rejects.toMatchObject({
      code: "malformed",
      message: "The native session history is malformed.",
    });
  });

  it("preserves bounded Pi tool calls, results, and bash executions in snapshots", async () => {
    const context = await fixture();
    sdk.list.mockResolvedValue([
      descriptor(context.project, context.sessionPath),
    ]);
    sdk.open.mockReturnValue(
      openedManager([
        {
          id: "assistant",
          type: "message",
          timestamp: "2026-01-01T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "call-1",
                name: "bash",
                arguments: { command: "pwd", cwd: "/project" },
              },
              {
                type: "toolCall",
                id: "call-2",
                name: "bash",
                arguments: { command: "pwd", cwd: "/project" },
              },
            ],
          },
        },
        {
          id: "result-2",
          type: "message",
          timestamp: "2026-01-01T00:00:01.000Z",
          message: {
            role: "toolResult",
            toolCallId: "call-2",
            toolName: "bash",
            content: [{ type: "text", text: "second result\n" }],
            isError: false,
            details: { cwd: "/project", exitCode: 0 },
          },
        },
        {
          id: "result-1",
          type: "message",
          timestamp: "2026-01-01T00:00:02.000Z",
          message: {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "bash",
            content: [{ type: "text", text: "first result\n" }],
            isError: false,
            details: { cwd: "/project", exitCode: 0 },
          },
        },
        {
          id: "bash",
          type: "message",
          timestamp: "2026-01-01T00:00:03.000Z",
          message: {
            role: "bashExecution",
            command: "false",
            output: "failed",
            exitCode: 1,
            cancelled: false,
          },
        },
        {
          id: "bad-tool",
          type: "message",
          timestamp: "2026-01-01T00:00:04.000Z",
          message: {
            role: "toolResult",
            toolCallId: "call-3",
            toolName: "bash",
            content: [],
            isError: "false",
          },
        },
      ]),
    );
    sdk.createAgentSession.mockResolvedValue({
      session: { subscribe: () => () => undefined },
    });

    const opened = await new PiAgentRuntime().open(context.project, sessionId);
    const snapshot = await opened.snapshot();
    expect(snapshot.transcript).toMatchObject([
      { id: "assistant", kind: "message", role: "assistant" },
      {
        id: "result-1",
        kind: "tool",
        name: "bash",
        status: "completed",
        input: '{"command":"pwd","cwd":"/project"}',
        output: "first result\n",
        cwd: "/project",
        exitCode: 0,
        // N1: a result entry carries the moment the step *finished*. The step
        // keeps the timestamp of the call that started it, so a reader can
        // subtract the two -- writing the result's time over the call's used
        // to leave a step's own elapsed time unrepresentable.
        timestamp: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:02.000Z",
      },
      {
        id: "result-2",
        kind: "tool",
        name: "bash",
        status: "completed",
        input: '{"command":"pwd","cwd":"/project"}',
        output: "second result\n",
        cwd: "/project",
        exitCode: 0,
        timestamp: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "bash",
        kind: "tool",
        name: "bash",
        status: "failed",
        input: "false",
        output: "failed",
        exitCode: 1,
        // A bashExecution is one entry with one instant and no start, so its
        // span stays unknown rather than being flattened to zero.
        timestamp: "2026-01-01T00:00:03.000Z",
        completedAt: null,
      },
    ]);
    expect(snapshot.diagnostics).toEqual([
      "An unsupported native message was omitted.",
    ]);
  });

  // N1: the shape behind "a 45-second run reports Worked for <1s" -- one tool
  // call, whose duration is the whole run's duration. Both ends of it have to
  // survive translation or the transcript cannot express it at all.
  it("carries both ends of a long single tool call, and leaves a running one open-ended", async () => {
    const context = await fixture();
    sdk.list.mockResolvedValue([
      descriptor(context.project, context.sessionPath),
    ]);
    sdk.open.mockReturnValue(
      openedManager([
        {
          id: "assistant",
          type: "message",
          timestamp: "2026-01-01T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "slept",
                name: "bash",
                arguments: { command: "sleep 45 && ls" },
              },
            ],
          },
        },
        {
          id: "slept-result",
          type: "message",
          timestamp: "2026-01-01T00:00:45.054Z",
          message: {
            role: "toolResult",
            toolCallId: "slept",
            toolName: "bash",
            content: [{ type: "text", text: "README.md\n" }],
            isError: false,
            details: { exitCode: 0 },
          },
        },
        {
          id: "assistant-2",
          type: "message",
          timestamp: "2026-01-01T00:00:46.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "running",
                name: "bash",
                arguments: { command: "sleep 60" },
              },
            ],
          },
        },
      ]),
    );
    sdk.createAgentSession.mockResolvedValue({
      session: { subscribe: () => () => undefined },
    });

    const opened = await new PiAgentRuntime().open(context.project, sessionId);
    const snapshot = await opened.snapshot();
    const tools = snapshot.transcript.filter((item) => item.kind === "tool");
    expect(tools).toMatchObject([
      {
        status: "completed",
        timestamp: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:45.054Z",
      },
      {
        status: "running",
        timestamp: "2026-01-01T00:00:46.000Z",
        completedAt: null,
      },
    ]);
  });

  // S1: three histories where a result outlives the call that made it. Each
  // must yield `timestamp: null` -- "I don't know when this began" -- because
  // borrowing the end time instead produces a step that claims to have taken
  // no time, which is N1's defect re-created inside N1's fix.
  it.each([
    [
      "a compaction summarised the issuing entry away",
      [
        {
          id: "compacted",
          type: "compaction",
          timestamp: "2026-01-01T00:00:00.000Z",
          summary: "Earlier turns.",
        },
      ],
    ],
    ["a branch or resume began after the call", []],
  ])("reports an unknown start when %s", async (_name, prefix) => {
    const context = await fixture();
    sdk.list.mockResolvedValue([
      descriptor(context.project, context.sessionPath),
    ]);
    sdk.open.mockReturnValue(
      openedManager([
        ...prefix,
        {
          id: "orphan-result",
          type: "message",
          timestamp: "2026-01-01T00:04:00.000Z",
          message: {
            role: "toolResult",
            toolCallId: "call-gone",
            toolName: "bash",
            content: [{ type: "text", text: "done\n" }],
            isError: false,
            details: { exitCode: 0 },
          },
        },
      ]),
    );
    sdk.createAgentSession.mockResolvedValue({
      session: { subscribe: () => () => undefined },
    });

    const opened = await new PiAgentRuntime().open(context.project, sessionId);
    const snapshot = await opened.snapshot();
    expect(snapshot.transcript.filter((i) => i.kind === "tool")).toMatchObject([
      {
        status: "completed",
        timestamp: null,
        completedAt: "2026-01-01T00:04:00.000Z",
      },
    ]);
  });

  it("reports an unknown start when a duplicate toolCallId discards it", async () => {
    const context = await fixture();
    sdk.list.mockResolvedValue([
      descriptor(context.project, context.sessionPath),
    ]);
    sdk.open.mockReturnValue(
      openedManager([
        {
          id: "assistant",
          type: "message",
          timestamp: "2026-01-01T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              { type: "toolCall", id: "dupe", name: "bash", arguments: {} },
              { type: "toolCall", id: "dupe", name: "bash", arguments: {} },
            ],
          },
        },
        {
          id: "dupe-result",
          type: "message",
          timestamp: "2026-01-01T00:04:00.000Z",
          message: {
            role: "toolResult",
            toolCallId: "dupe",
            toolName: "bash",
            content: [],
            isError: false,
          },
        },
      ]),
    );
    sdk.createAgentSession.mockResolvedValue({
      session: { subscribe: () => () => undefined },
    });

    const opened = await new PiAgentRuntime().open(context.project, sessionId);
    const snapshot = await opened.snapshot();
    const result = snapshot.transcript.filter((i) => i.kind === "tool").at(-1);
    expect(result).toMatchObject({
      status: "completed",
      timestamp: null,
      completedAt: "2026-01-01T00:04:00.000Z",
    });
  });

  // S2: a bashExecution entry is one record with one instant and no start, so
  // its span is unknown rather than zero -- a five-minute command must not
  // report itself as instantaneous.
  it("leaves a bash execution's span unknown rather than zero-width", async () => {
    const context = await fixture();
    sdk.list.mockResolvedValue([
      descriptor(context.project, context.sessionPath),
    ]);
    sdk.open.mockReturnValue(
      openedManager([
        {
          id: "bash",
          type: "message",
          timestamp: "2026-01-01T00:05:00.000Z",
          message: {
            role: "bashExecution",
            command: "sleep 300",
            output: "",
            exitCode: 0,
            cancelled: false,
          },
        },
      ]),
    );
    sdk.createAgentSession.mockResolvedValue({
      session: { subscribe: () => () => undefined },
    });

    const opened = await new PiAgentRuntime().open(context.project, sessionId);
    const snapshot = await opened.snapshot();
    expect(snapshot.transcript).toMatchObject([
      {
        kind: "tool",
        name: "bash",
        timestamp: "2026-01-01T00:05:00.000Z",
        completedAt: null,
      },
    ]);
  });
});

describe("PiOpenSession preflight boundary", () => {
  it.each([
    [true, true],
    [false, false],
    ["accepted", false],
  ])(
    "accepts only a boolean preflight result",
    async (providerValue, accepted) => {
      const context = await fixture();
      sdk.list.mockResolvedValue([
        descriptor(context.project, context.sessionPath),
      ]);
      sdk.open.mockReturnValue(openedManager());
      let listener: ((event: unknown) => void) | undefined;
      sdk.createAgentSession.mockResolvedValue({
        session: {
          subscribe: (next: (event: unknown) => void) => {
            listener = next;
            return () => undefined;
          },
          prompt: (
            _text: string,
            options: { preflightResult: (value: boolean) => void },
          ) => {
            listener?.({ type: "agent_settled" });
            Reflect.apply(options.preflightResult, undefined, [providerValue]);
            return new Promise<void>(() => undefined);
          },
          steer: () => Promise.resolve(),
          abort: () => Promise.resolve(),
          dispose: () => undefined,
        },
      });
      const opened = await new PiAgentRuntime().open(
        context.project,
        sessionId,
      );
      const events: unknown[] = [];
      opened.subscribe((event) => events.push(event));

      const outcome = await opened.prompt("Work");
      expect(outcome.accepted).toBe(accepted);
      if (accepted) outcome.releaseEvents();
      else outcome.discardEvents();
      expect(events).toHaveLength(accepted ? 1 : 0);
    },
  );

  // G12. "Provider retry N of M." reached the browser and was dropped, so a
  // stalled run was indistinguishable from a slow one. Fixing that in the
  // client needed a way to tell this diagnostic apart from the adapter's
  // routine ones — and severity could not do it, because EVERY unrecognised
  // Pi event (which includes all tool activity) is also a `warning`.
  describe("diagnostics carry a code, not only a severity", () => {
    async function emitted(event: unknown): Promise<unknown[]> {
      const context = await fixture();
      sdk.list.mockResolvedValue([
        descriptor(context.project, context.sessionPath),
      ]);
      sdk.open.mockReturnValue(openedManager());
      let listener: ((value: unknown) => void) | undefined;
      sdk.createAgentSession.mockResolvedValue({
        session: {
          subscribe: (next: (value: unknown) => void) => {
            listener = next;
            return () => undefined;
          },
          prompt: () => new Promise<void>(() => undefined),
          steer: () => Promise.resolve(),
          abort: () => Promise.resolve(),
          dispose: () => undefined,
        },
      });
      const opened = await new PiAgentRuntime().open(
        context.project,
        sessionId,
      );
      const events: unknown[] = [];
      opened.subscribe((value) => events.push(value));
      listener?.(event);
      return events;
    }

    it("names a provider retry, and raises it above info", async () => {
      expect(
        await emitted({
          type: "auto_retry_start",
          attempt: 2,
          maxAttempts: 5,
        }),
      ).toEqual([
        {
          type: "diagnostic",
          // `info` had this filtered out everywhere downstream, and the run
          // is not progressing — that is not information, it is a warning.
          level: "warning",
          code: "provider_retry",
          message: "Provider retry 2 of 5.",
        },
      ]);
    });

    it("names the routine unsupported-event noise as such", async () => {
      expect(await emitted({ type: "tool_execution_start" })).toEqual([
        {
          type: "diagnostic",
          level: "warning",
          code: "unsupported_event",
          message: "Pi emitted an unsupported event.",
        },
      ]);
    });

    it("names an unsupported message separately from an unsupported event", async () => {
      expect(
        await emitted({ type: "message_end", message: { role: "nonsense" } }),
      ).toEqual([
        {
          type: "diagnostic",
          level: "warning",
          code: "unsupported_message",
          message: "Pi emitted an unsupported message.",
        },
      ]);
    });
  });
});

// B2. The pane tells a reader whose Stop stranded a steer that the message
// was "never delivered" and hands the text back to the composer. That was
// false: neither `AgentSession.abort()` nor `Agent.abort()` empties
// `steeringQueue`, the queue belongs to the one session this thread reuses
// for every run, and the next `prompt()` drains it BEFORE the model call. So
// the reader pressed Enter on text Pi already held, and the instruction ran
// twice. Pi's own TUI clears the queue on abort; this adapter did not.
describe("stopping a run", () => {
  async function stoppableSession(session: Record<string, unknown>) {
    const context = await fixture();
    sdk.list.mockResolvedValue([
      descriptor(context.project, context.sessionPath),
    ]);
    sdk.open.mockReturnValue(openedManager());
    sdk.createAgentSession.mockResolvedValue({
      session: {
        subscribe: () => () => undefined,
        prompt: () => new Promise<void>(() => undefined),
        steer: () => Promise.resolve(),
        dispose: () => undefined,
        ...session,
      },
    });
    return await new PiAgentRuntime().open(context.project, sessionId);
  }

  it("clears the steering queue, so a stranded steer cannot ride the next prompt", async () => {
    const calls: string[] = [];
    const opened = await stoppableSession({
      clearQueue: () => {
        calls.push("clearQueue");
        return { steering: [], followUp: [] };
      },
      abort: () => {
        calls.push("abort");
        return Promise.resolve();
      },
    });

    await opened.stop();

    // Before the abort, which is the order Pi's own TUI uses. Aborting during
    // a TOOL call returns normally and reaches the end-of-turn drain, so a
    // queue cleared afterwards would already have been drained and persisted.
    expect(calls).toEqual(["clearQueue", "abort"]);
  });

  it("still stops a run on a Pi that has no clearQueue", async () => {
    let aborted = false;
    const opened = await stoppableSession({
      abort: () => {
        aborted = true;
        return Promise.resolve();
      },
    });

    await expect(opened.stop()).resolves.toBeUndefined();
    expect(aborted).toBe(true);
  });

  // The same stranded steer, on the ending nothing calls `stop()` for. A run
  // that ends in FAILURE never reaches the end-of-turn drain either
  // (`runLoop` returns on `stopReason === "error"`), so the queue survived it
  // and the pane's "never delivered" was false all over again. The settlement
  // outcome already distinguishes the three endings, so the rule is stated
  // where they are all visible: only a COMPLETED run keeps its queue.
  describe("a run that ends without being stopped", () => {
    // A thunk, not a promise: a rejected promise created at the call site is
    // unhandled for the microtasks it takes to reach the adapter.
    async function settledSession(operation: () => Promise<void>) {
      const cleared: string[] = [];
      const opened = await stoppableSession({
        clearQueue: () => {
          cleared.push("clearQueue");
          return { steering: [], followUp: [] };
        },
        abort: () => {
          cleared.push("abort");
          return Promise.resolve();
        },
        prompt: (
          _text: string,
          options: { preflightResult: (value: boolean) => void },
        ) => {
          Reflect.apply(options.preflightResult, undefined, [true]);
          return operation();
        },
      });
      const acceptance = await opened.prompt("Work");
      acceptance.discardEvents();
      return { cleared, outcome: await acceptance.settlement };
    }

    it("clears the steering queue when the run fails", async () => {
      const { cleared, outcome } = await settledSession(() =>
        Promise.reject(new Error("provider exploded")),
      );

      expect(outcome).toBe("failed");
      // Nothing called stop(): this is the ending that had no owner.
      expect(cleared).toEqual(["clearQueue"]);
    });

    it("clears it when the run ends interrupted", async () => {
      const { cleared, outcome } = await settledSession(() =>
        Promise.reject(new Error("The operation was aborted")),
      );

      expect(outcome).toBe("interrupted");
      expect(cleared).toEqual(["clearQueue"]);
    });

    // Not merely redundant -- wrong. A completed run drained its own queue,
    // so anything left in it arrived after that drain and is legitimately
    // waiting for the next prompt.
    it("leaves the queue alone when the run completes", async () => {
      const { cleared, outcome } = await settledSession(() =>
        Promise.resolve(),
      );

      expect(outcome).toBe("completed");
      expect(cleared).toEqual([]);
    });
  });
});

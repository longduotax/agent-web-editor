import { describe, expect, it, vi } from "vitest";

import { RuntimeFailure, type RuntimeEvent } from "@pi-web/agent-runtime";

import { CodexAgentRuntime, type CodexSandbox } from "./index.js";
import type { CodexTransport } from "./client.js";

const THREAD = "019fa011-c136-7dc0-8c67-e5f7926bd517";
const OTHER = "019fa2af-fc3c-7120-bbf5-9e970b2b7dd4";

interface Frame {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
}

/** A scripted app-server that answers by method, and can push notifications. */
class ScriptedServer implements CodexTransport {
  public readonly frames: Frame[] = [];
  private lineListener: ((line: string) => void) | undefined;
  private exitListener:
    | ((info: { code: number | null; signal: string | null }) => void)
    | undefined;
  public constructor(private readonly answers: Record<string, unknown>) {}

  public send(line: string): void {
    const frame = JSON.parse(line) as Frame;
    this.frames.push(frame);
    if (frame.method === undefined || frame.id === undefined) return;
    const answer =
      frame.method === "initialize"
        ? { userAgent: "codex/0.149.0" }
        : this.answers[frame.method];
    queueMicrotask(() => {
      if (answer === undefined) {
        this.push({
          jsonrpc: "2.0",
          id: frame.id,
          error: {
            code: -32601,
            message: `no script for ${String(frame.method)}`,
          },
        });
        return;
      }
      this.push({
        jsonrpc: "2.0",
        id: frame.id,
        result:
          typeof answer === "function" ? (answer as () => unknown)() : answer,
      });
    });
  }
  public onLine(listener: (line: string) => void): void {
    this.lineListener = listener;
  }
  public onExit(
    listener: (info: { code: number | null; signal: string | null }) => void,
  ): void {
    this.exitListener = listener;
  }
  public close(): void {
    this.exitListener?.({ code: 0, signal: null });
  }
  public push(value: unknown): void {
    this.lineListener?.(JSON.stringify(value));
  }
  public notify(method: string, params: unknown): void {
    this.push({ jsonrpc: "2.0", method, params });
  }
  public sentParams(method: string): Record<string, unknown> | undefined {
    return this.frames.find((frame) => frame.method === method)?.params;
  }
  public sentAll(method: string): (Record<string, unknown> | undefined)[] {
    return this.frames.filter((f) => f.method === method).map((f) => f.params);
  }
}

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: THREAD,
    name: "Fix the parser",
    preview: "Fix the parser",
    cwd: "/repo",
    createdAt: 1_755_000_000_000,
    updatedAt: 1_755_000_060_000,
    turns: [],
    ...overrides,
  };
}

function runtimeOver(server: ScriptedServer, sandbox?: CodexSandbox) {
  return new CodexAgentRuntime({
    connect: () => Promise.resolve(server),
    ...(sandbox === undefined ? {} : { sandbox }),
  });
}

describe("CodexAgentRuntime.discover", () => {
  it("lists only the threads recorded under the project path", async () => {
    const server = new ScriptedServer({
      "thread/list": {
        data: [thread(), thread({ id: OTHER })],
        nextCursor: null,
      },
    });
    const result = await runtimeOver(server).discover("/repo");
    expect(server.sentParams("thread/list")).toMatchObject({ cwd: "/repo" });
    expect(result.sessions.map((s) => s.id)).toEqual([THREAD, OTHER]);
    expect(result.diagnostics).toEqual([]);
  });

  it("follows the cursor to the end of the list", async () => {
    let page = 0;
    const server = new ScriptedServer({
      "thread/list": () =>
        page++ === 0
          ? { data: [thread()], nextCursor: "next" }
          : { data: [thread({ id: OTHER })], nextCursor: null },
    });
    const result = await runtimeOver(server).discover("/repo");
    expect(result.sessions).toHaveLength(2);
    expect(server.sentAll("thread/list")[1]).toMatchObject({ cursor: "next" });
  });

  it("reports an unreadable entry as a diagnostic and keeps the rest", async () => {
    const server = new ScriptedServer({
      "thread/list": {
        data: [thread(), { id: "not-a-uuid" }, thread({ id: OTHER })],
        nextCursor: null,
      },
    });
    const result = await runtimeOver(server).discover("/repo");
    expect(result.sessions.map((s) => s.id)).toEqual([THREAD, OTHER]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("fails with a typed error when Codex cannot be reached", async () => {
    const runtime = new CodexAgentRuntime({
      connect: () => Promise.reject(new Error("spawn codex ENOENT")),
    });
    await expect(runtime.discover("/repo")).rejects.toBeInstanceOf(
      RuntimeFailure,
    );
    await expect(runtime.discover("/repo")).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});

describe("CodexAgentRuntime.create", () => {
  it("starts a thread confined to the project with approvals disabled", async () => {
    const server = new ScriptedServer({
      "thread/start": { thread: thread() },
      "thread/name/set": {},
    });
    const created = await runtimeOver(server, "workspace-write").create(
      "/repo",
      "Fix the parser",
    );
    expect(created.sessionId).toBe(THREAD);
    expect(server.sentParams("thread/start")).toMatchObject({
      cwd: "/repo",
      approvalPolicy: "never",
      sandbox: "workspace-write",
    });
    expect(server.sentParams("thread/name/set")).toMatchObject({
      threadId: THREAD,
      name: "Fix the parser",
    });
  });

  it("names nothing when no title is given", async () => {
    const server = new ScriptedServer({ "thread/start": { thread: thread() } });
    await runtimeOver(server).create("/repo");
    expect(server.sentParams("thread/name/set")).toBeUndefined();
  });

  it("refuses a response whose thread identity is unusable", async () => {
    const server = new ScriptedServer({
      "thread/start": { thread: { id: "nope" } },
    });
    await expect(runtimeOver(server).create("/repo")).rejects.toMatchObject({
      code: "malformed",
    });
  });
});

describe("CodexOpenSession", () => {
  async function opened(answers: Record<string, unknown> = {}) {
    const server = new ScriptedServer({
      "thread/resume": { thread: thread() },
      "thread/read": { thread: thread() },
      "thread/unsubscribe": {},
      ...answers,
    });
    const session = await runtimeOver(server).open("/repo", THREAD);
    return { server, session };
  }

  it("resumes the thread it was asked for", async () => {
    const { server, session } = await opened();
    expect(session.id).toBe(THREAD);
    expect(server.sentParams("thread/resume")).toMatchObject({
      threadId: THREAD,
      approvalPolicy: "never",
    });
    await session.dispose();
  });

  it("reads the stored transcript as a snapshot", async () => {
    const { session } = await opened({
      "thread/read": {
        thread: thread({
          turns: [
            {
              id: "r1",
              status: "completed",
              error: null,
              items: [
                {
                  type: "userMessage",
                  id: "u1",
                  clientId: "c1",
                  content: [{ type: "text", text: "go" }],
                },
                { type: "agentMessage", id: "a1", text: "done" },
              ],
            },
          ],
        }),
      },
    });
    const snapshot = await session.snapshot();
    expect(snapshot.sessionId).toBe(THREAD);
    expect(snapshot.transcript).toHaveLength(2);
    expect(snapshot.transcript[1]).toMatchObject({ text: "done" });
    await session.dispose();
  });

  it("delivers only its own thread's notifications", async () => {
    const { server, session } = await opened();
    const events: RuntimeEvent[] = [];
    session.subscribe((event) => events.push(event));
    server.notify("item/completed", {
      threadId: OTHER,
      turnId: "r1",
      item: { type: "agentMessage", id: "x", text: "someone else" },
    });
    server.notify("item/completed", {
      threadId: THREAD,
      turnId: "r1",
      item: { type: "agentMessage", id: "a1", text: "mine" },
    });
    await vi.waitFor(() => {
      expect(events).toHaveLength(1);
    });
    expect(events[0]).toMatchObject({ item: { text: "mine" } });
    await session.dispose();
  });

  it("accepts a prompt and settles it when the turn completes", async () => {
    const { server, session } = await opened({
      "turn/start": {
        turn: { id: "turn-1", status: "inProgress", items: [], error: null },
      },
    });
    const acceptance = await session.prompt("do the thing", {
      id: "00000000-0000-4000-8000-0000000000aa",
    });
    expect(acceptance.accepted).toBe(true);
    expect(server.sentParams("turn/start")).toMatchObject({
      threadId: THREAD,
      clientUserMessageId: "00000000-0000-4000-8000-0000000000aa",
    });
    acceptance.releaseEvents();
    server.notify("turn/completed", {
      threadId: THREAD,
      turn: { id: "turn-1", status: "completed", items: [], error: null },
    });
    expect(await acceptance.settlement).toBe("completed");
    await session.dispose();
  });

  it("holds events until acceptance is released, and can discard them", async () => {
    const { server, session } = await opened({
      "turn/start": {
        turn: { id: "turn-1", status: "inProgress", items: [], error: null },
      },
    });
    const events: RuntimeEvent[] = [];
    session.subscribe((event) => events.push(event));
    const acceptance = await session.prompt("go");
    server.notify("item/completed", {
      threadId: THREAD,
      turnId: "turn-1",
      item: { type: "agentMessage", id: "a1", text: "buffered" },
    });
    await Promise.resolve();
    expect(events).toHaveLength(0);
    acceptance.releaseEvents();
    await vi.waitFor(() => {
      expect(events).toHaveLength(1);
    });
    await session.dispose();
  });

  it("reports a refused prompt as not accepted", async () => {
    const { session } = await opened();
    const acceptance = await session.prompt("go");
    expect(acceptance.accepted).toBe(false);
    expect(await acceptance.settlement).toBe("failed");
    await session.dispose();
  });

  it("settles a failed turn with the reported reason", async () => {
    const { server, session } = await opened({
      "turn/start": {
        turn: { id: "turn-1", status: "inProgress", items: [], error: null },
      },
    });
    const acceptance = await session.prompt("go");
    server.notify("turn/completed", {
      threadId: THREAD,
      turn: {
        id: "turn-1",
        status: "failed",
        items: [],
        error: { message: "sandbox denied write" },
      },
    });
    expect(await acceptance.settlement).toBe("failed");
    await session.dispose();
  });

  it("steers the active turn and refuses when none is running", async () => {
    const { server, session } = await opened({
      "turn/start": {
        turn: { id: "turn-1", status: "inProgress", items: [], error: null },
      },
      "turn/steer": {},
    });
    await expect(session.steer("wait")).rejects.toBeInstanceOf(RuntimeFailure);
    await session.prompt("go");
    await session.steer("actually, stop");
    expect(server.sentParams("turn/steer")).toMatchObject({
      threadId: THREAD,
      expectedTurnId: "turn-1",
    });
    await session.dispose();
  });

  it("interrupts the active turn and is a no-op when idle", async () => {
    const { server, session } = await opened({
      "turn/start": {
        turn: { id: "turn-1", status: "inProgress", items: [], error: null },
      },
      "turn/interrupt": {},
    });
    await session.stop();
    expect(server.sentParams("turn/interrupt")).toBeUndefined();
    await session.prompt("go");
    await session.stop();
    expect(server.sentParams("turn/interrupt")).toMatchObject({
      threadId: THREAD,
      turnId: "turn-1",
    });
    await session.dispose();
  });

  it("recovers a dispatch that reached Codex, and rejects one that did not", async () => {
    const dispatch = { id: "00000000-0000-4000-8000-0000000000bb" };
    const { session } = await opened({
      "thread/read": {
        thread: thread({
          turns: [
            {
              id: "r1",
              status: "completed",
              error: null,
              items: [
                {
                  type: "userMessage",
                  id: "u1",
                  clientId: dispatch.id,
                  content: [{ type: "text", text: "recovered prompt" }],
                },
              ],
            },
          ],
        }),
      },
    });
    expect(await session.recoverPrompt("recovered prompt", dispatch)).toEqual({
      outcome: "accepted",
    });
    expect(await session.recoverPrompt("a different prompt", dispatch)).toEqual(
      { outcome: "not_accepted" },
    );
    expect(
      await session.recoverPrompt("recovered prompt", {
        id: "00000000-0000-4000-8000-0000000000cc",
      }),
    ).toEqual({ outcome: "not_accepted" });
    await session.dispose();
  });

  it("denies an approval request instead of leaving the run waiting", async () => {
    const { server, session } = await opened();
    const events: RuntimeEvent[] = [];
    session.subscribe((event) => events.push(event));
    server.push({
      jsonrpc: "2.0",
      id: 99,
      method: "execCommandApproval",
      params: { threadId: THREAD, command: "rm -rf /" },
    });
    await vi.waitFor(() => {
      expect(
        server.frames.some(
          (frame) =>
            frame.id === 99 && JSON.stringify(frame).includes("denied"),
        ),
      ).toBe(true);
    });
    await session.dispose();
  });

  it("stops delivering events once disposed", async () => {
    const { server, session } = await opened();
    const events: RuntimeEvent[] = [];
    session.subscribe((event) => events.push(event));
    await session.dispose();
    server.notify("item/completed", {
      threadId: THREAD,
      turnId: "r1",
      item: { type: "agentMessage", id: "a1", text: "too late" },
    });
    await Promise.resolve();
    expect(events).toHaveLength(0);
  });
});

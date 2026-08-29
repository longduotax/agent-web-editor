import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RolloutReader, locateRollout } from "./index.js";

const TURN = "turn-1";
const at = "2026-08-23T00:00:00.000Z";

function entry(type: string, payload: unknown) {
  return JSON.stringify({ timestamp: at, type, payload });
}

async function fixture(lines: string[]) {
  const home = await mkdtemp(join(tmpdir(), "codex-rollout-"));
  const sessions = join(home, "sessions", "2026", "08", "23");
  await mkdir(sessions, { recursive: true });
  const path = join(sessions, "rollout-test.jsonl");
  await writeFile(path, `${lines.join("\n")}\n`);
  return { home, path };
}

describe("rollout confinement and reverse replay", () => {
  it("accepts only a real JSONL file inside the configured sessions root", async () => {
    const { home, path } = await fixture([entry("session_meta", {})]);
    await expect(locateRollout(path, home)).resolves.toBe(await realpath(path));
    await expect(locateRollout("/etc/passwd", home)).rejects.toThrow();
  });

  it("pairs app-server calls and outputs while taking no stored message text", async () => {
    const metadata = { turn_id: TURN, create_time: 1 };
    const { path } = await fixture([
      entry("event_msg", { type: "task_started", turn_id: TURN }),
      entry("response_item", {
        type: "message",
        id: "user-1",
        role: "user",
        content: "injected text must not be used",
        internal_chat_message_metadata_passthrough: metadata,
      }),
      entry("response_item", {
        type: "custom_tool_call",
        id: "call-1",
        call_id: "call-1",
        name: "exec",
        input:
          'const r = await tools.exec_command({"cmd":"printf ok","workdir":"/repo"}); text(JSON.stringify(r))',
        internal_chat_message_metadata_passthrough: metadata,
      }),
      entry("response_item", {
        type: "custom_tool_call_output",
        call_id: "call-1",
        output: [
          { type: "input_text", text: "Script completed" },
          {
            type: "input_text",
            text: '{"exit_code":0,"output":"ok"}',
          },
        ],
        internal_chat_message_metadata_passthrough: metadata,
      }),
      entry("response_item", {
        type: "message",
        id: "assistant-1",
        internal_chat_message_metadata_passthrough: metadata,
      }),
      entry("event_msg", { type: "task_complete", turn_id: TURN }),
    ]);
    const projection = await (await RolloutReader.open(path)).projectTurn(TURN);
    expect(
      projection.entries.map((value) => value.messageId ?? value.item?.id),
    ).toEqual(["user-1", "call-1", "assistant-1"]);
    expect(projection.entries[1]?.item).toMatchObject({
      kind: "tool",
      name: "shell",
      input: "printf ok",
      output: "ok",
      cwd: "/repo",
      exitCode: 0,
      status: "completed",
    });
  });

  it("identifies an unknown stored dialect without inventing tool history", async () => {
    const { path } = await fixture([
      entry("event_msg", { type: "task_started", turn_id: TURN }),
      entry("future_format", { type: "future_tool", turn_id: TURN }),
      entry("event_msg", { type: "task_complete", turn_id: TURN }),
    ]);
    const projection = await (await RolloutReader.open(path)).projectTurn(TURN);
    expect(projection.entries).toEqual([]);
    expect(projection.unknownDialect).toBe(true);
  });

  it("marks a page honestly when its reverse-read safety budget stops first", async () => {
    const { path } = await fixture([
      entry("event_msg", { type: "task_started", turn_id: TURN }),
      entry("event_msg", {
        type: "token_count",
        turn_id: TURN,
        detail: "x".repeat(1_000),
      }),
      entry("event_msg", { type: "task_complete", turn_id: TURN }),
    ]);
    const projection = await (
      await RolloutReader.open(path, 128)
    ).projectTurn(TURN);
    expect(projection.incomplete).toBe(true);
    expect(projection.reachedStart).toBe(false);
  });

  it("selects structured item_completed entries instead of duplicate response items", async () => {
    const metadata = { turn_id: TURN, create_time: 1 };
    const { path } = await fixture([
      entry("event_msg", { type: "task_started", turn_id: TURN }),
      entry("response_item", {
        type: "custom_tool_call",
        id: "duplicate",
        call_id: "duplicate",
        name: "exec",
        input: '{"cmd":"duplicate"}',
        internal_chat_message_metadata_passthrough: metadata,
      }),
      entry("response_item", {
        type: "custom_tool_call_output",
        call_id: "duplicate",
        output: '{"exit_code":0,"output":"duplicate"}',
        internal_chat_message_metadata_passthrough: metadata,
      }),
      entry("event_msg", {
        type: "item_completed",
        turn_id: TURN,
        completed_at_ms: 1_755_000_000_000,
        item: {
          type: "CommandExecution",
          id: "command-1",
          command: ["printf", "ok"],
          cwd: "/repo",
          status: "Completed",
          aggregated_output: "ok",
          exit_code: 0,
        },
      }),
      entry("event_msg", { type: "task_complete", turn_id: TURN }),
    ]);
    const projection = await (await RolloutReader.open(path)).projectTurn(TURN);
    expect(
      projection.entries
        .filter((value) => value.item)
        .map((value) => value.item?.id),
    ).toEqual(["command-1"]);
  });

  it("keeps an older response-only turn after projecting a newer structured turn", async () => {
    const olderTurn = "turn-older";
    const newerTurn = "turn-newer";
    const { path } = await fixture([
      entry("event_msg", { type: "task_started", turn_id: olderTurn }),
      entry("response_item", {
        type: "custom_tool_call",
        id: "older-response-call",
        call_id: "older-response-call",
        name: "exec",
        input: '{"cmd":"printf older"}',
        internal_chat_message_metadata_passthrough: { turn_id: olderTurn },
      }),
      entry("response_item", {
        type: "custom_tool_call_output",
        call_id: "older-response-call",
        output: '{"exit_code":0,"output":"older"}',
        internal_chat_message_metadata_passthrough: { turn_id: olderTurn },
      }),
      entry("event_msg", { type: "task_complete", turn_id: olderTurn }),
      entry("event_msg", { type: "task_started", turn_id: newerTurn }),
      entry("response_item", {
        type: "custom_tool_call",
        id: "newer-response-call",
        call_id: "newer-response-call",
        name: "exec",
        input: '{"cmd":"printf duplicate"}',
        internal_chat_message_metadata_passthrough: { turn_id: newerTurn },
      }),
      entry("response_item", {
        type: "custom_tool_call_output",
        call_id: "newer-response-call",
        output: '{"exit_code":0,"output":"duplicate"}',
        internal_chat_message_metadata_passthrough: { turn_id: newerTurn },
      }),
      entry("event_msg", {
        type: "item_completed",
        turn_id: newerTurn,
        item: {
          type: "CommandExecution",
          id: "newer-structured-call",
          command: "printf structured",
          status: "Completed",
          aggregated_output: "structured",
        },
      }),
      entry("event_msg", { type: "task_complete", turn_id: newerTurn }),
    ]);
    const reader = await RolloutReader.open(path);

    expect(
      (await reader.projectTurn(newerTurn)).entries.map(
        (value) => value.item?.id,
      ),
    ).toEqual(["newer-structured-call"]);
    expect(
      (await reader.projectTurn(olderTurn)).entries.map(
        (value) => value.item?.id,
      ),
    ).toEqual(["older-response-call"]);
  });
});

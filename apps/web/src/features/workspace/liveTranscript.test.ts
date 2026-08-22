import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "@pi-web/contracts";

import {
  mergeLiveTurn,
  reduceLiveTurn,
  STREAMING_ITEM_ID,
} from "./liveTranscript.js";

function streaming(
  text: string,
  timestamp = "2026-01-01T00:00:00.000Z",
): TranscriptItem {
  return {
    id: STREAMING_ITEM_ID,
    kind: "message",
    role: "assistant",
    text,
    timestamp,
  };
}

function settled(
  text: string,
  id = "live-0e4bf4e4-6c2e-4b2f-9f2b-0f4b0f4b0f4b",
) {
  return {
    id,
    kind: "message",
    role: "assistant",
    text,
    timestamp: "2026-01-01T00:00:02.000Z",
  } as const satisfies TranscriptItem;
}

const asked: TranscriptItem = {
  id: "u1",
  kind: "message",
  role: "user",
  text: "Explain the Pomodoro technique.",
  timestamp: "2026-01-01T00:00:00.000Z",
};

describe("reduceLiveTurn", () => {
  it("takes the newest streamed frame as the turn", () => {
    const first = reduceLiveTurn(null, streaming("The Pomodoro"));
    expect(first).toMatchObject({ text: "The Pomodoro" });
    expect(reduceLiveTurn(first, streaming("The Pomodoro te"))).toMatchObject({
      text: "The Pomodoro te",
    });
  });

  // The server does re-send the same text (the last two frames of a 2,583
  // character answer were identical), and it stamps every frame with a fresh
  // timestamp that nothing renders. Neither may cost a re-render.
  it("returns the identical turn when a frame changes nothing that renders", () => {
    const turn = reduceLiveTurn(null, streaming("Same"));
    expect(
      reduceLiveTurn(turn, streaming("Same", "2026-01-01T00:00:09.000Z")),
    ).toBe(turn);
  });

  it("lets the settled assistant turn take over from the placeholder", () => {
    const streamed = reduceLiveTurn(null, streaming("Work in 25 minute"));
    expect(
      reduceLiveTurn(streamed, settled("Work in 25 minute blocks.")),
    ).toMatchObject({ text: "Work in 25 minute blocks." });
  });

  // `live-<uuid>` is the id the adapter gives EVERY settled item, and
  // `translateMessage` maps user and system roles as readily as assistant. A
  // steer landing mid-stream must not wipe the answer being streamed.
  it("ignores a settled user or system message instead of ending the turn", () => {
    const streamed = reduceLiveTurn(null, streaming("Half an answ"));
    expect(
      reduceLiveTurn(streamed, {
        id: "live-11111111-1111-4111-8111-111111111111",
        kind: "message",
        role: "user",
        text: "actually, stop",
        timestamp: "2026-01-01T00:00:03.000Z",
      }),
    ).toBe(streamed);
    expect(
      reduceLiveTurn(streamed, {
        id: "live-22222222-2222-4222-8222-222222222222",
        kind: "message",
        role: "system",
        text: "compacted",
        timestamp: "2026-01-01T00:00:03.000Z",
      }),
    ).toBe(streamed);
  });

  it("ignores tool and diagnostic items", () => {
    const streamed = reduceLiveTurn(null, streaming("Reading"));
    expect(
      reduceLiveTurn(streamed, {
        id: "t1",
        kind: "tool",
        name: "read",
        status: "running",
        input: "{}",
        output: "",
        cwd: null,
        exitCode: null,
        timestamp: null,
      }),
    ).toBe(streamed);
  });
});

describe("mergeLiveTurn", () => {
  it("appends the in-progress turn to the authoritative transcript", () => {
    const merged = mergeLiveTurn([asked], streaming("The Pomodoro"));
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ text: "The Pomodoro" });
  });

  it("returns the transcript untouched when there is no turn in progress", () => {
    const transcript = [asked];
    expect(mergeLiveTurn(transcript, null)).toBe(transcript);
  });

  // B1: a background poll lands mid-run and brings back a transcript that
  // already holds the finished paragraph. Appending it again would show the
  // same text twice for the whole of the tool call that follows.
  it("stops appending once the same turn reaches the transcript under its own id", () => {
    const transcript: TranscriptItem[] = [
      asked,
      {
        id: "native-1",
        kind: "message",
        role: "assistant",
        text: "Work in 25 minute blocks.",
        timestamp: "2026-01-01T00:00:02.000Z",
      },
      {
        id: "t1",
        kind: "tool",
        name: "bash",
        status: "running",
        input: '{"command":"sleep 20"}',
        output: "",
        cwd: null,
        exitCode: null,
        timestamp: "2026-01-01T00:00:03.000Z",
      },
    ];
    expect(
      mergeLiveTurn(transcript, settled("Work in 25 minute blocks.")),
    ).toBe(transcript);
  });

  // Pi does repeat itself across turns -- "The directory contains .git and
  // README.md." appeared twice in one real thread. An identical sentence from
  // an earlier turn is not this turn.
  it("only treats matches after the last user message as this turn", () => {
    const transcript: TranscriptItem[] = [
      {
        id: "a-old",
        kind: "message",
        role: "assistant",
        text: "The directory contains .git and README.md.",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      { ...asked, id: "u2", text: "check again" },
    ];
    const merged = mergeLiveTurn(
      transcript,
      streaming("The directory contains .git and README.md."),
    );
    expect(merged).toHaveLength(3);
  });
});

import { describe, expect, it } from "vitest";
import type { ThreadSnapshot, TranscriptItem } from "@pi-web/contracts";

import { applyLiveTranscript, STREAMING_ITEM_ID } from "./liveTranscript.js";

const base = {
  transcript: [] as TranscriptItem[],
  highWaterSequence: 0,
} as unknown as ThreadSnapshot;

function streaming(text: string, timestamp = "2026-01-01T00:00:00.000Z") {
  return {
    id: STREAMING_ITEM_ID,
    kind: "message",
    role: "assistant",
    text,
    timestamp,
  } as const satisfies TranscriptItem;
}

const askedQuestion: TranscriptItem = {
  id: "u1",
  kind: "message",
  role: "user",
  text: "Explain the Pomodoro technique.",
  timestamp: "2026-01-01T00:00:00.000Z",
};

describe("applyLiveTranscript", () => {
  it("appends the first streamed frame and then grows it in place", () => {
    const started = applyLiveTranscript(
      { ...base, transcript: [askedQuestion] },
      [streaming("The Pomodoro")],
      1,
    );
    expect(started.transcript).toHaveLength(2);

    const grown = applyLiveTranscript(
      started,
      [streaming("The Pomodoro te")],
      2,
    );
    expect(grown.transcript).toHaveLength(2);
    expect(grown.transcript[1]).toMatchObject({ text: "The Pomodoro te" });
    expect(grown.highWaterSequence).toBe(2);
  });

  // The adapter reuses "streaming-assistant" for every frame of the turn and
  // then re-sends the finished text under a fresh live-<uuid>. Without this,
  // every answer would end up on screen twice.
  it("lets the settled turn supersede the streaming placeholder rather than sit beside it", () => {
    const streamed = applyLiveTranscript(
      { ...base, transcript: [askedQuestion] },
      [streaming("Work in 25 minute")],
      1,
    );
    const settled = applyLiveTranscript(
      streamed,
      [
        {
          id: "live-0e4bf4e4-6c2e-4b2f-9f2b-0f4b0f4b0f4b",
          kind: "message",
          role: "assistant",
          text: "Work in 25 minute blocks.",
          timestamp: "2026-01-01T00:00:02.000Z",
        },
      ],
      2,
    );

    expect(settled.transcript).toHaveLength(2);
    expect(
      settled.transcript.filter((item) => item.id === STREAMING_ITEM_ID),
    ).toHaveLength(0);
    expect(settled.transcript[1]).toMatchObject({
      text: "Work in 25 minute blocks.",
    });
  });

  // The server does re-send the same text (the last two frames of a 2,583
  // character answer were identical), and it stamps every frame with a fresh
  // timestamp that nothing renders. Neither may cost a re-render.
  it("returns the same snapshot when a frame changes nothing that renders", () => {
    const streamed = applyLiveTranscript(base, [streaming("Same")], 1);
    const repeated = applyLiveTranscript(
      streamed,
      [streaming("Same", "2026-01-01T00:00:09.000Z")],
      1,
    );
    expect(repeated).toBe(streamed);
  });

  it("never moves the cursor backwards when a refetch has already overtaken the batch", () => {
    const ahead = { ...base, highWaterSequence: 12 };
    expect(applyLiveTranscript(ahead, [], 4).highWaterSequence).toBe(12);
    expect(
      applyLiveTranscript(ahead, [streaming("x")], 13).highWaterSequence,
    ).toBe(13);
  });

  it("applies a batch of frames in order, keeping only the newest text", () => {
    const applied = applyLiveTranscript(
      base,
      [streaming("a"), streaming("ab"), streaming("abc")],
      3,
    );
    expect(applied.transcript).toHaveLength(1);
    expect(applied.transcript[0]).toMatchObject({ text: "abc" });
  });
});

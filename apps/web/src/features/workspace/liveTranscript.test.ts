import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "@pi-web/contracts";

import {
  dropSettledSteers,
  isReaderFacingDiagnostic,
  isSteerEcho,
  mergeLiveTurn,
  mergePendingSteers,
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

// G3. A steer sent mid-run vanished for the entire rest of the run: the
// composer cleared (the app's universal "sent" signal) and then nothing
// appeared, in the pane OR in the server's own transcript, for five minutes.
// The cause is structural and cannot be fixed on the server:
// `WorkspaceService.steer` hands the text to the runtime and returns the
// existing run, and `snapshot()` assigns its transcript wholesale from Pi's
// PERSISTED session branch -- which does not hold a steering message until
// Pi's agent loop drains its queue at the end of the turn in flight.
describe("pending steers", () => {
  function user(text: string, id = `pi-${text}`): TranscriptItem {
    return {
      id,
      kind: "message",
      role: "user",
      text,
      timestamp: "2026-01-01T00:00:00.000Z",
    };
  }
  const runId = "50000000-0000-4000-8000-000000000009";

  it("echoes an unpersisted steer at the foot of the transcript", () => {
    const merged = mergePendingSteers(
      [user("Explore the repo"), settled("Working on it.")],
      [{ runId, text: "Actually, stop and reply BANANA" }],
    );
    expect(merged).toHaveLength(3);
    const echo = merged.at(2);
    if (echo === undefined) throw new Error("expected an echoed steer");
    expect(echo).toMatchObject({
      kind: "message",
      role: "user",
      text: "Actually, stop and reply BANANA",
    });
    // After the assistant turn, not before it: that is where Pi will put the
    // persisted message, so the handover moves nothing on screen.
    expect(isSteerEcho(echo)).toBe(true);
  });

  it("retires an echo once Pi has persisted the same words", () => {
    const pending = [{ runId, text: "Reply BANANA" }];
    expect(dropSettledSteers([user("Explore the repo")], pending)).toBe(
      pending,
    );
    expect(
      dropSettledSteers(
        [user("Explore the repo"), user("Reply BANANA")],
        pending,
      ),
    ).toEqual([]);
  });

  it("retires one echo per persisted copy when the same words are sent twice", () => {
    const twice = [
      { runId, text: "Hurry up" },
      { runId, text: "Hurry up" },
    ];
    // Only one has landed, so exactly one echo may go.
    expect(dropSettledSteers([user("Hurry up")], twice)).toEqual([
      { runId, text: "Hurry up" },
    ]);
    expect(
      dropSettledSteers([user("Hurry up", "a"), user("Hurry up", "b")], twice),
    ).toEqual([]);
  });

  it("does not mistake the assistant repeating the words for the steer landing", () => {
    const pending = [{ runId, text: "Reply BANANA" }];
    expect(dropSettledSteers([settled("Reply BANANA")], pending)).toBe(pending);
  });

  it("leaves the transcript untouched when nothing is pending", () => {
    const transcript = [user("Explore the repo")];
    expect(mergePendingSteers(transcript, [])).toBe(transcript);
  });
});

// G12. Live diagnostics were received, used purely as a refetch trigger, and
// dropped -- so a provider retry looked exactly like a run that was merely
// slow. Severity alone cannot select which to show: the adapter turns EVERY
// Pi event it does not recognise into a `warning`, and Pi's tool activity
// travels that path, so "render every warning" would print
// "Pi emitted an unsupported event." several times per tool call.
describe("isReaderFacingDiagnostic", () => {
  it("shows a provider retry, which is the whole point", () => {
    expect(
      isReaderFacingDiagnostic({
        type: "diagnostic",
        level: "warning",
        code: "provider_retry",
        message: "Provider retry 2 of 5.",
      }),
    ).toBe(true);
  });

  it("stays silent about the adapter's routine unsupported-event noise", () => {
    expect(
      isReaderFacingDiagnostic({
        type: "diagnostic",
        level: "warning",
        code: "unsupported_event",
        message: "Pi emitted an unsupported event.",
      }),
    ).toBe(false);
    expect(
      isReaderFacingDiagnostic({
        type: "diagnostic",
        level: "warning",
        code: "unsupported_message",
        message: "Pi emitted an unsupported message.",
      }),
    ).toBe(false);
  });

  it("shows an error even when no code names it", () => {
    expect(
      isReaderFacingDiagnostic({
        type: "diagnostic",
        level: "error",
        message: "The session died.",
      }),
    ).toBe(true);
  });

  it("stays silent about info", () => {
    expect(
      isReaderFacingDiagnostic({
        type: "diagnostic",
        level: "info",
        message: "Compacted the session.",
      }),
    ).toBe(false);
  });
});

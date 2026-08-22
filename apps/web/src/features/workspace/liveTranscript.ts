import type { LiveDiagnostic, TranscriptItem } from "@pi-web/contracts";

/**
 * Whether a live diagnostic is worth putting in front of the reader.
 *
 * Severity cannot decide this on its own. The adapter turns every Pi event it
 * does not recognise into a `warning`, and Pi's tool activity travels that
 * path -- so "render every warning" would print "Pi emitted an unsupported
 * event." several times per tool call, which is why this selects on `code`.
 *
 * `provider_retry` is the one diagnostic that changes what the screen means:
 * without it a stalled run and a slow run look identical.
 *
 * The `error` arm has NO producer today -- every arm of the adapter's
 * `mapEvent` returns `warning` -- so it is forward cover, not live code, and
 * `.diagnostic.error` stays unreachable in practice until a runtime raises
 * one. It is kept because a runtime that does raise one is reporting
 * something no code anticipated, and silence is the wrong default for that.
 */
export function isReaderFacingDiagnostic(diagnostic: LiveDiagnostic): boolean {
  return diagnostic.code === "provider_retry" || diagnostic.level === "error";
}

/**
 * The id the Pi adapter reuses for every `message_update` frame of the
 * in-progress assistant turn (`packages/pi-adapter/src/index.ts`).
 *
 * It is a placeholder, not an identity: it is reused across turns, and the
 * settled turn arrives immediately afterwards under a fresh `live-<uuid>` id
 * carrying the same text.
 */
export const STREAMING_ITEM_ID = "streaming-assistant";

/**
 * Whether two transcript items are the same rendered content.
 *
 * Deliberately ignores `timestamp`: the adapter stamps every streaming frame
 * with `new Date()`, so a strict comparison would call each of the ~500
 * frames in a single answer a change even when the text has not moved (the
 * server does emit repeats — the last two frames of a 2,583 character answer
 * carried identical text). Nothing renders a message's timestamp, so ignoring
 * it costs nothing and saves the re-render.
 */
function sameRenderedItem(a: TranscriptItem, b: TranscriptItem): boolean {
  if (a === b) return true;
  if (a.kind !== "message" || b.kind !== "message") return false;
  return a.role === b.role && a.text === b.text;
}

/**
 * Folds one live transcript item into the in-progress assistant turn.
 *
 * The turn is client-only state: it is the one thing on screen that the
 * server cannot tell us about, because `WorkspaceService.snapshot()` reads
 * Pi's PERSISTED session branch and the message is not in that branch until
 * `message_end`. Keeping it out of the query cache is what stops an
 * authoritative fetch — the 15s background poll, or any throttled refetch —
 * from deleting a partly-streamed answer off the screen.
 *
 * Returns `current` unchanged when the frame changes nothing, so a repeated
 * frame cannot force a re-render.
 */
export function reduceLiveTurn(
  current: TranscriptItem | null,
  item: TranscriptItem,
): TranscriptItem | null {
  // Only an assistant message can be, or replace, an in-progress turn.
  // `live-<uuid>` is the id the adapter gives EVERY settled item, user and
  // system messages included, so a steer landing mid-stream must not be
  // mistaken for the end of the answer being streamed.
  if (item.kind !== "message" || item.role !== "assistant") return current;
  if (current !== null && sameRenderedItem(current, item)) return current;
  // Both a streamed frame and the settled turn replace what came before: the
  // settled item carries the same text the placeholder was building, so
  // holding on to it keeps the answer on screen until the refetch that
  // persists it lands.
  return item;
}

/**
 * Whether this turn has already reached the authoritative transcript.
 *
 * The settled turn arrives in the snapshot under Pi's own id rather than the
 * `live-<uuid>` the adapter minted, so identity has to be the text. The
 * search is scoped to the current turn — everything after the last user
 * message — so that an identical sentence Pi wrote in an earlier turn is
 * not mistaken for this one.
 */
function alreadySettled(
  transcript: readonly TranscriptItem[],
  turn: TranscriptItem,
): boolean {
  if (turn.kind !== "message") return false;
  let start = 0;
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item?.kind === "message" && item.role === "user") {
      start = index + 1;
      break;
    }
  }
  for (let index = start; index < transcript.length; index += 1) {
    const item = transcript[index];
    if (
      item?.kind === "message" &&
      item.role === "assistant" &&
      item.text === turn.text
    )
      return true;
  }
  return false;
}

/**
 * Renders the authoritative transcript with the in-progress turn appended.
 *
 * Pure, and computed at render time rather than stored, so there is no cache
 * entry for a background fetch to overwrite. Once the turn reaches the
 * snapshot it stops being appended, without any handover moment where the
 * text belongs to neither.
 */
export function mergeLiveTurn(
  transcript: readonly TranscriptItem[],
  turn: TranscriptItem | null,
): readonly TranscriptItem[] {
  if (turn === null || alreadySettled(transcript, turn)) return transcript;
  return [...transcript, turn];
}

/** The prefix every optimistic steer echo's id carries. */
export const STEER_ECHO_ID_PREFIX = "steer-echo:";

/** A steer the client has sent and the transcript cannot show yet. */
export interface PendingSteer {
  /** The run it was aimed at, so a stale echo cannot outlive its run. */
  runId: string;
  text: string;
  /**
   * A mint-time serial number, unique within the pane.
   *
   * The echo's id is built from it rather than from its position in the
   * pending array: retiring the first of two otherwise shifted the second
   * one's id, changing its React key and remounting a bubble that had not
   * changed.
   */
  ordinal: number;
  /**
   * How many user messages already carried this exact text when the steer was
   * minted.
   *
   * This is the baseline that makes the handover an identity rather than a
   * string search. Text alone cannot identify a message: "keep going",
   * "continue", "run the tests" are the ordinary vocabulary of steering AND
   * the ordinary vocabulary of prompting, and an earlier prompt with the same
   * words sits in the transcript for the life of the thread. It was never a
   * pending echo, so nothing ever consumed it, and it would retire any future
   * echo of the same words the moment the transcript next changed -- which
   * during a run is every few seconds. That is the reported defect (G3)
   * exactly: the steer disappears and stays gone for the rest of the run.
   *
   * Retiring only on a copy ABOVE the baseline keeps what counting got right
   * (two steers of the same words retire one echo per persisted copy) and
   * drops the false positive.
   */
  priorCopies: number;
}

/** How many user messages in `transcript` carry exactly this text. */
export function countUserMessages(
  transcript: readonly TranscriptItem[],
  text: string,
): number {
  let count = 0;
  for (const item of transcript) {
    if (item.kind !== "message" || item.role !== "user") continue;
    if (item.text === text) count += 1;
  }
  return count;
}

/** Whether an item is a client-minted steer echo rather than server truth. */
export function isSteerEcho(item: TranscriptItem): boolean {
  return item.id.startsWith(STEER_ECHO_ID_PREFIX);
}

/**
 * Renders a steer the user has sent as a user message, optimistically.
 *
 * This is the only honest option available. `WorkspaceService.steer` hands
 * the text to the runtime and returns the run unchanged: it writes no
 * transcript state, publishes nothing on the broker, and there is no
 * server-side transcript store for it to write to -- `snapshot()` assigns its
 * transcript wholesale from `transcriptFromManager(...)`, i.e. Pi's PERSISTED
 * session branch. Pi does not persist a steering message when it is sent; its
 * agent loop holds it in a queue and only emits `message_end` for it when the
 * turn in flight finishes. So between "sent" and "the run ends" there is
 * genuinely nothing for any server to tell us, and the gap is as long as the
 * run -- five minutes in the reported case.
 *
 * Known limits, both inherent to that:
 *  - the echo is local to this pane. A second pane or tab on the same thread
 *    shows nothing until the run settles, because nothing was published.
 *  - it does not survive a reload for the same reason it is not in the query
 *    cache: it is state no fetch can reproduce.
 *  - a steer queued into a turn that is then STOPPED is never delivered and
 *    never persisted (Pi's agent loop returns on abort before it drains the
 *    queue, and nothing flushes it), so the pane hands that text back to the
 *    composer rather than dropping it. See `ThreadPane`.
 */
export function steerEchoItem(pending: PendingSteer): TranscriptItem {
  return {
    id: `${STEER_ECHO_ID_PREFIX}${pending.runId}:${String(pending.ordinal)}`,
    kind: "message",
    role: "user",
    text: pending.text,
    timestamp: null,
  };
}

/**
 * Drops the steers Pi has now persisted, and returns the rest.
 *
 * The settled message comes back under one of Pi's own short entry ids, not
 * the id minted here, so the text is the only thing the two copies share --
 * but text is not an identity, and this used to treat it as one. A match is
 * now a copy that arrived AFTER the steer was minted: the count of user
 * messages carrying that text has to exceed the baseline recorded on the
 * steer (see `PendingSteer.priorCopies`).
 *
 * Consumption, not membership: two steers with the same words retire one echo
 * per persisted copy rather than both at the first. `transcript` must be the
 * authoritative one -- passing a transcript with echoes already merged in
 * would let an echo retire itself.
 */
export function dropSettledSteers(
  transcript: readonly TranscriptItem[],
  pending: readonly PendingSteer[],
): readonly PendingSteer[] {
  if (pending.length === 0) return pending;
  const counts = new Map<string, number>();
  for (const item of transcript) {
    if (item.kind !== "message" || item.role !== "user") continue;
    if (isSteerEcho(item)) continue;
    counts.set(item.text, (counts.get(item.text) ?? 0) + 1);
  }
  const kept: PendingSteer[] = [];
  for (const steer of pending) {
    const count = counts.get(steer.text) ?? 0;
    if (count > steer.priorCopies) {
      // Consumed, so a second echo of the same words is judged against what
      // is left rather than against the same copy again.
      counts.set(steer.text, count - 1);
      continue;
    }
    kept.push(steer);
  }
  return kept.length === pending.length ? pending : kept;
}

/**
 * Appends the still-unpersisted steers after the transcript and the live turn.
 *
 * After, not before, because that is where Pi will eventually put them: the
 * agent loop drains its steering queue once the turn in flight has finished,
 * so the persisted message lands after the assistant message and its whole
 * tool group. Echoing it in the same place means the handover, when the
 * refetch replaces the echo with server truth, moves nothing on screen.
 */
export function mergePendingSteers(
  transcript: readonly TranscriptItem[],
  pending: readonly PendingSteer[],
): readonly TranscriptItem[] {
  if (pending.length === 0) return transcript;
  return [...transcript, ...pending.map((steer) => steerEchoItem(steer))];
}

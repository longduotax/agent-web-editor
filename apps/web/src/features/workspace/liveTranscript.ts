import type { ThreadSnapshot, TranscriptItem } from "@pi-web/contracts";

/**
 * The id the Pi adapter reuses for every `message_update` frame of the
 * in-progress assistant turn (`packages/pi-adapter/src/index.ts`).
 *
 * It is a placeholder, not an identity: it is reused across turns, and the
 * settled turn arrives immediately afterwards under a fresh `live-<uuid>` id
 * carrying the same text. A live turn therefore has to REPLACE the
 * placeholder rather than land beside it, or every answer would render twice.
 */
export const STREAMING_ITEM_ID = "streaming-assistant";

/**
 * Whether two transcript items are the same rendered content.
 *
 * Deliberately ignores `timestamp` for messages: the adapter stamps every
 * streaming frame with `new Date()`, so a strict comparison would call each
 * of the ~500 frames in a single answer a change even when the text has not
 * moved (the server does emit repeats — the last two frames of a 2,583 char
 * answer carried identical text). Nothing in the transcript renders a
 * message's timestamp, so ignoring it costs nothing and saves the re-render.
 */
function sameRenderedItem(a: TranscriptItem, b: TranscriptItem): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  if (a.kind === "message" && b.kind === "message")
    return a.role === b.role && a.text === b.text;
  if (a.kind === "diagnostic" && b.kind === "diagnostic")
    return a.level === b.level && a.text === b.text;
  if (a.kind === "tool" && b.kind === "tool")
    return (
      a.name === b.name &&
      a.status === b.status &&
      a.input === b.input &&
      a.output === b.output &&
      a.cwd === b.cwd &&
      a.exitCode === b.exitCode
    );
  return false;
}

/**
 * Upserts one live transcript item into a transcript, by id.
 *
 * Returns the same array reference when nothing changed, so an unchanged
 * frame cannot force a re-render.
 */
function upsert(
  transcript: readonly TranscriptItem[],
  item: TranscriptItem,
): readonly TranscriptItem[] {
  // A settled turn supersedes the streaming placeholder: drop it first, then
  // place the settled item where the placeholder stood.
  const base =
    item.id === STREAMING_ITEM_ID
      ? transcript
      : transcript.filter((existing) => existing.id !== STREAMING_ITEM_ID);
  const index = base.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [...base, item];
  const existing = base[index];
  if (
    base === transcript &&
    existing !== undefined &&
    sameRenderedItem(existing, item)
  )
    return transcript;
  const next = [...base];
  next[index] = item;
  return next;
}

/**
 * Applies a batch of live transcript items to a cached thread snapshot.
 *
 * This is what makes an answer stream. The server already publishes an item
 * per model token over `/api/live`; the client used to answer each frame with
 * a full HTTP refetch of the thread, and the snapshot route reads Pi's
 * PERSISTED session branch — which does not contain the in-progress message
 * at all. So no amount of refetching could show a partial answer: the text
 * only existed in the live payload the client was throwing away.
 *
 * Every payload carries the item's full current state rather than a delta,
 * which is why a dropped or out-of-order frame is self-healing.
 *
 * Returns the same snapshot reference when nothing changed.
 */
export function applyLiveTranscript(
  snapshot: ThreadSnapshot,
  items: readonly TranscriptItem[],
  highWaterSequence: number,
): ThreadSnapshot {
  let transcript: readonly TranscriptItem[] = snapshot.transcript;
  for (const item of items) transcript = upsert(transcript, item);
  // The cursor only ever moves forward: a refetch that landed mid-batch may
  // already have carried the snapshot past the sequence this batch saw.
  const nextSequence = Math.max(snapshot.highWaterSequence, highWaterSequence);
  if (
    transcript === snapshot.transcript &&
    nextSequence === snapshot.highWaterSequence
  )
    return snapshot;
  return {
    ...snapshot,
    transcript: transcript as TranscriptItem[],
    highWaterSequence: nextSequence,
  };
}

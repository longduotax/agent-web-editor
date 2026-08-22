import type { TranscriptItem } from "@pi-web/contracts";

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

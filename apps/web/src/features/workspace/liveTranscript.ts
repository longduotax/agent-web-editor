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
 * The in-progress assistant turn, with the one fact that identifies it.
 *
 * `priorUserMessages` is how many user messages the authoritative transcript
 * held when this turn STARTED streaming, and it is the whole of the identity
 * rule (see `alreadySettled`). It is the same discipline the steer echo uses
 * for its own handover: a mint-time baseline against the authoritative
 * transcript, so that "arrived after I started" is a fact rather than a
 * guess about position.
 */
export interface LiveTurn {
  item: TranscriptItem;
  priorUserMessages: number;
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
 * `userMessagesNow` is the count of user messages in the authoritative
 * transcript at the moment the frame arrives; it is recorded only when a NEW
 * turn begins, so every frame of one turn shares one baseline.
 *
 * Returns `current` unchanged when the frame changes nothing, so a repeated
 * frame cannot force a re-render.
 */
export function reduceLiveTurn(
  current: LiveTurn | null,
  item: TranscriptItem,
  userMessagesNow: number,
): LiveTurn | null {
  // Only an assistant message can be, or replace, an in-progress turn.
  // `live-<uuid>` is the id the adapter gives EVERY settled item, user and
  // system messages included, so a steer landing mid-stream must not be
  // mistaken for the end of the answer being streamed.
  if (item.kind !== "message" || item.role !== "assistant") return current;
  if (current !== null && sameRenderedItem(current.item, item)) return current;
  // A frame continues the turn in hand only while that turn is still the
  // streaming placeholder: the adapter reuses one id for every frame of an
  // answer and then closes it with the settled item under a fresh id. So a
  // frame arriving on top of a SETTLED item is the next turn beginning, and
  // gets a baseline of its own; anything on top of the placeholder -- another
  // frame, or the settled item closing it -- is the same turn still.
  //
  // Both a streamed frame and the settled turn replace what came before: the
  // settled item carries the same text the placeholder was building, so
  // holding on to it keeps the answer on screen until the refetch that
  // persists it lands.
  if (current?.item.id !== STREAMING_ITEM_ID)
    return { item, priorUserMessages: userMessagesNow };
  return { item, priorUserMessages: current.priorUserMessages };
}

/**
 * Whether this turn has already reached the authoritative transcript.
 *
 * The settled turn arrives in the snapshot under Pi's own id rather than the
 * `live-<uuid>` the adapter minted, so identity has to be the text. A window
 * keeps an identical sentence Pi wrote in an EARLIER turn from being mistaken
 * for this one, and where that window starts is the whole of B1.
 *
 * It used to start after the LAST user message, which is correct only while
 * the newest user message is the prompt that started this turn. Pi drains its
 * steering queue after the turn in flight, so a persisted steer lands BELOW
 * the assistant message it interrupted: the settled turn then fell outside
 * the window, and the live copy was appended a second time — the whole
 * answer, drawn twice under the reader's own steer, for as long as the next
 * turn took to produce a token.
 *
 * The window now starts after the `priorUserMessages`-th user message, i.e.
 * after the ones that already existed when this turn began. Position cannot
 * separate the two cases on its own — `[user, assistant, user]` is the shape
 * of both "a steer landed under my answer" and "a new prompt started the turn
 * I am streaming" — but the baseline can, because it says which of those user
 * messages the turn is older than.
 *
 * If the transcript holds FEWER user messages than the baseline (compaction),
 * every one of them predates the turn and the window is the old one: after
 * the last user message.
 */
function alreadySettled(
  transcript: readonly TranscriptItem[],
  turn: LiveTurn,
): boolean {
  if (turn.item.kind !== "message") return false;
  const text = turn.item.text;
  let start = 0;
  let remaining = turn.priorUserMessages;
  if (remaining > 0)
    for (let index = 0; index < transcript.length; index += 1) {
      const item = transcript[index];
      if (item?.kind !== "message" || item.role !== "user") continue;
      start = index + 1;
      remaining -= 1;
      if (remaining === 0) break;
    }
  for (let index = start; index < transcript.length; index += 1) {
    const item = transcript[index];
    if (
      item?.kind === "message" &&
      item.role === "assistant" &&
      item.text === text
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
  turn: LiveTurn | null,
): readonly TranscriptItem[] {
  if (turn === null || alreadySettled(transcript, turn)) return transcript;
  return [...transcript, turn.item];
}

/** The prefix every optimistic steer echo's id carries. */
export const STEER_ECHO_ID_PREFIX = "steer-echo:";

/** A steer the client has sent and the transcript cannot show yet. */
export interface PendingSteer {
  /** The run it was aimed at, so a stale echo cannot outlive its run. */
  runId: string;
  text: string;
  /** Page-lifetime image files retained until Pi persists or returns the steer. */
  images?: readonly File[];
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
   *
   * Meaningless for a steer Pi will rewrite (`isRewrittenByPi`), which uses
   * `priorUserMessages` instead.
   */
  priorCopies: number;
  /**
   * How many user messages of ANY text the transcript held at the same
   * moment. The baseline for a steer whose stored text the client cannot
   * predict; see `isRewrittenByPi`.
   */
  priorUserMessages: number;
}

type SteerEchoItem = Extract<TranscriptItem, { kind: "message" }> & {
  /**
   * Files are pane-local pending state, not persisted ChatImageRefs.  Keep
   * only their count on the optimistic transcript item so the renderer can
   * honestly confirm them without trying to fetch or impersonate history.
   */
  queuedImageCount: number;
};

/**
 * Whether Pi will store something other than the text we sent.
 *
 * `AgentSession.steer` rewrites the text before queueing it, and both
 * rewrites are gated on the same prefix: `_expandSkillCommand` turns
 * `/skill:name args` into a `<skill name=… location=…>…</skill>` wrapper, and
 * `expandPromptTemplate` replaces `/name args` wholesale when `name` matches
 * a prompt template. (An extension command never gets this far: `steer`
 * throws on one, so the request fails and no echo is ever minted.)
 *
 * The prefix is deliberately the whole test rather than a guess at which
 * skills and templates exist. It over-triggers — `/tmp is full` is rewritten
 * by nothing — and over-triggering costs only a weaker retirement rule,
 * while under-triggering costs an echo that can never retire and is then
 * reported as never delivered.
 */
export function isRewrittenByPi(text: string): boolean {
  return text.startsWith("/");
}

function isUserMessage(
  item: TranscriptItem,
): item is Extract<TranscriptItem, { kind: "message" }> {
  return item.kind === "message" && item.role === "user";
}

/**
 * How many user messages in `transcript` carry exactly this text.
 *
 * Client-minted echoes do not count, for the same reason they do not count in
 * `dropSettledSteers`: one function mints the baseline the other spends, and
 * a baseline that counted echoes would be spent against a count that did not.
 * Both callers pass the authoritative transcript today, so this changes no
 * behaviour — it removes the trap for the caller that does not.
 */
export function countUserMessages(
  transcript: readonly TranscriptItem[],
  text: string,
): number {
  let count = 0;
  for (const item of transcript) {
    if (!isUserMessage(item) || isSteerEcho(item)) continue;
    if (item.text === text) count += 1;
  }
  return count;
}

/** How many user messages `transcript` holds, echoes excluded. */
export function countAllUserMessages(
  transcript: readonly TranscriptItem[],
): number {
  let count = 0;
  for (const item of transcript)
    if (isUserMessage(item) && !isSteerEcho(item)) count += 1;
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
 *  - a steer queued into a turn that is then STOPPED is never delivered, so
 *    the pane hands that text back to the composer rather than dropping it.
 *    That is true because `PiOpenSession.stop` empties Pi's steering queue
 *    before aborting; abort alone does not, and the queue outlives the run,
 *    so without that the words would arrive attached to whatever the reader
 *    sent next. See `ThreadPane` and `packages/pi-adapter`.
 */
export function steerEchoItem(pending: PendingSteer): SteerEchoItem {
  return {
    id: `${STEER_ECHO_ID_PREFIX}${pending.runId}:${String(pending.ordinal)}`,
    kind: "message",
    role: "user",
    text: pending.text,
    images: [],
    queuedImageCount: pending.images?.length ?? 0,
    timestamp: null,
  };
}

/** Returns the number of pane-local images confirmed by an optimistic steer. */
export function queuedSteerImageCount(item: TranscriptItem): number {
  if (!isSteerEcho(item) || !("queuedImageCount" in item)) return 0;
  const count = item.queuedImageCount;
  return typeof count === "number" && Number.isSafeInteger(count) && count > 0
    ? count
    : 0;
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
 *
 * Two refinements on that rule, and both are about what the client can
 * honestly claim to recognise:
 *
 *  - SF1. A steer Pi REWRITES before storing (`isRewrittenByPi`) can never
 *    match on text, so it is judged on the weaker fact the client still has:
 *    a user message of any text arrived that was not there when it was sent.
 *    Mid-run the only source of user messages is a steer landing, so this is
 *    a good identity and a bad one is not on offer. Without it the echo
 *    showed twice for the rest of the run and was then handed back to the
 *    composer as "never delivered" -- of a message Pi had acted on.
 *
 *  - SF2. The baseline is CLAMPED to what the transcript currently holds, and
 *    the clamp is returned so it persists. A transcript that shrinks between
 *    mint and retirement (compaction) otherwise leaves a count that can never
 *    exceed its baseline: the echo never retires, and is then reported
 *    undelivered although Pi delivered it.
 */
export function dropSettledSteers(
  transcript: readonly TranscriptItem[],
  pending: readonly PendingSteer[],
): readonly PendingSteer[] {
  if (pending.length === 0) return pending;
  const counts = new Map<string, number>();
  let total = 0;
  for (const item of transcript) {
    if (!isUserMessage(item) || isSteerEcho(item)) continue;
    total += 1;
    counts.set(item.text, (counts.get(item.text) ?? 0) + 1);
  }
  const kept: PendingSteer[] = [];
  let changed = false;
  for (const steer of pending) {
    const rewritten = isRewrittenByPi(steer.text);
    const count = rewritten ? total : (counts.get(steer.text) ?? 0);
    const minted = rewritten ? steer.priorUserMessages : steer.priorCopies;
    const baseline = Math.min(minted, count);
    if (count > baseline) {
      // Consumed from BOTH ledgers: a second echo of the same words is
      // judged against what is left rather than against the same copy again,
      // and a copy that retired a recognisable echo must not go on to retire
      // an unrecognisable one as well.
      if (!rewritten) counts.set(steer.text, count - 1);
      total -= 1;
      changed = true;
      continue;
    }
    if (baseline === minted) {
      kept.push(steer);
      continue;
    }
    changed = true;
    kept.push(
      rewritten
        ? { ...steer, priorUserMessages: baseline }
        : { ...steer, priorCopies: baseline },
    );
  }
  return changed ? kept : pending;
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

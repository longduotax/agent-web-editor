import { useEffect, useState, type SyntheticEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LiveEventSchema,
  LiveSnapshotRequiredSchema,
  TranscriptItemSchema,
  type ProjectId,
  type ThreadId,
  type ThreadSnapshot,
  type TranscriptItem,
} from "@pi-web/contracts";

import {
  getSnapshot,
  markViewed,
  prompt,
  steer,
  stop,
  webSocketUrl,
} from "../../api/client.js";
import { ActivityGroup, displayTranscript } from "../../components/Activity.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { Loading } from "../../components/Loading.js";
import { Markdown } from "../../components/Markdown.js";
import { useAutoGrow } from "../../components/useAutoGrow.js";
import { readDraft, removeDraft, writeDraft } from "./drafts.js";
import {
  mergeLiveTurn,
  reduceLiveTurn,
  STREAMING_ITEM_ID,
} from "./liveTranscript.js";
import { PaneHeader } from "./PaneHeader.js";
import { deriveRunStatus, elapsedLabel } from "./runStatus.js";
import { useStickToBottom } from "./stickToBottom.js";

export interface ThreadPaneProps {
  projectId: ProjectId;
  threadId: ThreadId;
  focused: boolean;
  onFocus(): void;
  onClose(): void;
  onSplit(): void;
}

/**
 * How long streamed transcript frames are pooled before one state update.
 *
 * Measured against the running server: a 2,583 character answer arrived as
 * 494 `transcript` frames in 14.5s, median 7ms apart. Applying each one
 * separately would re-render the transcript ~140 times a second and make
 * typing in the composer stutter. 40ms is 25 updates a second — under a paint
 * budget, and far above the rate at which text stops reading as "streaming".
 */
const LIVE_FLUSH_MS = 40;

/**
 * The floor between authoritative refetches.
 *
 * Tool activity never travels on the live channel — the adapter maps Pi's
 * tool events to "unsupported event" diagnostics, so steps reach the client
 * only through the snapshot route. Settled turns, run transitions and
 * diagnostics therefore still refetch, but Pi emits those in bursts (eight
 * diagnostics inside 20ms is normal), so they are throttled instead of
 * firing one HTTP request each.
 */
const LIVE_REFETCH_MS = 200;

/**
 * Subscribes to the thread's live channel and returns the in-progress
 * assistant turn.
 *
 * The turn is returned as component state rather than written into the
 * `["snapshot", ...]` cache entry, and that is load-bearing: React Query
 * replaces query data wholesale on every fetch success, the pane polls every
 * 15s, and the server snapshot provably cannot contain the in-progress
 * message. Cached, a partly-streamed answer was deleted from the screen by
 * every poll tick and every throttled refetch — invisible while tokens flow
 * at 7ms intervals, but a blank paragraph for the whole of a tool call.
 */
function useLive(
  projectId: ProjectId,
  threadId: ThreadId,
  ready: boolean,
  runActive: boolean,
): TranscriptItem | null {
  const queryClient = useQueryClient();
  const [liveTurn, setLiveTurn] = useState<TranscriptItem | null>(null);
  // The turn belongs to the run that produced it. `runActive` only goes false
  // once a fetch has told us so, and that same fetch carried the settled
  // message, so there is no moment where the text belongs to neither.
  useEffect(() => {
    if (!runActive) setLiveTurn(null);
  }, [runActive]);
  useEffect(() => {
    if (!ready) return;
    const queryKey = ["snapshot", projectId, threadId];
    let closed = false;
    let retry: number | undefined;
    let socket: WebSocket | undefined;
    // Where this client has read up to. Held here rather than in the query
    // data on purpose: making the effect depend on the snapshot's cursor tore
    // the socket down and rebuilt it after every refetch.
    let cursor: { epoch: string; sequence: number } | null = null;
    const pending: TranscriptItem[] = [];
    let flushTimer: number | undefined;
    let refetchTimer: number | undefined;
    let lastRefetch = 0;

    const flush = () => {
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      if (pending.length === 0) return;
      const batch = pending.splice(0, pending.length);
      setLiveTurn((current) => batch.reduce(reduceLiveTurn, current));
    };
    const scheduleFlush = () => {
      flushTimer ??= window.setTimeout(flush, LIVE_FLUSH_MS);
    };
    const refetch = () => {
      if (refetchTimer !== undefined) {
        clearTimeout(refetchTimer);
        refetchTimer = undefined;
      }
      lastRefetch = Date.now();
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    };
    const scheduleRefetch = () => {
      if (refetchTimer !== undefined) return;
      refetchTimer = window.setTimeout(
        refetch,
        Math.max(0, LIVE_REFETCH_MS - (Date.now() - lastRefetch)),
      );
    };

    const onMessage = (event: MessageEvent) => {
      // A frame can still be dispatched after cleanup closed the socket;
      // acting on it would leave a timer running past unmount.
      if (closed) return;
      let value: unknown;
      try {
        value = JSON.parse(String(event.data));
      } catch {
        return;
      }
      // The server cannot replay from where we are: everything we hold may be
      // stale, so drop the queue and take a full snapshot.
      if (LiveSnapshotRequiredSchema.safeParse(value).success) {
        cursor = null;
        pending.length = 0;
        refetch();
        return;
      }
      const parsed = LiveEventSchema.safeParse(value);
      if (!parsed.success) return;
      const live = parsed.data;
      if (live.threadId !== threadId) return;
      const contiguous =
        cursor !== null &&
        live.epoch === cursor.epoch &&
        live.sequence === cursor.sequence + 1;
      // Only ever forwards within an epoch, so a server that replayed an old
      // event could not rewind gap detection.
      if (live.epoch !== cursor?.epoch || live.sequence > cursor.sequence)
        cursor = { epoch: live.epoch, sequence: live.sequence };
      // A gap or a new epoch means events we never saw. The frame in hand is
      // still applied (payloads are whole items, not deltas), but the
      // snapshot is re-fetched to close whatever was missed.
      if (!contiguous) scheduleRefetch();
      if (live.eventType === "transcript") {
        const item = TranscriptItemSchema.safeParse(live.payload);
        if (!item.success) {
          scheduleRefetch();
          return;
        }
        pending.push(item.data);
        if (item.data.id === STREAMING_ITEM_ID) {
          scheduleFlush();
          return;
        }
        // The turn settled. Show it at once, then reconcile with the server
        // for the tool steps and canonical ids the live channel does not
        // carry; `mergeLiveTurn` stops appending it once that lands.
        flush();
        scheduleRefetch();
        return;
      }
      scheduleRefetch();
    };

    const connect = () => {
      socket = new WebSocket(webSocketUrl("/api/live"));
      socket.addEventListener("open", () => {
        const cached = queryClient.getQueryData<ThreadSnapshot>(queryKey);
        const resume =
          cursor ??
          (cached === undefined
            ? null
            : { epoch: cached.epoch, sequence: cached.highWaterSequence });
        cursor = resume;
        socket?.send(
          JSON.stringify({
            version: 1,
            type: "subscribe",
            threadId,
            ...(resume === null
              ? {}
              : { epoch: resume.epoch, cursor: resume.sequence }),
          }),
        );
      });
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", () => {
        if (!closed) retry = window.setTimeout(connect, 1_000);
      });
    };
    connect();
    return () => {
      closed = true;
      setLiveTurn(null);
      if (retry !== undefined) clearTimeout(retry);
      if (flushTimer !== undefined) clearTimeout(flushTimer);
      if (refetchTimer !== undefined) clearTimeout(refetchTimer);
      socket?.close();
    };
  }, [projectId, queryClient, ready, threadId]);
  return liveTurn;
}

type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;
type NonToolItem = Exclude<TranscriptItem, { kind: "tool" }>;
type TranscriptGroup =
  | { kind: "tool-run"; items: ToolItem[] }
  | { kind: "single"; item: NonToolItem };

// Contiguous tool items between messages/diagnostics collapse into one
// "Worked for …" disclosure, matching the Codex reading model.
function groupTranscriptItems(
  items: readonly TranscriptItem[],
): TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];
  for (const item of items) {
    if (item.kind === "tool") {
      const last = groups.at(-1);
      if (last?.kind === "tool-run") {
        last.items.push(item);
      } else {
        groups.push({ kind: "tool-run", items: [item] });
      }
    } else {
      groups.push({ kind: "single", item });
    }
  }
  return groups;
}

// Changes whenever the rendered transcript grows or its newest item's text
// grows (a streaming assistant turn), so the scroll container can follow the
// newest content without re-pinning on every unrelated re-render.
function transcriptContentKey(
  items: readonly TranscriptItem[],
  diagnostics: readonly string[],
): string {
  const last = items.at(-1);
  const lastLength =
    last !== undefined && "text" in last ? last.text.length : 0;
  return [items.length, last?.id ?? "", lastLength, diagnostics.length].join(
    ":",
  );
}

function Transcript({
  snapshot,
  liveTurn,
}: {
  snapshot: ThreadSnapshot;
  liveTurn: TranscriptItem | null;
}) {
  const items = displayTranscript(mergeLiveTurn(snapshot.transcript, liveTurn));
  const scrollRef = useStickToBottom<HTMLDivElement>(
    snapshot.thread.id,
    transcriptContentKey(items, snapshot.diagnostics),
  );
  const running = snapshot.currentRun?.state === "running";
  const groups = groupTranscriptItems(items);
  // The newest batch of steps stays open for the whole run. Keying "live" to
  // the last group of any kind made a finished batch snap shut the moment the
  // assistant started narrating after it, which is a layout jump mid-run.
  const lastToolGroup = groups.reduce(
    (last, group, index) => (group.kind === "tool-run" ? index : last),
    -1,
  );
  return (
    <div className="transcript" aria-label="Conversation" ref={scrollRef}>
      <div className="transcript-column">
        {items.length === 0 && (
          <div className="empty conversation-empty">
            <strong>No messages yet</strong>
            <span>
              Ask Pi to inspect, implement, or review something in this project.
            </span>
          </div>
        )}
        {groups.map((group, index) => {
          if (group.kind === "tool-run") {
            // A group is live while its run is: either it is the newest
            // batch of steps, or one of its steps is still running.
            const live =
              running &&
              (index === lastToolGroup ||
                group.items.some((item) => item.status === "running"));
            return (
              <ActivityGroup
                items={group.items}
                key={group.items[0]?.id}
                live={live}
                projectPath={snapshot.project.displayPath}
              />
            );
          }
          const { item } = group;
          if (item.kind === "diagnostic") {
            return (
              <p className={`diagnostic ${item.level}`} key={item.id}>
                {item.text}
              </p>
            );
          }
          if (item.role === "user") {
            return (
              <div className="u-row" key={item.id}>
                <div className="u-bubble">
                  <span className="sr-only">You</span>
                  <div className="markdown">
                    <Markdown>{item.text}</Markdown>
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div className="a-block" key={item.id}>
              <span className="sr-only">
                {item.role === "assistant" ? "Pi" : "System"}
              </span>
              <div className="markdown">
                <Markdown>{item.text}</Markdown>
              </div>
            </div>
          );
        })}
        {snapshot.diagnostics.map((diagnostic) => (
          <p className="diagnostic warning" key={diagnostic}>
            {diagnostic}
          </p>
        ))}
      </div>
    </div>
  );
}

export function Composer({
  projectId,
  threadId,
  snapshot,
}: {
  projectId: ProjectId;
  threadId: ThreadId;
  snapshot: ThreadSnapshot;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(() => readDraft(`pi-draft:${threadId}`));
  const textareaRef = useAutoGrow<HTMLTextAreaElement>(text);
  const active = snapshot.currentRun?.state === "running";
  const mutation = useMutation({
    mutationFn: async () =>
      active
        ? await steer(projectId, threadId, text)
        : await prompt(projectId, threadId, text),
    onSuccess: async () => {
      setText("");
      removeDraft(`pi-draft:${threadId}`);
      await queryClient.invalidateQueries({
        queryKey: ["snapshot", projectId, threadId],
      });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });
  useEffect(() => {
    writeDraft(`pi-draft:${threadId}`, text);
  }, [text, threadId]);

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (text.trim() === "") return;
    mutation.mutate();
  };
  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-input">
        <textarea
          ref={textareaRef}
          aria-label="Message Pi"
          placeholder="Ask Pi to work in this project…"
          rows={1}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.shiftKey ||
              event.nativeEvent.isComposing
            )
              return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
        />
        <div className="composer-actions">
          <span>Enter to send · Shift + Enter for a new line</span>
          {active && (
            <button
              type="button"
              className="stop"
              onClick={() =>
                void stop(projectId, threadId).then(() =>
                  queryClient.invalidateQueries({
                    queryKey: ["snapshot", projectId, threadId],
                  }),
                )
              }
            >
              ■ Stop
            </button>
          )}
          <button
            type="submit"
            className="send"
            aria-label={active ? "Steer current run" : "Send message"}
            title={active ? "Steer current run" : "Send message"}
            disabled={mutation.isPending || text.trim() === ""}
          >
            <span aria-hidden="true">↑</span>
          </button>
        </div>
      </div>
      {mutation.error !== null && (
        <ErrorNotice
          error={mutation.error}
          onRetry={() => {
            mutation.mutate();
          }}
        />
      )}
    </form>
  );
}

export function ThreadPane(props: ThreadPaneProps) {
  const { projectId, threadId, focused } = props;
  const snapshot = useQuery({
    queryKey: ["snapshot", projectId, threadId],
    queryFn: () => getSnapshot(projectId, threadId),
    refetchInterval: 15_000,
  });
  const liveTurn = useLive(
    projectId,
    threadId,
    snapshot.data !== undefined,
    snapshot.data?.currentRun?.state === "running",
  );
  useEffect(() => {
    const lastRun = snapshot.data?.lastRun;
    if (snapshot.data?.thread.unread === true && lastRun?.state === "completed")
      void markViewed(projectId, threadId, lastRun.id);
  }, [
    projectId,
    snapshot.data?.lastRun,
    snapshot.data?.thread.unread,
    threadId,
  ]);
  const threadWorkspace = snapshot.data?.thread.workspace ?? {
    mode: "shared" as const,
    branchName: null,
    available: true,
  };
  const status = deriveRunStatus({
    runState: snapshot.data?.thread.runState ?? null,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== "working") return;
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(id);
    };
  }, [status]);
  const elapsed =
    status === "working"
      ? elapsedLabel(snapshot.data?.currentRun?.startedAt ?? null, now)
      : null;
  const workspaceLabel = `${
    threadWorkspace.mode === "worktree" ? "↗ Worktree" : "⌂ Local checkout"
  }${threadWorkspace.branchName === null ? "" : ` · ⑂ ${threadWorkspace.branchName}`}`;
  // The header clamps its detail line to one row, so the full text lives on
  // the tooltip rather than being lost.
  const detailTitle = `${workspaceLabel} · Direct execution: Pi tools run with your user permissions, without application approval or an OS sandbox.`;
  // A failed run used to be a red dot and nothing else. Run.failureMessage /
  // Run.failureCode have always been in the contract and sent by the server;
  // surface whichever the server gave us so the failure path does not dead
  // end.
  const failedRun =
    snapshot.data?.lastRun?.state === "failed" ? snapshot.data.lastRun : null;
  const failureText =
    failedRun === null
      ? null
      : (failedRun.failureMessage ??
        (failedRun.failureCode === null
          ? "The run failed without reporting a reason."
          : `The run failed (${failedRun.failureCode}).`));

  return (
    <section
      className={`pane thread-pane ${focused ? "focused" : "dim"}`}
      aria-label={snapshot.data?.thread.title ?? "Thread"}
      aria-current={focused ? "true" : undefined}
      onClick={() => {
        props.onFocus();
      }}
    >
      <PaneHeader
        status={status}
        elapsed={elapsed}
        title={snapshot.data?.thread.title ?? "Thread"}
        projectLabel={snapshot.data?.project.displayName ?? ""}
        focused={focused}
        detailTitle={detailTitle}
        detail={
          <>
            <span className="pane-meta">{workspaceLabel}</span>
            <span className="trust-note">
              <span className="trust-dot" aria-hidden="true" />
              <strong>Direct execution:</strong> Pi tools run with your user
              permissions, without application approval or an OS sandbox.
            </span>
          </>
        }
        onSplit={() => {
          props.onSplit();
        }}
        onClose={() => {
          props.onClose();
        }}
      />
      {snapshot.isPending ? (
        <Loading />
      ) : snapshot.error !== null ? (
        <main className="center">
          <ErrorNotice
            error={snapshot.error}
            onRetry={() => {
              void snapshot.refetch();
            }}
          />
        </main>
      ) : (
        <main className="center">
          <Transcript liveTurn={liveTurn} snapshot={snapshot.data} />
          {failureText !== null && (
            <div className="run-failure">
              <p className="run-failure-body" role="status">
                <span className="sdot fail" aria-hidden="true" />
                {failureText}
              </p>
            </div>
          )}
          <Composer
            projectId={projectId}
            threadId={threadId}
            snapshot={snapshot.data}
          />
        </main>
      )}
    </section>
  );
}

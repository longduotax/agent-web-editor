import { useEffect, useState, type SyntheticEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LiveEventSchema,
  LiveSnapshotRequiredSchema,
  type ProjectId,
  type ThreadId,
  type ThreadSnapshot,
  type TranscriptItem,
  type TranscriptPage,
} from "@pi-web/contracts";

import {
  ApiClientError,
  getOlderTranscriptPage,
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
import { BACKEND_LABEL, PaneHeader } from "./PaneHeader.js";
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

function useLive(
  projectId: ProjectId,
  threadId: ThreadId,
  snapshot: ThreadSnapshot | undefined,
): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (snapshot === undefined) return;
    let closed = false;
    let retry: number | undefined;
    let socket: WebSocket | undefined;
    const connect = () => {
      socket = new WebSocket(webSocketUrl("/api/live"));
      socket.addEventListener("open", () =>
        socket?.send(
          JSON.stringify({
            version: 1,
            type: "subscribe",
            threadId,
            epoch: snapshot.epoch,
            cursor: snapshot.highWaterSequence,
          }),
        ),
      );
      socket.addEventListener("message", (event) => {
        let value: unknown;
        try {
          value = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (
          LiveEventSchema.safeParse(value).success ||
          LiveSnapshotRequiredSchema.safeParse(value).success
        ) {
          void queryClient.invalidateQueries({
            queryKey: ["snapshot", projectId, threadId],
          });
          void queryClient.invalidateQueries({ queryKey: ["workspace"] });
        }
      });
      socket.addEventListener("close", () => {
        if (!closed) retry = window.setTimeout(connect, 1_000);
      });
    };
    connect();
    return () => {
      closed = true;
      if (retry !== undefined) clearTimeout(retry);
      socket?.close();
    };
  }, [
    projectId,
    queryClient,
    snapshot?.epoch,
    snapshot?.highWaterSequence,
    threadId,
  ]);
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

function pageKey(page: TranscriptPage): string {
  return `${page.items[0]?.id ?? "empty"}:${page.items.at(-1)?.id ?? "empty"}:${String(page.items.length)}`;
}

function Transcript({
  projectId,
  threadId,
  snapshot,
}: {
  projectId: ProjectId;
  threadId: ThreadId;
  snapshot: ThreadSnapshot;
}) {
  const [pages, setPages] = useState<TranscriptPage[]>([
    snapshot.transcriptPage,
  ]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const latestKey = pageKey(snapshot.transcriptPage);

  useEffect(() => {
    setPages([snapshot.transcriptPage]);
    setHistoryError(null);
  }, [snapshot.thread.id]);

  useEffect(() => {
    setPages((current) => {
      const latestIndex = current.findIndex((page) => page.atLatest);
      if (latestIndex < 0) return current;
      const next = [...current];
      next[latestIndex] = snapshot.transcriptPage;
      return next;
    });
  }, [latestKey, snapshot.transcriptPage]);

  const items = displayTranscript(
    pages
      .flatMap((page) => page.items)
      .filter(
        (item, index, all) =>
          all.findIndex((candidate) => candidate.id === item.id) === index,
      ),
  );
  const scrollRef = useStickToBottom<HTMLDivElement>(
    snapshot.thread.id,
    transcriptContentKey(items, snapshot.diagnostics),
  );
  const oldestCursor = pages[0]?.olderCursor ?? null;
  const showingLatest = pages.some((page) => page.atLatest);

  const loadEarlier = async () => {
    if (oldestCursor === null || loadingOlder) return;
    setLoadingOlder(true);
    setHistoryError(null);
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    const previousTop = element?.scrollTop ?? 0;
    try {
      const page = await getOlderTranscriptPage(
        projectId,
        threadId,
        oldestCursor,
      );
      setPages((current) => [page, ...current].slice(0, 5));
      requestAnimationFrame(() => {
        if (element !== null)
          element.scrollTop =
            previousTop + element.scrollHeight - previousHeight;
      });
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "stale_transcript"
      ) {
        setPages([snapshot.transcriptPage]);
        setHistoryError(
          "Conversation history changed, so the view returned to the latest messages.",
        );
      } else
        setHistoryError(
          error instanceof Error
            ? error.message
            : "Earlier messages could not be loaded.",
        );
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <div className="transcript" aria-label="Conversation" ref={scrollRef}>
      <div className="transcript-column">
        {oldestCursor !== null && (
          <button
            type="button"
            className="history-page-control"
            disabled={loadingOlder}
            onClick={() => void loadEarlier()}
          >
            {loadingOlder
              ? "Loading earlier messages…"
              : "Load earlier messages"}
          </button>
        )}
        {!showingLatest && (
          <button
            type="button"
            className="history-page-control"
            onClick={() => {
              setPages([snapshot.transcriptPage]);
            }}
          >
            Jump to latest
          </button>
        )}
        {historyError !== null && (
          <p className="diagnostic warning" role="alert">
            {historyError}{" "}
            <button type="button" onClick={() => void loadEarlier()}>
              Retry
            </button>
          </p>
        )}
        {items.length === 0 && (
          <div className="empty conversation-empty">
            <strong>No messages yet</strong>
            <span>
              Ask Pi to inspect, implement, or review something in this project.
            </span>
          </div>
        )}
        {groupTranscriptItems(items).map((group) => {
          if (group.kind === "tool-run") {
            return (
              <ActivityGroup
                items={group.items}
                key={group.items[0]?.id}
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
  // The composer names the agent that will actually read the message; a Codex
  // chat inviting you to "Ask Pi" would be simply wrong.
  const agentLabel = BACKEND_LABEL[snapshot.thread.runtime];

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-input">
        <textarea
          ref={textareaRef}
          aria-label={`Message ${agentLabel}`}
          placeholder={`Ask ${agentLabel} to work in this project…`}
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
  useLive(projectId, threadId, snapshot.data);
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
        runtime={snapshot.data?.thread.runtime ?? null}
        focused={focused}
        detailTitle={detailTitle}
        detail={
          <>
            <span className="pane-meta">{workspaceLabel}</span>
            {snapshot.data?.thread.runtime === "codex" ? (
              <span className="trust-note">
                <span className="trust-dot" aria-hidden="true" />
                <strong>Confined execution:</strong> Codex runs without
                application approval, inside the boundary this server was
                configured with.
              </span>
            ) : (
              <span className="trust-note">
                <span className="trust-dot" aria-hidden="true" />
                <strong>Direct execution:</strong> Pi tools run with your user
                permissions, without application approval or an OS sandbox.
              </span>
            )}
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
          <Transcript
            projectId={projectId}
            threadId={threadId}
            snapshot={snapshot.data}
          />
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

import { useEffect, useState, type SyntheticEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LiveEventSchema,
  LiveSnapshotRequiredSchema,
  type ProjectId,
  type ThreadId,
  type ThreadSnapshot,
} from "@pi-web/contracts";

import {
  getSnapshot,
  markViewed,
  prompt,
  steer,
  stop,
  webSocketUrl,
} from "../../api/client.js";
import { Activity, displayTranscript } from "../../components/Activity.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { Loading } from "../../components/Loading.js";
import { Markdown } from "../../components/Markdown.js";
import { Status } from "../../components/Status.js";
import { readDraft, removeDraft, writeDraft } from "./drafts.js";
import { PaneHeader } from "./PaneHeader.js";
import { deriveRunStatus, elapsedLabel } from "./runStatus.js";

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

function Transcript({ snapshot }: { snapshot: ThreadSnapshot }) {
  return (
    <div className="transcript" aria-label="Conversation">
      {snapshot.transcript.length === 0 && (
        <div className="empty conversation-empty">
          <strong>No messages yet</strong>
          <span>
            Ask Pi to inspect, implement, or review something in this project.
          </span>
        </div>
      )}
      {displayTranscript(snapshot.transcript).map((item) =>
        item.kind === "message" ? (
          <article className={`message message-${item.role}`} key={item.id}>
            <header>
              {item.role === "assistant"
                ? "Pi"
                : item.role === "user"
                  ? "You"
                  : "System"}
            </header>
            <div className="markdown">
              <Markdown>{item.text}</Markdown>
            </div>
          </article>
        ) : item.kind === "tool" ? (
          <Activity
            item={item}
            key={item.id}
            projectPath={snapshot.project.displayPath}
          />
        ) : (
          <p className={`diagnostic ${item.level}`} key={item.id}>
            {item.text}
          </p>
        ),
      )}
      {snapshot.diagnostics.map((diagnostic) => (
        <p className="diagnostic warning" key={diagnostic}>
          {diagnostic}
        </p>
      ))}
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
          aria-label="Message Pi"
          placeholder="Ask Pi to work in this project…"
          rows={3}
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
      {mutation.error !== null && <ErrorNotice error={mutation.error} />}
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
          <ErrorNotice error={snapshot.error} />
        </main>
      ) : (
        <main className="center">
          <header className="thread-header">
            <div>
              <small>
                {snapshot.data.project.displayName} ·{" "}
                {threadWorkspace.mode === "worktree"
                  ? "↗ Worktree"
                  : "⌂ Local checkout"}
                {threadWorkspace.branchName === null
                  ? ""
                  : ` · ⑂ ${threadWorkspace.branchName}`}
              </small>
              <h1>{snapshot.data.thread.title}</h1>
            </div>
            <Status
              state={
                snapshot.data.currentRun?.state ??
                snapshot.data.lastRun?.state ??
                null
              }
              unread={snapshot.data.thread.unread}
            />
          </header>
          <div className="trust-warning">
            <strong>Direct execution:</strong> Pi tools run with your user
            permissions, without application approval or an OS sandbox.
          </div>
          <Transcript snapshot={snapshot.data} />
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

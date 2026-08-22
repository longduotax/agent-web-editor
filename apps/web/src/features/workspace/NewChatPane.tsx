import { useEffect, useState, type SyntheticEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

import {
  commandId,
  getWorkspace,
  getWorkspacePreflight,
  startThread,
} from "../../api/client.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { Markdown } from "../../components/Markdown.js";
import {
  newChatDraftKey,
  readDraft,
  removeDraft,
  writeDraft,
} from "./drafts.js";
import type { PaneId } from "./layoutTree.js";
import { PaneHeader } from "./PaneHeader.js";
import { useAutoGrow } from "../../components/useAutoGrow.js";

export interface NewChatPaneProps {
  projectId: ProjectId;
  paneId: PaneId;
  focused: boolean;
  onFocus(): void;
  onClose(): void;
  onSplit(): void;
  onThreadStarted(threadId: ThreadId): void;
}

export function NewChatPane(props: NewChatPaneProps) {
  const { projectId, paneId, focused } = props;
  const draftKey = newChatDraftKey(projectId, paneId);
  const queryClient = useQueryClient();
  const workspace = useQuery({
    queryKey: ["workspace"],
    queryFn: getWorkspace,
  });
  const preflight = useQuery({
    queryKey: ["workspace-preflight", projectId],
    queryFn: () => getWorkspacePreflight(projectId),
  });
  const [mode, setMode] = useState<"worktree" | "shared">("worktree");
  const [sourceChanges, setSourceChanges] = useState<
    "none" | "tracked_and_untracked"
  >("none");
  const [baseBranch, setBaseBranch] = useState("");
  const [creationKey, setCreationKey] = useState(commandId);
  const [text, setText] = useState(() => readDraft(draftKey));
  // The prompt the user has already committed to but that has no thread yet.
  // Starting the first thread creates a git worktree, which takes 1.6-2.6s;
  // leaving the text sitting in the composer for that long reads as "Enter
  // did not register", so the message is echoed here the moment it is sent.
  const [sentPrompt, setSentPrompt] = useState<string | null>(null);
  const textareaRef = useAutoGrow<HTMLTextAreaElement>(text);
  useEffect(() => {
    setMode("worktree");
    setSourceChanges("none");
    setBaseBranch("");
    setCreationKey(commandId());
    setSentPrompt(null);
    setText(readDraft(newChatDraftKey(projectId, paneId)));
  }, [paneId, projectId]);
  useEffect(() => {
    if (preflight.data?.currentBranch !== null && baseBranch === "")
      setBaseBranch(preflight.data?.currentBranch ?? "");
  }, [baseBranch, preflight.data?.currentBranch]);
  useEffect(() => {
    writeDraft(draftKey, text);
  }, [draftKey, text]);
  const create = useMutation({
    mutationFn: async (promptText: string) =>
      await startThread(
        projectId,
        promptText,
        mode === "shared"
          ? { mode: "shared" }
          : {
              mode: "worktree",
              baseBranch,
              sourceChanges,
              ...(sourceChanges === "tracked_and_untracked" &&
              preflight.data?.changes !== null &&
              preflight.data?.changes !== undefined
                ? { sourceStateToken: preflight.data.changes.token }
                : {}),
            },
        creationKey,
      ),
    onSuccess: async (result) => {
      removeDraft(draftKey);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      props.onThreadStarted(result.thread.id);
    },
  });
  const project = workspace.data?.projects.find(
    (candidate) => candidate.id === projectId,
  );
  const send = (value: string) => {
    if (
      value.trim() === "" ||
      (mode === "worktree" &&
        (!preflight.data?.worktreeAvailable || baseBranch === ""))
    )
      return;
    setSentPrompt(value);
    setText("");
    create.mutate(value, {
      onError: () => {
        // A failed submit must never eat what was typed: the composer gets
        // the text back byte for byte, draft included, and the echo goes
        // away so there is only one copy of it on screen.
        setSentPrompt(null);
        setText(value);
        writeDraft(draftKey, value);
      },
    });
  };
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    send(text);
  };
  return (
    <section
      className={`pane new-chat-pane ${focused ? "focused" : "dim"}`}
      aria-label="New chat"
      aria-current={focused ? "true" : undefined}
      onClick={() => {
        props.onFocus();
      }}
    >
      <PaneHeader
        status={null}
        elapsed={null}
        title="New chat"
        projectLabel={project?.displayName ?? ""}
        focused={focused}
        detail={
          <span className="pane-meta">
            Pick where Pi runs, then describe the work.
          </span>
        }
        onSplit={() => {
          props.onSplit();
        }}
        onClose={() => {
          props.onClose();
        }}
      />
      <main className="center new-chat">
        {sentPrompt !== null && (
          // Sits on the same reading column as the card below it, so the
          // echoed message lands where the transcript will render it a moment
          // later. Worktree preparation is a step in that transcript now, not
          // an 11px grey hint in the corner of the composer.
          <div className="transcript-column" aria-label="Conversation">
            <div className="u-row">
              <div className="u-bubble">
                <span className="sr-only">You</span>
                <div className="markdown">
                  <Markdown>{sentPrompt}</Markdown>
                </div>
              </div>
            </div>
            <details className="activity activity-running">
              <summary>
                <span className="activity-state" aria-label="Running">
                  <span aria-hidden="true">◌</span>
                </span>
                <span className="activity-action">Preparing</span>
                <span className="activity-target">
                  {mode === "worktree"
                    ? "new git worktree"
                    : (project?.displayPath ?? "local checkout")}
                </span>
                <span className="activity-meta">naming the thread</span>
                <span className="activity-chevron" aria-hidden="true">
                  ›
                </span>
              </summary>
              <div className="activity-details">
                <section>
                  <h3>Input</h3>
                  <pre>
                    {mode === "worktree"
                      ? `git worktree add  (base ${baseBranch || "HEAD"}, ${
                          sourceChanges === "none"
                            ? "clean start"
                            : "including local changes"
                        })`
                      : "Running in the existing local checkout."}
                  </pre>
                </section>
              </div>
            </details>
          </div>
        )}
        <form className="new-chat-card" onSubmit={submit}>
          <div className="new-chat-toolbar" aria-label="New chat configuration">
            <label>
              <span className="sr-only">Execution location</span>
              <select
                aria-label="Execution location"
                value={mode}
                onChange={(event) => {
                  setMode(
                    event.target.value === "shared" ? "shared" : "worktree",
                  );
                  setSourceChanges("none");
                  setCreationKey(commandId());
                }}
              >
                <option
                  value="worktree"
                  disabled={preflight.data?.worktreeAvailable === false}
                >
                  New worktree
                </option>
                <option value="shared">Local checkout</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Starting state</span>
              <select
                aria-label="Starting state"
                value={mode === "shared" ? "current" : sourceChanges}
                disabled={mode === "shared"}
                onChange={(event) => {
                  setSourceChanges(
                    event.target.value === "tracked_and_untracked"
                      ? "tracked_and_untracked"
                      : "none",
                  );
                  setCreationKey(commandId());
                }}
              >
                {mode === "shared" && (
                  <option value="current">Current local files</option>
                )}
                {mode === "worktree" && (
                  <>
                    <option value="none">Clean start</option>
                    <option
                      value="tracked_and_untracked"
                      disabled={
                        baseBranch !==
                          (preflight.data === undefined
                            ? null
                            : preflight.data.currentBranch) ||
                        (preflight.data?.changes?.files.length ?? 0) === 0
                      }
                    >
                      Include local changes
                    </option>
                  </>
                )}
              </select>
            </label>
            <label>
              <span className="sr-only">Base branch</span>
              <select
                aria-label="Base branch"
                value={baseBranch}
                disabled={mode === "shared"}
                onChange={(event) => {
                  setBaseBranch(event.target.value);
                  setSourceChanges("none");
                  setCreationKey(commandId());
                }}
              >
                {(preflight.data?.branches ?? []).map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {mode === "worktree" &&
            preflight.data?.worktreeAvailable === false && (
              <p className="new-chat-note" role="alert">
                {preflight.data.unavailableReason}
              </p>
            )}
          {mode === "worktree" && sourceChanges === "none" && (
            <p className="new-chat-note">
              Starts from committed {baseBranch || "HEAD"}. Local changes are
              not copied.
            </p>
          )}
          {mode === "worktree" && sourceChanges === "tracked_and_untracked" && (
            <div className="new-chat-note warning">
              <p>
                Including {String(preflight.data?.changes?.files.length ?? 0)}{" "}
                local changes. Ignored files are excluded.
              </p>
              <details>
                <summary>Review files</summary>
                <ul>
                  {preflight.data?.changes?.files.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </details>
            </div>
          )}
          {mode === "shared" && (
            <p className="new-chat-note warning">
              Pi will work directly in the existing checkout and see its current
              files.
            </p>
          )}
          <div className="composer-input new-chat-input">
            <textarea
              ref={textareaRef}
              aria-label="First message"
              placeholder={`Ask Pi to work in ${project?.displayName ?? "this project"}…`}
              rows={1}
              autoFocus
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setCreationKey(commandId());
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
              <span>
                {create.isPending
                  ? "Naming and preparing workspace…"
                  : "Enter to send · Shift + Enter for a new line"}
              </span>
              <button
                type="submit"
                className="send"
                aria-label="Create chat and send"
                disabled={create.isPending || text.trim() === ""}
              >
                <span aria-hidden="true">↑</span>
              </button>
            </div>
          </div>
          {create.error !== null && (
            <ErrorNotice
              error={create.error}
              onRetry={() => {
                send(text);
              }}
            />
          )}
        </form>
      </main>
    </section>
  );
}

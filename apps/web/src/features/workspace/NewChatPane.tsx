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
  const textareaRef = useAutoGrow<HTMLTextAreaElement>(text);
  useEffect(() => {
    setMode("worktree");
    setSourceChanges("none");
    setBaseBranch("");
    setCreationKey(commandId());
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
    mutationFn: async () =>
      await startThread(
        projectId,
        text,
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
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      text.trim() === "" ||
      (mode === "worktree" &&
        (!preflight.data?.worktreeAvailable || baseBranch === ""))
    )
      return;
    create.mutate();
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
                create.mutate();
              }}
            />
          )}
        </form>
      </main>
    </section>
  );
}

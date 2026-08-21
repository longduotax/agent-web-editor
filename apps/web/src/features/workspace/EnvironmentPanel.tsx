import { useEffect, useState, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GitFileStatus, ProjectId, ThreadId } from "@pi-web/contracts";

import { getSnapshot, getStatus } from "../../api/client.js";
import {
  deriveRunStatus,
  elapsedLabel,
  PANE_STATUS_LABEL,
  PANE_STATUS_TOKEN,
} from "./runStatus.js";
import type { WorkspaceLayoutController } from "./useWorkspaceLayout.js";

export interface EnvironmentPanelProps {
  projectId: ProjectId;
  controller: WorkspaceLayoutController;
  onClose(): void; // user hides the panel (persists "hidden")
}

// Buckets the raw git kinds into the three counts the mockup's Changes row
// distinguishes; renamed/copied read as neither an addition nor a removal so
// they fall in with "modified" (content moved, not created/destroyed).
function summarizeChanges(files: GitFileStatus[]): string {
  if (files.length === 0) return "No changes";
  let added = 0;
  let modified = 0;
  let deleted = 0;
  for (const file of files) {
    if (file.kind === "added" || file.kind === "untracked") added += 1;
    else if (file.kind === "deleted") deleted += 1;
    else modified += 1; // modified, conflicted, renamed, copied
  }
  const parts: string[] = [];
  if (added > 0) parts.push(`${String(added)} added`);
  if (modified > 0) parts.push(`${String(modified)} modified`);
  if (deleted > 0) parts.push(`${String(deleted)} deleted`);
  return parts.join(", ");
}

export function EnvironmentPanel(props: EnvironmentPanelProps): JSX.Element {
  const { projectId, controller, onClose } = props;
  const { focusedPaneId } = controller.layout;
  const focusedPane =
    focusedPaneId !== null ? controller.layout.panes[focusedPaneId] : undefined;
  const threadId: ThreadId | null = focusedPane?.threadId ?? null;

  const snapshot = useQuery({
    queryKey: ["snapshot", projectId, threadId],
    queryFn: () => getSnapshot(projectId, threadId as ThreadId),
    enabled: threadId !== null,
  });
  // Same query key the (per-thread) Inspector uses for git status, so the
  // two share react-query's cache instead of double-fetching.
  const status = useQuery({
    queryKey: ["git", projectId, threadId],
    queryFn: () => getStatus(projectId, threadId as ThreadId),
    enabled: threadId !== null,
  });

  const runStatus = deriveRunStatus({
    runState: snapshot.data?.thread.runState ?? null,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (runStatus !== "working") return;
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(id);
    };
  }, [runStatus]);
  const elapsed =
    runStatus === "working"
      ? elapsedLabel(snapshot.data?.currentRun?.startedAt ?? null, now)
      : null;

  const workspace = snapshot.data?.thread.workspace ?? null;
  const worktreeText = workspace === null
    ? ""
    : workspace.mode === "worktree"
      ? "Worktree"
      : "Shared";
  const branchText = workspace === null
    ? ""
    : workspace.mode === "worktree"
      ? workspace.branchName
      : (workspace.branchName ?? "shared");

  const changesText = status.isPending
    ? "…"
    : status.data === undefined || !status.data.available
      ? "Unavailable"
      : summarizeChanges(status.data.files);

  return (
    <aside className="environment-panel" aria-label="Environment">
      <div className="insp-head">
        <span className="t">Environment</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Hide environment panel"
          title="Hide environment panel"
          onClick={onClose}
        >
          <svg
            className="ico ico-sm"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {threadId === null ? (
        <div className="insp-body">
          <div className="insp-row muted">
            <span className="grow">No focused run</span>
          </div>
        </div>
      ) : (
        <>
          <div className="insp-focus">
            <div className="fr">
              {runStatus !== null && (
                <span
                  className={`sdot ${PANE_STATUS_TOKEN[runStatus]}`}
                  aria-hidden="true"
                />
              )}
              <span className="title">
                {snapshot.data?.thread.title ?? "Thread"}
              </span>
            </div>
            <div className="fs">
              <span className="status-label">
                {runStatus !== null ? PANE_STATUS_LABEL[runStatus] : "No status"}
              </span>
              {elapsed !== null && (
                <span className="status-elapsed">{` · ${elapsed}`}</span>
              )}
            </div>
          </div>
          <div className="insp-body">
            <div className="insp-row">
              <span className="grow">Changes</span>
              <span>{changesText}</span>
            </div>
            <div className="insp-row">
              <span className="grow">Worktree</span>
              <span>{worktreeText}</span>
            </div>
            <div className="insp-row">
              <span className="grow">{branchText}</span>
            </div>
            <div className="insp-row muted">
              <span className="grow">Commit or push</span>
            </div>
            <div className="insp-sep" />
            <div className="insp-sec">
              <span className="grow">Sources</span>
            </div>
            <div className="insp-row muted">
              <span className="grow">GitHub</span>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

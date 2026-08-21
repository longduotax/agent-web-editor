import { useQuery } from "@tanstack/react-query";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

import { getSnapshot } from "../../api/client.js";
import { needsAttention } from "./attention.js";
import type { PaneId } from "./layoutTree.js";
import type { WorkspaceLayoutController } from "./useWorkspaceLayout.js";

export interface DockProps {
  projectId: ProjectId;
  controller: WorkspaceLayoutController;
}

function DockChipShell({
  paneId,
  title,
  attention,
  onRestore,
}: {
  paneId: PaneId;
  title: string;
  attention: boolean;
  onRestore: (paneId: PaneId) => void;
}) {
  return (
    <button
      type="button"
      className="dock-chip"
      onClick={() => {
        onRestore(paneId);
      }}
    >
      <span className="dock-chip-title">{title}</span>
      {attention && (
        <>
          <span className="dock-chip-dot" aria-hidden="true" />
          <span className="sr-only">needs attention</span>
        </>
      )}
    </button>
  );
}

function ThreadedDockChip({
  projectId,
  threadId,
  paneId,
  onRestore,
}: {
  projectId: ProjectId;
  threadId: ThreadId;
  paneId: PaneId;
  onRestore: (paneId: PaneId) => void;
}) {
  const snapshot = useQuery({
    queryKey: ["snapshot", projectId, threadId],
    queryFn: () => getSnapshot(projectId, threadId),
  });
  const thread = snapshot.data?.thread;
  const attention =
    thread !== undefined &&
    needsAttention({ runState: thread.runState, unread: thread.unread });

  return (
    <DockChipShell
      paneId={paneId}
      title={thread?.title ?? "Thread"}
      attention={attention}
      onRestore={onRestore}
    />
  );
}

function ThreadlessDockChip({
  paneId,
  onRestore,
}: {
  paneId: PaneId;
  onRestore: (paneId: PaneId) => void;
}) {
  return (
    <DockChipShell
      paneId={paneId}
      title="New chat"
      attention={false}
      onRestore={onRestore}
    />
  );
}

export function DockRow({ projectId, controller }: DockProps) {
  const { docked, panes } = controller.layout;
  const onRestore = (paneId: PaneId) => {
    controller.restore(paneId);
  };

  if (docked.length === 0) return <div className="dock-row" />;

  return (
    <div className="dock-row" role="group" aria-label="Docked panes">
      {docked.map((paneId) => {
        const threadId = panes[paneId]?.threadId ?? null;
        return threadId === null ? (
          <ThreadlessDockChip
            key={paneId}
            paneId={paneId}
            onRestore={onRestore}
          />
        ) : (
          <ThreadedDockChip
            key={paneId}
            projectId={projectId}
            threadId={threadId}
            paneId={paneId}
            onRestore={onRestore}
          />
        );
      })}
    </div>
  );
}

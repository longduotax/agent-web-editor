import { memo, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";

import { getStatus } from "../../api/client.js";
import { summarizeChanges } from "../../components/changesSummary.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { UnboundNotice } from "./tabBody.js";
import type { TabBodyProps } from "./tabBody.js";

// The working-tree status of one execution scope (WSP-06). Labelled as the
// current state of a named worktree, never as the thread's output — the two
// are different claims, and only the first one is true.

export const ChangesTab = memo(function ChangesTab({
  tab,
  visible,
  actions,
}: TabBodyProps<"changes">): JSX.Element {
  const context = tab.context;
  const status = useQuery({
    queryKey: ["git", context?.projectId, context?.threadId],
    queryFn: async () => {
      if (context === null)
        throw new Error("This tab has no worktree to read.");
      return await getStatus(context.projectId, context.threadId);
    },
    enabled: visible && context !== null,
  });

  if (context === null) return <UnboundNotice />;

  const files = status.data?.files ?? [];
  return (
    <>
      <p className="scope-note">
        {`Working tree: ${context.label}`}
        {status.data?.available === true &&
          files.length > 0 &&
          ` · ${summarizeChanges(files)}`}
      </p>
      {status.isPending && (
        <p className="panel-state" aria-live="polite">
          Reading the worktree…
        </p>
      )}
      {status.data?.available === false && (
        <div className="empty">{status.data.message}</div>
      )}
      {status.data?.available === true && files.length === 0 && (
        <div className="empty">No changes in this worktree.</div>
      )}
      <ul className="file-list">
        {files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              onClick={() => {
                // A tab of its own, so the list the user is reading survives
                // (WSP-06), carrying this tab's context rather than whatever
                // chat pane happens to be focused.
                actions.openTab({
                  type: "diff",
                  context,
                  path: file.path,
                  collapsedHunks: [],
                });
              }}
            >
              <span className={`change-kind ${file.kind}`}>
                {file.kind[0]?.toUpperCase()}
              </span>
              <span>{file.path}</span>
            </button>
          </li>
        ))}
      </ul>
      {files.length > 0 && (
        <p className="panel-state">Select a file to view its diff.</p>
      )}
      {status.error !== null && (
        <ErrorNotice
          error={status.error}
          onRetry={() => {
            void status.refetch();
          }}
        />
      )}
    </>
  );
});

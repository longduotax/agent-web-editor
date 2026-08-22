import { memo, type JSX } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

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
    // The one tab body that does NOT share the panel's stale window (D5).
    //
    // WSP-06 says this list is "the current working-tree state of a named
    // worktree". Nothing invalidates it: the live channel carries transcript,
    // run, completion and diagnostic events — none of which says the worktree
    // changed — and it is only subscribed for threads that have a chat pane
    // on screen, while this tab may be pointed at any thread. A shell run in
    // a Terminal tab changes the tree and emits nothing at all. So an
    // invalidation route would be wrong for most of the ways the tree
    // actually changes, and a thirty-second window would leave a diff list
    // claiming to be current while being wrong.
    //
    // WSP-09's "no refetch on switch" gives way to that, but only as far as
    // it has to: `keepPreviousData` holds the list on screen while the
    // refetch runs, so returning to this tab costs a request, never a blank
    // panel or a lost scroll position.
    staleTime: 0,
    placeholderData: keepPreviousData,
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

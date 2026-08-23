import { memo, type JSX } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { GitFileStatus } from "@pi-web/contracts";

import { getStatus } from "../../api/client.js";
import { summarizeChanges } from "../../components/changesSummary.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { UnboundNotice } from "./tabBody.js";
import type { TabBodyProps } from "./tabBody.js";

// The working-tree status of one execution scope (WSP-06). Labelled as the
// current state of a named worktree, never as the thread's output — the two
// are different claims, and only the first one is true.

/**
 * How many changed paths are painted at once.
 *
 * WSP-09's render budget, which names status lists alongside file listings
 * and diffs. A working tree with more changes than this is unusual and a
 * generated one is not — and the notice below always says what was left
 * out, so a bounded list never reads as a complete one.
 */
export const CHANGES_RENDER_LIMIT = 200;

/**
 * The letter each change kind carries, so the distinction is never in the
 * colour alone (WSP-06).
 *
 * Git's own letters rather than the first letter of the kind's name: `git
 * status --short` writes `?` for untracked and `U` for unmerged, and taking
 * initials instead gave `C` to both "copied" and "conflicted" — two kinds
 * one letter cannot tell apart.
 */
const CHANGE_LETTERS: Record<GitFileStatus["kind"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "?",
  conflicted: "U",
};

/** The same distinction in words, for a reader who cannot see the letter. */
const CHANGE_WORDS: Record<GitFileStatus["kind"], string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
  copied: "Copied",
  untracked: "Untracked",
  conflicted: "Conflicted",
};

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
        {files.slice(0, CHANGES_RENDER_LIMIT).map((file) => (
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
                  wrap: false,
                });
              }}
            >
              {/* The change kind, carried by a letter as well as a colour
                  (WSP-06). The letter is Git's own — `?` for untracked and
                  `U` for unmerged — because the first letter of the kind's
                  name gave `C` to both "copied" and "conflicted", which is
                  a distinction carried by colour alone in everything but
                  name. The word beside it is what a screen reader reads:
                  "M" is a letter, not a sentence. */}
              <span className={`change-kind ${file.kind}`} aria-hidden="true">
                {CHANGE_LETTERS[file.kind]}
              </span>
              <span className="sr-only">{`${CHANGE_WORDS[file.kind]}: `}</span>
              <span>{file.path}</span>
            </button>
          </li>
        ))}
      </ul>
      {files.length > CHANGES_RENDER_LIMIT && (
        <p className="panel-state">
          {`Showing the first ${String(CHANGES_RENDER_LIMIT)} of ${String(files.length)} changed files.`}
        </p>
      )}
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

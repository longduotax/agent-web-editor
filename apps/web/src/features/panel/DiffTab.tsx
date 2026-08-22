import { memo, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";

import { getDiff } from "../../api/client.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { DiffText } from "./DiffText.js";
import { PANEL_QUERY_STALE_TIME, UnboundNotice } from "./tabBody.js";
import type { TabBodyProps } from "./tabBody.js";

// One path's working-tree diff (WSP-06). This is the ported rendering:
// separately labelled staged and unstaged sections with the `+`/`-` prefixes
// retained. Per-hunk collapse, dual line-number gutters and the sticky
// header arrive with milestone 5, over a parser that does not exist yet.

export const DiffTab = memo(function DiffTab({
  tab,
  visible,
}: TabBodyProps<"diff">): JSX.Element {
  const context = tab.context;
  const diff = useQuery({
    queryKey: ["diff", context?.projectId, context?.threadId, tab.path],
    queryFn: async () => {
      if (context === null)
        throw new Error("This tab has no worktree to read.");
      return await getDiff(context.projectId, context.threadId, tab.path);
    },
    enabled: visible && context !== null,
    staleTime: PANEL_QUERY_STALE_TIME,
  });

  if (context === null) return <UnboundNotice />;

  const data = diff.data;
  const empty = data?.staged === "" && data.unstaged === "";
  return (
    <div className="diff-view">
      <header>
        {`${data?.path ?? tab.path} · ${context.label}`}
        {data?.truncated === true && " · truncated"}
      </header>
      {diff.isPending && (
        <p className="panel-state" aria-live="polite">
          Loading diff…
        </p>
      )}
      {empty && <div className="empty">No differences in this file.</div>}
      {data !== undefined && data.staged !== "" && (
        <>
          <h4>Staged</h4>
          <DiffText text={data.staged} />
        </>
      )}
      {data !== undefined && data.unstaged !== "" && (
        <>
          <h4>Unstaged</h4>
          <DiffText text={data.unstaged} />
        </>
      )}
      {diff.error !== null && (
        <ErrorNotice
          error={diff.error}
          onRetry={() => {
            void diff.refetch();
          }}
        />
      )}
    </div>
  );
});

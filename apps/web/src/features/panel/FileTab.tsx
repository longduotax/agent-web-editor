import { memo, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";

import { getFile } from "../../api/client.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { PANEL_QUERY_STALE_TIME, UnboundNotice } from "./tabBody.js";
import type { TabBodyProps } from "./tabBody.js";

// One file, read-only (WSP-05). This is the ported preview: plain text, the
// server's own binary/truncated states, and copy actions. The markdown
// preview, the source toggle and syntax highlighting arrive with milestone 4;
// nothing here decides anything they will have to undo.

export const FileTab = memo(function FileTab({
  tab,
  visible,
}: TabBodyProps<"file">): JSX.Element {
  const context = tab.context;
  const preview = useQuery({
    queryKey: ["file", context?.projectId, context?.threadId, tab.path],
    queryFn: async () => {
      if (context === null)
        throw new Error("This tab has no worktree to read.");
      return await getFile(context.projectId, context.threadId, tab.path);
    },
    enabled: visible && context !== null,
    staleTime: PANEL_QUERY_STALE_TIME,
  });

  if (context === null) return <UnboundNotice />;

  const file = preview.data;
  return (
    <div className="file-preview">
      <header>
        {/* The workspace-relative path the server returned. An absolute
            server path is never shown, and never copied. */}
        <span>{file?.path ?? tab.path}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(file?.path ?? tab.path);
          }}
        >
          Copy path
        </button>
        <button
          type="button"
          disabled={file === undefined || file.binary}
          onClick={() => {
            if (file === undefined) return;
            void navigator.clipboard?.writeText(file.content);
          }}
        >
          Copy contents
        </button>
      </header>
      {preview.isPending && (
        <p className="panel-state" aria-live="polite">
          Reading the file…
        </p>
      )}
      {file?.truncated === true && (
        <p className="panel-state">
          This file is truncated: only its first bytes are shown.
        </p>
      )}
      {file?.binary === true && (
        <div className="empty">Binary file preview is unavailable.</div>
      )}
      {file !== undefined && !file.binary && <pre>{file.content}</pre>}
      {preview.error !== null && (
        <ErrorNotice
          error={preview.error}
          onRetry={() => {
            void preview.refetch();
          }}
        />
      )}
    </div>
  );
});

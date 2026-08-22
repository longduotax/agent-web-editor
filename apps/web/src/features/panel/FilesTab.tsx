import { memo, useEffect, useState, type JSX } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { getFiles } from "../../api/client.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { useDebouncedValue } from "../../components/useDebouncedValue.js";
import { UnboundNotice } from "./tabBody.js";
import type { TabBodyProps } from "./tabBody.js";

// How many file rows are painted at once. The unsearched listing on a real
// repository is ~20,000 entries; rendering them all is what made the shipped
// inspector slow to open and to scroll (NEW-R3-4). This is a render budget,
// not a filter: the notice below always names the true total.
export const FILE_LIST_RENDER_LIMIT = 200;

export const FilesTab = memo(function FilesTab({
  tab,
  visible,
  actions,
}: TabBodyProps<"files">): JSX.Element {
  const context = tab.context;
  // Typing is local and instant; the panel's state — and therefore the
  // device-local record — only learns the search once it settles, so a
  // keystroke never rebuilds the panel or writes to storage.
  const [search, setSearch] = useState(tab.search);
  const debouncedSearch = useDebouncedValue(search);
  useEffect(() => {
    if (debouncedSearch === tab.search) return;
    actions.updateTab(tab.id, { search: debouncedSearch });
  }, [debouncedSearch, tab.id, tab.search, actions]);

  const files = useQuery({
    queryKey: ["files", context?.projectId, context?.threadId, debouncedSearch],
    queryFn: async () => {
      if (context === null)
        throw new Error("This tab has no worktree to read.");
      return await getFiles(
        context.projectId,
        context.threadId,
        debouncedSearch,
      );
    },
    enabled: visible && context !== null,
    // A full recursive listing takes hundreds of milliseconds to seconds on
    // a real repository, so the previous result stays on screen instead of
    // the list blanking to "Listing files…" between searches (WSP-09).
    placeholderData: keepPreviousData,
  });

  if (context === null) return <UnboundNotice />;

  const entries = files.data?.entries ?? [];
  return (
    <>
      <input
        className="file-search"
        aria-label="Search project files"
        placeholder="Search files…"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      {files.isPending && (
        <p className="panel-state" aria-live="polite">
          Listing files…
        </p>
      )}
      {files.data?.entries.length === 0 && (
        <div className="empty">
          {/* Named for the query the RESULT belongs to, not the keystroke in
              flight. */}
          {debouncedSearch === ""
            ? "No files in this workspace."
            : `No files match "${debouncedSearch}".`}
        </div>
      )}
      <ul className="file-list">
        {entries.slice(0, FILE_LIST_RENDER_LIMIT).map((file) => (
          <li key={file.path}>
            <button
              type="button"
              disabled={file.kind !== "file" && file.kind !== "symlink"}
              onClick={() => {
                // A tab of its own (WSP-05), so a document the user is
                // reading survives further browsing.
                actions.openTab({
                  type: "file",
                  context,
                  path: file.path,
                  view: "preview",
                });
              }}
            >
              <span aria-hidden="true">
                {file.kind === "directory" ? "▸" : "·"}
              </span>
              <span>{file.path}</span>
            </button>
          </li>
        ))}
      </ul>
      {entries.length > FILE_LIST_RENDER_LIMIT && (
        <p className="panel-state" aria-live="polite">
          {`Showing the first ${String(FILE_LIST_RENDER_LIMIT)} of ${String(entries.length)} files. Search to narrow the list.`}
        </p>
      )}
      {files.error !== null && (
        <ErrorNotice
          error={files.error}
          onRetry={() => {
            void files.refetch();
          }}
        />
      )}
    </>
  );
});

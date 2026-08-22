import { memo, useCallback, useEffect, useState, type JSX } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { getFiles } from "../../api/client.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { useDebouncedValue } from "../../components/useDebouncedValue.js";
import {
  boundedListingNotice,
  FILE_LIST_RENDER_LIMIT,
  FileTree,
} from "./FileTree.js";
import { PANEL_QUERY_STALE_TIME, UnboundNotice } from "./tabBody.js";
import type { TabBodyProps } from "./tabBody.js";

export { FILE_LIST_RENDER_LIMIT } from "./FileTree.js";

// The Files tab: a navigable tree, or a flat list of matches while a search
// is running (WSP-05 as revised by specification version 2).
//
// The two modes are deliberately different shapes. A tree of sparse matches
// is harder to read than a list, and a bare file name is ambiguous across
// directories — so search shows full paths, flat, and the tree shows one name
// per row. Clearing the search brings the tree back at exactly the expansion
// it had, which is why that expansion lives on the tab record (WSP-04) rather
// than in this component's state.

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

  // Which listings said they had hidden something. A set rather than a
  // single flag because every expanded directory answers for itself, and a
  // rule that only matches three levels down still hides something the tab
  // owes the user a statement about.
  const [ignoredIn, setIgnoredIn] = useState<readonly string[]>([]);
  // How many entries the tree's ROOT listing holds, which is what decides
  // whether there is anything here to select at all.
  const [rootEntries, setRootEntries] = useState(0);
  const onLevelSettled = useCallback(
    (directory: string, hidden: boolean, entries: number) => {
      setIgnoredIn((current) => {
        const held = current.includes(directory);
        if (held === hidden) return current;
        return hidden
          ? [...current, directory]
          : current.filter((entry) => entry !== directory);
      });
      if (directory === "") setRootEntries(entries);
    },
    [],
  );

  const searching = debouncedSearch !== "";
  const matches = useQuery({
    queryKey: [
      "files",
      context?.projectId,
      context?.threadId,
      "search",
      debouncedSearch,
      tab.showIgnored,
    ],
    queryFn: async () => {
      if (context === null)
        throw new Error("This tab has no worktree to read.");
      return await getFiles(context.projectId, context.threadId, {
        search: debouncedSearch,
        // A search asks the whole subtree; the depth bound is the tree's
        // request, not the search's.
        depth: "full",
        showIgnored: tab.showIgnored,
      });
    },
    enabled: visible && context !== null && searching,
    staleTime: PANEL_QUERY_STALE_TIME,
    // A search takes hundreds of milliseconds on a real repository, so the
    // previous result stays on screen instead of the list blanking to
    // "Listing files…" between searches (WSP-09).
    placeholderData: keepPreviousData,
  });

  const openFile = useCallback(
    (path: string) => {
      if (context === null) return;
      // A tab of its own (WSP-05), so a document the user is reading
      // survives further browsing.
      actions.openTab({ type: "file", context, path, view: "preview" });
    },
    [actions, context],
  );

  const setExpanded = useCallback(
    (expanded: string[]) => {
      actions.updateTab(tab.id, { expanded });
    },
    [actions, tab.id],
  );

  if (context === null) return <UnboundNotice />;

  const entries = matches.data?.entries ?? [];
  const ignoredHidden = searching
    ? (matches.data?.ignoredHidden ?? false)
    : ignoredIn.length > 0;

  return (
    // A column: the search, the ignore notice, and the no-selection line each
    // keep their own height, and the tree or the match list is the one part
    // that grows and scrolls — the arrangement the file preview already uses
    // (F2), and what puts the tree's own horizontal scrollbar on screen
    // instead of at the bottom of a list a thousand pixels tall (H3).
    <div className="files-tab">
      <input
        className="file-search"
        aria-label="Search project files"
        placeholder="Search files…"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      <div className="file-ignored">
        <label>
          <input
            type="checkbox"
            checked={tab.showIgnored}
            onChange={(event) => {
              const showIgnored = event.target.checked;
              actions.updateTab(tab.id, { showIgnored });
              // The panel's own live region rather than a second one on this
              // tab: the effect of this toggle is a list the user may not be
              // looking at (WSP-10).
              actions.announce(
                showIgnored
                  ? "Showing files matched by the workspace's ignore rules."
                  : "Hiding files matched by the workspace's ignore rules.",
              );
            }}
          />
          Show ignored files
        </label>
        {/* Never silently under-report: a listing that omitted something says
            so, in the tree and in a search result alike (WSP-05 v2). */}
        {ignoredHidden && !tab.showIgnored && (
          <p className="panel-state">
            Files matched by this workspace&apos;s ignore rules are hidden.
          </p>
        )}
      </div>
      {searching ? (
        <>
          {matches.isPending && (
            <p className="panel-state" aria-live="polite">
              Listing files…
            </p>
          )}
          {matches.data?.entries.length === 0 && (
            <div className="empty">
              {/* Named for the query the RESULT belongs to, not the keystroke
                  in flight. */}
              {`No files match "${debouncedSearch}".`}
            </div>
          )}
          <ul className="file-list">
            {entries.slice(0, FILE_LIST_RENDER_LIMIT).map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  disabled={file.kind !== "file" && file.kind !== "symlink"}
                  onClick={() => {
                    openFile(file.path);
                  }}
                >
                  <span aria-hidden="true">
                    {file.kind === "directory" ? "▸" : "·"}
                  </span>
                  {/* The full path, because a bare name is ambiguous across
                      directories once the tree is flattened. */}
                  <span>{file.path}</span>
                </button>
              </li>
            ))}
          </ul>
          {(entries.length > FILE_LIST_RENDER_LIMIT ||
            matches.data?.truncated === true) && (
            <p className="panel-state" aria-live="polite">
              {boundedListingNotice(
                entries.length,
                matches.data?.truncated === true,
                "files",
              )}
            </p>
          )}
          {matches.error !== null && (
            <ErrorNotice
              error={matches.error}
              onRetry={() => {
                void matches.refetch();
              }}
            />
          )}
        </>
      ) : (
        <FileTree
          context={context}
          expanded={tab.expanded}
          showIgnored={tab.showIgnored}
          visible={visible}
          onExpandedChange={setExpanded}
          onOpenFile={openFile}
          onLevelSettled={onLevelSettled}
        />
      )}
      {/* WSP-10's no-selection state. This tab does not preview in place —
          activating a row opens a File tab (WSP-05) — but it is still a list
          the user is meant to choose from, and saying so is what the shipped
          inspector did and what the Changes tab still does. The old
          inspector's version of this line was dropped in the port (D7). */}
      {(searching ? entries.length > 0 : rootEntries > 0) && (
        <p className="panel-state">Select a file to open it in its own tab.</p>
      )}
    </div>
  );
});

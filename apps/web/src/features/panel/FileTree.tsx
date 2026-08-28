import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";

import { getFiles } from "../../api/client.js";
import { PANEL_QUERY_STALE_TIME } from "./tabBody.js";
import type { TabContext } from "./panelTabs.js";

// The Files tab's tree (WSP-05 as revised by specification version 2).
//
// One directory is one query, fetched only while its row is expanded and only
// while the tab is visible (WSP-09). That is the whole point of the depth
// bound the server gained: the shipped list pulled a 20,000-entry recursive
// walk to paint 200 rows, on a hot path, every time the tab opened.
//
// Collapsing a directory unmounts its level, which stops its work; expanding
// it again re-mounts against the same query key, and `PANEL_QUERY_STALE_TIME`
// is what makes that a cache read rather than a second request.

/**
 * How many children of one directory are painted at once.
 *
 * A render budget, not a filter: the notice row below always says what it
 * left out, so a bounded view never reads as a complete one (WSP-09).
 */
export const FILE_LIST_RENDER_LIMIT = 200;

/**
 * What a bounded listing says about itself.
 *
 * Two different bounds meet here, and the sentence has to be true under
 * both. The render budget above is ours and we know the true total, so we
 * name it. The **read boundary's own traversal limit** is the server's, and
 * when it engages the count we were handed is not a count of what is on
 * disk — so naming it as one would be the same lie J7 found in the File
 * tab's line notice, in the place WSP-05 v2 explicitly forbids it: "a
 * listing that quietly under-reports what is on disk is not acceptable, in
 * the tree or in a search result count". Found while checking whether that
 * wording was reused elsewhere. It was, and the `truncated` flag the read
 * boundary has always returned was not being read by anything.
 */
export function boundedListingNotice(
  returned: number,
  stoppedShort: boolean,
  noun: "entries" | "files",
): string {
  if (!stoppedShort)
    return `Showing the first ${String(FILE_LIST_RENDER_LIMIT)} of ${String(returned)} ${noun}. Search to narrow the list.`;
  const shown = Math.min(returned, FILE_LIST_RENDER_LIMIT);
  return `Showing ${String(shown)} ${noun}. The workspace stopped listing at its own limit before the end, so this is not all of them.`;
}

export interface FileTreeProps {
  context: TabContext;
  /** Workspace-relative paths of the expanded directories (WSP-04). */
  expanded: readonly string[];
  showIgnored: boolean;
  visible: boolean;
  onExpandedChange: (expanded: string[]) => void;
  onOpenFile: (path: string) => void;
  /**
   * Called by each level as its listing settles, with what that listing hid
   * and how many entries it holds.
   *
   * Per level rather than once for the root, because a rule that only hides
   * something three directories down still hides something, and the tab owes
   * the user a statement about it either way (WSP-05 v2).
   */
  onLevelSettled: (
    directory: string,
    ignoredHidden: boolean,
    entries: number,
  ) => void;
}

/** Everything a level needs that does not change as the tree is walked. */
interface LevelContext {
  context: TabContext;
  /**
   * Prefix for each row's label element id.
   *
   * A `treeitem` takes its name from its content, and its content includes
   * the `group` of children a directory row owns — so an expanded `src`
   * would be announced as "src features main.ts". Each row therefore points
   * at the one element that holds its own name, which keeps the accessible
   * name exactly the text the row displays (WSP-05 v2, acceptance 14). The
   * prefix is per tree instance, because the panel mounts every tab body at
   * once and two Files tabs would otherwise mint the same ids.
   */
  labelPrefix: string;
  expanded: ReadonlySet<string>;
  showIgnored: boolean;
  visible: boolean;
  activeRow: string | null;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onLevelSettled: (
    directory: string,
    ignoredHidden: boolean,
    entries: number,
  ) => void;
  onFocusRow: (row: string) => void;
}

export const FileTree = memo(function FileTree({
  context,
  expanded,
  showIgnored,
  visible,
  onExpandedChange,
  onOpenFile,
  onLevelSettled,
}: FileTreeProps): JSX.Element {
  const treeRef = useRef<HTMLUListElement | null>(null);
  const labelPrefix = useId();
  // The roving tabindex's anchor: the one row in the whole tree that is in
  // the page's tab order (WSP-10). Held as the row's own key rather than as
  // an index, because expanding a directory renumbers every row below it.
  const [activeRow, setActiveRow] = useState<string | null>(null);

  const expandedSet = useMemo(() => new Set(expanded), [expanded]);

  const onToggle = useCallback(
    (path: string) => {
      const next = new Set(expanded);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      onExpandedChange([...next]);
    },
    [expanded, onExpandedChange],
  );

  // Anchor the roving tabindex on the first row whenever the row it was on
  // is no longer rendered — a collapse, a search, or a listing that has just
  // arrived can all take that row away, and a tree with no tabbable row is a
  // tree the keyboard cannot enter at all.
  //
  // Observed rather than recomputed on render, because the rows are rendered
  // by descendant components: a level whose query settles re-renders itself
  // and not this component, so a render-time check would run at every moment
  // except the ones that matter.
  useEffect(() => {
    const tree = treeRef.current;
    if (tree === null) return;
    const anchor = (): void => {
      const rows = treeRows(tree);
      const first = rows[0];
      if (first === undefined) return;
      setActiveRow((current) =>
        current !== null && rows.some((row) => rowKey(row) === current)
          ? current
          : rowKey(first),
      );
    };
    anchor();
    const observer = new MutationObserver(anchor);
    observer.observe(tree, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, []);

  const level: LevelContext = {
    context,
    labelPrefix,
    expanded: expandedSet,
    showIgnored,
    visible,
    activeRow,
    onToggle,
    onOpenFile,
    onLevelSettled,
    onFocusRow: setActiveRow,
  };

  return (
    <ul
      className="file-tree"
      role="tree"
      aria-label="Project files"
      ref={treeRef}
      onKeyDown={(event) => {
        handleTreeKey(event, treeRef.current, expandedSet, onToggle, (row) => {
          setActiveRow(row);
        });
      }}
    >
      <TreeLevel path="" depth={1} level={level} />
    </ul>
  );
});

/**
 * The children of one directory, as `li` rows of its parent's list.
 *
 * Renders a fragment rather than its own list element: the `ul` that owns
 * these rows is the caller's, so the `tree`/`group` nesting stays exactly one
 * list per expanded directory.
 */
function TreeLevel({
  path,
  depth,
  level,
}: {
  path: string;
  depth: number;
  level: LevelContext;
}): JSX.Element {
  const { context, showIgnored, visible } = level;
  const listing = useQuery({
    // `"tree"` separates these from the flat search listing, which asks the
    // same route for something else entirely.
    queryKey: [
      "files",
      context.projectId,
      context.threadId,
      "tree",
      path,
      showIgnored,
    ],
    queryFn: async () =>
      await getFiles(context.projectId, context.threadId, {
        path,
        depth: "1",
        showIgnored,
      }),
    enabled: visible,
    staleTime: PANEL_QUERY_STALE_TIME,
  });

  const { onLevelSettled } = level;
  const hidden = listing.data?.ignoredHidden ?? false;
  const count = listing.data?.entries.length ?? 0;
  useEffect(() => {
    onLevelSettled(path, hidden, count);
    // A collapsed directory is hiding nothing, because it is showing nothing.
    return () => {
      onLevelSettled(path, false, 0);
    };
  }, [onLevelSettled, path, hidden, count]);

  if (listing.isPending)
    return (
      <StateRow
        rowKey={stateRowKey(path, "pending")}
        depth={depth}
        level={level}
        disabled
        label={path === "" ? "Listing files…" : `Listing ${path}…`}
      />
    );

  if (listing.error !== null)
    return (
      // A row of its own, so one unreadable directory costs its own row and
      // not the tree. It is activatable rather than carrying a nested button:
      // a `treeitem` may not own another interactive control.
      <StateRow
        rowKey={stateRowKey(path, "error")}
        depth={depth}
        level={level}
        label={`Could not list ${path === "" ? "this workspace" : path}. Activate this row to try again.`}
        onActivate={() => {
          void listing.refetch();
        }}
      />
    );

  const entries = listing.data.entries;
  if (entries.length === 0)
    return (
      <StateRow
        rowKey={stateRowKey(path, "empty")}
        depth={depth}
        level={level}
        disabled
        label={path === "" ? "No files in this workspace." : "Empty directory"}
      />
    );

  return (
    <>
      {entries.slice(0, FILE_LIST_RENDER_LIMIT).map((entry) => (
        <TreeRow key={entry.path} entry={entry} depth={depth} level={level} />
      ))}
      {(entries.length > FILE_LIST_RENDER_LIMIT || listing.data.truncated) && (
        <StateRow
          rowKey={stateRowKey(path, "capped")}
          depth={depth}
          level={level}
          disabled
          label={boundedListingNotice(
            entries.length,
            listing.data.truncated,
            "entries",
          )}
        />
      )}
    </>
  );
}

interface Entry {
  path: string;
  name: string;
  kind: "file" | "directory" | "symlink";
}

function TreeRow({
  entry,
  depth,
  level,
}: {
  entry: Entry;
  depth: number;
  level: LevelContext;
}): JSX.Element {
  const isDirectory = entry.kind === "directory";
  const expanded = isDirectory && level.expanded.has(entry.path);
  const activate = () => {
    level.onFocusRow(entry.path);
    if (isDirectory) level.onToggle(entry.path);
    else level.onOpenFile(entry.path);
  };
  return (
    <li
      className="file-tree-row"
      role="treeitem"
      data-row={entry.path}
      data-path={entry.path}
      data-kind={entry.kind}
      aria-level={depth}
      aria-expanded={isDirectory ? expanded : undefined}
      aria-labelledby={`${level.labelPrefix}${entry.path}`}
      // The full workspace-relative path lives here and in the File tab's
      // copy-path; the row itself shows only its own name, so a deep file is
      // readable at any panel width (WSP-05 v2). `title` never becomes the
      // accessible name, because `treeitem` takes its name from its content.
      title={entry.path}
      tabIndex={level.activeRow === entry.path ? 0 : -1}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        activate();
      }}
    >
      {/* The pointer target is this line, not the `li`: an expanded
          directory's `li` also contains its children, so a click on the
          middle of its box would land on whichever child happens to be
          there. The line is the row as the user sees it. */}
      <span className="file-tree-line" style={indent(depth)} onClick={activate}>
        <span className="file-tree-twisty" aria-hidden="true">
          {isDirectory ? (expanded ? "▾" : "▸") : "·"}
        </span>
        <span
          className="file-tree-name"
          id={`${level.labelPrefix}${entry.path}`}
        >
          {entry.name}
        </span>
      </span>
      {expanded && (
        <ul className="file-tree-group" role="group">
          <TreeLevel path={entry.path} depth={depth + 1} level={level} />
        </ul>
      )}
    </li>
  );
}

/** A loading, empty, capped, or failed row: a real row, never a blank tree. */
function StateRow({
  rowKey: key,
  depth,
  level,
  label,
  disabled = false,
  onActivate,
}: {
  rowKey: string;
  depth: number;
  level: LevelContext;
  label: string;
  disabled?: boolean;
  onActivate?: () => void;
}): JSX.Element {
  return (
    <li
      className="file-tree-row file-tree-state"
      role="treeitem"
      data-row={key}
      aria-level={depth}
      aria-disabled={disabled ? true : undefined}
      aria-labelledby={`${level.labelPrefix}${key}`}
      tabIndex={level.activeRow === key ? 0 : -1}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onActivate?.();
      }}
    >
      <span
        className="file-tree-line"
        style={indent(depth)}
        onClick={() => {
          level.onFocusRow(key);
          onActivate?.();
        }}
      >
        <span className="file-tree-name" id={`${level.labelPrefix}${key}`}>
          {label}
        </span>
      </span>
    </li>
  );
}

/**
 * The roving-tabindex key of a state row.
 *
 * A leading slash is what keeps it distinct from every entry row's key: an
 * entry's key is its workspace-relative path, and a relative path never
 * starts with one.
 */
function stateRowKey(path: string, kind: string): string {
  return `/${kind}/${path}`;
}

/** Depth as padding, so nesting reads without the rows losing their box. */
function indent(depth: number): { paddingInlineStart: string } {
  return { paddingInlineStart: `${String((depth - 1) * 0.85)}rem` };
}

/** Every rendered row, in the order a reader meets them. */
function treeRows(tree: HTMLElement): HTMLElement[] {
  return [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
}

function rowKey(row: HTMLElement): string {
  return row.dataset.row ?? "";
}

function focusRow(
  row: HTMLElement | undefined,
  onFocus: (key: string) => void,
) {
  if (row === undefined) return;
  onFocus(rowKey(row));
  row.focus();
}

/**
 * Arrow-key navigation over the whole tree (WSP-10).
 *
 * Reads the rendered rows rather than a parallel model of them, so a row that
 * exists to the keyboard is exactly a row that exists on screen — the two
 * cannot drift apart as directories expand and collapse.
 */
function handleTreeKey(
  event: KeyboardEvent<HTMLElement>,
  tree: HTMLElement | null,
  expanded: ReadonlySet<string>,
  onToggle: (path: string) => void,
  onFocus: (key: string) => void,
): void {
  if (tree === null) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const current = target.closest<HTMLElement>('[role="treeitem"]');
  if (current === null) return;
  const rows = treeRows(tree);
  const at = rows.indexOf(current);
  if (at === -1) return;
  const path = current.dataset.path;
  const isDirectory = current.dataset.kind === "directory";

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      focusRow(rows[at + 1], onFocus);
      return;
    case "ArrowUp":
      event.preventDefault();
      focusRow(rows[at - 1], onFocus);
      return;
    case "Home":
      event.preventDefault();
      focusRow(rows[0], onFocus);
      return;
    case "End":
      event.preventDefault();
      focusRow(rows[rows.length - 1], onFocus);
      return;
    case "ArrowRight":
      event.preventDefault();
      // Open a closed directory; on an open one, step into its children —
      // which are the next row, because the rows are in reading order.
      if (isDirectory && path !== undefined && !expanded.has(path))
        onToggle(path);
      else if (isDirectory) focusRow(rows[at + 1], onFocus);
      return;
    case "ArrowLeft": {
      event.preventDefault();
      if (isDirectory && path !== undefined && expanded.has(path)) {
        onToggle(path);
        return;
      }
      // Otherwise leave for the parent row, which is the `treeitem` that owns
      // the `group` this row is in.
      const parent =
        current.parentElement?.closest<HTMLElement>('[role="treeitem"]') ??
        undefined;
      focusRow(parent, onFocus);
      return;
    }
    default:
      return;
  }
}

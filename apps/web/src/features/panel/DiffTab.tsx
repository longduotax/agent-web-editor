import {
  memo,
  useCallback,
  useId,
  useMemo,
  type CSSProperties,
  type JSX,
} from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RelativePathSchema } from "@pi-web/contracts";

import { ApiClientError, getDiff } from "../../api/client.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { HeaderPath, UnknownPath } from "./HeaderPath.js";
import {
  DIFF_CHARACTER_LIMIT,
  DIFF_LINE_LIMIT,
  parseUnifiedDiff,
} from "./parseUnifiedDiff.js";
import type { DiffHunk, DiffLine, ParsedDiff } from "./parseUnifiedDiff.js";
import { UnboundNotice } from "./tabBody.js";
import type { TabBodyProps } from "./tabBody.js";

// One path's working-tree diff, as structured content rather than as an
// undifferentiated block of text (WSP-06): separately labelled staged and
// unstaged sections, a collapsible hunk carrying its own header, old-side and
// new-side line numbers, and the `+`/`-` prefix left in every line's text so
// the distinction is never carried by colour alone.
//
// This tab is READ-ONLY and there is no route to anything else: staging,
// unstaging, reverting and committing are explicit product non-goals, so
// nothing here posts, and no affordance suggests it might.
//
// The shape is the File tab's — a header pinned above ONE bounded scrolling
// region — and deliberately so. A `pre` that scrolls on its own grows to its
// full content height inside a scrolling ancestor, which puts its horizontal
// scrollbar hundreds of pixels below the visible area and makes the end of a
// long diff line unreachable by any pointer (F2). `.diff-body` is the only
// thing that scrolls, and the stylesheet bounds it to the tab's own height.

/**
 * How many collapsed hunks one tab remembers.
 *
 * A hunk identity is derived from the hunk's content, so editing a file
 * leaves the identities of the hunks it used to have behind: without a bound
 * a long session's device-local record would grow without ever shrinking.
 * The most recent entries are the ones kept, because they are the ones that
 * still name something on screen; 200 is far past any file's hunk count.
 */
export const COLLAPSED_HUNK_LIMIT = 200;

export const DiffTab = memo(function DiffTab({
  tab,
  visible,
  actions,
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
    // Working-tree state, so the same reasoning as ChangesTab applies (D5):
    // WSP-06 calls this the CURRENT diff of a named worktree, and nothing
    // invalidates it. A stale diff is wrong, where a refetch that keeps the
    // content on screen is merely work — so the window is zero and the
    // retained data stays visible while the request runs.
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

  const data = diff.data;
  // Parsed once per section of text rather than per render: a hunk's identity
  // is what a collapse is remembered by, and toggling one re-renders this
  // component with the same diff underneath it.
  const staged = useMemo(
    () => parseUnifiedDiff(data?.staged ?? "", "staged"),
    [data?.staged],
  );
  const unstaged = useMemo(
    () => parseUnifiedDiff(data?.unstaged ?? "", "unstaged"),
    [data?.unstaged],
  );

  const collapsed = useMemo(
    () => new Set(tab.collapsedHunks),
    [tab.collapsedHunks],
  );
  const toggleHunk = useCallback(
    (id: string) => {
      actions.updateTab(tab.id, {
        collapsedHunks: toggleCollapsed(tab.collapsedHunks, id),
      });
    },
    [actions, tab.collapsedHunks, tab.id],
  );
  // Two Diff tabs are mounted at once whenever one is hidden behind another,
  // so the ids that tie a disclosure to the body it controls have to be
  // unique per tab instance rather than per hunk.
  const idPrefix = useId();

  if (context === null) return <UnboundNotice />;

  // What this tab may present AS a workspace-relative path (J10): the
  // server's normalized answer first, the tab's own record only while it
  // passes the same schema the read boundary parses with, and otherwise
  // nothing that claims to be a path at all.
  const requested = RelativePathSchema.safeParse(tab.path).success
    ? tab.path
    : null;
  const path = data?.path ?? requested;

  const sections = [staged, unstaged].filter(
    (section) => section.text !== "" && section.text.trim() !== "",
  );
  const readable = sections.some(
    (section) => section.raw === null && !section.binary,
  );
  const failed = diff.error !== null;
  const empty = !failed && data !== undefined && sections.length === 0;
  const widest = Math.max(staged.widestNumber, unstaged.widestNumber);

  return (
    <div className="diff-view">
      <header>
        {path === null ? <UnknownPath /> : <HeaderPath path={path} />}
        {/* WSP-06: the header states the path and the add/delete counts. In
            words rather than as `+2 −2`, so the two modalities read the same
            sentence and neither needs a label of its own; the counts are of
            the whole diff even where the body below is bounded. */}
        {readable && (
          <span className="diff-counts">
            <span className="diff-count-add">
              {`${String(staged.added + unstaged.added)} added`}
            </span>
            <span className="diff-count-delete">
              {`${String(staged.deleted + unstaged.deleted)} deleted`}
            </span>
          </span>
        )}
      </header>
      {/* Current working-tree state of a named worktree, never the thread's
          output (WSP-06). The same sentence the Changes tab opens with. */}
      <p className="scope-note">{`Working tree: ${context.label}`}</p>
      {diff.isPending && (
        <p className="panel-state" aria-live="polite">
          Reading the diff…
        </p>
      )}
      {failed && (
        <DiffFailure
          error={diff.error}
          onRetry={() => {
            void diff.refetch();
          }}
        />
      )}
      {empty && <div className="empty">No differences in this file.</div>}
      {!failed && data?.truncated === true && (
        <p className="panel-state">
          The workspace stopped reading this diff at its own output limit, so
          everything below is the beginning of the change and not all of it.
        </p>
      )}
      {/* One scrolling box for both sections (F2). Each `pre` inside it
          scrolls nothing of its own, so the staged and unstaged panes cannot
          slide out of alignment with each other and the scrollbar stays
          where a pointer can find it. */}
      <div className="diff-body" style={gutterWidth(widest)}>
        {!failed &&
          sections.map((section) => (
            <DiffSectionView
              key={section.section}
              diff={section}
              collapsed={collapsed}
              onToggle={toggleHunk}
              idPrefix={idPrefix}
            />
          ))}
      </div>
    </div>
  );
});

/** One labelled half of the diff, and everything it has to say about itself. */
function DiffSectionView({
  diff,
  collapsed,
  onToggle,
  idPrefix,
}: {
  diff: ParsedDiff;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  idPrefix: string;
}): JSX.Element {
  const label = diff.section === "staged" ? "Staged" : "Unstaged";
  return (
    <section className="diff-section">
      <h4>{label}</h4>
      {/* The file-level lines a reader learns something from — a rename, a
          new or deleted file, a mode change — as Git wrote them. Translating
          them into prose would be inventing a claim; the plumbing lines that
          only restate the path are dropped by the parser. */}
      {diff.notes.length > 0 && (
        <ul className="diff-notes">
          {diff.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {diff.binary && (
        <p className="panel-state">
          Git reports this file as binary, so there are no lines to compare.
        </p>
      )}
      {diff.raw !== null && (
        <>
          <p className="panel-state">{rawNotice(diff.raw)}</p>
          <pre className="diff-raw">{diff.text}</pre>
        </>
      )}
      {diff.cut && <p className="panel-state">{boundedNotice(diff)}</p>}
      {diff.hunks.map((hunk) => (
        <HunkView
          key={hunk.id}
          hunk={hunk}
          collapsed={collapsed.has(hunk.id)}
          onToggle={onToggle}
          bodyId={`${idPrefix}${hunk.id}`}
        />
      ))}
      {!diff.binary && diff.raw === null && diff.hunks.length === 0 && (
        <p className="panel-state">
          Git changed this file without changing any of its lines.
        </p>
      )}
    </section>
  );
}

/**
 * One hunk: a disclosure, and the lines it discloses.
 *
 * A button with `aria-expanded` rather than `details`/`summary`, because the
 * collapse is persisted state the tab owns (WSP-04) and a `details` element
 * owns its own — two authorities over one boolean, which is the shape of
 * every state bug this panel has had.
 *
 * The body is `hidden` rather than unmounted, so collapsing costs no layout
 * of the lines and expanding re-does no work.
 */
function HunkView({
  hunk,
  collapsed,
  onToggle,
  bodyId,
}: {
  hunk: DiffHunk;
  collapsed: boolean;
  onToggle: (id: string) => void;
  bodyId: string;
}): JSX.Element {
  return (
    <div className="diff-hunk-group">
      <h5 className="diff-hunk-heading">
        <button
          type="button"
          className="diff-hunk-toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => {
            onToggle(hunk.id);
          }}
        >
          {/* The state is on `aria-expanded`; this is the same state drawn
              for the eye, and it is not a second thing to announce. */}
          <span className="diff-hunk-mark" aria-hidden="true">
            {collapsed ? "▸" : "▾"}
          </span>
          <span className="diff-hunk-header">{hunk.header}</span>
          <span className="diff-hunk-tally">
            {`+${String(hunk.added)} -${String(hunk.deleted)}`}
          </span>
        </button>
      </h5>
      <pre className="diff-lines" id={bodyId} hidden={collapsed}>
        {hunk.lines.map((line, index) => (
          // A diff line has no identity of its own — the array is the hunk —
          // so the index is the honest key here.
          <Line
            key={index}
            line={line}
            last={index === hunk.lines.length - 1}
          />
        ))}
      </pre>
    </div>
  );
}

/**
 * One diff line: two numbers, a prefix, and the code — in four boxes, three
 * of which the stylesheet pins to the left edge.
 *
 * The numbers are NOT in the document's text. `data-old` and `data-new` are
 * attributes, and the stylesheet draws them through `content: attr(…)` on a
 * `::before` — generated content, which a selection cannot reach and
 * `textContent` does not contain (J11, and the same mechanism the File tab's
 * gutter uses). A number rendered as a text node would be copied out with
 * the diff, which is the one thing a line-number gutter must never do. Two
 * gutters need two pseudo-elements, so the line's text is wrapped in an
 * element of its own and carries the new-side number.
 *
 * The prefix character is the opposite case and the reason it now has a box
 * (K1). WSP-06 says the add/remove distinction is never carried by colour
 * alone, and a horizontal scroll used to make it exactly that: the gutters
 * and the prefix were ordinary in-flow content, so at any `scrollLeft` past
 * a few dozen pixels all three were off screen and only the wash was left —
 * 1.04:1 between add and delete in light, 1.06:1 in dark. The stylesheet
 * pins all three with `position: sticky`, which needs the prefix to be a box
 * of its own. It stays a REAL text node inside that box, because a prefix is
 * patch content and a copy has to carry it; drawing it the way the numbers
 * are drawn would silently make every copied diff unapplyable.
 *
 * The trailing newline is a real character and stays one, which is why these
 * are inline elements rather than blocks: a block would add a break of its
 * own and double every line, and its background would then be the only thing
 * a copy could not reproduce.
 */
function Line({ line, last }: { line: DiffLine; last: boolean }): JSX.Element {
  return (
    <span className={`diff-line diff-${line.kind}`} data-old={number(line.old)}>
      <span className="diff-line-body" data-new={number(line.new)}>
        {/* Split for layout only: the two spans concatenate back to the
            line Git wrote, so `textContent` and a selection are unchanged. */}
        <span className="diff-line-prefix">{line.text.slice(0, 1)}</span>
        <span className="diff-line-text">{line.text.slice(1)}</span>
      </span>
      {last ? null : "\n"}
    </span>
  );
}

/** A gutter with no number in it still reserves its column. */
function number(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * How wide each number column has to be for this diff.
 *
 * From the largest number actually painted rather than from the budget: a
 * twelve-line file should not pay four characters of indent twice over. Two
 * is the floor, because a one-character gutter reads as an accident.
 */
function gutterWidth(widest: number): CSSProperties {
  const digits = Math.max(2, String(Math.max(1, widest)).length);
  return { "--diff-gutter": `${String(digits)}ch` } as CSSProperties;
}

/** Collapse on, or collapse off, within the record's own bound. */
export function toggleCollapsed(
  current: readonly string[],
  id: string,
): string[] {
  if (current.includes(id)) return current.filter((entry) => entry !== id);
  return [...current, id].slice(-COLLAPSED_HUNK_LIMIT);
}

/** What is on screen, and of what (the File tab's J7 wording, for a diff). */
function boundedNotice(diff: ParsedDiff): string {
  const which = diff.section === "staged" ? "staged" : "unstaged";
  if (diff.byCharacters) {
    // Lines are the wrong unit for a diff whose length is not in its line
    // count — a one-line minified bundle produces exactly that — and quoting
    // one here would say nothing about it.
    return `Showing the first ${String(DIFF_CHARACTER_LIMIT / 1024)} KiB of the ${which} diff. The rest of it is not painted.`;
  }
  return `Showing the first ${String(DIFF_LINE_LIMIT)} of the ${String(diff.totalLines)} lines of the ${which} diff. The counts above are of the whole change.`;
}

/** Why a section is shown as Git's own text rather than as hunks. */
function rawNotice(reason: "combined" | "malformed"): string {
  return reason === "combined"
    ? "This file is part way through a merge, so Git wrote a combined diff with one column per parent. It is shown exactly as Git produced it, because there is no single old side to number."
    : "The workspace could not read this as a unified diff, so it is shown exactly as Git produced it and its lines are not counted above.";
}

/**
 * A read that did not produce a diff.
 *
 * The working tree is not stable between the status call that listed the path
 * and the diff call that asks for it — the design boundary says so
 * explicitly — so a file that has stopped being changed is an ordinary event
 * on this tab and not an error to apologise for. Every state still offers
 * Retry: the change may come back, and WSP-10 requires an error state to have
 * a way out.
 */
function DiffFailure({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}): JSX.Element {
  const message = refusalMessage(error);
  if (message === null) return <ErrorNotice error={error} onRetry={onRetry} />;
  return (
    <div className="empty panel-refusal">
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function refusalMessage(error: unknown): string | null {
  if (!(error instanceof ApiClientError)) return null;
  switch (error.code) {
    case "git_path_not_changed":
      return "This file has no changes in this worktree any more. It may have been reverted, committed, or deleted since this tab was opened.";
    case "git_unavailable":
      return "This project is not a Git working tree, so it has no diff to show.";
    case "path_not_found":
      return "This file is no longer in this worktree. It may have been deleted, renamed, or moved since the tab was opened.";
    default:
      return null;
  }
}

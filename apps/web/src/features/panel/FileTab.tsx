import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type JSX,
} from "react";
import { useQuery } from "@tanstack/react-query";

import { ApiClientError, getFile } from "../../api/client.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { FilePreviewMarkdown } from "./FilePreviewMarkdown.js";
import { isMarkdownPath, languageForPath } from "./fileLanguage.js";
import { PANEL_QUERY_STALE_TIME, UnboundNotice } from "./tabBody.js";
import type { TabBodyProps } from "./tabBody.js";
import type { HighlightedLine } from "./syntaxHighlight.js";

// One file, read-only (WSP-05). There is no editing affordance here and no
// route to one: the tab reads, copies, and renders, and that is the whole of
// its surface.
//
// The tab's shape is a flex column with the header pinned above ONE bounded
// scrolling region — `.file-preview` in `styles.css`. That is not decoration.
// The `pre` used to grow to its full content height inside a scrolling
// ancestor, which put its horizontal scrollbar ~1600px below the visible area
// and made the end of a long line unreachable by any pointer (F2). Whatever
// changes here, the growing child must stay the only thing that scrolls, and
// it must stay bounded to the tab's own height.

/**
 * How many lines are painted at once.
 *
 * WSP-09's render budget: the copy action still yields the whole file, and
 * the notice below states the true line count, so a bounded view never reads
 * as a complete one. Two thousand lines is past the end of almost every
 * source file and still cheap to paint and to highlight.
 */
export const FILE_PREVIEW_LINE_LIMIT = 2000;

export const FileTab = memo(function FileTab({
  tab,
  visible,
  actions,
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

  const file = preview.data;
  const markdown = isMarkdownPath(tab.path);
  // A file with no rendered form is always its own source, whatever the tab
  // recorded. The record is still the user's choice and is left alone, so a
  // tab that once held a markdown file does not lose it.
  const rendered = markdown && tab.view === "preview";

  // The bounded portion, computed once per file rather than per render: it
  // is what gets painted, what gets highlighted, and what the notice counts.
  const shown = useMemo(
    () => boundedLines(file?.binary === true ? "" : (file?.content ?? "")),
    [file?.content, file?.binary],
  );

  // Highlighting is a decoration applied to text that is ALREADY on screen.
  // It is keyed by the text it was computed for, so a hidden tab keeps what
  // it had — switching back re-does nothing (WSP-09) — and a different file's
  // tokens can never be painted over this one's.
  const [highlighted, setHighlighted] = useState<{
    text: string;
    lines: HighlightedLine[];
  } | null>(null);
  const language = rendered ? null : languageForPath(tab.path);
  const text = shown.text;
  useEffect(() => {
    if (!visible || language === null || text === "") return;
    if (highlighted?.text === text) return;
    // A signal rather than a captured flag: the tokens arrive after two
    // awaits, and by then this effect may have been replaced by one for a
    // different file.
    const superseded = new AbortController();
    void (async () => {
      try {
        // The one place the highlighter is reached, and deliberately a
        // dynamic import: Shiki and its grammars are a chunk of their own,
        // requested when a code file is opened and never before. Nothing in
        // this module may import it statically, not even for a constant.
        const { highlightCode } = await import("./syntaxHighlight.js");
        const lines = await highlightCode(text, language);
        if (!superseded.signal.aborted && lines !== null)
          setHighlighted({ text, lines });
      } catch {
        // Highlighting is unavailable, which WSP-05 requires to be a
        // non-event: the plain monospace text stays exactly as it is, and
        // the reader is told nothing, because nothing they wanted has
        // failed.
      }
    })();
    return () => {
      superseded.abort();
    };
  }, [visible, language, text, highlighted?.text]);

  const openFile = useCallback(
    (path: string) => {
      if (context === null) return;
      actions.openTab({ type: "file", context, path, view: "preview" });
    },
    [actions, context],
  );

  if (context === null) return <UnboundNotice />;

  const path = file?.path ?? tab.path;
  return (
    <div className="file-preview">
      <header>
        {/* The workspace-relative path the server returned. An absolute
            server path is never shown, and never copied. */}
        <HeaderPath path={path} />
        <div className="file-actions">
          {markdown && (
            <button
              type="button"
              onClick={() => {
                actions.updateTab(tab.id, {
                  view: rendered ? "source" : "preview",
                });
              }}
            >
              {rendered ? "View source" : "View preview"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(path);
            }}
          >
            Copy path
          </button>
          <button
            type="button"
            disabled={file === undefined || file.binary}
            onClick={() => {
              if (file === undefined) return;
              // The whole file, not the bounded portion painted below: the
              // budget is about what this panel renders, and copying is how a
              // reader takes the file somewhere that has no budget.
              void navigator.clipboard.writeText(file.content);
            }}
          >
            Copy contents
          </button>
        </div>
      </header>
      {preview.isPending && (
        <p className="panel-state" aria-live="polite">
          Reading the file…
        </p>
      )}
      {preview.error !== null && (
        <ReadFailure
          error={preview.error}
          onRetry={() => {
            void preview.refetch();
          }}
        />
      )}
      {file?.truncated === true && (
        <p className="panel-state">
          This file is larger than the 2 MiB preview limit. Only its first 2 MiB
          were read.
        </p>
      )}
      {shown.hidden > 0 && (
        <p className="panel-state">
          {`Showing the first ${String(FILE_PREVIEW_LINE_LIMIT)} of ${String(shown.total)} lines. Copy contents takes the whole file.`}
        </p>
      )}
      {file?.binary === true && (
        <div className="empty">
          {/* Invalid UTF-8 arrives here too, and that is deliberate at the
              boundary: text that cannot be decoded is never handed over as
              if it were text. */}
          Binary file preview is unavailable.
        </div>
      )}
      {file !== undefined && !file.binary && file.content === "" && (
        <div className="empty">This file is empty.</div>
      )}
      {file !== undefined &&
        !file.binary &&
        file.content !== "" &&
        (rendered ? (
          <div className="file-markdown markdown">
            <FilePreviewMarkdown
              source={shown.text}
              path={path}
              onOpenFile={openFile}
            />
          </div>
        ) : (
          <pre>
            {highlighted?.text === shown.text ? (
              <HighlightedText lines={highlighted.lines} />
            ) : (
              shown.text
            )}
          </pre>
        ))}
    </div>
  );
});

/**
 * The path in the tab's header, in two pieces.
 *
 * One piece, and the header wrapped it: `text-overflow: ellipsis` is inert
 * while `white-space` computes to `normal`, so at the panel's 280px floor the
 * path rendered one character per line in a 10px column and the header grew
 * from 24px to 107px — 83px of the file's own reading area, spent on saying
 * nothing (J1). The stylesheet now nowraps it; this splits it so the ellipsis
 * falls where it costs least.
 *
 * Which end is kept is a judgement about paths: `docs/product-specs/…` names
 * a hundred files and `…/workspace-panel.md` names one, so the directories
 * are what shrinks and the file name is what survives. The whole path is on
 * the element's tooltip either way, and the two spans read as one string, so
 * neither the accessible name nor a text selection notices the split.
 */
function HeaderPath({ path }: { path: string }): JSX.Element {
  const cut = path.lastIndexOf("/");
  const directories = cut === -1 ? "" : path.slice(0, cut + 1);
  const name = cut === -1 ? path : path.slice(cut + 1);
  return (
    <span className="file-path" title={path}>
      {directories !== "" && (
        <span className="file-path-dir">{directories}</span>
      )}
      <span className="file-path-name">{name}</span>
    </span>
  );
}

/** The rendered portion of a file, and what it left out. */
interface BoundedText {
  text: string;
  total: number;
  hidden: number;
}

function boundedLines(content: string): BoundedText {
  if (content === "") return { text: "", total: 0, hidden: 0 };
  const lines = content.split("\n");
  if (lines.length <= FILE_PREVIEW_LINE_LIMIT)
    return { text: content, total: lines.length, hidden: 0 };
  return {
    text: lines.slice(0, FILE_PREVIEW_LINE_LIMIT).join("\n"),
    total: lines.length,
    hidden: lines.length - FILE_PREVIEW_LINE_LIMIT,
  };
}

/**
 * The same text, with the highlighter's colours on it.
 *
 * A token that takes the preview's own colour is rendered as bare text
 * rather than as a span: about half of a source file is body text, and this
 * is the difference between a few thousand elements and twice that.
 */
function HighlightedText({ lines }: { lines: HighlightedLine[] }): JSX.Element {
  return (
    <>
      {lines.map((tokens, lineIndex) => (
        // Lines have no identity of their own — the array is the file — so
        // the index is the honest key here.
        <span className="file-line" key={lineIndex}>
          {tokens.map((token, index) =>
            token.color === null && !token.italic && !token.bold ? (
              token.text
            ) : (
              <span
                className="file-token"
                key={index}
                style={{
                  color: token.color ?? undefined,
                  fontStyle: token.italic ? "italic" : undefined,
                  fontWeight: token.bold ? 600 : undefined,
                }}
              >
                {token.text}
              </span>
            ),
          )}
          {lineIndex < lines.length - 1 ? "\n" : null}
        </span>
      ))}
    </>
  );
}

/**
 * A read that did not produce a file.
 *
 * The typed refusals the read boundary defines each get their own sentence,
 * because "the requested path was not found" is the server explaining itself
 * to a client, and a reader wants to know what happened to their file. Every
 * one of them still offers Retry: a deleted file may come back, and a
 * permission may be granted, and WSP-10 requires an error state to have a way
 * out.
 */
function ReadFailure({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}): JSX.Element {
  const message = refusalMessage(error);
  if (message === null) return <ErrorNotice error={error} onRetry={onRetry} />;
  return (
    <div className="empty file-refusal">
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
    case "path_not_found":
      return "This file is no longer in this worktree. It may have been deleted, renamed, or moved since the tab was opened.";
    case "path_unreadable":
      return "This file cannot be read: the workspace does not have permission to open it.";
    case "file_not_regular":
      return "This path is not a regular file, so there is nothing to preview.";
    case "path_excluded":
      return "This path is inside the repository's own machinery, which the workspace never reads.";
    default:
      return null;
  }
}

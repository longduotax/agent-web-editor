import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { RelativePathSchema } from "@pi-web/contracts";

import { ApiClientError, getFile } from "../../api/client.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { FilePreviewMarkdown } from "./FilePreviewMarkdown.js";
import { headingSlug } from "./markdownLinks.js";
import {
  HIGHLIGHT_MAX_CHARACTERS,
  isMarkdownPath,
  languageForPath,
} from "./fileLanguage.js";
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
 * WSP-09's render budget: the copy action still yields everything that
 * reached the browser, and the notice below says what it left out and what
 * it left it out of, so a bounded view never reads as a complete one. Two
 * thousand lines is past the end of almost every source file and still cheap
 * to paint and to highlight.
 */
export const FILE_PREVIEW_LINE_LIMIT = 2000;

/**
 * How many characters are painted at once.
 *
 * The line bound above is not enough on its own, and a minified bundle is
 * why (J5). One measured file was 4.7 MB, server-truncated to 2 MiB:
 * **2,097,096 characters in one `pre`**, because 2 MiB of it is only 293
 * lines and the 2,000-line budget therefore never engaged. Its longest line
 * was 878,586 characters and the `pre`'s `scrollWidth` was 6,594,300px. Lines
 * are a proxy for size and this is the size itself, so both are bounded.
 *
 * 512 KiB is past any file a person reads and small enough that the DOM node
 * is an ordinary one. It is deliberately LARGER than
 * `HIGHLIGHT_MAX_CHARACTERS`: painting a character is cheap and tokenizing it
 * is not, so the tab can show more than it can colour — and says so when it
 * does.
 */
export const FILE_PREVIEW_CHARACTER_LIMIT = 512 * 1024;

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
  // A file the highlighter would only decline, decided here rather than two
  // dynamic imports later (J5). Knowing it up front is what lets the tab both
  // skip fetching the chunk and TELL the reader why nothing is coloured —
  // the highlighter's own `null` arrives too late to be either.
  const highlightTooLarge =
    language !== null && text.length > HIGHLIGHT_MAX_CHARACTERS;
  useEffect(() => {
    if (!visible || language === null || text === "") return;
    if (text.length > HIGHLIGHT_MAX_CHARACTERS) return;
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

  // Copying, with both of its outcomes said out loud (J4, WSP-10).
  //
  // This was `void navigator.clipboard.writeText(…)` with no `.catch`: a
  // refusal — a denied permission, an unfocused document, an insecure
  // context — produced an `unhandledrejection` and nothing on screen
  // changed, and a copy that worked said nothing either. The panel already
  // has exactly one `role="status"`, which the split refusal and the drag
  // narration share; a second live region on one surface interrupts the
  // first, so this uses that one.
  const copy = useCallback(
    (text: string, what: string) => {
      const failed = () => {
        actions.announce(
          `Could not copy ${what}: the browser refused access to the clipboard.`,
        );
      };
      let written: Promise<void>;
      try {
        // In a `try` rather than behind an optional chain: an insecure
        // context has no `clipboard` at all, and the type says otherwise, so
        // this call THROWS there instead of rejecting. Both routes have to
        // reach the same sentence, and only one of them is a promise.
        written = navigator.clipboard.writeText(text);
      } catch {
        failed();
        return;
      }
      void written.then(() => {
        actions.announce(`Copied ${what} to the clipboard.`);
      }, failed);
    },
    [actions],
  );

  const openFile = useCallback(
    (path: string) => {
      if (context === null) return;
      actions.openTab({ type: "file", context, path, view: "preview" });
    },
    [actions, context],
  );

  // The rendered document, which is also the box that scrolls it.
  const documentRef = useRef<HTMLDivElement | null>(null);

  // Going to a place inside the document being displayed (J8).
  //
  // Resolved against the rendered DOM rather than against the source, because
  // the DOM is what the reader is looking at and its headings carry exactly
  // the text a slug is computed from — inline markup already resolved, so
  // `## The **hard** part` and its `#the-hard-part` link agree without this
  // having to re-implement inline parsing.
  //
  // Scrolled by arithmetic rather than by `scrollIntoView`, which would also
  // scroll every scrollable ancestor and can move the panel itself; and
  // focus goes to the heading, because a jump nobody's cursor followed is
  // not a jump for a screen-reader or keyboard user.
  const goToFragment = useCallback(
    (id: string) => {
      const container = documentRef.current;
      if (container === null) return;
      const wanted = headingSlug(id);
      const seen = new Map<string, number>();
      let match: HTMLElement | null = null;
      for (const heading of container.querySelectorAll<HTMLElement>(
        "h1, h2, h3, h4, h5, h6",
      )) {
        const base = headingSlug(heading.textContent);
        // GitHub's own answer to two headings with one name, and the reason
        // `#overview-1` is a link people write.
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const slug = count === 0 ? base : `${base}-${String(count)}`;
        if (slug === wanted || heading.id === id) {
          match = heading;
          break;
        }
      }
      if (match === null) {
        // Said out loud rather than silently doing nothing, which is the
        // failure mode the inert rendering was trying to avoid and did not.
        actions.announce(`This document has no section called “${id}”.`);
        return;
      }
      container.scrollTop +=
        match.getBoundingClientRect().top -
        container.getBoundingClientRect().top;
      match.tabIndex = -1;
      match.focus({ preventScroll: true });
    },
    [actions],
  );

  if (context === null) return <UnboundNotice />;

  // What this tab may present AS a workspace-relative path (J10).
  //
  // The server's answer first, because it is normalized and authoritative.
  // Before it arrives — and it may never arrive — the tab's own record is
  // all there is, and that record is device-local storage: any script on the
  // origin can write it, and a tab restored at `../../../etc/hosts` was
  // observed rendering exactly that in the header, with Copy path ready to
  // put it on the clipboard. Containment held (the read boundary refused it,
  // and the tab showed the refusal with a Retry) but the header still said
  // "this is where you are". So the record is validated against
  // `RelativePathSchema` — the SAME rule the read boundary parses with,
  // imported rather than restated, so the two cannot drift — and anything it
  // rejects is not shown as a path and not copied as one.
  const requested = RelativePathSchema.safeParse(tab.path).success
    ? tab.path
    : null;
  const path = file?.path ?? requested;
  return (
    <div className="file-preview">
      <header>
        {/* The workspace-relative path the server returned. An absolute
            server path is never shown, and never copied. */}
        {path === null ? (
          <span className="file-path">
            <span className="file-path-name">
              This tab&apos;s path is not a workspace path.
            </span>
          </span>
        ) : (
          <HeaderPath path={path} />
        )}
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
            disabled={path === null}
            onClick={() => {
              if (path === null) return;
              copy(path, "the file path");
            }}
          >
            Copy path
          </button>
          <button
            type="button"
            disabled={file === undefined || file.binary}
            onClick={() => {
              if (file === undefined) return;
              // Everything that reached the browser, not the bounded portion
              // painted below: the budget is about what this panel renders,
              // and copying is how a reader takes the file somewhere that has
              // no budget. What reached the browser is the whole file unless
              // the read was truncated, and the announcement says which (J7).
              copy(
                file.content,
                file.truncated
                  ? "the 2 MiB that were read"
                  : "the file's contents",
              );
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
      {file?.truncated === true && !file.binary && (
        <p className="panel-state">
          This file is larger than the 2 MiB preview limit. Only its first 2 MiB
          were read, so everything below is about that portion and not about the
          whole file.
        </p>
      )}
      {shown.cut && (
        <p className="panel-state">
          {boundedNotice(shown, file?.truncated === true)}
        </p>
      )}
      {highlightTooLarge && (
        <p className="panel-state">{declinedHighlightNotice()}</p>
      )}
      {file?.binary === true && (
        <div className="empty">
          {/* Invalid UTF-8 arrives here too, and that is deliberate at the
              boundary: text that cannot be decoded is never handed over as
              if it were text.

              ONE statement, because two were contradictory (J9): a 4.9 MB PDF
              read "Only its first 2 MiB were read." directly above "Binary
              file preview is unavailable.", which says both that there is a
              readable portion and that there is nothing to read. The size is
              still worth naming — it is why Copy contents is disabled for a
              file the reader may know is small enough to copy — so it is said
              here, once, in the sentence that is true. */}
          {file.truncated
            ? "Binary file preview is unavailable. This file is also larger than the 2 MiB preview limit, so only its first 2 MiB were examined."
            : "Binary file preview is unavailable."}
        </div>
      )}
      {file !== undefined && !file.binary && file.content === "" && (
        <div className="empty">This file is empty.</div>
      )}
      {file !== undefined &&
        !file.binary &&
        file.content !== "" &&
        (rendered ? (
          <div className="file-markdown markdown" ref={documentRef}>
            <FilePreviewMarkdown
              source={shown.text}
              path={file.path}
              onOpenFile={openFile}
              onGoToFragment={goToFragment}
            />
          </div>
        ) : (
          <pre style={gutterWidth(shown)}>
            {highlighted?.text === shown.text ? (
              <HighlightedText lines={highlighted.lines} />
            ) : (
              <PlainText text={shown.text} />
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
  /** Lines in everything that reached the browser. */
  total: number;
  /**
   * Whether anything was left out at all.
   *
   * Not a count of hidden lines, because a bundle is one line and cutting it
   * in half hides none of them while hiding almost all of the file. "Is this
   * the whole of what arrived?" is the question the notice turns on.
   */
  cut: boolean;
  /** Whether the character bound, rather than the line bound, made the cut. */
  byCharacters: boolean;
}

/**
 * What the tab is showing, and of what (J7).
 *
 * The reported sentence was "Showing the first 2000 of 55477 lines. Copy
 * contents takes the whole file.", under a file of 69,037 lines whose FIRST
 * 2 MiB hold 55,477 of them. Both halves were false: 55,477 is a count of the
 * portion the server read, not of the file, and Copy contents copies that
 * same portion, because 2 MiB is all that ever reached the browser. A bounded
 * view is honest only if it is honest about what it is bounded from.
 */
function boundedNotice(shown: BoundedText, truncated: boolean): string {
  const copy = truncated
    ? "Copy contents takes those 2 MiB."
    : "Copy contents takes the whole file.";
  if (shown.byCharacters) {
    // Lines are the wrong unit for a file whose length is not in its line
    // count, and quoting one here would be as misleading as the count J7
    // fixed: "the first 2,000 of 293 lines" says nothing about a bundle.
    const source = truncated ? "the 2 MiB that were read" : "this file";
    return `Showing the first ${String(FILE_PREVIEW_CHARACTER_LIMIT / 1024)} KiB of ${source}. ${copy}`;
  }
  const first = `Showing the first ${String(FILE_PREVIEW_LINE_LIMIT)}`;
  return truncated
    ? `${first} of the ${String(shown.total)} lines in the 2 MiB that were read. ${copy}`
    : `${first} of ${String(shown.total)} lines. ${copy}`;
}

/** Why nothing is coloured, when the reason is a bound rather than nothing. */
function declinedHighlightNotice(): string {
  return `Syntax highlighting is off for this file: what is shown is larger than the ${String(HIGHLIGHT_MAX_CHARACTERS / 1024)} KiB the highlighter will colour. The text below is the file's own, unchanged.`;
}

function boundedLines(content: string): BoundedText {
  if (content === "")
    return { text: "", total: 0, cut: false, byCharacters: false };
  const lines = content.split("\n");
  const total = lines.length;
  const byLines =
    total <= FILE_PREVIEW_LINE_LIMIT
      ? content
      : lines.slice(0, FILE_PREVIEW_LINE_LIMIT).join("\n");
  // The character bound is applied to what the line bound left, so the two
  // compose rather than competing: whichever bites first is the one that
  // decided, and it is the one the notice names.
  if (byLines.length <= FILE_PREVIEW_CHARACTER_LIMIT)
    return {
      text: byLines,
      total,
      cut: byLines !== content,
      byCharacters: false,
    };
  return {
    text: byLines.slice(0, FILE_PREVIEW_CHARACTER_LIMIT),
    total,
    cut: true,
    byCharacters: true,
  };
}

/**
 * How wide the number column has to be for this file (J11).
 *
 * From the line count rather than from the 2,000-line budget: a twelve-line
 * file should not pay four characters of indent for numbers it will never
 * reach. Two is the floor, because a one-character gutter reads as an
 * accident.
 */
function gutterWidth(shown: BoundedText): CSSProperties {
  const digits = Math.max(2, String(Math.max(1, shown.total)).length);
  return { "--file-gutter": `${String(digits)}ch` } as CSSProperties;
}

/**
 * One numbered line of the source view.
 *
 * The number is NOT here. It is `data-line`, which the stylesheet draws
 * through `content: attr(data-line)` on a `::before` — so it is generated
 * content, which a selection cannot reach and `textContent` does not
 * contain. A number rendered as a text node would be copied out with the
 * code, which is the one thing a line-number gutter must never do.
 *
 * The trailing newline is a real character of the file and stays one, which
 * is why the line is an inline element rather than a block: a block would
 * add a break of its own and double every line.
 */
function Line({
  number,
  last,
  children,
}: {
  number: number;
  last: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <span className="file-line" data-line={number}>
      {children}
      {last ? null : "\n"}
    </span>
  );
}

/**
 * The file's text before the highlighter answers, or when it never does.
 *
 * Split into the SAME line elements the highlighted rendering uses, which is
 * what keeps the upgrade geometrically identical: the swap replaces each
 * line's contents, not the shape of the box around it. Shiki's tokenizer
 * splits on the same newlines, so the two always produce the same number of
 * lines (verified against the real highlighter, including for text with a
 * trailing newline).
 */
function PlainText({ text }: { text: string }): JSX.Element {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, index) => (
        // Lines have no identity of their own — the array is the file — so
        // the index is the honest key here.
        <Line key={index} number={index + 1} last={index === lines.length - 1}>
          {line}
        </Line>
      ))}
    </>
  );
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
        <Line
          key={lineIndex}
          number={lineIndex + 1}
          last={lineIndex === lines.length - 1}
        >
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
        </Line>
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

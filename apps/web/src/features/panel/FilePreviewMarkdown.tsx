import type { JSX, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { resolvePreviewLink } from "./markdownLinks.js";

// A markdown file from the working tree, rendered as a formatted preview
// (WSP-05).
//
// **Why this is not `components/Markdown.tsx`.** That renderer exists for
// assistant messages, which this application produced in this session, whose
// links are addresses, and whose images are worth nulling out mainly because
// the transcript has nowhere to put them. A file preview is a different trust
// context in both directions:
//
//  - the content is arbitrary bytes from the user's working tree, including
//    files they did not write — a dependency's README, something a tool
//    generated, a document that arrived with a repository — so "the user
//    typed this" is never available as a reason to render something;
//  - its links and images are REPOSITORY PATHS, not URLs. The transcript's
//    renderer would send `../design/notes.md` to `window.open` as a relative
//    URL against the workspace's own origin, which navigates the workspace
//    to a page that does not exist. Being safe is not the same as being
//    right, and a link that quietly means something else is its own defect.
//
// What the two share is the part that must not drift: raw HTML stays off (no
// `rehype-raw`), so a document cannot bring its own elements, its own
// `<script>`, or an `onerror` handler, and every external link keeps
// `rel="noreferrer noopener"`.

export interface FilePreviewMarkdownProps {
  /** The file's text, exactly as the server read it. */
  source: string;
  /** The workspace-relative path it was read from, which links resolve against. */
  path: string;
  onOpenFile: (path: string) => void;
}

export function FilePreviewMarkdown({
  source,
  path,
  onOpenFile,
}: FilePreviewMarkdownProps): JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // NO image is rendered, of any kind. A remote one is a request, which
        // WSP-05 forbids outright; an inline `data:` one issues none, and was
        // going to be allowed, but react-markdown's own URL sanitiser
        // refuses `data:` and re-enabling it for arbitrary working-tree
        // content would buy a rare case at the price of the one element in a
        // document that can carry bytes of its own. So every reference
        // becomes a label instead.
        img: ({ src, alt }) => {
          const reference = typeof src === "string" ? src : "";
          // Not silence: a document whose diagram is missing should say what
          // was there, because the reader can then open that file, and
          // because a blank space reads as a rendering fault.
          const target = describeImage(reference, path);
          return (
            <span className="md-image-missing">
              {`${alt ?? "Image"} — not loaded${target === null ? "" : `: ${target}`}`}
            </span>
          );
        },
        a: ({ children, href, title }) => (
          <PreviewLink href={href} title={title} path={path} open={onOpenFile}>
            {children}
          </PreviewLink>
        ),
      }}
    >
      {source}
    </ReactMarkdown>
  );
}

/** What an unloaded image pointed at, said in the reader's own terms. */
function describeImage(reference: string, path: string): string | null {
  const target = resolvePreviewLink(reference, path);
  switch (target.kind) {
    case "file":
      return target.path;
    case "external":
      return target.href;
    case "inert":
      return null;
  }
}

function PreviewLink({
  children,
  href,
  title,
  path,
  open,
}: {
  children: ReactNode;
  href: string | undefined;
  title: string | undefined;
  path: string;
  open: (path: string) => void;
}): JSX.Element {
  const target = resolvePreviewLink(href, path);
  switch (target.kind) {
    case "file":
      // A control rather than an anchor, because it does not navigate: it
      // opens another File tab, which is what WSP-05 says activating a file
      // does. Its tooltip carries the full workspace-relative path, as the
      // file tree's rows do.
      return (
        <button
          type="button"
          className="md-file-link"
          title={title ?? target.path}
          onClick={() => {
            open(target.path);
          }}
        >
          {children}
        </button>
      );
    case "external":
      return (
        <a
          className="md-external-link"
          href={target.href}
          title={title}
          rel="noreferrer noopener"
          target="_blank"
        >
          {children}
          <span className="md-external-mark" aria-hidden="true">
            ↗
          </span>
          {/* Part of the accessible name on purpose: a reader deciding
              whether to follow a link inside someone else's document is
              entitled to know where it goes and that it leaves the
              workspace, and a glyph says that to no one using a screen
              reader. */}
          <span className="sr-only">{` (${authorityOf(target.href)}, opens in a new browser tab)`}</span>
        </a>
      );
    case "inert":
      // Rendered as what it is: text that names no reachable target. A live
      // anchor here would be a link that silently does nothing, and an
      // anchor carrying the original `href` would be the one thing this
      // whole path exists to prevent.
      return (
        <span
          className="md-inert-link"
          title="This link does not point anywhere the workspace can open."
        >
          {children}
        </span>
      );
  }
}

/** The host an external link leads to, or the scheme when it has no host. */
function authorityOf(href: string): string {
  try {
    const url = new URL(href);
    return url.host === "" ? url.protocol.replace(":", "") : url.host;
  } catch {
    return "external link";
  }
}

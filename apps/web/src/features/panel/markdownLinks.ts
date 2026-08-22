// What a link inside a previewed markdown file points at (WSP-05).
//
// A document in a working tree is not a web page: most of its links are
// repository paths, relative to the file they are written in, and the ones
// that are addresses belong in a real browser rather than in the workspace.
// The three answers are therefore a file to open in its own tab, an address
// to hand to the browser, and nothing — and the third is rendered as visibly
// nothing rather than as a link that does not work.

export type PreviewLink =
  | { kind: "file"; path: string }
  | { kind: "external"; href: string }
  /**
   * A place inside the document being displayed (J8).
   *
   * These were rendered inert, with the tooltip "This link does not point
   * anywhere the workspace can open" — correct about the workspace and wrong
   * about the link, which points at a heading three inches further down. A
   * table of contents is the commonest thing a repository document has, and
   * telling a reader that its every entry leads nowhere is worse than saying
   * nothing.
   */
  | { kind: "fragment"; id: string }
  | { kind: "inert" };

const INERT: PreviewLink = { kind: "inert" };

/** Anything of the form `scheme:` — the check the WHATWG parser starts with. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The schemes a preview will hand to the browser, and no others. */
const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * The workspace-relative path a repository link names, or `null`.
 *
 * The rules a path has to satisfy are the server's own — no empty segment,
 * no `..` that leaves the root, no backslash, no NUL — applied here so a
 * document cannot even offer a link the read boundary would refuse. The
 * boundary still refuses them; this is what keeps the refusal from being the
 * user's first sight of the answer.
 */
function repositoryPath(href: string, fromPath: string): string | null {
  // A fragment addresses a place inside a document and a query addresses a
  // server; neither names a different file.
  const withoutFragment = href.split("#")[0] ?? "";
  const target = withoutFragment.split("?")[0] ?? "";
  if (target === "") return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // A malformed escape is not a path this can name, and guessing at one is
    // exactly how a traversal gets through.
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) return null;

  // A leading slash means the workspace root. That is what a repository
  // document means by it — the file is read from a checkout, not served from
  // a site root — and it is the only reading that resolves to a real file.
  const rooted = decoded.startsWith("/");
  const base = rooted ? [] : parentSegments(fromPath);
  const segments = decoded.split("/");
  // `sub/`, `../` and a bare `.` all name a DIRECTORY, and a File tab reads
  // one file. The last segment is what says which: a name means a file, and
  // a trailing slash, `.` or `..` means the directory it landed in.
  const last = segments[segments.length - 1];
  if (last === "" || last === "." || last === "..") return null;
  const resolved = [...base];
  for (const segment of segments) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      // Nothing above the root: the workspace is the whole of what a File
      // tab can address.
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  if (resolved.length === 0) return null;
  return resolved.join("/");
}

function parentSegments(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  segments.pop();
  return segments;
}

/** The text of a `#fragment`, or `null` when there is none to speak of. */
function decodeFragment(raw: string): string | null {
  if (raw === "") return null;
  try {
    const decoded = decodeURIComponent(raw);
    return decoded === "" ? null : decoded;
  } catch {
    // A malformed escape names nothing, exactly as it does for a path.
    return null;
  }
}

/**
 * The GitHub-style slug of a heading, which is what a document's own
 * fragments are written against.
 *
 * Applied to both sides of the comparison — the fragment as written and the
 * text of each rendered heading — so the two agree by construction rather
 * than by the author having spelled the slug the same way we would.
 */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

export function resolvePreviewLink(
  href: string | undefined,
  fromPath: string,
): PreviewLink {
  if (href === undefined) return INERT;
  const trimmed = href.trim();
  if (trimmed === "") return INERT;
  // Protocol-relative, which is an address whose scheme is the page's. The
  // workspace's own scheme is not this document's, so it names nothing true.
  if (trimmed.startsWith("//")) return INERT;
  const scheme = SCHEME.exec(trimmed);
  if (scheme !== null) {
    // Every other scheme is refused rather than rendered: `javascript:` and
    // `data:` are the ones that would run, and `file:` is the one that would
    // read outside the workspace.
    return EXTERNAL_SCHEMES.has(scheme[0].toLowerCase())
      ? { kind: "external", href: trimmed }
      : INERT;
  }
  if (trimmed.startsWith("#")) {
    // `#` alone is a link to the top of a page, which is a web idiom rather
    // than a place in a document; it names nothing here.
    const id = decodeFragment(trimmed.slice(1));
    return id === null ? INERT : { kind: "fragment", id };
  }
  const path = repositoryPath(trimmed, fromPath);
  return path === null ? INERT : { kind: "file", path };
}

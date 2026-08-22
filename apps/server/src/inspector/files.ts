import { opendir, open, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  FilePreviewResponseSchema,
  FileTreeResponseSchema,
  RelativePathSchema,
} from "@pi-web/contracts";

import {
  isIgnored,
  loadDirectoryIgnoreLayer,
  loadRootIgnoreLayers,
  type IgnoreLayer,
} from "./ignoreRules.js";
import {
  isTracked,
  loadTrackedPaths,
  type TrackedIndex,
} from "./trackedFiles.js";

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_TREE_ENTRIES = 20_000;
const MAX_SEARCH_MATCHES = 500;

export function parseRelativePath(raw: unknown): string {
  return RelativePathSchema.parse(raw);
}

function isContained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

export async function resolveContained(
  rootPath: string,
  rawRelativePath: unknown,
  allowRoot = false,
): Promise<{ root: string; target: string; relativePath: string }> {
  const root = await realpath(rootPath);
  if (allowRoot && rawRelativePath === "")
    return { root, target: root, relativePath: "" };
  const relativePath = parseRelativePath(rawRelativePath);
  if (isAbsolute(relativePath)) throw new Error("path_escape");
  const lexical = resolve(root, ...relativePath.split("/"));
  if (!isContained(root, lexical)) throw new Error("path_escape");
  const target = await realpath(lexical);
  if (!isContained(root, target)) throw new Error("path_escape");
  return { root, target, relativePath };
}

export interface ListProjectFilesOptions {
  /** Bounded server-side substring search over the workspace-relative path. */
  search?: string;
  /**
   * `"1"` lists the target directory's own children; `"full"` walks the whole
   * subtree. `"full"` is the default so the parameter is additive: a browser
   * that does not send it sees exactly what it saw before (WSP-05 v2).
   */
  depth?: "1" | "full";
  /** Reveal paths the working tree's ignore rules match. `.git` never is. */
  showIgnored?: boolean;
  /** The directory to list, relative to the execution root; `""` is the root. */
  path?: string;
}

/** How the children of one directory are ordered, and why it is stable. */
function compareEntries(
  left: { name: string; kind: string },
  right: { name: string; kind: string },
): number {
  // Directories first, then files and symlinks, each case-insensitively by
  // name. Case-insensitive because a tree that puts `Docs` and `apps` in
  // different halves of the list reads as unsorted; the case-sensitive
  // tie-break after it keeps the order total, so two listings of one
  // directory never disagree about which of `README` and `readme` comes
  // first.
  const leftDirectory = left.kind === "directory";
  const rightDirectory = right.kind === "directory";
  if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
  const folded = left.name
    .toLocaleLowerCase()
    .localeCompare(right.name.toLocaleLowerCase());
  if (folded !== 0) return folded;
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

export async function listProjectFiles(
  rootPath: string,
  options: ListProjectFilesOptions = {},
) {
  // One containment check for the whole listing, through the same resolver
  // every other file route uses: the walk below never re-derives a path from
  // client text, only from directory entries under this resolved target.
  const resolved = await resolveContained(rootPath, options.path ?? "", true);
  const root = resolved.root;
  const search = (options.search ?? "").trim().toLocaleLowerCase();
  const depth = options.depth ?? "full";
  const showIgnored = options.showIgnored ?? false;
  const entries: {
    path: string;
    name: string;
    kind: "file" | "directory" | "symlink";
    size: number | null;
  }[] = [];
  let truncated = false;
  let ignoredHidden = false;

  // Every ignore file from the root down to and including the directory being
  // listed, so expanding `apps/web` still honours a rule written in `apps`.
  const baseLayers = showIgnored
    ? []
    : await loadIgnoreLayersFor(root, resolved.relativePath);
  // What the working tree's Git index holds, or null when there is no index
  // to read. A tracked path is never ignored, whatever the patterns say
  // (H1); a null index exempts nothing, which is exactly what shipped.
  const tracked: TrackedIndex | null = showIgnored
    ? null
    : await loadTrackedPaths(root);

  function atCapacity(): boolean {
    return (
      entries.length >= MAX_TREE_ENTRIES ||
      (search !== "" && entries.length >= MAX_SEARCH_MATCHES)
    );
  }

  async function visit(
    directory: string,
    layers: IgnoreLayer[],
    remaining: number,
    /**
     * Whether this directory is itself excluded, which is only reachable
     * because something tracked lives under it.
     *
     * Git's rule, kept exactly: a path under an excluded directory cannot be
     * re-included, so inside one the only visible entries are the tracked
     * ones. Without this the walk would descend into an excluded directory
     * on account of one committed file and then show every uncommitted
     * sibling beside it, because a floating pattern like `dist` matches the
     * directory and not the paths beneath it.
     */
    insideIgnored: boolean,
  ): Promise<void> {
    if (atCapacity()) {
      truncated = true;
      return;
    }
    const children: {
      name: string;
      kind: "file" | "directory" | "symlink";
      // A symlinked directory reports `directory: false` here on purpose:
      // traversal must not follow one (design/inspector-and-terminal.md).
      walkable: boolean;
    }[] = [];
    const handle = await opendir(directory);
    for await (const entry of handle) {
      // Not an ignore rule and not revealed by the opt-in: `.git` is the
      // repository's own machinery, and reading it is not browsing.
      if (entry.name === ".git") continue;
      children.push({
        name: entry.name,
        kind: entry.isSymbolicLink()
          ? "symlink"
          : entry.isDirectory()
            ? "directory"
            : "file",
        walkable: entry.isDirectory(),
      });
    }
    children.sort(compareEntries);

    for (const child of children) {
      const absolute = resolve(directory, child.name);
      const displayPath = relative(root, absolute).split(sep).join("/");
      const isDirectory = child.kind === "directory";
      const excluded =
        !showIgnored &&
        (insideIgnored || isIgnored(layers, displayPath, isDirectory));
      if (excluded && !isTracked(tracked, displayPath)) {
        // Recorded so the tab can say it is showing less than everything;
        // an under-reporting listing that stays quiet is not acceptable.
        ignoredHidden = true;
        continue;
      }
      if (search === "" || displayPath.toLocaleLowerCase().includes(search)) {
        let size: number | null = null;
        if (child.kind === "file") {
          try {
            size = (await stat(absolute)).size;
          } catch {
            size = null;
          }
        }
        entries.push({
          path: displayPath,
          name: child.name,
          kind: child.kind,
          size,
        });
      }
      if (child.walkable && remaining > 0) {
        const nested = showIgnored
          ? layers
          : await appendDirectoryLayer(layers, absolute, displayPath);
        await visit(absolute, nested, remaining - 1, excluded);
      }
      if (atCapacity()) {
        truncated = true;
        break;
      }
    }
  }

  // `depth: "1"` is the tree's own request: one level, and the browser asks
  // again when the user expands a directory. It is what stops the panel
  // paying for a 20,000-entry walk to paint ten rows.
  await visit(
    resolved.target,
    baseLayers,
    depth === "1" ? 0 : Number.POSITIVE_INFINITY,
    // The requested root is subject to the same rules as any entry (H2): a
    // directory that is itself excluded is refused above unless something
    // tracked lives under it, and when it is reached that way its children
    // are inside an excluded directory.
    !showIgnored &&
      resolved.relativePath !== "" &&
      isIgnored(baseLayers, resolved.relativePath, true),
  );
  return FileTreeResponseSchema.parse({ entries, truncated, ignoredHidden });
}

/** The ignore layers in force for a directory, root-first. */
async function loadIgnoreLayersFor(
  root: string,
  relativeDirectory: string,
): Promise<IgnoreLayer[]> {
  let layers = await loadRootIgnoreLayers(root);
  if (relativeDirectory === "") return layers;
  const segments = relativeDirectory.split("/");
  let prefix = "";
  for (const segment of segments) {
    prefix = prefix === "" ? segment : `${prefix}/${segment}`;
    layers = await appendDirectoryLayer(
      layers,
      resolve(root, ...prefix.split("/")),
      prefix,
    );
  }
  return layers;
}

async function appendDirectoryLayer(
  layers: IgnoreLayer[],
  absoluteDirectory: string,
  relativeDirectory: string,
): Promise<IgnoreLayer[]> {
  const layer = await loadDirectoryIgnoreLayer(
    absoluteDirectory,
    relativeDirectory,
  );
  // A new array rather than a push: a sibling directory's rules must not
  // leak into the branch beside it once the walk comes back up.
  return layer === null ? layers : [...layers, layer];
}

function languageFor(path: string): string | null {
  const extension = extname(path).slice(1).toLowerCase();
  const known: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    py: "python",
    rs: "rust",
    go: "go",
    sh: "shell",
    yml: "yaml",
    yaml: "yaml",
  };
  return known[extension] ?? (extension === "" ? null : extension);
}

export async function previewProjectFile(
  rootPath: string,
  rawRelativePath: unknown,
) {
  const resolved = await resolveContained(rootPath, rawRelativePath);
  const info = await stat(resolved.target);
  if (!info.isFile()) throw new Error("file_not_regular");
  const handle = await open(resolved.target, "r");
  try {
    const capacity =
      Math.min(info.size, MAX_PREVIEW_BYTES) +
      (info.size > MAX_PREVIEW_BYTES ? 0 : 1);
    const buffer = Buffer.alloc(capacity);
    const result = await handle.read(buffer, 0, capacity, 0);
    const bytes = buffer.subarray(0, result.bytesRead);
    const binary = bytes.includes(0);
    let content = "";
    if (!binary) {
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return FilePreviewResponseSchema.parse({
          path: resolved.relativePath,
          language: languageFor(resolved.relativePath),
          content: "",
          binary: true,
          truncated: info.size > MAX_PREVIEW_BYTES,
        });
      }
    }
    return FilePreviewResponseSchema.parse({
      path: resolved.relativePath,
      language: languageFor(resolved.relativePath),
      content,
      binary,
      truncated: info.size > MAX_PREVIEW_BYTES,
    });
  } finally {
    await handle.close();
  }
}

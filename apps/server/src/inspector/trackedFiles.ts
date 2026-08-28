import { stat } from "node:fs/promises";
import { join } from "node:path";

import { runGit } from "./git.js";

// Which paths the working tree's Git index knows about (H1).
//
// Why this exists at all. The ignore matcher in `ignoreRules.ts` is a pure
// predicate over patterns, and a pure predicate cannot answer the one
// question Git answers before it ever consults a pattern: **Git never
// ignores a tracked file.** A file committed before the rule that now
// matches it, or added with `git add --force`, is in the repository and is
// shown by every Git tool there is — and the panel hid it, while telling the
// user it was hidden by an ignore rule. That is the failure that costs trust
// in a file tree: the user knows the file is in the repository and the tree
// says it is not.
//
// Why this is not the `git check-ignore` the plan rejected. That rejection
// stands and is about a different call: `check-ignore` is a **per-path
// oracle** — one process, or one long-lived pipe, consulted for every entry
// of every listing, on the hot path. This is **one bounded listing per
// working tree**, cached against the index it was read from, consulted from
// memory thereafter. It also answers a question the matcher cannot answer at
// all, rather than re-answering one it already answers faithfully: measured
// over a real repository, the matcher and Git disagreed about exactly the
// two tracked files below and about nothing else.
//
// Every failure degrades to today's behaviour and never to worse: no Git, no
// repository, a non-zero exit, a timeout, output past the limit, or more
// tracked paths than the bound allows all yield `null`, and a `null` index
// exempts nothing.

/**
 * The most tracked paths held in memory for one working tree.
 *
 * Bounds the cache rather than the process: `runGit`'s own 5 MiB output limit
 * already stops the read itself from being unbounded. A repository past this
 * is served by the pattern matcher alone, which is exactly what shipped.
 */
export const MAX_TRACKED_ENTRIES = 50_000;

/** How many working trees keep an index in memory at once. */
const MAX_CACHED_ROOTS = 4;

/** How long an entry survives when the index file cannot be stamped. */
const UNSTAMPED_TTL_MS = 5_000;

/** How long a stamped entry survives even while its stamp is unchanged. */
const MAX_AGE_MS = 60_000;

export interface TrackedIndex {
  /** Every tracked path, relative to the listed root. */
  readonly files: ReadonlySet<string>;
  /** Every directory holding a tracked path, at any depth below it. */
  readonly directories: ReadonlySet<string>;
}

interface CacheEntry {
  /** The index file's identity when this was read, or null if unreadable. */
  stamp: string | null;
  loadedAt: number;
  index: TrackedIndex | null;
}

const cache = new Map<string, CacheEntry>();

/** Whether Git tracks this path, or anything under it. */
export function isTracked(
  index: TrackedIndex | null,
  relativePath: string,
): boolean {
  if (index === null) return false;
  return index.files.has(relativePath) || index.directories.has(relativePath);
}

/**
 * The tracked paths of one working tree, or `null` when there are none to be
 * had.
 *
 * `null` is not an error the caller handles: it is "this changes nothing",
 * and every caller must behave exactly as it did before this module existed.
 */
export async function loadTrackedPaths(
  root: string,
): Promise<TrackedIndex | null> {
  const stamp = await indexStamp(root);
  const cached = cache.get(root);
  if (cached !== undefined && isFresh(cached, stamp)) {
    // Re-inserted so the eviction order is by use rather than by first read.
    cache.delete(root);
    cache.set(root, cached);
    return cached.index;
  }
  const index = await readTrackedPaths(root);
  cache.delete(root);
  cache.set(root, { stamp, loadedAt: Date.now(), index });
  while (cache.size > MAX_CACHED_ROOTS) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
  return index;
}

/** Drops every cached index. For tests, and for a project being removed. */
export function clearTrackedPathCache(): void {
  cache.clear();
}

function isFresh(entry: CacheEntry, stamp: string | null): boolean {
  const age = Date.now() - entry.loadedAt;
  if (age >= MAX_AGE_MS) return false;
  // The index file is what `git ls-files` reads, so its identity is the
  // invalidation signal: `git add`, `commit`, `rm`, and `checkout` all write
  // it. Where it cannot be stamped — a linked worktree keeps its index
  // elsewhere — a short lifetime stands in for the signal.
  if (stamp === null || entry.stamp === null) return age < UNSTAMPED_TTL_MS;
  return entry.stamp === stamp;
}

async function indexStamp(root: string): Promise<string | null> {
  try {
    const info = await stat(join(root, ".git", "index"));
    return `${String(info.mtimeMs)}:${String(info.size)}`;
  } catch {
    return null;
  }
}

async function readTrackedPaths(root: string): Promise<TrackedIndex | null> {
  let result;
  try {
    // `-z` because a path may contain a newline, and `--cached` — the
    // default, stated — because the question is what the index holds. Paths
    // come back relative to the directory the command ran in, which is the
    // execution root, so they are already in the listing's own coordinates.
    result = await runGit(root, ["ls-files", "-z", "--cached"]);
  } catch {
    // A missing `git`, a timeout, or a spawn failure. Not this boundary's
    // problem to report: the listing is a file listing and does not imply
    // Git ownership.
    return null;
  }
  // A non-zero exit is the ordinary answer for "not a Git working tree", and
  // truncated output would make an index that lies by omission — which would
  // hide a tracked file again, the very defect this exists to remove.
  if (result.code !== 0 || result.truncated) return null;

  const files = new Set<string>();
  const directories = new Set<string>();
  for (const path of result.stdout.toString("utf8").split("\0")) {
    if (path === "") continue;
    if (files.size >= MAX_TRACKED_ENTRIES) return null;
    files.add(path);
    let slash = path.lastIndexOf("/");
    while (slash > 0) {
      const directory = path.slice(0, slash);
      // Every ancestor of a tracked path is already recorded once one is.
      if (directories.has(directory)) break;
      directories.add(directory);
      slash = directory.lastIndexOf("/");
    }
  }
  return { files, directories };
}

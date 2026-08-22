import type { GitFileStatus } from "@pi-web/contracts";

/**
 * One-line "N added, N modified, N deleted" summary of a worktree's status.
 *
 * Folded forward from the removed Environment panel (CWS-06, superseded):
 * the one place the workspace still summarizes the focused thread's changes
 * is the inspector's Changes tab. Renamed/copied read as neither an addition
 * nor a removal, so they fall in with "modified"; an untracked file reads as
 * an addition, because that is what it will be once staged.
 */
export function summarizeChanges(files: readonly GitFileStatus[]): string {
  if (files.length === 0) return "No changes";
  let added = 0;
  let modified = 0;
  let deleted = 0;
  for (const file of files) {
    if (file.kind === "added" || file.kind === "untracked") added += 1;
    else if (file.kind === "deleted") deleted += 1;
    else modified += 1;
  }
  const parts: string[] = [];
  if (added > 0) parts.push(`${String(added)} added`);
  if (modified > 0) parts.push(`${String(modified)} modified`);
  if (deleted > 0) parts.push(`${String(deleted)} deleted`);
  return parts.join(", ");
}

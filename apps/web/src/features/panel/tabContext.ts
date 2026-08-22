import type { Project, ThreadSummary } from "@pi-web/contracts";

import type { TabContext } from "./panelTabs.js";

// A tab's context is the execution scope it reads from, frozen at open time
// (WSP-02). This module is the only place that derives one, so every tab
// agrees on what "the same worktree" means.

/**
 * The context a tab opened against `thread` carries.
 *
 * The label names the **execution scope**, never the thread: a shared thread
 * reads the project's own working tree, and every shared thread of one
 * project reads the *same* one, so labelling such a tab with a thread title
 * would claim a distinction the filesystem does not have. An isolated thread
 * has a worktree of its own, and its branch is what names it.
 */
export function threadTabContext(
  project: Project,
  thread: ThreadSummary,
): TabContext {
  if (thread.workspace.mode === "worktree")
    return {
      projectId: project.id,
      threadId: thread.id,
      // One worktree per isolated thread, so the thread id identifies the
      // working tree as well as any server-side worktree id would — and
      // unlike that id, the browser already has it.
      scopeKey: thread.id,
      label: thread.workspace.branchName,
    };
  return {
    projectId: project.id,
    threadId: thread.id,
    scopeKey: project.id,
    label: project.displayName,
  };
}

/** Whether two contexts read the same working tree. */
export function sameExecutionScope(
  a: TabContext | null,
  b: TabContext | null,
): boolean {
  if (a === null || b === null) return false;
  return a.projectId === b.projectId && a.scopeKey === b.scopeKey;
}

/**
 * Whether a tab must name the worktree it reads (WSP-02).
 *
 * Shown whenever the tab's working tree is not the one the focused chat pane
 * is working in — including when no pane owns a thread at all, because then
 * nothing on screen implies which worktree the tab is reading. A tab with no
 * context of its own has nothing to name; it renders its own unbound state
 * instead.
 */
export function showsWorktreeChip(
  tab: TabContext | null,
  focused: TabContext | null,
): boolean {
  if (tab === null) return false;
  return !sameExecutionScope(tab, focused);
}

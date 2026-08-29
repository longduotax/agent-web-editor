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
      // Several chats may share one managed worktree. Its opaque server-owned
      // id identifies the execution scope without exposing a filesystem path.
      scopeKey: thread.workspace.worktreeId,
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
  if (a.projectId !== b.projectId) return false;
  if (a.scopeKey === b.scopeKey) return true;
  // Panel storage written before worktrees could own sibling chats used the
  // authorizing thread id as its isolated scope key. Recognize that exact
  // legacy shape by its stable branch label; shared contexts never have
  // scopeKey === threadId, so they cannot enter this fallback.
  const legacy = a.scopeKey === a.threadId || b.scopeKey === b.threadId;
  return legacy && a.label === b.label;
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

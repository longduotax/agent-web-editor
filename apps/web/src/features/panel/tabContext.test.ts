import { describe, expect, it } from "vitest";
import {
  ThreadWorkspaceSummarySchema,
  type Project,
  type ProjectId,
  type ThreadId,
  type ThreadSummary,
} from "@pi-web/contracts";

import { showsWorktreeChip, threadTabContext } from "./tabContext.js";

const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
const otherThreadId = "20000000-0000-4000-8000-000000000002" as ThreadId;
const worktreeId = "30000000-0000-4000-8000-000000000001";
const otherWorktreeId = "30000000-0000-4000-8000-000000000002";

const project: Project = {
  id: projectId,
  displayName: "Example project",
  displayPath: "/example",
  createdAt: "2026-01-01T00:00:00.000Z",
  available: true,
  gitAvailable: true,
  sidebarExpanded: true,
  unreadCount: 0,
  lastOpenedThreadId: threadId,
};

function thread(
  id: ThreadId,
  workspace: ThreadSummary["workspace"],
): ThreadSummary {
  return {
    id,
    projectId,
    title: `Thread ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    runState: null,
    unread: false,
    runtimeAvailable: true,
    workspace,
  };
}

const shared: ThreadSummary["workspace"] = {
  mode: "shared",
  branchName: "main",
  available: true,
};
// Parsed rather than cast: the branch fields are branded, and a fixture the
// contract itself accepts is the only honest way to build one.
const isolated: ThreadSummary["workspace"] = ThreadWorkspaceSummarySchema.parse(
  {
    mode: "worktree",
    worktreeId,
    branchName: "pi/feature",
    baseBranch: "main",
    baseCommit: "abc1234",
    available: true,
  },
);

describe("threadTabContext", () => {
  it("labels a shared thread with the project, because that is the worktree it reads", () => {
    expect(threadTabContext(project, thread(threadId, shared))).toEqual({
      projectId,
      threadId,
      scopeKey: projectId,
      label: "Example project",
    });
  });

  it("labels an isolated thread with its branch", () => {
    expect(threadTabContext(project, thread(threadId, isolated))).toEqual({
      projectId,
      threadId,
      scopeKey: worktreeId,
      label: "pi/feature",
    });
  });

  // Two shared threads of one project genuinely share a working tree, so a
  // per-thread scope key would claim a distinction that does not exist.
  it("gives two shared threads of one project the same scope", () => {
    const first = threadTabContext(project, thread(threadId, shared));
    const second = threadTabContext(project, thread(otherThreadId, shared));
    expect(second.scopeKey).toBe(first.scopeKey);
    expect(second.label).toBe(first.label);
  });

  it("gives sibling chats in one isolated worktree the same scope", () => {
    const first = threadTabContext(project, thread(threadId, isolated));
    const second = threadTabContext(project, thread(otherThreadId, isolated));
    expect(second.scopeKey).toBe(first.scopeKey);
  });

  it("gives chats in different isolated worktrees different scopes", () => {
    const other = ThreadWorkspaceSummarySchema.parse({
      ...isolated,
      worktreeId: otherWorktreeId,
      branchName: "pi/other",
    });
    const first = threadTabContext(project, thread(threadId, isolated));
    const second = threadTabContext(project, thread(otherThreadId, other));
    expect(second.scopeKey).not.toBe(first.scopeKey);
  });
});

describe("showsWorktreeChip", () => {
  const sharedContext = threadTabContext(project, thread(threadId, shared));
  const isolatedContext = threadTabContext(project, thread(threadId, isolated));

  it("is hidden while the tab reads the focused pane's worktree", () => {
    expect(showsWorktreeChip(sharedContext, sharedContext)).toBe(false);
  });

  it("is hidden for a second shared thread of the same project", () => {
    const sibling = threadTabContext(project, thread(otherThreadId, shared));
    expect(showsWorktreeChip(sharedContext, sibling)).toBe(false);
  });

  it("recognises a persisted legacy thread-keyed context for the same worktree", () => {
    const legacy = { ...isolatedContext, scopeKey: isolatedContext.threadId };
    expect(showsWorktreeChip(legacy, isolatedContext)).toBe(false);
  });

  it("is shown when the tab reads a different worktree", () => {
    expect(showsWorktreeChip(isolatedContext, sharedContext)).toBe(true);
  });

  // Nothing on screen implies which worktree the tab reads, so it has to say.
  it("is shown when no chat pane owns a thread", () => {
    expect(showsWorktreeChip(sharedContext, null)).toBe(true);
  });

  it("is hidden for a tab that has no context of its own", () => {
    expect(showsWorktreeChip(null, sharedContext)).toBe(false);
  });
});

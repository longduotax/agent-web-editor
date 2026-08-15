import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MetadataStore } from "./store.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function stateDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-state-"));
  roots.push(root);
  return root;
}

function ids() {
  let value = 1;
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, "0")}`;
}

describe("metadata persistence", () => {
  it("persists projects and restores soft-removed metadata", async () => {
    const state = await stateDirectory();
    let store = await MetadataStore.open({
      stateDirectory: state,
      now: () => "2026-08-15T12:00:00.000Z",
      id: ids(),
    });
    const project = store.registerProject("/tmp/example-project", "Example");
    const thread = store.createThread(
      project.id,
      "10000000-0000-4000-8000-000000000001",
      "Work",
    );
    store.setProjectExpanded(project.id, false);
    store.removeProject(project.id);
    expect(store.listProjects()).toHaveLength(0);
    store.close();

    store = await MetadataStore.open({
      stateDirectory: state,
      now: () => "2026-08-15T12:01:00.000Z",
      id: ids(),
    });
    const restored = store.registerProject("/tmp/example-project");
    expect(restored.id).toBe(project.id);
    expect(restored.sidebar_expanded).toBe(0);
    expect(store.listThreads(restored.id)[0]?.id).toBe(thread.id);
    store.close();
  });

  it("enforces one running run per project and derives unread state", async () => {
    const state = await stateDirectory();
    const store = await MetadataStore.open({
      stateDirectory: state,
      now: () => "2026-08-15T12:00:00.000Z",
      id: ids(),
    });
    const project = store.registerProject("/tmp/project");
    const first = store.createThread(
      project.id,
      "10000000-0000-4000-8000-000000000001",
    );
    const second = store.createThread(
      project.id,
      "10000000-0000-4000-8000-000000000002",
    );
    const run = store.createRun(
      project.id,
      first.id,
      "20000000-0000-4000-8000-000000000001",
    );
    expect(() =>
      store.createRun(
        project.id,
        second.id,
        "20000000-0000-4000-8000-000000000002",
      ),
    ).toThrow(/UNIQUE/);
    store.settleRun(run.id, "completed");
    expect(store.unreadCount(project.id)).toBe(1);
    store.markViewed(project.id, first.id, run.id);
    expect(store.unreadCount(project.id)).toBe(0);
    store.close();
  });

  it("marks unfinished runs interrupted on restart", async () => {
    const state = await stateDirectory();
    let now = "2026-08-15T12:00:00.000Z";
    let store = await MetadataStore.open({
      stateDirectory: state,
      now: () => now,
      id: ids(),
    });
    const project = store.registerProject("/tmp/project");
    const thread = store.createThread(
      project.id,
      "10000000-0000-4000-8000-000000000001",
    );
    const completed = store.createRun(
      project.id,
      thread.id,
      "20000000-0000-4000-8000-000000000001",
    );
    store.settleRun(completed.id, "completed");
    store.markViewed(project.id, thread.id, completed.id);
    now = "2026-08-15T12:00:01.000Z";
    const running = store.createRun(
      project.id,
      thread.id,
      "20000000-0000-4000-8000-000000000002",
    );
    store.close();
    store = await MetadataStore.open({
      stateDirectory: state,
      now: () => "2026-08-15T12:01:00.000Z",
      id: ids(),
    });
    expect(store.latestRun(thread.id)).toMatchObject({
      id: running.id,
      state: "interrupted",
    });
    const recoveredThread = store.getThread(project.id, thread.id);
    expect(recoveredThread).toMatchObject({
      last_completed_run_id: running.id,
      last_viewed_completed_run_id: completed.id,
    });
    if (recoveredThread === null) throw new Error("thread was not recovered");
    expect(store.isUnread(recoveredThread)).toBe(true);
    expect(store.unreadCount(project.id)).toBe(1);
    store.close();
  });
});

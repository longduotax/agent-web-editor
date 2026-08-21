// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectId } from "@pi-web/contracts";

import { createInitialLayout, tiledPaneIds } from "./layoutTree.js";
import type { PaneId, WorkspaceLayout } from "./layoutTree.js";
import {
  layoutStorageKey,
  readLayout,
  WORKSPACE_LAYOUT_VERSION,
  writeLayout,
} from "./layoutStorage.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const PROJECT_ID = "11111111-1111-1111-1111-111111111111" as ProjectId;

let nextId = 0;
function makeId(): PaneId {
  nextId += 1;
  return `pane-${String(nextId)}`;
}

describe("workspace layout storage", () => {
  it("returns an initial one-pane layout for a fresh project", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    const layout = readLayout(PROJECT_ID, makeId);

    expect(layout.root).not.toBeNull();
    expect(layout.root?.type).toBe("pane");
    expect(Object.keys(layout.panes)).toHaveLength(1);
    expect(layout).not.toHaveProperty("docked");
    if (layout.root?.type === "pane") {
      expect(layout.focusedPaneId).toBe(layout.root.id);
    }
  });

  it("round-trips a layout written with writeLayout through readLayout", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });

    const initial = createInitialLayout(makeId);
    const layout: WorkspaceLayout = {
      ...initial,
      boundPaneId: initial.focusedPaneId,
    };

    writeLayout(PROJECT_ID, layout);

    const stored = JSON.parse(store.get(layoutStorageKey(PROJECT_ID)) ?? "{}") as {
      version: number;
      docked?: unknown;
    };
    expect(stored.version).toBe(WORKSPACE_LAYOUT_VERSION);
    expect(stored).not.toHaveProperty("docked");

    const result = readLayout(PROJECT_ID, makeId);

    expect(result).toEqual(layout);
  });

  it("discards a malformed JSON string and returns an initial layout", () => {
    const removeItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: () => "not json",
      setItem: () => undefined,
      removeItem,
    });

    const layout = readLayout(PROJECT_ID, makeId);

    expect(removeItem).toHaveBeenCalledWith(layoutStorageKey(PROJECT_ID));
    expect(layout.root?.type).toBe("pane");
    expect(layout).not.toHaveProperty("docked");
  });

  it("discards a stored value with an unknown version and returns an initial layout", () => {
    const removeItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          version: 999,
          root: { type: "pane", id: "pane-1" },
          panes: { "pane-1": { threadId: null } },
          focusedPaneId: "pane-1",
          boundPaneId: null,
        }),
      setItem: () => undefined,
      removeItem,
    });

    const layout = readLayout(PROJECT_ID, makeId);

    expect(removeItem).toHaveBeenCalledWith(layoutStorageKey(PROJECT_ID));
    expect(layout.root?.type).toBe("pane");
    expect(layout).not.toHaveProperty("docked");
  });

  it("migrates a v1 payload with a docked pane into v2: the docked pane is folded back into the tree with no pane lost, and the persisted shape carries no `docked` field", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          version: 1,
          root: { type: "pane", id: "pane-1" },
          panes: {
            "pane-1": { threadId: null },
            "pane-2": { threadId: null },
          },
          docked: ["pane-2"],
          focusedPaneId: "pane-1",
          boundPaneId: null,
        }),
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    const layout = readLayout(PROJECT_ID, makeId);

    expect(layout).not.toHaveProperty("docked");
    expect(Object.keys(layout.panes).sort()).toEqual(["pane-1", "pane-2"]);
    expect(tiledPaneIds(layout).sort()).toEqual(["pane-1", "pane-2"]);
    expect(layout.focusedPaneId).toBe("pane-2");
  });

  it("round-trips a v2 payload without migration or data loss", () => {
    const removeItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          version: 2,
          root: { type: "pane", id: "pane-1" },
          panes: { "pane-1": { threadId: null } },
          focusedPaneId: "pane-1",
          boundPaneId: null,
        }),
      setItem: () => undefined,
      removeItem,
    });

    const layout = readLayout(PROJECT_ID, makeId);

    expect(removeItem).not.toHaveBeenCalled();
    expect(layout).toEqual({
      root: { type: "pane", id: "pane-1" },
      panes: { "pane-1": { threadId: null } },
      focusedPaneId: "pane-1",
      boundPaneId: null,
    });
  });
});

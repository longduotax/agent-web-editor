// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectId } from "@pi-web/contracts";

import { tiledPaneIds } from "./layoutTree.js";
import type { WorkspaceLayout } from "./layoutTree.js";
import { useWorkspaceLayout } from "./useWorkspaceLayout.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const PROJECT_ID = "11111111-1111-1111-1111-111111111111" as ProjectId;

function stubStorage(): Map<string, string> {
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
  return store;
}

describe("useWorkspaceLayout", () => {
  it("splits the focused pane into two tiled panes and focuses the new one", () => {
    stubStorage();
    const { result } = renderHook(() => useWorkspaceLayout(PROJECT_ID));
    const originalPaneId = result.current.layout.focusedPaneId;

    act(() => {
      result.current.dispatch({ type: "split", axis: "row" });
    });

    const tiled = tiledPaneIds(result.current.layout);
    expect(tiled).toHaveLength(2);
    expect(result.current.layout.focusedPaneId).not.toBe(originalPaneId);
    expect(result.current.layout.focusedPaneId).not.toBeNull();
    expect(tiled).toContain(result.current.layout.focusedPaneId);
  });

  it("persists a split across unmount/remount for the same project", () => {
    stubStorage();
    const first = renderHook(() => useWorkspaceLayout(PROJECT_ID));

    act(() => {
      first.result.current.dispatch({ type: "split", axis: "row" });
    });
    expect(tiledPaneIds(first.result.current.layout)).toHaveLength(2);

    first.unmount();

    const second = renderHook(() => useWorkspaceLayout(PROJECT_ID));

    expect(tiledPaneIds(second.result.current.layout)).toHaveLength(2);
  });

  it("resizes a split addressed by its own id, normalizing the sizes to sum to 1", () => {
    stubStorage();
    const { result } = renderHook(() => useWorkspaceLayout(PROJECT_ID));

    act(() => {
      result.current.dispatch({ type: "split", axis: "row" });
    });
    const splitId =
      result.current.layout.root?.type === "split"
        ? result.current.layout.root.id
        : undefined;
    expect(splitId).not.toBeUndefined();

    act(() => {
      if (splitId !== undefined) result.current.resize(splitId, [0.2, 0.8]);
    });

    const { root } = result.current.layout;
    expect(root?.type).toBe("split");
    if (root?.type === "split") {
      const [a, b] = root.sizes;
      expect(a + b).toBeCloseTo(1);
      expect(a).toBeCloseTo(0.2);
      expect(b).toBeCloseTo(0.8);
    }
  });

  it("close(paneId) removes that specific pane, not the focused one", () => {
    stubStorage();
    const { result } = renderHook(() => useWorkspaceLayout(PROJECT_ID));
    const originalPaneId = result.current.layout.focusedPaneId;
    expect(originalPaneId).not.toBeNull();

    act(() => {
      result.current.dispatch({ type: "split", axis: "row" });
    });
    const newPaneId = result.current.layout.focusedPaneId;
    expect(newPaneId).not.toBe(originalPaneId);

    act(() => {
      if (originalPaneId !== null) result.current.close(originalPaneId);
    });

    expect(tiledPaneIds(result.current.layout)).not.toContain(originalPaneId);
    if (originalPaneId !== null)
      expect(result.current.layout.panes[originalPaneId]).toBeUndefined();
    expect(tiledPaneIds(result.current.layout)).toContain(newPaneId);
  });

  // Closing is the one layout change that can be followed by a navigation in
  // the same handler (the route must stop naming a pane that no longer
  // exists), and that navigation unmounts this hook before its persist effect
  // flushes. Measured in the browser before the fix: the emptied layout was
  // never written, so the view that mounted next re-read the pane that had
  // just been closed and put it straight back on screen.
  it("reports the layout the close produced and persists it without waiting for an effect", () => {
    const store = stubStorage();
    const { result } = renderHook(() => useWorkspaceLayout(PROJECT_ID));
    const onlyPaneId = result.current.layout.focusedPaneId;
    if (onlyPaneId === null) throw new Error("expected a seeded pane");

    let reported: WorkspaceLayout | undefined;
    let persistedInsideHandler: unknown;
    act(() => {
      reported = result.current.close(onlyPaneId);
      // Read INSIDE act(), before it flushes effects — otherwise the persist
      // effect would write it anyway and this would pass against a close that
      // relies on the effect, which is the arrangement that lost the write.
      persistedInsideHandler = JSON.parse(
        store.get(`pi-workspace:layout:${PROJECT_ID}`) ?? "null",
      );
    });

    expect(persistedInsideHandler).toMatchObject({
      root: null,
      focusedPaneId: null,
    });
    // The caller is told what the close produced rather than re-deriving it.
    expect(reported).toEqual(result.current.layout);
    expect(reported?.root).toBeNull();
    expect(reported?.focusedPaneId).toBeNull();
  });

  it("newPane() on an empty layout (after closing the only pane) creates one focused tiled pane", () => {
    stubStorage();
    const { result } = renderHook(() => useWorkspaceLayout(PROJECT_ID));
    const onlyPaneId = result.current.layout.focusedPaneId;
    expect(onlyPaneId).not.toBeNull();

    act(() => {
      if (onlyPaneId !== null) result.current.close(onlyPaneId);
    });
    expect(result.current.layout.root).toBeNull();
    expect(tiledPaneIds(result.current.layout)).toHaveLength(0);

    act(() => {
      result.current.newPane();
    });

    const tiled = tiledPaneIds(result.current.layout);
    expect(tiled).toHaveLength(1);
    expect(result.current.layout.focusedPaneId).not.toBeNull();
    expect(tiled).toContain(result.current.layout.focusedPaneId);
  });
});

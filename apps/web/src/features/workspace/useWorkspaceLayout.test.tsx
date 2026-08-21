// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectId } from "@pi-web/contracts";

import { tiledPaneIds } from "./layoutTree.js";
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

  it("moves the focused pane into the dock on collapse", () => {
    stubStorage();
    const { result } = renderHook(() => useWorkspaceLayout(PROJECT_ID));
    const focusedPaneId = result.current.layout.focusedPaneId;
    expect(focusedPaneId).not.toBeNull();

    act(() => {
      result.current.dispatch({ type: "collapse" });
    });

    expect(result.current.layout.docked).toContain(focusedPaneId);
    expect(tiledPaneIds(result.current.layout)).not.toContain(focusedPaneId);
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

  it("resizes the parent split of a pane, normalizing the sizes to sum to 1", () => {
    stubStorage();
    const { result } = renderHook(() => useWorkspaceLayout(PROJECT_ID));

    act(() => {
      result.current.dispatch({ type: "split", axis: "row" });
    });
    const paneId = result.current.layout.focusedPaneId;
    expect(paneId).not.toBeNull();

    act(() => {
      if (paneId !== null) result.current.resize(paneId, [0.2, 0.8]);
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

  it("collapse(paneId) docks that specific pane, not the focused one", () => {
    stubStorage();
    const { result } = renderHook(() => useWorkspaceLayout(PROJECT_ID));
    const originalPaneId = result.current.layout.focusedPaneId;
    expect(originalPaneId).not.toBeNull();

    act(() => {
      result.current.dispatch({ type: "split", axis: "row" });
    });
    // The split focuses the newly created pane; the original pane is now
    // unfocused but still tiled.
    const newPaneId = result.current.layout.focusedPaneId;
    expect(newPaneId).not.toBe(originalPaneId);
    expect(tiledPaneIds(result.current.layout)).toContain(originalPaneId);

    act(() => {
      if (originalPaneId !== null) result.current.collapse(originalPaneId);
    });

    expect(result.current.layout.docked).toContain(originalPaneId);
    expect(tiledPaneIds(result.current.layout)).not.toContain(originalPaneId);
    // The focused pane is untouched by targeting a different pane.
    expect(tiledPaneIds(result.current.layout)).toContain(newPaneId);
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
});

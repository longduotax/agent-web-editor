// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

import { leafIds } from "../layout/binaryTree.js";
import { PANEL_STATE_VERSION, PANEL_STORAGE_KEY } from "./panelStorage.js";
import type { TabContext } from "./panelTabs.js";
import { usePanelState } from "./usePanelState.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(seed?: [string, string][]): Map<string, string> {
  const store = new Map<string, string>(seed);
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

const context: TabContext = {
  projectId: "10000000-0000-4000-8000-000000000001" as ProjectId,
  threadId: "20000000-0000-4000-8000-000000000001" as ThreadId,
  scopeKey: "10000000-0000-4000-8000-000000000001",
  label: "Example project",
};

// The panel's chord group: Shift + primary + Alt.
function panelKey(key: string): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    shiftKey: true,
    ctrlKey: true,
    altKey: true,
    bubbles: true,
  });
}

describe("usePanelState", () => {
  it("opens on the default Changes tab and persists every change", () => {
    const store = stubStorage();
    const { result } = renderHook(() => usePanelState());

    expect(Object.values(result.current.state.tabs)).toHaveLength(1);
    expect(Object.values(result.current.state.tabs)[0]?.type).toBe("changes");
    expect(result.current.state.open).toBe(false);

    act(() => {
      result.current.actions.setOpen(true);
    });
    expect(JSON.parse(store.get(PANEL_STORAGE_KEY) ?? "")).toMatchObject({
      version: PANEL_STATE_VERSION,
      open: true,
    });
  });

  it("restores what was persisted", () => {
    const store = stubStorage();
    const first = renderHook(() => usePanelState());
    act(() => {
      first.result.current.actions.openTab({
        type: "files",
        context,
        search: "",
        expanded: [],
        showIgnored: false,
      });
    });
    first.unmount();
    expect(store.has(PANEL_STORAGE_KEY)).toBe(true);

    const second = renderHook(() => usePanelState());
    expect(Object.values(second.result.current.state.tabs)).toHaveLength(2);
  });

  // Every tab body is memoised on these, so an action object rebuilt each
  // render would re-render (and, for a query, re-subscribe) the whole panel
  // on every keystroke and every divider drag.
  it("keeps its action API referentially stable across state changes", () => {
    stubStorage();
    const { result } = renderHook(() => usePanelState());
    const actions = result.current.actions;

    act(() => {
      result.current.actions.setWidth(520);
    });

    expect(result.current.state.width).toBe(520);
    expect(result.current.actions).toBe(actions);
  });

  it("dispatches panel chords from the one bindings table", () => {
    stubStorage();
    const { result } = renderHook(() => usePanelState());
    expect(result.current.state.open).toBe(false);

    act(() => {
      window.dispatchEvent(panelKey(" "));
    });
    expect(result.current.state.open).toBe(true);

    act(() => {
      window.dispatchEvent(panelKey(" "));
    });
    expect(result.current.state.open).toBe(false);
  });

  it("asks the view for focus, and opens the panel so there is something to focus", () => {
    stubStorage();
    const { result } = renderHook(() => usePanelState());
    const before = result.current.focusRequest;

    act(() => {
      window.dispatchEvent(panelKey("Enter"));
    });

    expect(result.current.state.open).toBe(true);
    expect(result.current.focusRequest).toBeGreaterThan(before);
  });

  it("ignores chords typed into a text field", () => {
    stubStorage();
    const { result } = renderHook(() => usePanelState());
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    act(() => {
      input.dispatchEvent(panelKey(" "));
    });

    expect(result.current.state.open).toBe(false);
    input.remove();
  });

  it("splits a group from the keyboard", () => {
    stubStorage();
    const { result } = renderHook(() => usePanelState());
    act(() => {
      result.current.actions.openTab({
        type: "files",
        context,
        search: "",
        expanded: [],
        showIgnored: false,
      });
    });

    act(() => {
      window.dispatchEvent(panelKey("ArrowDown"));
    });

    expect(leafIds(result.current.state.root)).toHaveLength(2);
  });

  // D-1: a tab migrated from the v1 inspector record has no thread to carry,
  // because the shipped inspector never stored one. It binds to the focused
  // pane's thread once and is then fixed like any other tab.
  it("binds a context-less tab to the focused thread exactly once", () => {
    stubStorage();
    const { result } = renderHook(() => usePanelState());
    const tabId = Object.keys(result.current.state.tabs)[0] ?? "";
    expect(result.current.state.tabs[tabId]?.context).toBeNull();

    act(() => {
      result.current.actions.bindPendingContexts(context);
    });
    expect(result.current.state.tabs[tabId]?.context).toEqual(context);

    const bound = result.current.state;
    const other: TabContext = { ...context, scopeKey: "other", label: "Other" };
    act(() => {
      result.current.actions.bindPendingContexts(other);
    });
    // Nothing left to bind, so the state is not even rebuilt.
    expect(result.current.state).toBe(bound);
  });
});

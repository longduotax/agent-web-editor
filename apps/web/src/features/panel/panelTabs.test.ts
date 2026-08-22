import { describe, expect, it } from "vitest";
import type { ProjectId, TerminalId, ThreadId } from "@pi-web/contracts";

import {
  isEmbeddableAddress,
  sameTarget,
  tabNeedsThread,
  tabTitle,
} from "./panelTabs.js";
import type { PanelTab, TabContext } from "./panelTabs.js";

const PROJECT_A = "11111111-1111-1111-1111-111111111111" as ProjectId;
const PROJECT_B = "22222222-2222-2222-2222-222222222222" as ProjectId;
const THREAD_A = "aaaaaaaa-1111-1111-1111-111111111111" as ThreadId;
const THREAD_B = "bbbbbbbb-2222-2222-2222-222222222222" as ThreadId;

function context(overrides: Partial<TabContext> = {}): TabContext {
  return {
    projectId: PROJECT_A,
    threadId: THREAD_A,
    scopeKey: PROJECT_A,
    label: "main",
    ...overrides,
  };
}

describe("tabTitle", () => {
  it("names the fixed-purpose tabs", () => {
    const changes: PanelTab = { id: "t1", type: "changes", context: context() };
    const files: PanelTab = {
      id: "t2",
      type: "files",
      context: context(),
      search: "",
      expanded: [],
      showIgnored: false,
    };
    expect(tabTitle(changes)).toBe("Changes");
    expect(tabTitle(files)).toBe("Files");
  });

  it("uses the basename for file and diff tabs", () => {
    const file: PanelTab = {
      id: "t1",
      type: "file",
      context: context(),
      path: "apps/web/src/App.tsx",
      view: "preview",
    };
    const diff: PanelTab = {
      id: "t2",
      type: "diff",
      context: context(),
      path: "docs/product-specs/workspace-panel.md",
      collapsedHunks: [],
    };
    expect(tabTitle(file)).toBe("App.tsx");
    expect(tabTitle(diff)).toBe("workspace-panel.md");
  });

  it("keeps a bare filename and falls back for an empty path", () => {
    const bare: PanelTab = {
      id: "t1",
      type: "file",
      context: context(),
      path: "README.md",
      view: "source",
    };
    const empty: PanelTab = {
      id: "t2",
      type: "file",
      context: context(),
      path: "",
      view: "source",
    };
    expect(tabTitle(bare)).toBe("README.md");
    expect(tabTitle(empty)).toBe("Untitled");
  });

  it("uses the working directory's basename for a terminal tab", () => {
    const terminal: PanelTab = {
      id: "t1",
      type: "terminal",
      context: context(),
      cwd: "/Users/dev/projects/pi-web-app",
      terminalId: null,
    };
    expect(tabTitle(terminal)).toBe("pi-web-app");
  });

  it("ignores a trailing slash on a terminal's directory", () => {
    const terminal: PanelTab = {
      id: "t1",
      type: "terminal",
      context: context(),
      cwd: "/Users/dev/projects/pi-web-app/",
      terminalId: null,
    };
    expect(tabTitle(terminal)).toBe("pi-web-app");
  });

  it("falls back to Terminal for a root or unknown directory", () => {
    const root: PanelTab = {
      id: "t1",
      type: "terminal",
      context: context(),
      cwd: "/",
      terminalId: null,
    };
    const unknown: PanelTab = {
      id: "t2",
      type: "terminal",
      context: null,
      cwd: "",
      terminalId: null,
    };
    expect(tabTitle(root)).toBe("Terminal");
    expect(tabTitle(unknown)).toBe("Terminal");
  });

  it("uses the host, including its port, for a browser tab", () => {
    const local: PanelTab = {
      id: "t1",
      type: "browser",
      context: null,
      url: "http://localhost:5173/docs/index.html",
      history: [],
      historyIndex: -1,
    };
    expect(tabTitle(local)).toBe("localhost:5173");
  });

  it("falls back for an empty browser tab and shows an unparseable address as typed", () => {
    const blank: PanelTab = {
      id: "t1",
      type: "browser",
      context: null,
      url: "",
      history: [],
      historyIndex: -1,
    };
    const typo: PanelTab = {
      id: "t2",
      type: "browser",
      context: null,
      url: "localhost:517",
      history: [],
      historyIndex: -1,
    };
    expect(tabTitle(blank)).toBe("New tab");
    expect(tabTitle(typo)).toBe("localhost:517");
  });
});

describe("sameTarget", () => {
  it("is false across different tab types", () => {
    const changes: PanelTab = { id: "t1", type: "changes", context: context() };
    const files: PanelTab = {
      id: "t2",
      type: "files",
      context: context(),
      search: "",
      expanded: [],
      showIgnored: false,
    };
    expect(sameTarget(changes, files)).toBe(false);
  });

  // File and Diff are the interesting cross-type pair: they are the two
  // types that carry a path, so they are the two that a same-path
  // comparison could confuse. A Diff of `a.ts` and a File of `a.ts` show
  // different content and must never dedupe one another away.
  it("is false between a file tab and a diff tab on the same path", () => {
    const file: PanelTab = {
      id: "t1",
      type: "file",
      context: context(),
      path: "a.ts",
      view: "preview",
    };
    const diff: PanelTab = {
      id: "t2",
      type: "diff",
      context: context(),
      path: "a.ts",
      collapsedHunks: [],
    };
    expect(sameTarget(file, diff)).toBe(false);
    expect(sameTarget(diff, file)).toBe(false);
  });

  // "Addresses the same thing" is a relation between two tabs, not a
  // property of the first one: openTab compares a new tab against every open
  // one in whatever order the record happens to hold them.
  it("is symmetric across every pair of tab types", () => {
    const tabs: PanelTab[] = [
      { id: "t1", type: "changes", context: context() },
      { id: "t2", type: "changes", context: null },
      {
        id: "t3",
        type: "files",
        context: context(),
        search: "",
        expanded: [],
        showIgnored: false,
      },
      {
        id: "t4",
        type: "file",
        context: context(),
        path: "a.ts",
        view: "preview",
      },
      {
        id: "t5",
        type: "file",
        context: context(),
        path: "b.ts",
        view: "preview",
      },
      {
        id: "t6",
        type: "diff",
        context: context(),
        path: "a.ts",
        collapsedHunks: [],
      },
      {
        id: "t7",
        type: "terminal",
        context: context(),
        cwd: "/repo",
        terminalId: null,
      },
      {
        id: "t8",
        type: "browser",
        context: null,
        url: "http://localhost:5173/",
        history: [],
        historyIndex: -1,
      },
    ];
    for (const a of tabs)
      for (const b of tabs)
        expect([a.id, b.id, sameTarget(a, b)]).toEqual([
          a.id,
          b.id,
          sameTarget(b, a),
        ]);
  });

  it("matches two Changes tabs on the same execution scope", () => {
    const a: PanelTab = { id: "t1", type: "changes", context: context() };
    const b: PanelTab = { id: "t2", type: "changes", context: context() };
    expect(sameTarget(a, b)).toBe(true);
  });

  it("matches across threads that share one execution scope", () => {
    // Two shared threads of one project read the same worktree, so their
    // Changes tabs would render byte-identical content.
    const a: PanelTab = { id: "t1", type: "changes", context: context() };
    const b: PanelTab = {
      id: "t2",
      type: "changes",
      context: context({ threadId: THREAD_B, label: "other" }),
    };
    expect(sameTarget(a, b)).toBe(true);
  });

  it("separates isolated worktrees of the same project", () => {
    const a: PanelTab = {
      id: "t1",
      type: "changes",
      context: context({ scopeKey: "worktree-1" }),
    };
    const b: PanelTab = {
      id: "t2",
      type: "changes",
      context: context({ scopeKey: "worktree-2" }),
    };
    expect(sameTarget(a, b)).toBe(false);
  });

  it("separates identical scope keys from different projects", () => {
    const a: PanelTab = {
      id: "t1",
      type: "changes",
      context: context({ scopeKey: "scope" }),
    };
    const b: PanelTab = {
      id: "t2",
      type: "changes",
      context: context({ projectId: PROJECT_B, scopeKey: "scope" }),
    };
    expect(sameTarget(a, b)).toBe(false);
  });

  it("matches file and diff tabs only when the path also matches", () => {
    const file = (id: string, path: string): PanelTab => ({
      id,
      type: "file",
      context: context(),
      path,
      view: "preview",
    });
    expect(sameTarget(file("t1", "a.ts"), file("t2", "a.ts"))).toBe(true);
    expect(sameTarget(file("t1", "a.ts"), file("t2", "b.ts"))).toBe(false);

    const diff = (id: string, path: string): PanelTab => ({
      id,
      type: "diff",
      context: context(),
      path,
      collapsedHunks: [],
    });
    expect(sameTarget(diff("t1", "a.ts"), diff("t2", "a.ts"))).toBe(true);
    expect(sameTarget(diff("t1", "a.ts"), diff("t2", "b.ts"))).toBe(false);
  });

  it("ignores per-tab view state when matching", () => {
    const preview: PanelTab = {
      id: "t1",
      type: "file",
      context: context(),
      path: "a.md",
      view: "preview",
    };
    const source: PanelTab = {
      id: "t2",
      type: "file",
      context: context(),
      path: "a.md",
      view: "source",
    };
    expect(sameTarget(preview, source)).toBe(true);
  });

  it("never matches terminal tabs, because opening one means another shell", () => {
    const terminal = (id: string): PanelTab => ({
      id,
      type: "terminal",
      context: context(),
      cwd: "/repo",
      terminalId: null,
    });
    expect(sameTarget(terminal("t1"), terminal("t2"))).toBe(false);
    // Not even against itself: nothing may dedupe a terminal away.
    expect(sameTarget(terminal("t1"), terminal("t1"))).toBe(false);
  });

  it("never matches browser tabs, even at the same address", () => {
    const browser = (id: string): PanelTab => ({
      id,
      type: "browser",
      context: null,
      url: "http://localhost:5173/",
      history: ["http://localhost:5173/"],
      historyIndex: 0,
    });
    expect(sameTarget(browser("t1"), browser("t2"))).toBe(false);
  });

  it("never matches a tab whose context was not recovered", () => {
    // A migrated tab carries a null context until the UI binds it to the
    // focused pane. An unknown scope cannot be proven equal to anything, so
    // it must not dedupe a real request away.
    const orphan: PanelTab = { id: "t1", type: "changes", context: null };
    const bound: PanelTab = { id: "t2", type: "changes", context: context() };
    const otherOrphan: PanelTab = { id: "t3", type: "changes", context: null };
    expect(sameTarget(orphan, bound)).toBe(false);
    expect(sameTarget(orphan, otherOrphan)).toBe(false);
  });

  it("accepts an id-less tab, so a tab can be deduped before it is created", () => {
    const existing: PanelTab = {
      id: "t1",
      type: "changes",
      context: context(),
    };
    expect(sameTarget({ type: "changes", context: context() }, existing)).toBe(
      true,
    );
  });

  it("keeps a live terminal id out of matching entirely", () => {
    const live: PanelTab = {
      id: "t1",
      type: "terminal",
      context: context(),
      cwd: "/repo",
      terminalId: "cccccccc-3333-3333-3333-333333333333" as TerminalId,
    };
    const dead: PanelTab = { ...live, id: "t2", terminalId: null };
    expect(sameTarget(live, dead)).toBe(false);
  });
});

// WSP-08: the Browser tab accepts any `http` or `https` address and nothing
// else. This is the check the address field and the persisted record share,
// so an address that could never be typed cannot be restored either.
describe("isEmbeddableAddress", () => {
  it.each(["http://localhost:5173/", "https://example.com/docs?a=1#b"])(
    "accepts %s",
    (address) => {
      expect(isEmbeddableAddress(address)).toBe(true);
    },
  );

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "about:blank",
    "ftp://example.com/",
    "localhost:5173",
    "",
    "   ",
  ])("refuses %s", (address) => {
    expect(isEmbeddableAddress(address)).toBe(false);
  });
});

// WSP-02: with no chat pane owning a thread, the + menu offers only the tab
// types that read no worktree, and says why the rest are unavailable. The
// menu asks this rather than carrying a list of its own.
describe("tabNeedsThread", () => {
  it("is true for every tab type that reads a working tree", () => {
    for (const type of [
      "changes",
      "files",
      "file",
      "diff",
      "terminal",
    ] as const)
      expect(tabNeedsThread(type)).toBe(true);
  });

  it("is false for a browser tab, which reads no working tree", () => {
    expect(tabNeedsThread("browser")).toBe(false);
  });
});

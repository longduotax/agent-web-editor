# Tiling workspace surface implementation plan

**Status:** Active

**Plan version:** 1

**Technical approval:** Approved for plan version 1 on 2026-08-21 (user authorised implementation via the subagent-driven approach)

**Subsystem:** Browser workspace composition — pane tiling, dock, keybindings, and device-local layout persistence

**Affected paths or contracts:** `apps/web/src/features/workspace/**`, `apps/web/src/App.tsx`, `apps/web/src/main.tsx`, `apps/web/src/styles.css`, `apps/web/src/api/client.ts` (consume only), focused Vitest and Playwright tests, and current web component documentation

**Governing specification:** [Multi-agent tiling workspace design](../../design/multi-agent-tiling-workspace.md)

**Related documents or issue:** [Web workspace composition](../../design/web-workspace-composition.md), [Architecture overview](../../architecture/overview.md), [Thread workspaces](../../product-specs/thread-workspaces.md)

**Last updated:** 2026-08-21

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-selected-thread project view with a terminal-style tiling surface where every thread of a project is a pane the user can split, collapse to a bottom dock, restore, focus, and close — persisting layout device-locally and surfacing a blue attention dot on docked panes that have settled unread work.

**Architecture:** A pure, framework-free binary tiling-tree model with a reducer-style API drives all layout state (split/collapse/restore/close/focus/bind/resize). A device-local versioned localStorage layer persists one layout per project, following the existing `inspectorPreferences` parse-or-discard pattern. React `features/workspace` components render the tree as nested split panes, mount the existing thread rendering inside tiled panes, and show docked panes as chips. A keybinding layer maps the approved shortcuts onto model actions. This phase reuses the existing thread APIs (`startThread`, `archiveThread`, `getSnapshot`) and does not change the server, agents, worktrees, or theming.

**Tech Stack:** TypeScript, React 19, React Router, TanStack Query, Zod (`@pi-web/contracts`), Vitest + React Testing Library + `@testing-library/user-event` + axe-core, Playwright.

**Spec:** [Multi-agent tiling workspace design](../../design/multi-agent-tiling-workspace.md) — this plan implements Sections 1, 2, and the layout portions of 7; agent backends (§4), worktree forking (§3.3), the right panel/git-log (§5), theming (§6), and the server status projection (§7) are later phases.

## Global Constraints

- Node >= 22.19.0; pnpm 11.1.2; ESM only (`"type": "module"`); import specifiers end in `.js` for local modules, matching the repo.
- Every HTTP/WS payload is parsed with `@pi-web/contracts` schemas; never trust `response.json()` through a cast.
- Layout, dock, focus, and binding are **device-local view preferences** in versioned localStorage keyed by project id; malformed or unknown-version values are discarded explicitly. Selection, unread, run state, and transcripts are never sourced from localStorage.
- Status is never conveyed by colour alone: the attention dot always carries an accessible label.
- Honour `prefers-reduced-motion` for any collapse/restore transition.
- Closing a pane archives its thread (metadata-only, non-destructive); it never deletes a thread or Pi history.
- A thread is created with its first prompt via `startThread`; a freshly split pane is a **new-chat pane** (no thread) until its first prompt resolves.
- Tests query by role/name/state, not class names. Commit after every green step.

---

### Task 1: Layout tree model

**Files:**

- Create: `apps/web/src/features/workspace/layoutTree.ts`
- Test: `apps/web/src/features/workspace/layoutTree.test.ts`

**Interfaces:**

- Consumes: `ThreadId` from `@pi-web/contracts`.
- Produces:

```ts
export type PaneId = string;
export type SplitAxis = "row" | "column"; // row = split right; column = split down
export type FocusDirection = "left" | "right" | "up" | "down";

export interface PaneNode {
  type: "pane";
  id: PaneId;
}
export interface SplitNode {
  type: "split";
  axis: SplitAxis;
  children: [LayoutNode, LayoutNode];
  sizes: [number, number]; // fractions in (0,1) summing to 1
}
export type LayoutNode = PaneNode | SplitNode;

export interface WorkspaceLayout {
  root: LayoutNode | null; // null = no tiled panes
  panes: Record<PaneId, { threadId: ThreadId | null }>; // all panes, tiled + docked
  docked: PaneId[]; // dock order, index 0 = most recently docked
  focusedPaneId: PaneId | null;
  boundPaneId: PaneId | null; // right-panel binding (carried; used in a later phase)
}

export function createInitialLayout(makeId: () => PaneId): WorkspaceLayout;
export function splitPane(
  l: WorkspaceLayout,
  target: PaneId,
  axis: SplitAxis,
  makeId: () => PaneId,
): WorkspaceLayout;
export function closePane(l: WorkspaceLayout, id: PaneId): WorkspaceLayout;
export function collapsePane(l: WorkspaceLayout, id: PaneId): WorkspaceLayout;
export function restorePane(l: WorkspaceLayout, id: PaneId): WorkspaceLayout;
export function assignThread(
  l: WorkspaceLayout,
  id: PaneId,
  threadId: ThreadId,
): WorkspaceLayout;
export function focusPane(l: WorkspaceLayout, id: PaneId): WorkspaceLayout;
export function moveFocus(
  l: WorkspaceLayout,
  dir: FocusDirection,
): WorkspaceLayout;
export function bindPane(l: WorkspaceLayout, id: PaneId): WorkspaceLayout;
export function tiledPaneIds(l: WorkspaceLayout): PaneId[]; // in-order leaves
```

Notes for the implementer:

- All functions are **pure**: they return a new `WorkspaceLayout` and never mutate the input or read a clock/RNG. Id creation is injected via `makeId` so tests are deterministic.
- `splitPane` replaces the target `PaneNode` with a `SplitNode { axis, children: [target, newPane], sizes: [0.5, 0.5] }`, adds the new pane to `panes` with `threadId: null`, and focuses the new pane.
- `collapsePane` and `closePane` both remove the pane from the tree and, when its parent split loses a child, replace that split with the surviving sibling. `collapsePane` keeps the pane in `panes` and unshifts it onto `docked`; `closePane` deletes it from `panes` and `docked`. Both refocus: the previously-focused pane if it still exists, else the first `tiledPaneIds`, else `null`. If the removed pane was `boundPaneId`, clear the binding.
- `restorePane` removes the id from `docked` and re-inserts it by splitting the currently focused tiled pane along `"row"`; if there is no tiled pane (`root === null`) it becomes the root. It focuses the restored pane.
- `moveFocus` uses in-order leaf order from `tiledPaneIds`: `"left"`/`"up"` → previous leaf, `"right"`/`"down"` → next leaf, cyclic; no-op when fewer than two tiled panes. (Geometric adjacency is a later refinement; note this in a code comment.)

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/src/features/workspace/layoutTree.test.ts
import { describe, expect, it } from "vitest";
import type { ThreadId } from "@pi-web/contracts";
import {
  assignThread,
  closePane,
  collapsePane,
  createInitialLayout,
  moveFocus,
  restorePane,
  splitPane,
  tiledPaneIds,
} from "./layoutTree.js";

const ids = () => {
  let n = 0;
  return () => `pane-${++n}`;
};

describe("layoutTree", () => {
  it("starts with one focused, threadless pane", () => {
    const l = createInitialLayout(ids());
    expect(tiledPaneIds(l)).toEqual(["pane-1"]);
    expect(l.focusedPaneId).toBe("pane-1");
    expect(l.panes["pane-1"].threadId).toBeNull();
    expect(l.docked).toEqual([]);
  });

  it("splits right into a focused new pane", () => {
    const make = ids();
    let l = createInitialLayout(make);
    l = splitPane(l, "pane-1", "row", make);
    expect(l.root?.type).toBe("split");
    expect(tiledPaneIds(l)).toEqual(["pane-1", "pane-2"]);
    expect(l.focusedPaneId).toBe("pane-2");
  });

  it("collapses to the dock and restores back into the tree", () => {
    const make = ids();
    let l = createInitialLayout(make);
    l = splitPane(l, "pane-1", "row", make); // pane-2 focused
    l = collapsePane(l, "pane-2");
    expect(l.docked).toEqual(["pane-2"]);
    expect(tiledPaneIds(l)).toEqual(["pane-1"]);
    expect(l.panes["pane-2"]).toBeDefined();
    l = restorePane(l, "pane-2");
    expect(l.docked).toEqual([]);
    expect(tiledPaneIds(l)).toContain("pane-2");
    expect(l.focusedPaneId).toBe("pane-2");
  });

  it("closing a pane collapses its parent split and forgets it", () => {
    const make = ids();
    let l = createInitialLayout(make);
    l = splitPane(l, "pane-1", "column", make);
    l = closePane(l, "pane-2");
    expect(l.root).toEqual({ type: "pane", id: "pane-1" });
    expect(l.panes["pane-2"]).toBeUndefined();
    expect(l.focusedPaneId).toBe("pane-1");
  });

  it("assigns a thread id to a pane", () => {
    const l = assignThread(
      createInitialLayout(ids()),
      "pane-1",
      "t1" as ThreadId,
    );
    expect(l.panes["pane-1"].threadId).toBe("t1");
  });

  it("moves focus cyclically across tiled panes", () => {
    const make = ids();
    let l = createInitialLayout(make);
    l = splitPane(l, "pane-1", "row", make); // panes 1,2 ; focus 2
    l = moveFocus(l, "right");
    expect(l.focusedPaneId).toBe("pane-1"); // cyclic wrap
    l = moveFocus(l, "left");
    expect(l.focusedPaneId).toBe("pane-2");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/layoutTree.test.ts`
Expected: FAIL (module not found / functions undefined).

- [ ] **Step 3: Implement `layoutTree.ts`**

Implement the interface above as pure functions. Sketch of the tree-editing helpers the public functions build on:

```ts
function replaceNode(
  node: LayoutNode,
  targetId: PaneId,
  make: (p: PaneNode) => LayoutNode,
): LayoutNode {
  if (node.type === "pane") return node.id === targetId ? make(node) : node;
  const children = node.children.map((c) => replaceNode(c, targetId, make)) as [
    LayoutNode,
    LayoutNode,
  ];
  return { ...node, children };
}

function removeLeaf(node: LayoutNode, id: PaneId): LayoutNode | null {
  if (node.type === "pane") return node.id === id ? null : node;
  const [a, b] = node.children;
  const na = removeLeaf(a, id);
  const nb = removeLeaf(b, id);
  if (na === null) return nb; // surviving sibling replaces the split
  if (nb === null) return na;
  return { ...node, children: [na, nb] };
}
```

Keep every export referentially honest (return fresh objects). Add the geometric-adjacency comment on `moveFocus`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/layoutTree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/layoutTree.ts apps/web/src/features/workspace/layoutTree.test.ts
git commit -m "feat(web): add pure tiling layout tree model"
```

---

### Task 2: Device-local layout persistence

**Files:**

- Create: `apps/web/src/features/workspace/layoutStorage.ts`
- Test: `apps/web/src/features/workspace/layoutStorage.test.ts`

**Interfaces:**

- Consumes: `WorkspaceLayout`, `LayoutNode` from `./layoutTree.js`; `ProjectId` from `@pi-web/contracts`.
- Produces:

```ts
export const WORKSPACE_LAYOUT_VERSION = 1;
export function layoutStorageKey(projectId: ProjectId): string; // `pi-workspace:layout:${projectId}`
export function readLayout(
  projectId: ProjectId,
  makeId: () => PaneId,
): WorkspaceLayout; // stored or fresh initial
export function writeLayout(
  projectId: ProjectId,
  layout: WorkspaceLayout,
): void;
```

Follow `inspectorPreferences.ts` exactly for the storage-access guard, JSON parse guard, `safeParse`, and remove-on-malformed behaviour. Define a Zod `WorkspaceLayoutSchema` (a recursive `LayoutNode` schema via `z.lazy`, plus the `{ version: z.literal(1), ... }` wrapper). On any miss/malformed/wrong-version value, return `createInitialLayout(makeId)`.

- [ ] **Step 1: Write failing tests** covering: fresh project returns an initial one-pane layout; a written layout round-trips; a malformed JSON string is discarded and removed; an unknown `version` is discarded. Use a fake storage object injected via `globalThis.localStorage` (mirror the approach in `inspectorPreferences.test.ts`).

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/layoutStorage.test.ts`

- [ ] **Step 3: Implement `layoutStorage.ts`** using the `inspectorPreferences.ts` structure verbatim for storage handling, with `WorkspaceLayoutSchema`.

- [ ] **Step 4: Run and verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/layoutStorage.ts apps/web/src/features/workspace/layoutStorage.test.ts
git commit -m "feat(web): persist workspace layout per project device-locally"
```

---

### Task 3: Attention rule for the dock

**Files:**

- Create: `apps/web/src/features/workspace/attention.ts`
- Test: `apps/web/src/features/workspace/attention.test.ts`

**Interfaces:**

- Consumes: `RunState` from `@pi-web/contracts`.
- Produces:

```ts
export interface AttentionInput {
  runState: RunState | null;
  unread: boolean;
}
// True when a run has settled (completed | failed | interrupted) and is unread:
// the two situations the spec calls "needs input or done".
export function needsAttention(input: AttentionInput): boolean;
```

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { needsAttention } from "./attention.js";

describe("needsAttention", () => {
  it("flags settled unread runs", () => {
    expect(needsAttention({ runState: "completed", unread: true })).toBe(true);
    expect(needsAttention({ runState: "failed", unread: true })).toBe(true);
    expect(needsAttention({ runState: "interrupted", unread: true })).toBe(
      true,
    );
  });
  it("ignores running, read, or absent runs", () => {
    expect(needsAttention({ runState: "running", unread: true })).toBe(false);
    expect(needsAttention({ runState: "completed", unread: false })).toBe(
      false,
    );
    expect(needsAttention({ runState: null, unread: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/attention.test.ts`

- [ ] **Step 3: Implement**

```ts
import type { RunState } from "@pi-web/contracts";
export interface AttentionInput {
  runState: RunState | null;
  unread: boolean;
}
export function needsAttention({ runState, unread }: AttentionInput): boolean {
  return unread && runState !== null && runState !== "running";
}
```

- [ ] **Step 4: Run and verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/attention.ts apps/web/src/features/workspace/attention.test.ts
git commit -m "feat(web): derive dock attention from settled unread runs"
```

---

### Task 4: Keybinding resolver

**Files:**

- Create: `apps/web/src/features/workspace/keybindings.ts`
- Test: `apps/web/src/features/workspace/keybindings.test.ts`

**Interfaces:**

- Produces:

```ts
export type WorkspaceCommand =
  | { type: "split"; axis: SplitAxis }
  | { type: "collapse" }
  | { type: "restore" }
  | { type: "close" }
  | { type: "focus"; direction: FocusDirection }
  | { type: "bind" };

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}
export interface Platform {
  isMac: boolean;
}
// Returns the command a key event maps to, or null. macOS uses Cmd (metaKey);
// other platforms use Alt (altKey) for the primary modifier.
export function resolveCommand(
  e: KeyEventLike,
  p: Platform,
): WorkspaceCommand | null;
export function detectPlatform(nav?: { platform?: string }): Platform;
```

Mapping (primary = Cmd on mac, Alt elsewhere):

| Event                                             | Command                             |
| ------------------------------------------------- | ----------------------------------- |
| Shift + primary + `=`                             | `{ type: "split", axis: "row" }`    |
| Shift + primary + `-`                             | `{ type: "split", axis: "column" }` |
| Shift + primary + `ArrowDown`                     | `{ type: "collapse" }`              |
| Shift + primary + `ArrowUp`                       | `{ type: "restore" }`               |
| Shift + primary + `Backspace`                     | `{ type: "close" }`                 |
| (mac) Meta+Alt+Arrow / (other) Ctrl+Alt+Arrow     | `{ type: "focus", direction }`      |
| (mac) Meta+Alt+`Enter` / (other) Ctrl+Alt+`Enter` | `{ type: "bind" }`                  |

- [ ] **Step 1: Write failing tests** asserting each row for both platforms (build `KeyEventLike` literals), plus that unmapped events and events missing Shift return `null`. Focus-move on mac uses `{ metaKey: true, altKey: true }`; on other platforms `{ ctrlKey: true, altKey: true }` with `key: "ArrowLeft"` → `{ type: "focus", direction: "left" }`.

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/keybindings.test.ts`

- [ ] **Step 3: Implement** `resolveCommand` and `detectPlatform` (`isMac = /mac/i.test(nav?.platform ?? "")`). Import `SplitAxis`/`FocusDirection` from `./layoutTree.js`.

- [ ] **Step 4: Run and verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/keybindings.ts apps/web/src/features/workspace/keybindings.test.ts
git commit -m "feat(web): map approved workspace shortcuts to commands"
```

---

### Task 5: `useWorkspaceLayout` hook (state + persistence + commands)

**Files:**

- Create: `apps/web/src/features/workspace/useWorkspaceLayout.ts`
- Test: `apps/web/src/features/workspace/useWorkspaceLayout.test.tsx`

**Interfaces:**

- Consumes: everything from Tasks 1, 2, 4; `ProjectId`, `ThreadId`.
- Produces:

```ts
export interface WorkspaceLayoutController {
  layout: WorkspaceLayout;
  dispatch(command: WorkspaceCommand): void;
  assignThreadToPane(paneId: PaneId, threadId: ThreadId): void;
  focus(paneId: PaneId): void;
  restore(paneId: PaneId): void;
  bind(paneId: PaneId): void;
  resize(paneId: PaneId, sizes: [number, number]): void; // divider drag on that pane's parent split
}
export function useWorkspaceLayout(
  projectId: ProjectId,
): WorkspaceLayoutController;
```

Behaviour: initialise from `readLayout(projectId, makeId)` where `makeId = () => \`pane-${crypto.randomUUID()}\``; apply each command through the Task 1 functions against the currently focused pane (split/collapse/close/bind operate on `layout.focusedPaneId`; restore acts on the most-recently-docked pane); persist with `writeLayout`in an effect whenever`layout`changes.`dispatch({type:"restore"})`restores`docked[0]`.

- [ ] **Step 1: Write failing test** with React Testing Library `renderHook`: dispatching `{type:"split",axis:"row"}` grows `tiledPaneIds` to 2 and focuses the new pane; `{type:"collapse"}` moves the focused pane to `docked`; re-mounting the hook for the same `projectId` restores the persisted layout from the fake storage.

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/useWorkspaceLayout.test.tsx`

- [ ] **Step 3: Implement** the hook with `useState<WorkspaceLayout>`, a stable `makeId`, a `useEffect` persistence sync, and a `dispatch` switch mapping commands to Task 1 functions.

- [ ] **Step 4: Run and verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/useWorkspaceLayout.ts apps/web/src/features/workspace/useWorkspaceLayout.test.tsx
git commit -m "feat(web): workspace layout controller hook with persistence"
```

---

### Task 6: Extract `ThreadPane` and `NewChatPane` from `App.tsx`

**Files:**

- Create: `apps/web/src/features/workspace/ThreadPane.tsx`
- Create: `apps/web/src/features/workspace/NewChatPane.tsx`
- Modify: `apps/web/src/App.tsx` (extract the existing selected-thread center column and the existing `/new` first-prompt flow into these components; import them back)
- Test: `apps/web/src/features/workspace/ThreadPane.test.tsx`

**Interfaces:**

- Produces:

```ts
export interface ThreadPaneProps {
  projectId: ProjectId;
  threadId: ThreadId;
  focused: boolean;
  onFocus(): void;
  onCollapse(): void;
  onClose(): void; // caller archives the thread
  onBind(): void;
}
export function ThreadPane(props: ThreadPaneProps): JSX.Element;

export interface NewChatPaneProps {
  projectId: ProjectId;
  focused: boolean;
  onFocus(): void;
  onClose(): void;
  // called after startThread resolves so the caller can assignThreadToPane
  onThreadStarted(threadId: ThreadId): void;
}
export function NewChatPane(props: NewChatPaneProps): JSX.Element;
```

Reuse, do not rewrite, the existing rendering: `ThreadPane` wraps the current transcript + `Activity` + composer + steering/stop UI that `App.tsx` renders for a selected thread (move that JSX and its hooks into the component, parameterised by `projectId`/`threadId`). `NewChatPane` wraps the existing `/new` toolbar (project/location/start-state/branch) and first-prompt composer; on submit it calls `startThread(projectId, prompt, { mode: "worktree", baseBranch, sourceChanges: "none" }, commandId())` — the clean-worktree default — then `onThreadStarted(response.thread.id)`. Each pane renders a title bar with focus, collapse, close, and bind controls (icon buttons with accessible names). Clicking anywhere in the pane calls `onFocus`.

- [ ] **Step 1: Write failing test** — render `ThreadPane` with an injected typed client/query wrapper (follow `App.test.tsx` setup), assert the transcript region and composer render, and that the title-bar "Collapse" / "Close" buttons (by accessible name) invoke `onCollapse` / `onClose`.

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/ThreadPane.test.tsx`

- [ ] **Step 3: Implement** by extracting existing JSX/hooks from `App.tsx` into the two components and re-importing them where `App.tsx` currently renders the selected thread and the `/new` view. Keep `App.tsx` behaviour unchanged at this step (it still renders one pane); this task is a pure refactor that isolates the reusable pane.

- [ ] **Step 4: Run and verify PASS**, and run the existing suite to prove no regression.
      Run: `pnpm --filter @pi-web/web exec vitest run`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/ThreadPane.tsx apps/web/src/features/workspace/NewChatPane.tsx apps/web/src/App.tsx apps/web/src/features/workspace/ThreadPane.test.tsx
git commit -m "refactor(web): extract ThreadPane and NewChatPane from App"
```

---

### Task 7: `TilingSurface` renderer with resizable splits

**Files:**

- Create: `apps/web/src/features/workspace/TilingSurface.tsx`
- Create: `apps/web/src/features/workspace/tiling.css` (or extend `styles.css`)
- Test: `apps/web/src/features/workspace/TilingSurface.test.tsx`

**Interfaces:**

- Consumes: `WorkspaceLayout`, `LayoutNode`, `ThreadPane`, `NewChatPane`, `WorkspaceLayoutController`.
- Produces:

```ts
export interface TilingSurfaceProps {
  projectId: ProjectId;
  controller: WorkspaceLayoutController;
  onClosePane(paneId: PaneId, threadId: ThreadId | null): void; // caller archives if threadId set
}
export function TilingSurface(props: TilingSurfaceProps): JSX.Element;
```

Render `controller.layout.root` recursively: a `SplitNode` becomes a flex container (`flex-direction: row|column` from `axis`) with two child regions sized by `sizes` and a draggable divider between them (pointer + keyboard resize within min fractions, mirroring the inspector resizer semantics); a `PaneNode` renders `ThreadPane` when `panes[id].threadId` is set, else `NewChatPane`, wiring focus/collapse/close/bind to the controller and `onClosePane`. The focused pane gets an accessible focused treatment (visible outline + `aria-current`). `root === null` renders an empty-state that offers a first pane.

- [ ] **Step 1: Write failing test** — with a controller seeded to two tiled panes (one threaded via a stubbed snapshot, one new-chat), assert both panes render, the split container exposes the two regions, the divider has a slider role with min/max, and keyboard resize adjusts `sizes`.

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/TilingSurface.test.tsx`

- [ ] **Step 3: Implement** the recursive renderer and divider. Reuse the existing inspector resizer pattern/utilities where present.

- [ ] **Step 4: Run and verify PASS**, plus an axe check on the rendered surface.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/TilingSurface.tsx apps/web/src/features/workspace/tiling.css apps/web/src/features/workspace/TilingSurface.test.tsx
git commit -m "feat(web): render resizable tiling surface from layout tree"
```

---

### Task 8: `Dock` with attention dots

**Files:**

- Create: `apps/web/src/features/workspace/Dock.tsx`
- Test: `apps/web/src/features/workspace/Dock.test.tsx`

**Interfaces:**

- Consumes: `needsAttention` (Task 3); `WorkspaceLayoutController`; per-pane thread summary (`runState`, `unread`, `title`) via the existing thread-summary/snapshot query — docked panes do **not** mount transcript or terminal.
- Produces:

```ts
export interface DockProps {
  projectId: ProjectId;
  controller: WorkspaceLayoutController;
}
export function DockRow(props: DockProps): JSX.Element; // renders one chip per controller.layout.docked entry
```

Each chip shows the thread title (or "New chat" for a threadless docked pane), a click target that calls `controller.restore(paneId)`, and a blue attention dot when `needsAttention({ runState, unread })` is true for its thread. The dot is a small visual element paired with visually-hidden text like "needs attention" so status is not colour-only. Threadless docked panes never show a dot.

- [ ] **Step 1: Write failing test** — seed a controller with one docked threaded pane whose stubbed summary is `{ runState: "completed", unread: true }` and one that is `{ runState: "running", unread: true }`; assert the first chip exposes an accessible "needs attention" indicator and the second does not; clicking a chip calls restore (assert via `tiledPaneIds` growth or a spy).

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/Dock.test.tsx`

- [ ] **Step 3: Implement** `DockRow`, querying each docked pane's thread summary (reuse the existing snapshot/summary query keyed by threadId; select only `runState`/`unread`/`title`).

- [ ] **Step 4: Run and verify PASS** (+ axe check).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/Dock.tsx apps/web/src/features/workspace/Dock.test.tsx
git commit -m "feat(web): dock chips with settled-unread attention dots"
```

---

### Task 9: Wire the project route to the workspace + keybindings + deep-link focus

**Files:**

- Create: `apps/web/src/features/workspace/WorkspaceView.tsx`
- Modify: `apps/web/src/App.tsx` (project route renders `WorkspaceView`; sidebar reduced to a project switcher), `apps/web/src/styles.css`
- Test: `apps/web/src/features/workspace/WorkspaceView.test.tsx`

**Interfaces:**

- Consumes: `useWorkspaceLayout`, `TilingSurface`, `DockRow`, `resolveCommand`, `detectPlatform`, `archiveThread`, `startThread`, and the route params.
- Produces:

```ts
export function WorkspaceView(props: { projectId: ProjectId }): JSX.Element;
```

`WorkspaceView` builds the controller with `useWorkspaceLayout(projectId)`, renders `TilingSurface` over `DockRow`, and installs one `keydown` listener that runs `resolveCommand`; on a match it calls `preventDefault()` and `controller.dispatch(command)`. `onClosePane` archives the thread (`archiveThread(projectId, threadId)`) when present, then dispatches `close`. When the route is `/projects/:projectId/threads/:threadId`, on mount it ensures a pane exists for `threadId` (focus it, restoring from dock if collapsed; if absent, adopt it into a pane) so deep links and existing links keep working. On first load with no persisted panes, seed one `NewChatPane`.

- [ ] **Step 1: Write failing tests** — (a) pressing the split-right chord (dispatch a `keydown` with mac/other modifiers) adds a pane and the browser default is prevented; (b) closing a threaded pane calls `archiveThread`; (c) navigating to a `threadId` route focuses/creates its pane. Use the two-context/route testing patterns already in `App.test.tsx`.

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/WorkspaceView.test.tsx`

- [ ] **Step 3: Implement** `WorkspaceView`, mount it from the project route in `App.tsx`, and reduce the old thread sidebar to a project switcher (keep project add/remove/browse; drop per-thread selection list).

- [ ] **Step 4: Run and verify PASS**, then the full web unit suite.
      Run: `pnpm --filter @pi-web/web exec vitest run`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/WorkspaceView.tsx apps/web/src/App.tsx apps/web/src/styles.css apps/web/src/features/workspace/WorkspaceView.test.tsx
git commit -m "feat(web): mount tiling workspace on the project route"
```

---

### Task 10: End-to-end coverage and documentation

**Files:**

- Create: `e2e/workspace-tiling.spec.ts`
- Modify: `apps/web/README.md` (document the workspace/dock/keybindings), `docs/design/web-workspace-composition.md` (note the tiling surface replaces single-thread selection), `docs/exec-plans/active/index.md` (progress)

- [ ] **Step 1: Write failing Playwright spec** — register/open a project, split right (chord), type a first prompt in the new pane to start a thread, collapse it to the dock, assert a dock chip appears, restore it, and close a pane. Assert no horizontal page scroll. Follow `playwright.config.ts` and existing e2e patterns.

- [ ] **Step 2: Run and verify FAIL (or red where features are exercised).**
      Run: `pnpm test:e2e --grep workspace-tiling`

- [ ] **Step 3: Make it pass**; update the two docs and the active-plan index progress note. Keep links relative so `docs:check` passes.

- [ ] **Step 4: Full verification.**
      Run: `pnpm check`
      Expected: format, lint, typecheck, unit, build, docs all PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/workspace-tiling.spec.ts apps/web/README.md docs/design/web-workspace-composition.md docs/exec-plans/active/index.md
git commit -m "test(web): e2e tiling workspace and document the surface"
```

---

## Self-review

- **Spec coverage:** §1 tiling surface → Tasks 6–9; §2 split → Tasks 1/4/9, collapse+dock → Tasks 1/8, attention dot → Tasks 3/8, keybindings → Tasks 4/9, close=archive → Task 9; layout persistence (data ownership) → Task 2; §7 layout-side efficiency (docked panes mount no transcript/terminal; one layout, cheap dock summaries) → Tasks 6/8. Deferred to later phases and explicitly out of scope here: agent backends (§4), fork start-state (§3.3), right panel/git-log (§5), theming (§6), and the server status projection/virtualisation (rest of §7).
- **Placeholder scan:** none — every code step carries real code or a precise reuse instruction against named existing files.
- **Type consistency:** `PaneId`, `SplitAxis`, `FocusDirection`, `WorkspaceLayout`, `WorkspaceCommand`, and `WorkspaceLayoutController` are defined once (Tasks 1/4/5) and consumed with the same names throughout; `startThread`/`archiveThread` are used with their real signatures from `apps/web/src/api/client.ts`.

## Phase roadmap (subsequent plans)

Each becomes its own `docs/exec-plans/active/` plan when this phase completes and is verified:

1. **This plan — tiling workspace surface.**
2. Per-pane agent selection + Codex adapter (`runtime` discriminator, migration, `packages/codex-adapter`).
3. Claude adapter (`packages/claude-adapter`).
4. Worktree fork lineage + start-state "fork of a running chat".
5. Right-panel binding + git-commits view.
6. Codex-desktop restyle + light theme + toggle.
7. Efficiency: server status projection for cheap docked subscriptions + transcript virtualisation tiers.

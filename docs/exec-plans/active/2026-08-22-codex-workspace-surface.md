# Codex-style workspace surface implementation plan

**Status:** Active

**Plan version:** 1

**Technical approval:** Approved for plan version 1 on 2026-08-22 (user authorised implementation via the subagent-driven approach, consistent with the product decisions recorded the same day in the governing spec's Open product questions)

**Subsystem:** Browser workspace composition — pane visual surface, light/dark theming, the focus-bound Environment panel, dock-tier removal, and a Settings page

**Affected paths or contracts:** `apps/web/src/features/workspace/**`, `apps/web/src/components/**`, `apps/web/src/App.tsx`, `apps/web/src/main.tsx`, `apps/web/index.html`, `apps/web/src/styles.css`, new `apps/web/src/features/settings/**`, new theme/environment preference stores, `apps/web/src/api/client.ts` (consume only), focused Vitest and Playwright tests, and the tiling spec + web docs. No server, contract, agent, or database changes.

**Governing specification:** [Codex-style workspace surface](../../product-specs/codex-workspace-surface.md)

**Related documents or issue:** [Tiling workspace surface](../../product-specs/tiling-workspace-surface.md) (revised here), [Tiling workspace surface implementation plan](2026-08-21-tiling-workspace-surface.md) (the baseline this revises), [Multi-agent tiling workspace design](../../design/multi-agent-tiling-workspace.md). Authoritative visual references: [`thread-surface-codex.html`](../../design/thread-surface-codex.html) and [`thread-surface-tiled.html`](../../design/thread-surface-tiled.html).

**Last updated:** 2026-08-22

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the tiling workspace to the calm, near-borderless Codex desktop aesthetic; ship complete light and dark themes that follow the OS by default with a Settings-page override; render a single shared, focus-following Environment right panel; surface a four-way run status in each pane header and the sidebar; reduce pane actions to Split and Close (immediate, with an undo toast); and remove the collapse-to-dock pane tier entirely, migrating any persisted docked panes back into the tiling tree.

**Architecture:** This plan revises the already-shipped tiling surface (`apps/web/src/features/workspace/**`) rather than building new. Theming is added by refactoring the single global stylesheet (`styles.css`) from a dark-only `:root` into a token pair (light default + dark) selected by `prefers-color-scheme` and overridden by a `data-theme` attribute, with a tiny before-paint script in `index.html` and a `useTheme` hook for reactivity. Run status is a pure derivation over the existing `RunState`. A shared `PaneHeader` replaces the two inline pane title bars. The dock tier is deleted from the pure layout model and its localStorage is migrated v1→v2. The Environment panel is a new right-column component that reads the controller's `focusedPaneId` and the existing git/status APIs. Device-local preferences (theme, environment-panel visibility) follow the established `inspectorPreferences.ts` versioned-Zod-localStorage pattern.

**Tech Stack:** TypeScript, React 18, React Router, TanStack Query, Zod (`@pi-web/contracts`), plain global CSS with custom properties, Vitest + React Testing Library + `@testing-library/user-event` + axe-core, Playwright.

**Spec:** [Codex-style workspace surface](../../product-specs/codex-workspace-surface.md) — this plan implements CWS-01 through CWS-08 and the superseded-requirements bookkeeping. The visual reference mockups are authoritative for tokens, spacing, and component shapes.

## Global Constraints

- Node >= 22.19.0; pnpm 11.1.2; ESM only (`"type": "module"`); local import specifiers end in `.js`, matching the repo.
- Every HTTP/WS payload is parsed with `@pi-web/contracts` schemas; never trust `response.json()` through a cast.
- Device-local preferences (layout, theme, environment-panel visibility) live in versioned localStorage, parsed with a Zod schema, and are discarded-and-reset on any malformed or unknown-version value — the `inspectorPreferences.ts` pattern. They are never sourced from or written to the server.
- Selection, unread, run state, and transcripts remain server-authoritative and are read only through the existing thread/run/snapshot contracts. This plan makes **no** server, contract, agent, worktree, or database change.
- **Status is never conveyed by colour alone:** every run-status indicator carries an accessible text label (or visually-hidden text) in addition to colour.
- The theme is applied **before first paint** (no flash) and, on **System**, follows `prefers-color-scheme` and updates live when the OS switches. System is the default. Every colour is a design token; switching theme re-maps tokens only.
- Honour `prefers-reduced-motion` for any status pulse, spinner, or transition.
- Closing a pane archives its thread metadata-only and non-destructively; it never deletes a thread, worktree, or agent history. The undo affordance **defers** the archive (there is no unarchive endpoint) rather than reversing it.
- **No dock:** after this plan, no shipped code, CSS, keybinding, saved state, or doc may reference a dock, collapse, minimize, or restore-from-dock. Every thread on the surface is a full pane.
- The run status enum on the wire is `running | completed | failed | interrupted`. There is **no** `needs-approval` run state and no approval signal anywhere on the client today. Per the product decision (2026-08-22), the four-way `needs-approval` indicator is **wired but dormant**: the derivation supports it and activates automatically once an approval signal exists, but no current data produces it. Do not add a server/contract approval signal in this plan.
- Tests query by role/name/state, not class names. Commit after every green step.

---

### Task 1: Theme preference store

**Files:**

- Create: `apps/web/src/features/settings/themePreferences.ts`
- Test: `apps/web/src/features/settings/themePreferences.test.ts`

**Interfaces:**

- Consumes: nothing (self-contained; mirrors `apps/web/src/inspectorPreferences.ts`).
- Produces:

```ts
export type ThemeChoice = "system" | "light" | "dark";
export const THEME_PREFERENCE_VERSION = 1;
export const THEME_PREFERENCE_KEY = "pi-workspace:theme";
export function readThemeChoice(): ThemeChoice; // stored choice, or "system" on miss/malformed
export function writeThemeChoice(choice: ThemeChoice): void;
```

Follow `inspectorPreferences.ts` exactly for the storage-access guard, JSON parse guard, `safeParse`, and remove-on-malformed behaviour. The Zod schema is `z.object({ version: z.literal(1), choice: z.enum(["system","light","dark"]) })`. On any miss / non-string / invalid-JSON / schema-mismatch / unknown-version value, `readThemeChoice` returns `"system"` and (when a bad value was present) removes the key. `writeThemeChoice` stores `{ version: THEME_PREFERENCE_VERSION, choice }`.

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/src/features/settings/themePreferences.test.ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  readThemeChoice,
  writeThemeChoice,
  THEME_PREFERENCE_KEY,
} from "./themePreferences.js";

afterEach(() => localStorage.clear());

describe("themePreferences", () => {
  it("defaults to system when nothing is stored", () => {
    expect(readThemeChoice()).toBe("system");
  });
  it("round-trips a written choice", () => {
    writeThemeChoice("dark");
    expect(readThemeChoice()).toBe("dark");
  });
  it("discards a malformed value and resets to system", () => {
    localStorage.setItem(THEME_PREFERENCE_KEY, "{not json");
    expect(readThemeChoice()).toBe("system");
    expect(localStorage.getItem(THEME_PREFERENCE_KEY)).toBeNull();
  });
  it("discards an unknown version", () => {
    localStorage.setItem(
      THEME_PREFERENCE_KEY,
      JSON.stringify({ version: 99, choice: "dark" }),
    );
    expect(readThemeChoice()).toBe("system");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @pi-web/web exec vitest run src/features/settings/themePreferences.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `themePreferences.ts`** using the `inspectorPreferences.ts` structure verbatim, substituting the schema and default above.

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @pi-web/web exec vitest run src/features/settings/themePreferences.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/settings/themePreferences.ts apps/web/src/features/settings/themePreferences.test.ts
git commit -m "feat(web): device-local theme preference store"
```

---

### Task 2: Light and dark theme tokens in CSS

**Files:**

- Modify: `apps/web/src/styles.css` (lines 1–25 token block, plus the hardcoded literals noted below)

**Interfaces:**

- Produces (CSS contract consumed by every later visual task): a complete token set defined on bare `:root` (light), redefined for system-dark and forced-dark, covering at least: `--page`, `--sidebar`, `--card`, `--user-pill`, `--hover`, `--active`, `--hairline`, `--hairline-2`, `--text`, `--text-2`, `--muted`, `--faint`, `--green`, `--red`, `--amber`, `--accent`, `--send-bg`, `--send-fg`, `--run`, `--wait`, `--done`, `--fail`, `--focus-ring`, `--card-shadow`, `--pop-shadow`, `--mono`. Values are copied from the mockups' palettes (`thread-surface-codex.html` lines 21–63 and `thread-surface-tiled.html` lines 13–32).

Structure (theme-aware, three redefinitions so both the OS default and the explicit toggle win):

```css
:root {
  color-scheme: light;
  --page: #ffffff;
  --sidebar: #ffffff;
  --card: #ffffff;
  --user-pill: #f1f1f2;
  --hover: #f4f4f5;
  --active: #ececee;
  --hairline: #e9e9eb;
  --hairline-2: #e2e2e4;
  --text: #1d1d1f;
  --text-2: #3a3a3e;
  --muted: #8a8a8f;
  --faint: #b3b3b8;
  --green: #2f9e44;
  --red: #d1453b;
  --amber: #c07d16;
  --accent: #2f6feb;
  --send-bg: #1d1d1f;
  --send-fg: #ffffff;
  --run: #c07d16;
  --wait: #2f6feb;
  --done: #2f9e44;
  --fail: #d1453b;
  --focus-ring: rgba(47, 111, 235, 0.5);
  --card-shadow: 0 1px 2px rgba(20, 20, 30, 0.05);
  --pop-shadow:
    0 10px 30px rgba(20, 25, 40, 0.12), 0 2px 8px rgba(20, 25, 40, 0.06);
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
}
/* keep the repo's legacy alias names pointing at the new tokens so existing
   rules that reference --surface-0..3/--border/--blue keep working */
:root {
  --surface-0: var(--page);
  --surface-1: var(--card);
  --surface-2: var(--hover);
  --surface-3: var(--active);
  --surface-hover: var(--hover);
  --border: var(--hairline-2);
  --blue: var(--accent);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #131417;
    --sidebar: #17181c;
    --card: #1b1d22;
    --user-pill: #26282e;
    --hover: #1f2127;
    --active: #24262d;
    --hairline: rgba(255, 255, 255, 0.08);
    --hairline-2: rgba(255, 255, 255, 0.12);
    --text: #ececee;
    --text-2: #c3c5cb;
    --muted: #8b8d95;
    --faint: #62646c;
    --green: #4ec06f;
    --red: #e0645c;
    --amber: #d6a53a;
    --accent: #6aa0ff;
    --send-bg: #ececee;
    --send-fg: #16171a;
    --run: #d6a53a;
    --wait: #6aa0ff;
    --done: #4ec06f;
    --fail: #e0645c;
    --focus-ring: rgba(106, 160, 255, 0.55);
    --card-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    --pop-shadow: 0 12px 34px rgba(0, 0, 0, 0.5);
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  /* identical dark values as above (copy the same declarations) */
}
```

De-hardcode the literal colours the audit found so a theme swap re-maps them: `.trust-warning` (`#d4c39b` / `#211e18` around line 533) → `var(--amber)` on `color-mix(in srgb, var(--amber) 8%, var(--card))`; the spinner literals (`#6e7785` / `#d4b971` around lines 338–339) → `var(--muted)` / `var(--run)`; `.markdown` `#dce0e8` (around line 559) → `var(--text)`. Replace any remaining `background`/`color` set directly on `:root` (old lines 2–3) with the token-driven `body` rule. Do not change layout, spacing, or selectors in this task — only colours/tokens.

- [ ] **Step 1: Add the light + dark token blocks** at the top of `styles.css`, keeping the legacy alias `--surface-*`/`--border`/`--blue` names mapped to the new tokens so no existing rule breaks.

- [ ] **Step 2: De-hardcode** the three literal spots listed above.

- [ ] **Step 3: Verify the app still builds and renders**

Run: `pnpm --filter @pi-web/web exec vitest run` (existing suite must stay green — this is CSS-only)
Then: `pnpm --filter @pi-web/web build`
Expected: PASS / clean build. (Visual verification of both themes happens in Task 3 once the toggle exists.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "feat(web): add light and dark theme token sets"
```

---

### Task 3: Theme runtime — before-paint init and `useTheme`

**Files:**

- Modify: `apps/web/index.html` (add a before-paint inline script in `<head>`)
- Create: `apps/web/src/features/settings/useTheme.ts`
- Test: `apps/web/src/features/settings/useTheme.test.tsx`

**Interfaces:**

- Consumes: `ThemeChoice`, `readThemeChoice`, `writeThemeChoice`, `THEME_PREFERENCE_KEY` (Task 1).
- Produces:

```ts
// applies the choice to <html>: "system" removes data-theme (CSS media query governs);
// "light"/"dark" set data-theme so the explicit choice wins in both directions.
export function applyThemeChoice(choice: ThemeChoice): void;
export interface ThemeController {
  choice: ThemeChoice;
  setChoice(choice: ThemeChoice): void; // persists + applies immediately
}
export function useTheme(): ThemeController;
```

Behaviour:

- `applyThemeChoice`: `choice === "system"` → `document.documentElement.removeAttribute("data-theme")`; else `setAttribute("data-theme", choice)`.
- The **before-paint script** in `index.html` (inline, runs before the bundle and before CSS paints a wrong theme) reads the raw localStorage value under `pi-workspace:theme`, and if it parses to `{ choice: "light" | "dark" }`, sets `document.documentElement.dataset.theme` accordingly. It does nothing for `system`/missing/malformed, letting the CSS `prefers-color-scheme` rule govern. It must be tiny and dependency-free (it cannot import the TS module):

```html
<script>
  try {
    var v = JSON.parse(localStorage.getItem("pi-workspace:theme") || "null");
    if (v && (v.choice === "light" || v.choice === "dark"))
      document.documentElement.setAttribute("data-theme", v.choice);
  } catch (e) {}
</script>
```

- `useTheme`: initialises `choice` from `readThemeChoice()`, calls `applyThemeChoice` on mount and whenever `choice` changes, and — only while `choice === "system"` — subscribes to `window.matchMedia("(prefers-color-scheme: dark)")` `change` so a live OS switch re-paints (the media query already governs the CSS, but the subscription forces any JS-observed theme state to update; keep it so the hook is the single source of truth for consumers). `setChoice` calls `writeThemeChoice` then updates state.

- [ ] **Step 1: Write failing test** (`// @vitest-environment jsdom`): stub `matchMedia`; `renderHook(() => useTheme())` starts at `"system"` with no `data-theme` attribute; `act(() => result.current.setChoice("dark"))` sets `document.documentElement.getAttribute("data-theme")` to `"dark"` and persists (assert `readThemeChoice() === "dark"`); `setChoice("system")` removes the attribute again.

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/settings/useTheme.test.tsx`

- [ ] **Step 3: Implement** `useTheme.ts` and add the inline script to `apps/web/index.html`.

- [ ] **Step 4: Run and verify PASS.** Then start the app and confirm both themes render and the OS switch updates System live.
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/settings/useTheme.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add apps/web/index.html apps/web/src/features/settings/useTheme.ts apps/web/src/features/settings/useTheme.test.tsx
git commit -m "feat(web): apply theme before paint and follow the OS on system"
```

---

### Task 4: Settings page hosting the theme control

**Files:**

- Create: `apps/web/src/features/settings/SettingsPage.tsx`
- Modify: `apps/web/src/App.tsx` (add `/settings` route around lines 1105–1118; add an entry point in the sidebar `.brand`/`.local-only` region)
- Modify: `apps/web/src/styles.css` (Settings page + control styles, token-based)
- Test: `apps/web/src/features/settings/SettingsPage.test.tsx`

**Interfaces:**

- Consumes: `useTheme` (Task 3).
- Produces:

```ts
export function SettingsPage(): JSX.Element;
```

`SettingsPage` renders inside the existing `WorkspaceLayout` shell (so the sidebar/chrome persist) with a settings body. Version 1 body is a single **Theme** section: a three-option control (radiogroup) of **System**, **Light**, **Dark**, with System preselected when `choice === "system"`. Selecting an option calls `useTheme().setChoice` — applied immediately and persisted. Structure the page as a list of labelled sections (`<section>` with a heading + control) so future settings drop in without a redesign. Add a **Settings** entry point in the sidebar chrome (a labelled button/link in the `.brand` header or the `.local-only` footer) that routes to `/settings`.

- [ ] **Step 1: Write failing test** — render `<MemoryRouter initialEntries={["/settings"]}>` with the settings route, assert a `radiogroup` named "Theme" with three radios (System/Light/Dark), System checked by default; `await user.click(screen.getByRole("radio", { name: "Dark" }))` sets `document.documentElement` `data-theme="dark"` and persists (`readThemeChoice() === "dark"`). Add an axe check.

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/settings/SettingsPage.test.tsx`

- [ ] **Step 3: Implement** `SettingsPage.tsx`, wire the `/settings` route and the sidebar entry point in `App.tsx`, and add token-based styles.

- [ ] **Step 4: Run and verify PASS**, then the full web suite for no regression.
      Run: `pnpm --filter @pi-web/web exec vitest run`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/settings/SettingsPage.tsx apps/web/src/App.tsx apps/web/src/styles.css apps/web/src/features/settings/SettingsPage.test.tsx
git commit -m "feat(web): settings page with system/light/dark theme control"
```

---

### Task 5: Run-status derivation

**Files:**

- Create: `apps/web/src/features/workspace/runStatus.ts`
- Test: `apps/web/src/features/workspace/runStatus.test.ts`

**Interfaces:**

- Consumes: `RunState` from `@pi-web/contracts`.
- Produces:

```ts
export type PaneRunStatus = "working" | "needs-approval" | "done" | "failed";
export interface RunStatusInput {
  runState: RunState | null;
  needsApproval?: boolean; // dormant seam; no client data sets this today
}
// running -> working; completed -> done; interrupted -> done (settled, non-error);
// failed -> failed; null -> null (no status: threadless or never-run pane).
// needsApproval === true overrides to "needs-approval" (wired, dormant).
export function deriveRunStatus(input: RunStatusInput): PaneRunStatus | null;
export const PANE_STATUS_LABEL: Record<PaneRunStatus, string>; // Working / Needs approval / Done / Failed
export const PANE_STATUS_TOKEN: Record<
  PaneRunStatus,
  "run" | "wait" | "done" | "fail"
>;
// elapsed timer text for running work, e.g. "2m 14s"; null when no start or not running
export function elapsedLabel(
  startedAtIso: string | null,
  nowMs: number,
): string | null;
```

`PANE_STATUS_LABEL = { working: "Working", "needs-approval": "Needs approval", done: "Done", failed: "Failed" }`. `PANE_STATUS_TOKEN` maps each status to the CSS colour-token suffix used by the mockups (`--run`/`--wait`/`--done`/`--fail`). `elapsedLabel` formats `(nowMs - Date.parse(startedAtIso))` as `Xm Ys` (or `Ys` under a minute); returns `null` for a null start. Keep `deriveRunStatus` and `PANE_STATUS_*` pure and clock-free; only `elapsedLabel` takes `nowMs` (injected, never read from a clock inside the module).

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  deriveRunStatus,
  elapsedLabel,
  PANE_STATUS_LABEL,
} from "./runStatus.js";

describe("deriveRunStatus", () => {
  it("maps run states to display statuses", () => {
    expect(deriveRunStatus({ runState: "running" })).toBe("working");
    expect(deriveRunStatus({ runState: "completed" })).toBe("done");
    expect(deriveRunStatus({ runState: "interrupted" })).toBe("done");
    expect(deriveRunStatus({ runState: "failed" })).toBe("failed");
    expect(deriveRunStatus({ runState: null })).toBeNull();
  });
  it("honours the dormant needs-approval seam", () => {
    expect(deriveRunStatus({ runState: "running", needsApproval: true })).toBe(
      "needs-approval",
    );
  });
});

describe("elapsedLabel", () => {
  it("formats elapsed running time", () => {
    const start = "2026-08-22T00:00:00.000Z";
    expect(elapsedLabel(start, Date.parse(start) + 134_000)).toBe("2m 14s");
    expect(elapsedLabel(start, Date.parse(start) + 9_000)).toBe("9s");
    expect(elapsedLabel(null, 0)).toBeNull();
  });
});

describe("PANE_STATUS_LABEL", () => {
  it("labels every status for accessible, non-colour-only status", () => {
    expect(PANE_STATUS_LABEL["needs-approval"]).toBe("Needs approval");
  });
});
```

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/runStatus.test.ts`

- [ ] **Step 3: Implement** `runStatus.ts` per the interface.

- [ ] **Step 4: Run and verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/runStatus.ts apps/web/src/features/workspace/runStatus.test.ts
git commit -m "feat(web): derive four-way pane run status from run state"
```

---

### Task 6: Remove the dock/collapse tier from the layout model and keymap

**Files:**

- Modify: `apps/web/src/features/workspace/layoutTree.ts` (drop `docked`, `collapsePane`, `restorePane`)
- Modify: `apps/web/src/features/workspace/layoutTree.test.ts` (remove collapse/restore cases; keep an internal restore helper's test)
- Modify: `apps/web/src/features/workspace/layoutStorage.ts` (bump to version 2; migrate v1 docked panes into the tree)
- Modify: `apps/web/src/features/workspace/layoutStorage.test.ts` (add the v1→v2 migration case)
- Modify: `apps/web/src/features/workspace/keybindings.ts` (drop `collapse`/`restore` from `WorkspaceCommand` and mapping)
- Modify: `apps/web/src/features/workspace/keybindings.test.ts`
- Modify: `apps/web/src/features/workspace/useWorkspaceLayout.ts` (drop `collapse`/`restore` from the controller and `applyCommand`)
- Modify: `apps/web/src/features/workspace/useWorkspaceLayout.test.tsx`

**Interfaces:**

- Produces (revised):

```ts
// layoutTree.ts — WorkspaceLayout loses `docked`; boundPaneId is RETAINED unchanged.
export interface WorkspaceLayout {
  root: LayoutNode | null;
  panes: Record<PaneId, { threadId: ThreadId | null }>;
  focusedPaneId: PaneId | null;
  boundPaneId: PaneId | null; // retained; see note below
}
// collapsePane and restorePane are DELETED. splitPane/closePane/assignThread/
// focusPane/moveFocus/bindPane/tiledPaneIds/setSplitSizes are unchanged except
// that closePane no longer touches a `docked` array.
// Internal-only helper kept for migration (NOT re-exported publicly):
export function restoreIntoTree(
  l: WorkspaceLayout,
  id: PaneId,
): WorkspaceLayout;

// keybindings.ts — WorkspaceCommand loses collapse/restore:
export type WorkspaceCommand =
  | { type: "split"; axis: SplitAxis }
  | { type: "close" }
  | { type: "focus"; direction: FocusDirection }
  | { type: "bind" };

// layoutStorage.ts
export const WORKSPACE_LAYOUT_VERSION = 2;
```

Notes for the implementer:

- **`boundPaneId` is retained** untouched, and the `bind` command/keybinding (`Cmd+Alt+Enter`) stays mapped, per CWS-05 ("all other approved keybindings are retained"). The Environment panel (Task 10) reads `focusedPaneId`, not `boundPaneId`, so binding stays dormant exactly as it is today. Do not remove it.
- `createInitialLayout` no longer sets `docked`. `closePane` keeps its parent-split-collapses-to-sibling behaviour and its refocus logic; just remove the `docked` bookkeeping.
- **Migration (CWS-05):** keep a private `WorkspaceLayoutV1Schema` (with `docked: PaneId[]`) for reading old payloads. In `readLayout`, when the stored `version === 1` and it parses against V1, migrate: start from the v1 `{ root, panes, focusedPaneId, boundPaneId }` (dropping `docked` from the type) and fold each id in the v1 `docked` array back into the tree via `restoreIntoTree` (which splits the focused tiled pane along `"row"`, or becomes the root when `root === null`), preserving all existing splits. Return the version-2 layout. Only a payload that is malformed or of a version that is neither 1 nor 2 resets to `createInitialLayout`. A docked pane must never be dropped. `writeLayout` always writes version 2 with no `docked` field.
- Update the affected existing tests: delete the collapse/restore assertions in `layoutTree.test.ts`, remove the collapse case in `useWorkspaceLayout.test.tsx`, and drop the collapse/restore rows in `keybindings.test.ts`.

- [ ] **Step 1: Write/adjust failing tests** — in `layoutTree.test.ts` remove the collapse/restore test and add a `restoreIntoTree` test (docked-style id folds back in, splits preserved, focus on the restored pane). In `layoutStorage.test.ts` add: a v1 payload with a `docked` pane loads as version 2 with that pane present in `tiledPaneIds`, no `docked` field, and no pane lost; a v2 payload round-trips; an unknown version resets. In `keybindings.test.ts` assert `ArrowUp`/`ArrowDown` with the primary modifier no longer resolve to a command. In `useWorkspaceLayout.test.tsx` remove collapse expectations.

- [ ] **Step 2: Run and verify the new/edited tests FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/layoutTree.test.ts src/features/workspace/layoutStorage.test.ts src/features/workspace/keybindings.test.ts src/features/workspace/useWorkspaceLayout.test.tsx`

- [ ] **Step 3: Implement** the model/keymap/storage edits: strip `docked`/`collapsePane`/`restorePane`, add `restoreIntoTree`, bump the version and add the V1 migration, and prune `collapse`/`restore` from the command type, resolver, and controller.

- [ ] **Step 4: Run and verify PASS**, then the whole workspace suite (the app still compiles even though `Dock.tsx` is deleted in Task 9 — this task must keep the tree building, so temporarily leave `Dock.tsx` importing nothing removed; `Dock` used `needsAttention`, not the layout `docked` array beyond `controller.layout.docked`. Because `layout.docked` is gone, update `Dock.tsx`/`WorkspaceView.tsx` minimally to unblock the build, or fold the Dock removal forward — cleanest is to do Task 9's deletion here if the build otherwise breaks. Prefer: in this task, delete the `DockRow` render in `WorkspaceView.tsx` and the `Dock.tsx`/`Dock.test.tsx`/`attention.*` files, since they cannot compile without `docked`.)

Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace`

> Implementer note: because `Dock.tsx` and `attention.ts` depend on the now-removed `docked` tier, remove `apps/web/src/features/workspace/Dock.tsx`, `Dock.test.tsx`, `attention.ts`, and `attention.test.ts` in this task and delete the `DockRow` usage + import in `WorkspaceView.tsx` (its full re-style lands in Task 9). This keeps every step compiling and green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/layoutTree.ts apps/web/src/features/workspace/layoutTree.test.ts apps/web/src/features/workspace/layoutStorage.ts apps/web/src/features/workspace/layoutStorage.test.ts apps/web/src/features/workspace/keybindings.ts apps/web/src/features/workspace/keybindings.test.ts apps/web/src/features/workspace/useWorkspaceLayout.ts apps/web/src/features/workspace/useWorkspaceLayout.test.tsx apps/web/src/features/workspace/WorkspaceView.tsx
git rm apps/web/src/features/workspace/Dock.tsx apps/web/src/features/workspace/Dock.test.tsx apps/web/src/features/workspace/attention.ts apps/web/src/features/workspace/attention.test.ts
git commit -m "feat(web): remove the collapse-to-dock pane tier and migrate layout to v2"
```

---

### Task 7: Shared `PaneHeader` with run status and Split/Close-only actions

**Files:**

- Create: `apps/web/src/features/workspace/PaneHeader.tsx`
- Create: `apps/web/src/features/workspace/PaneHeader.test.tsx`
- Modify: `apps/web/src/features/workspace/ThreadPane.tsx` (replace the inline `.pane-title-bar`, lines ~264–303, with `PaneHeader`; remove the Collapse and Bind buttons)
- Modify: `apps/web/src/features/workspace/NewChatPane.tsx` (replace its inline header, lines ~104–119, with `PaneHeader` in threadless mode)
- Modify: `apps/web/src/styles.css` (pane header styles from `thread-surface-tiled.html` lines 100–109; status pill, repo chip, focus ring)

**Interfaces:**

- Consumes: `PaneRunStatus`, `PANE_STATUS_LABEL`, `PANE_STATUS_TOKEN`, `elapsedLabel` (Task 5).
- Produces:

```ts
export interface PaneHeaderProps {
  status: PaneRunStatus | null; // null on a new-chat/never-run pane -> no status shown
  elapsed: string | null; // elapsed timer text while running, else null
  title: string; // thread title, or "New chat" for a threadless pane
  projectLabel: string; // project/worktree chip text
  focused: boolean;
  onSplit(): void; // split right (row); keyboard still offers both axes
  onClose(): void;
}
export function PaneHeader(props: PaneHeaderProps): JSX.Element;
```

The header renders, in reading order: a **status pill** — a coloured dot (`.sdot` with the `PANE_STATUS_TOKEN[status]` modifier class) plus the `PANE_STATUS_LABEL[status]` text and, when `elapsed` is set, `· {elapsed}` — omitted entirely when `status` is null; the **title** (truncating); the **project/worktree chip** (`.repo`); and the **actions**: exactly two icon buttons, **Split** (accessible name "Split") and **Close** (accessible name "Close"). No collapse, minimize, dock, or bind button. The status pill's label text is real text (not colour-only), satisfying the accessibility constraint. Styling mirrors `.pane-head`/`.status`/`.title`/`.repo`/`.acts` from the tiled mockup; the focused treatment (`.pane.focused` ring) is applied by the pane wrapper in `TilingSurface` (Task 9 confirms it), driven by `focused`.

Update `ThreadPane` to compute `status`/`elapsed` from its snapshot: `status = deriveRunStatus({ runState: snapshot.thread.runState })`; `elapsed = status === "working" ? elapsedLabel(snapshot.currentRun?.startedAt ?? null, Date.now()) : null` (a 1s `setInterval` tick while running keeps it live; clear on unmount and honour `prefers-reduced-motion` by still updating text — motion rule applies to animation, not the timer). `NewChatPane` passes `status={null}`, `title="New chat"`, and wires only `onSplit`/`onClose`.

- [ ] **Step 1: Write failing test** — render `PaneHeader` with `status="needs-approval"`, `elapsed={null}`, `title="fix the merge conflict"`, `projectLabel="valai"`, `focused`, and spies. Assert the accessible text "Needs approval" is present (status not colour-only), the title and chip render, exactly two buttons named "Split" and "Close" exist and no button named "Collapse"/"Bind"/"Dock" exists, and clicking them invokes the spies. Add a case with `status={null}` asserting no status text renders. Axe check.

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/PaneHeader.test.tsx`

- [ ] **Step 3: Implement** `PaneHeader.tsx`, swap it into `ThreadPane`/`NewChatPane` (removing the collapse/bind buttons and adding Split), and add the styles.

- [ ] **Step 4: Run and verify PASS**, then the workspace suite (update `ThreadPane.test.tsx` expectations that asserted a "Collapse"/"Bind" button — those buttons are gone; assert "Split"/"Close" instead).
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/PaneHeader.tsx apps/web/src/features/workspace/PaneHeader.test.tsx apps/web/src/features/workspace/ThreadPane.tsx apps/web/src/features/workspace/ThreadPane.test.tsx apps/web/src/features/workspace/NewChatPane.tsx apps/web/src/styles.css
git commit -m "feat(web): shared pane header with run status and split/close actions"
```

---

### Task 8: Immediate close with an undo toast (deferred archive)

**Files:**

- Modify: `apps/web/src/features/workspace/WorkspaceView.tsx` (replace the current close-then-archive with a deferred-archive + toast flow)
- Create: `apps/web/src/features/workspace/UndoToast.tsx`
- Create: `apps/web/src/features/workspace/UndoToast.test.tsx`
- Modify: `apps/web/src/styles.css` (toast styles)

**Interfaces:**

- Consumes: `archiveThread` from `../../api/client.js`; the `WorkspaceLayoutController`.
- Produces:

```ts
export interface UndoToastProps {
  message: string; // e.g. "Archived — thread name"
  onUndo(): void;
  onDismiss(): void; // fired when the timeout elapses
  timeoutMs?: number; // default 6000
}
export function UndoToast(props: UndoToastProps): JSX.Element;
```

Close flow in `WorkspaceView` (CWS-04 — immediate, no modal): on close of a threaded pane, capture `const previous = controller.layout` and the `threadId`, then `controller.close(paneId)` so the pane disappears **immediately**; show an `UndoToast` and start a deferred archive. If the toast times out (`onDismiss`), call `archiveThread(projectId, threadId)` (the archive actually happens now). If the user clicks **Undo** (`onUndo`), cancel the deferred archive and restore `previous` via a controller setter (add `controller.replaceLayout(previous)` to `useWorkspaceLayout`, a thin `setLayout` wrapper) so the pane returns with its splits intact — no server call, because the archive never fired. A new-chat (threadless) pane closes with no toast and no archive. Only one pending close at a time: if a second close happens while one is pending, flush the first (archive it now) before starting the second.

> Rationale: there is no unarchive endpoint, so undo must prevent the archive rather than reverse it. Deferring `archiveThread` until the toast expires keeps close immediate while making undo a pure client operation.

- [ ] **Step 1: Write failing tests** — (a) `UndoToast`: renders the message and an "Undo" button; clicking it calls `onUndo`; advancing fake timers past `timeoutMs` calls `onDismiss` once. (b) In a `WorkspaceView` test, closing a threaded pane removes it immediately and does **not** call `archiveThread` synchronously; letting the toast time out calls `archiveThread(projectId, threadId)` exactly once; clicking Undo restores the pane (`tiledPaneIds` returns to its pre-close set) and `archiveThread` is never called. Use `vi.useFakeTimers()` and the existing `vi.mock("../../api/client.js")` pattern from `WorkspaceView.test.tsx`.

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/UndoToast.test.tsx src/features/workspace/WorkspaceView.test.tsx`

- [ ] **Step 3: Implement** `UndoToast.tsx`, the deferred-archive close flow, and `controller.replaceLayout`.

- [ ] **Step 4: Run and verify PASS**, then the workspace suite.
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/UndoToast.tsx apps/web/src/features/workspace/UndoToast.test.tsx apps/web/src/features/workspace/WorkspaceView.tsx apps/web/src/features/workspace/useWorkspaceLayout.ts apps/web/src/styles.css
git commit -m "feat(web): immediate pane close with an undo toast and deferred archive"
```

---

### Task 9: Wire the surface without a dock; sidebar run-status indicators; focus ring & click-to-focus

**Files:**

- Modify: `apps/web/src/features/workspace/WorkspaceView.tsx` (remove all dock chrome; ensure no dock strip renders)
- Modify: `apps/web/src/features/workspace/TilingSurface.tsx` (focus ring on the focused pane; de-emphasise non-focused; click-to-focus; `EmptyState` offers "New pane", not "Restore last pane")
- Modify: `apps/web/src/App.tsx` (sidebar run rows show the four-way status via `deriveRunStatus`, matching the mockup's `.sdot` states; verify a status change never moves focus)
- Modify: `apps/web/src/styles.css` (remove dock CSS lines ~1280–1329; pane focus/dim styles; sidebar status dots)
- Modify: `apps/web/src/features/workspace/TilingSurface.test.tsx`, `apps/web/src/features/workspace/WorkspaceView.test.tsx`

**Interfaces:**

- Consumes: `deriveRunStatus`, `PANE_STATUS_TOKEN`, `PANE_STATUS_LABEL` (Task 5); the controller.
- Produces: no new exported symbols; behavioural changes only.

Details:

- **No dock (CWS-05):** confirm `WorkspaceView` renders only the `TilingSurface` (+ the Environment panel from Task 10 later) and the undo toast — no dock row, no dock CSS. Remove the dock CSS block from `styles.css`.
- **Focus & de-emphasis (CWS-04):** the focused pane gets the ring (`.pane.focused`, `box-shadow: 0 0 0 2px var(--focus-ring)`, `aria-current`); non-focused panes get `.pane.dim` (title muted) but render at full fidelity. Clicking anywhere in a non-focused pane (that is not an input/button) focuses it — this logic already exists in `PaneRegion`; verify and keep it.
- **Sidebar run list (CWS-03):** each run/thread row in the sidebar shows a status dot + accessible label derived by `deriveRunStatus({ runState: summary.runState })` (from the `getWorkspace()` `ThreadSummary[]`), using the same `.sdot.{run|wait|done|fail}` classes as the pane header so the sidebar and panes read identically. Threadless/never-run rows show no status.
- **No focus steal (CWS-03):** a run transitioning to needs-approval or failed updates the header and sidebar indicator only; it must never call a focus setter. Add a regression test asserting that re-rendering a pane with a changed `runState` leaves `controller.layout.focusedPaneId` unchanged.
- **EmptyState:** now offers to open a fresh pane (`controller.newPane()` / seed), never a dock restore.

- [ ] **Step 1: Write/adjust failing tests** — (a) `TilingSurface.test.tsx`: the focused pane exposes the focused treatment (`aria-current`), a non-focused pane click focuses it, and no element with an accessible "dock"/"restore from dock" name exists. (b) `WorkspaceView.test.tsx`: no `role="group"` named "Docked panes" renders; a snapshot re-render flipping a pane's `runState` to `failed` does not change `focusedPaneId`. (c) A sidebar test (in `App.test.tsx`) asserts a run row shows the derived status label.

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace src/App.test.tsx`

- [ ] **Step 3: Implement** the dock removal from the view/CSS, the focus ring/dim, the sidebar status indicators, and the no-focus-steal guard.

- [ ] **Step 4: Run and verify PASS**, then the full web suite + a build.
      Run: `pnpm --filter @pi-web/web exec vitest run && pnpm --filter @pi-web/web build`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/WorkspaceView.tsx apps/web/src/features/workspace/TilingSurface.tsx apps/web/src/features/workspace/TilingSurface.test.tsx apps/web/src/features/workspace/WorkspaceView.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/styles.css
git commit -m "feat(web): dockless surface with focus ring and sidebar run status"
```

---

### Task 10: Environment panel — single, shared, focus-following

**Files:**

- Create: `apps/web/src/features/workspace/EnvironmentPanel.tsx`
- Create: `apps/web/src/features/workspace/EnvironmentPanel.test.tsx`
- Create: `apps/web/src/features/settings/environmentPreferences.ts`
- Create: `apps/web/src/features/settings/environmentPreferences.test.ts`
- Modify: `apps/web/src/features/workspace/WorkspaceView.tsx` (render the panel as a right column; toggle control)
- Modify: `apps/web/src/styles.css` (right-column + rows, from `thread-surface-tiled.html` lines 158–177)

**Interfaces:**

- Consumes: the controller (`layout.focusedPaneId`, `layout.panes`), `getSnapshot`/`getStatus` from `../../api/client.js`, `deriveRunStatus`/`PANE_STATUS_LABEL`/`elapsedLabel` (Task 5).
- Produces:

```ts
// environmentPreferences.ts — device-local visibility, tri-state.
export type EnvironmentVisibility = "auto" | "shown" | "hidden";
export const ENVIRONMENT_PREFERENCE_VERSION = 1;
export const ENVIRONMENT_PREFERENCE_KEY = "pi-workspace:environment";
export function readEnvironmentVisibility(): EnvironmentVisibility; // "auto" on miss/malformed
export function writeEnvironmentVisibility(v: EnvironmentVisibility): void;
// "auto" resolves to shown while the surface has <= 1 tiled pane, hidden once it tiles.
export function isEnvironmentOpen(
  v: EnvironmentVisibility,
  tiledPaneCount: number,
): boolean;

// EnvironmentPanel.tsx
export interface EnvironmentPanelProps {
  projectId: ProjectId;
  controller: WorkspaceLayoutController;
  onClose(): void; // user hides the panel (persists "hidden")
}
export function EnvironmentPanel(props: EnvironmentPanelProps): JSX.Element;
```

Behaviour (CWS-06):

- **Single & shared:** exactly one `EnvironmentPanel` for the whole surface, rendered by `WorkspaceView` as a docked right column (never a floating overlay). It is not per-pane.
- **Focus-following:** it reads `controller.layout.focusedPaneId` → the pane's `threadId`. When a thread is focused it shows a **focus header** (thread title + status pill via `deriveRunStatus`/`elapsedLabel`), a **Changes** row (from `getStatus(projectId, threadId)` — count the `files[].kind` into added/modified/deleted, e.g. "3 changed" or the `+added / −deleted` counts the mockup shows; reuse the existing Inspector `getStatus` query key), **Worktree** and **Branch** rows (from `snapshot.thread.workspace`: `branchName`/`baseBranch` in worktree mode, "shared" otherwise), a muted **Commit or push** affordance, and a **Sources** section with a GitHub row (static row for v1, matching the mockup's muted style). When focus moves to another pane the panel re-reads for the new thread. When no pane is focused (or the focused pane is threadless) it shows an **empty state** ("No focused run").
- **Visibility (device-local, CWS-06):** effective open state is `isEnvironmentOpen(readEnvironmentVisibility(), tiledPaneIds(layout).length)`. On a fresh device (`"auto"`) it is open at one pane and hidden once the surface tiles. A user toggle persists `"shown"`/`"hidden"` and is remembered thereafter. `WorkspaceView` renders a toggle button in the chrome (mirrors the tiled mockup's right-panel toggle) that flips shown/hidden and persists it.
- Scope is environment + git summary only; **no embedded terminal** (Non-goal). Do not add a terminal here.

- [ ] **Step 1: Write failing tests** — (a) `environmentPreferences.test.ts`: default `"auto"`; `isEnvironmentOpen("auto", 1) === true`, `isEnvironmentOpen("auto", 2) === false`, `isEnvironmentOpen("shown", 4) === true`, `isEnvironmentOpen("hidden", 1) === false`; malformed resets to `"auto"`. (b) `EnvironmentPanel.test.tsx`: with a controller focused on a threaded pane whose stubbed snapshot has a worktree branch and whose `getStatus` returns two modified files, assert the panel shows the thread title, its status label, the branch text, and a changes summary; moving focus to a second thread (re-render with a new `focusedPaneId`) updates the shown branch; with no focused pane it shows "No focused run". Assert only one panel region (`role="complementary"` / accessible name "Environment") exists. Axe check.

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/settings/environmentPreferences.test.ts src/features/workspace/EnvironmentPanel.test.tsx`

- [ ] **Step 3: Implement** `environmentPreferences.ts` (Task-1 pattern), `EnvironmentPanel.tsx` (reusing the Inspector's `getStatus` query), the right-column render + toggle in `WorkspaceView`, and the styles.

- [ ] **Step 4: Run and verify PASS**, then the full web suite + build.
      Run: `pnpm --filter @pi-web/web exec vitest run && pnpm --filter @pi-web/web build`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/EnvironmentPanel.tsx apps/web/src/features/workspace/EnvironmentPanel.test.tsx apps/web/src/features/settings/environmentPreferences.ts apps/web/src/features/settings/environmentPreferences.test.ts apps/web/src/features/workspace/WorkspaceView.tsx apps/web/src/styles.css
git commit -m "feat(web): single shared focus-following environment panel"
```

---

### Task 11: Codex transcript reading model and trust-banner demotion

**Files:**

- Modify: `apps/web/src/features/workspace/ThreadPane.tsx` (`Transcript`, lines ~96–140; trust banner, lines ~334–337)
- Modify: `apps/web/src/components/Activity.tsx` (group tool/command activity under a collapsed "Worked for …" run header)
- Modify: `apps/web/src/styles.css` (user pill, assistant plain text, hairline cards, inline status line — from `thread-surface-codex.html` lines 127–166 and `thread-surface-tiled.html` lines 119–156)
- Modify: `apps/web/src/features/workspace/ThreadPane.test.tsx`, `apps/web/src/components/Activity.test.tsx`

**Interfaces:**

- Produces: no new exported symbols; DOM/CSS structure changes to match the mockups.

Details (CWS-01):

- **User turn** → a quiet, right-aligned neutral pill (`.u-row` + `.u-bubble`, `var(--user-pill)`), never a full-width outlined card. (`.message-user` already exists; restyle it to the pill.)
- **Assistant turn** → plain flowing text on the pane background, no bubble, comfortable measure/line-height (`.a-block`, `line-height: ~1.6`). Remove any outline/card from assistant messages.
- **Tool/command activity** → clean hairline-bordered cards (title, status glyph, command/file rows), **grouped under a collapsed "Worked for …" run header** rather than a raw edge-to-edge log. Introduce a `.worked` run-header element that summarises a contiguous run of tool items (e.g. "Worked for 14s") and collapses them; expanding reveals the existing `Activity` cards. Keep `Activity`'s existing per-tool rendering; add the grouping wrapper.
- **Near-borderless:** grouping/elevation come from background + hairline dividers, not an outline on every element. Audit the transcript rules and drop redundant per-element borders.
- **Trust banner demotion:** the full-width amber `.trust-warning` banner becomes a single quiet **inline status line** in the pane header region (a muted one-line note near the header, using `var(--muted)`/`var(--amber)` text, not a full-width filled banner). Move it out of the transcript flow into the header area.

- [ ] **Step 1: Write failing tests** — in `ThreadPane.test.tsx`: a user message renders inside the pill element and an assistant message renders as flowing text with no card/outline wrapper; the trust note renders as a single inline line in the header region (assert it is not the old full-width `.trust-warning` banner — query by its text and assert its container is the header region, or assert the demoted class). In `Activity.test.tsx`: a sequence of tool items renders under a single "Worked for" run-header disclosure that is collapsed by default and expands to show the command rows.

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/ThreadPane.test.tsx src/components/Activity.test.tsx`

- [ ] **Step 3: Implement** the transcript restyle, the "Worked for" grouping, and the trust-banner demotion.

- [ ] **Step 4: Run and verify PASS**, then a visual check in both themes.
      Run: `pnpm --filter @pi-web/web exec vitest run`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/ThreadPane.tsx apps/web/src/features/workspace/ThreadPane.test.tsx apps/web/src/components/Activity.tsx apps/web/src/components/Activity.test.tsx apps/web/src/styles.css
git commit -m "feat(web): codex transcript reading model and inline trust line"
```

---

### Task 12: Full-width transcript, minimum pane width, and scroll

**Files:**

- Modify: `apps/web/src/styles.css` (drop the centered fixed reading measure inside a pane; set a min pane width; scroll the surface)
- Modify: `apps/web/src/features/workspace/TilingSurface.tsx` (enforce minimum usable pane width; the surface scrolls rather than shrinking below it)
- Modify: `apps/web/src/features/workspace/TilingSurface.test.tsx`

**Interfaces:**

- Produces:

```ts
export const MIN_PANE_WIDTH_PX = 360; // minimum usable pane width; surface scrolls past it
```

Details (CWS-07):

- Inside a pane, drop the centered `max-width: 720px; margin: 0 auto` reading measure (mockup `.thread`) so the transcript uses the pane's **full width** with comfortable padding (`.pane-scroll { padding: 14px 16px }`). This keeps narrow panes (3-up, 2×2) readable.
- **Minimum pane width:** the surface enforces `MIN_PANE_WIDTH_PX`. When more panes are open than fit at that minimum, the surface **scrolls horizontally** rather than shrinking panes below it (e.g. give the tiles container a `min-width` computed from the leaf count × `MIN_PANE_WIDTH_PX`, with `overflow-x: auto` on the surface). Panes never shrink into an unreadable state. The page body must never scroll horizontally — only the surface's own scroll container does.

- [ ] **Step 1: Write failing test** — `TilingSurface.test.tsx`: assert the pane transcript container has no fixed centered max-width (its width tracks the pane), and that with many panes the surface exposes an `overflow-x: auto` scroll container whose content min-width reflects `MIN_PANE_WIDTH_PX × paneCount` (assert via the computed style or the applied inline `min-width`). Keep it a behavioural assertion, not a class-name snapshot.

- [ ] **Step 2: Run and verify FAIL.**
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace/TilingSurface.test.tsx`

- [ ] **Step 3: Implement** the full-width measure, `MIN_PANE_WIDTH_PX`, and the surface scroll.

- [ ] **Step 4: Run and verify PASS**, plus a manual check at 3-up and 2×2 that panes stay readable and the body never scrolls sideways.
      Run: `pnpm --filter @pi-web/web exec vitest run src/features/workspace`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/TilingSurface.tsx apps/web/src/features/workspace/TilingSurface.test.tsx apps/web/src/styles.css
git commit -m "feat(web): full-width panes with a minimum width and surface scroll"
```

---

### Task 13: End-to-end coverage, docs, and the tiling-spec supersession

**Files:**

- Modify: `e2e/workspace-tiling.spec.ts` (remove dock/collapse steps; add theme, status, environment, and undo coverage) — or create `e2e/workspace-codex.spec.ts` if cleaner
- Modify: `apps/web/README.md` (document themes, Settings, run status, Environment panel, Split/Close; strike the dock)
- Modify: `docs/product-specs/tiling-workspace-surface.md` (apply the [Superseded requirements] edits)
- Modify: `docs/product-specs/codex-workspace-surface.md` (set Implementation status; link this ExecPlan under "Related ExecPlans")
- Modify: `docs/exec-plans/active/index.md` (register this plan)

Supersession bookkeeping (from the spec's [Superseded requirements]) — edit `tiling-workspace-surface.md` so these no longer describe shipped behaviour: strike **TWS-04** (collapse/dock/restore), **TWS-05** (dock attention signal — note it is replaced by pane-header status CWS-03), **TWS-09** (docked panes cost almost nothing), the **TWS-06** "Collapse focused pane to dock" and "Restore last-docked / cycle dock" rows (retain all other rows), and the **TWS-01** "restoring it from the dock first if it is collapsed" clause; remove the **dock** term from Terminology and the dock-related acceptance items (5, 6, 11), and lift the right-panel and theming non-goals (now specified in CWS). Keep the two `.html` mockups untouched (they are device-local references).

- [ ] **Step 1: Write the failing/updated Playwright spec** — register/open a project; assert the surface uses the Codex styling (a user pill and a bubble-less assistant turn, tool activity under a "Worked for" header, an inline trust line — not a full-width banner); split right via the header Split button and via the chord; assert each pane header shows a labeled run status; open Settings, switch to Dark, assert `data-theme="dark"` on `<html>`, reload, assert the choice persisted before paint; toggle the Environment panel and assert it reflects the focused pane and updates when focus moves; close a pane and assert the "Undo" toast, click Undo, assert the pane returns; assert there is no dock strip and no horizontal page scroll. Follow the existing `e2e/workspace-tiling.spec.ts` server-boot + stub-runtime pattern.

- [ ] **Step 2: Run and verify FAIL (or red where features are exercised).**
      Run: `pnpm test:e2e --grep workspace`

- [ ] **Step 3: Make it pass**; apply the doc edits and the tiling-spec supersession. Keep all doc links relative so `docs:check` passes.

- [ ] **Step 4: Full verification.**
      Run: `pnpm check`
      Expected: format, lint, typecheck, unit, build, docs all PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/ apps/web/README.md docs/product-specs/tiling-workspace-surface.md docs/product-specs/codex-workspace-surface.md docs/exec-plans/active/index.md
git commit -m "test(web): e2e codex surface; supersede the tiling dock and document the surface"
```

---

## Self-review

- **Spec coverage:**
  - CWS-01 (Codex visual language) → Task 11 (transcript, trust line) + Tasks 2/7/9 (near-borderless cards, header, focus).
  - CWS-02 (light/dark, System default, live, before paint, token-only, no colour-only status) → Tasks 1/2/3, with the accessibility label enforced in Tasks 5/7/9.
  - CWS-03 (pane-header run status, elapsed timer, sidebar indicators, no focus steal) → Tasks 5/7/9.
  - CWS-04 (Split + Close only, immediate close + undo toast, focus ring, click-to-focus) → Tasks 7/8/9.
  - CWS-05 (dock tier removed; keybindings; attention relocated; every thread a full pane; v1→v2 migration restoring docked panes) → Task 6 (model/storage/keymap) + Task 9 (UI/CSS).
  - CWS-06 (Environment panel renders, single shared, focus-following, git summary, device-local visibility default) → Task 10.
  - CWS-07 (full-width transcript, minimum pane width, scroll) → Task 12.
  - CWS-08 (Settings page hosts theme selection, System default, structured for growth) → Task 4.
  - Superseded-requirements edits to the tiling spec → Task 13.
- **Placeholder scan:** none — every code step carries real code or a precise reuse instruction against named existing files and line ranges. The one deliberate dormant path (`needsApproval` seam) is explicit, tested, and authorised by the 2026-08-22 product decision.
- **Type consistency:** `ThemeChoice` (Tasks 1/3/4), `PaneRunStatus`/`PANE_STATUS_LABEL`/`PANE_STATUS_TOKEN`/`deriveRunStatus`/`elapsedLabel` (Tasks 5/7/9/10), `EnvironmentVisibility`/`isEnvironmentOpen` (Task 10), and the revised `WorkspaceLayout` (no `docked`) + `WorkspaceCommand` (no collapse/restore) + `WORKSPACE_LAYOUT_VERSION = 2` (Task 6) are each defined once and consumed with the same names throughout. `boundPaneId`/`bind` are retained unchanged per CWS-05. `getStatus`/`getSnapshot`/`archiveThread`/`startThread` are used with their real signatures from `apps/web/src/api/client.ts`.
- **Data-reality checks:** there is no `needs-approval` run state and no approval signal on the wire — handled by the dormant seam (Global Constraints + Task 5). There is no unarchive endpoint — handled by the deferred-archive undo (Task 8). `interrupted` has no distinct display status in the spec's four — mapped to `done` (settled, non-error) in Task 5.

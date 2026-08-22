import { z } from "zod";
import { ProjectIdSchema, ThreadIdSchema } from "@pi-web/contracts";

import type { TreeNode } from "../layout/binaryTree.js";
import { createEmptyPanel, openTab, panelStateProblems } from "./panelModel.js";
import type { GroupId, PanelState } from "./panelModel.js";
import type { NewPanelTab, PanelTab } from "./panelTabs.js";

// Device-local persistence for the workspace panel (WSP-04). Nothing here
// reaches the server, and every failure path lands on a usable panel rather
// than an exception: a browser with storage disabled must still work.

export const PANEL_STORAGE_KEY = "pi-workspace:panel";
export const PANEL_STATE_VERSION = 2;

// The shipped inspector's own key. Duplicated rather than imported from
// `inspectorPreferences.ts` because this migration has to outlive that
// module — the next phase deletes it, and users who skip a release still
// need their preference carried forward.
export const INSPECTOR_MIGRATION_KEY = "pi-workspace:inspector";

const TabContextSchema = z.object({
  projectId: ProjectIdSchema,
  threadId: ThreadIdSchema,
  scopeKey: z.string(),
  label: z.string(),
});

const PanelTabSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("changes"),
    context: TabContextSchema.nullable(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("files"),
    context: TabContextSchema.nullable(),
    search: z.string(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("file"),
    context: TabContextSchema.nullable(),
    path: z.string(),
    view: z.enum(["preview", "source"]),
  }),
  z.object({
    id: z.string(),
    type: z.literal("diff"),
    context: TabContextSchema.nullable(),
    path: z.string(),
    collapsedHunks: z.array(z.string()),
  }),
  z.object({
    id: z.string(),
    type: z.literal("terminal"),
    context: TabContextSchema.nullable(),
    cwd: z.string(),
    // Parsed but never trusted: see restoreTab.
    terminalId: z.string().nullable(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("browser"),
    context: z.null(),
    url: z.string(),
    history: z.array(z.string()),
    historyIndex: z.number(),
  }),
]);

type PersistedTab = z.infer<typeof PanelTabSchema>;

type GroupNode = TreeNode<"group", GroupId>;

const GroupNodeSchema: z.ZodType<GroupNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("group"), id: z.string() }),
    z.object({
      type: z.literal("split"),
      id: z.string(),
      axis: z.enum(["row", "column"]),
      children: z.tuple([GroupNodeSchema, GroupNodeSchema]),
      sizes: z.tuple([z.number(), z.number()]),
    }),
  ]),
);

const PanelStateSchema = z.object({
  version: z.literal(PANEL_STATE_VERSION),
  root: GroupNodeSchema.nullable(),
  groups: z.record(
    z.string(),
    z.object({
      id: z.string(),
      tabIds: z.array(z.string()),
      activeTabId: z.string().nullable(),
    }),
  ),
  tabs: z.record(z.string(), PanelTabSchema),
  focusedGroupId: z.string().nullable(),
  width: z.number(),
  open: z.boolean(),
});

// The shipped inspector preference this panel replaces.
const InspectorPreferencesV1Schema = z.object({
  version: z.literal(1),
  open: z.boolean(),
  activeTab: z.enum(["changes", "files", "terminal"]),
  width: z.number(),
});

interface PreferenceStorage {
  getItem(key: string): unknown;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storageMethods(value: object): PreferenceStorage | null {
  if (
    !("getItem" in value) ||
    !("setItem" in value) ||
    !("removeItem" in value)
  )
    return null;
  const { getItem, setItem, removeItem } = value;
  if (
    typeof getItem !== "function" ||
    typeof setItem !== "function" ||
    typeof removeItem !== "function"
  )
    return null;
  return {
    getItem: getItem.bind(value) as (key: string) => unknown,
    setItem: setItem.bind(value) as (key: string, stored: string) => void,
    removeItem: removeItem.bind(value) as (key: string) => void,
  };
}

function preferenceStorage(): PreferenceStorage | null {
  const storage: unknown = globalThis.localStorage;
  return typeof storage === "object" && storage !== null
    ? storageMethods(storage)
    : null;
}

function readJson(storage: PreferenceStorage | null, key: string): unknown {
  const stored = storage?.getItem(key);
  if (stored === null || stored === undefined) return undefined;
  if (typeof stored !== "string") {
    storage?.removeItem(key);
    return undefined;
  }
  try {
    return JSON.parse(stored);
  } catch {
    storage?.removeItem(key);
    return undefined;
  }
}

// A terminal tab always comes back detached. The process belongs to the
// server, not to this record: after a reload the tab re-attaches to a
// still-running process or reports it gone with a restart action (WSP-07),
// and a stale id would have it claim a process it does not have.
function restoreTab(tab: PersistedTab): PanelTab {
  if (tab.type === "terminal") return { ...tab, terminalId: null };
  return tab;
}

const CHANGES_TAB: NewPanelTab = { type: "changes", context: null };

// The panel a first-time user gets, and the one any record we refuse to
// trust falls back to: a single Changes tab, closed, at the default width
// (WSP-04). Built through openTab so it cannot drift from the invariants
// the model enforces.
function defaultPanelState(makeId: () => string): PanelState {
  const state = openTab(createEmptyPanel(makeId), CHANGES_TAB, makeId);
  return { ...state, open: false };
}

// A v1 inspector record names only the tab's type. The shipped inspector
// re-targeted itself at whatever chat pane was focused, so it never stored
// which thread its content belonged to — there is no context to recover.
// Rather than invent one, the migrated tab carries a null context and the
// UI binds it to the focused pane on first render.
function migratedTab(activeTab: "changes" | "files" | "terminal"): NewPanelTab {
  switch (activeTab) {
    case "changes":
      return CHANGES_TAB;
    case "files":
      return { type: "files", context: null, search: "" };
    case "terminal":
      return { type: "terminal", context: null, cwd: "", terminalId: null };
  }
}

function migrateFromInspector(
  storage: PreferenceStorage | null,
  makeId: () => string,
): PanelState | null {
  const parsed = InspectorPreferencesV1Schema.safeParse(
    readJson(storage, INSPECTOR_MIGRATION_KEY),
  );
  if (!parsed.success) return null;
  const { open, activeTab, width } = parsed.data;
  // The v1 record is left in place: it is only ever read when no v2 record
  // exists, so persisting the migrated panel is what ends the migration.
  // Removing it here would strand a user who rolls back a release.
  const state = openTab(
    createEmptyPanel(makeId),
    migratedTab(activeTab),
    makeId,
  );
  return { ...state, width, open };
}

export function readPanelState(
  makeId: () => string = () => crypto.randomUUID(),
): PanelState {
  try {
    const storage = preferenceStorage();
    const stored = readJson(storage, PANEL_STORAGE_KEY);
    if (stored !== undefined) {
      const parsed = PanelStateSchema.safeParse(stored);
      if (parsed.success) {
        const { root, groups, focusedGroupId, width, open } = parsed.data;
        const tabs = Object.fromEntries(
          Object.entries(parsed.data.tabs).map(([id, tab]) => [
            id,
            restoreTab(tab),
          ]),
        );
        const state: PanelState = {
          root,
          groups,
          tabs,
          focusedGroupId,
          width,
          open,
        };
        // Shape is not soundness: a record can parse cleanly and still have
        // a tree leaf with no group behind it, or a group activating a tab
        // it does not hold. Such a panel would render blank halves, so it is
        // reset rather than shown (WSP-04: never referenced-but-absent).
        if (panelStateProblems(state).length === 0) return state;
      }
      storage?.removeItem(PANEL_STORAGE_KEY);
      return defaultPanelState(makeId);
    }
    const migrated = migrateFromInspector(storage, makeId);
    if (migrated !== null) return migrated;
  } catch {
    // The panel is best-effort when browser storage is unavailable.
  }
  return defaultPanelState(makeId);
}

export function writePanelState(state: PanelState): void {
  try {
    preferenceStorage()?.setItem(
      PANEL_STORAGE_KEY,
      JSON.stringify({ version: PANEL_STATE_VERSION, ...state }),
    );
  } catch {
    // The in-memory panel remains usable when persistence is unavailable.
  }
}

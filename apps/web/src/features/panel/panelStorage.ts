import { z } from "zod";
import {
  ProjectIdSchema,
  RelativePathSchema,
  TerminalIdSchema,
  ThreadIdSchema,
} from "@pi-web/contracts";

import { normalizeSizes } from "../layout/binaryTree.js";
import type { TreeNode } from "../layout/binaryTree.js";
import { preferenceStorage } from "../storage/preferenceStorage.js";
import type { PreferenceStorage } from "../storage/preferenceStorage.js";
import { clampPanelWidth } from "./panelGeometry.js";
import {
  createEmptyPanel,
  openTab,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  panelStateProblems,
} from "./panelModel.js";
import type { GroupId, PanelState } from "./panelModel.js";
import { isEmbeddableAddress } from "./panelTabs.js";
import type { NewPanelTab, PanelTab } from "./panelTabs.js";

// Device-local persistence for the workspace panel (WSP-04). Nothing here
// reaches the server, and every failure path lands on a usable panel rather
// than an exception: a browser with storage disabled must still work.

export const PANEL_STORAGE_KEY = "pi-workspace:panel";
export const PANEL_STATE_VERSION = 4;

// Record versions this reader still accepts, and migrates on read.
//
// Version 3 added `expanded` and `showIgnored` to the `files` tab for the
// file tree (WSP-05 as revised by specification version 2). Version 4 added
// `wrap` to the `file` and `diff` tabs for the soft-wrap toggle (WSP-05 as
// revised by version 3, K5). That is the whole of each difference, and every
// one of those fields carries a default below, so an older record migrates by
// being parsed: the next write stamps it 4. The chain from the v1 inspector
// preference is unbroken — a device that has not opened the panel since the
// inspector shipped still migrates v1 -> v4 in one read, because the v1
// migration builds tabs through the model rather than through this schema.
const MIGRATABLE_PANEL_VERSIONS = [2, 3] as const;

// The shipped inspector's own key. Held here rather than imported, because
// this migration has to outlive the module that wrote it: that module is
// gone, and a user who skips a release still needs their preference carried
// forward.
export const INSPECTOR_MIGRATION_KEY = "pi-workspace:inspector";

const TabContextSchema = z.object({
  projectId: ProjectIdSchema,
  threadId: ThreadIdSchema,
  scopeKey: z.string(),
  label: z.string(),
});

// A persisted expansion entry is an arbitrary string that becomes a listing
// request, so it is held to the same shape the server's own path parser
// enforces: no absolute, drive, UNC, `..`, NUL, or backslash spelling ever
// reaches a query string from this record.
function isRestorableDirectoryPath(value: unknown): value is string {
  return (
    typeof value === "string" && RelativePathSchema.safeParse(value).success
  );
}

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
    // Each entry becomes a listing request, so it is parsed with the same
    // relative-path rules the route re-applies to whatever it receives. A
    // malformed entry drops that entry from the expansion set rather than
    // resetting the tab: an expansion is a convenience, and losing the whole
    // panel over one bad string would be the larger failure. The defaults
    // are the version 2 -> 3 migration.
    expanded: z
      .array(z.unknown())
      .default([])
      .transform((values) => values.filter(isRestorableDirectoryPath)),
    showIgnored: z.boolean().default(false),
  }),
  z.object({
    id: z.string(),
    type: z.literal("file"),
    context: TabContextSchema.nullable(),
    path: z.string(),
    view: z.enum(["preview", "source"]),
    // The version 3 -> 4 migration: scrolling is what the tab did before the
    // toggle existed, so a record written without one comes back scrolling.
    wrap: z.boolean().default(false),
  }),
  z.object({
    id: z.string(),
    type: z.literal("diff"),
    context: TabContextSchema.nullable(),
    path: z.string(),
    collapsedHunks: z.array(z.string()),
    wrap: z.boolean().default(false),
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
  version: z.union([
    z.literal(PANEL_STATE_VERSION),
    ...MIGRATABLE_PANEL_VERSIONS.map((version) => z.literal(version)),
  ]),
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

// The shipped inspector preference this panel replaces, with the width bound
// it was written under. The panel must not accept a record that the record's
// own writer would have refused: relaxing this to a bare number let a
// hand-edited `width: 0` through, and a 0px panel has no resize edge to grab.
const InspectorPreferencesV1Schema = z.object({
  version: z.literal(1),
  open: z.boolean(),
  activeTab: z.enum(["changes", "files", "terminal"]),
  width: z.number().int().min(PANEL_MIN_WIDTH).max(PANEL_MAX_WIDTH),
});

// The width bound that holds with no viewport to measure against. A record
// is read before anything is laid out, so `clampPanelWidth` is given an
// unbounded viewport here and applied again — against the real one — when
// the panel is rendered and resized.
function storedWidth(width: number): number {
  return clampPanelWidth(width, Number.POSITIVE_INFINITY);
}

// WSP-01's clamped size fractions are a promise about what is rendered, so
// they have to hold for fractions that arrive from storage as much as for
// ones a divider drag produced. `[0, 1]` parses as a pair of numbers and
// would render a tile with no grabbable edge.
function normalizedTree(node: GroupNode): GroupNode {
  if (node.type !== "split") return node;
  return {
    ...node,
    children: [
      normalizedTree(node.children[0]),
      normalizedTree(node.children[1]),
    ],
    sizes: normalizeSizes(node.sizes),
  };
}

// How deeply a stored record may nest. The panel's tree costs two JSON
// levels per split (the split object, then its `children` array), so this
// allows about 48 nested splits — far more groups than a screen can show,
// and far less than the stack can take.
//
// The bound exists because depth is the one malformation that is not a parse
// *failure*: the v2 schema is recursive, so a deep enough tree overflows the
// stack inside `safeParse` — and inside every recursive walk after it. That
// RangeError is thrown, not returned, so it escaped to the outer handler,
// which is the one path that did not quarantine the record. The panel then
// reset on every reload, forever, with no way for the user to recover.
const MAX_RECORD_DEPTH = 100;

// Iterative on purpose: a recursive depth check would overflow on exactly
// the records it exists to reject.
function exceedsDepth(value: unknown, limit: number): boolean {
  const pending: { node: unknown; depth: number }[] = [
    { node: value, depth: 0 },
  ];
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    const { node, depth } = entry;
    if (typeof node !== "object" || node === null) continue;
    if (depth >= limit) return true;
    for (const child of Object.values(node))
      pending.push({ node: child, depth: depth + 1 });
  }
  return false;
}

function readJson(storage: PreferenceStorage | null, key: string): unknown {
  const stored = storage?.getItem(key);
  if (stored === null || stored === undefined) return undefined;
  if (typeof stored !== "string") {
    storage?.removeItem(key);
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    storage?.removeItem(key);
    return undefined;
  }
  if (exceedsDepth(parsed, MAX_RECORD_DEPTH)) {
    storage?.removeItem(key);
    return undefined;
  }
  return parsed;
}

// A terminal tab comes back naming the process it was attached to and the
// directory it was in (WSP-07): that is what lets a reload re-attach to a
// still-running shell, with replay, instead of orphaning it or starting a
// second one. Neither field is trusted — the id is a claim the server checks
// against what it actually owns, and answers `terminal_gone` for anything
// else, and the directory becomes a spawn path that the server resolves and
// contains. What this does is refuse to send either one in a shape its own
// contract would reject, because both come from a key any script on the
// origin can write.
//
// A browser tab comes back with only the addresses WSP-08 allows. A rejected
// one is cleared from the tab rather than carried in state for the component
// to refuse later: a `javascript:` address reaching an `iframe` `src` runs
// on the workspace's own origin, and `history` feeds the same `src` one back
// press later, so it is filtered too — which is what makes `historyIndex`
// meaningful again.
function restoreTab(tab: PersistedTab): PanelTab {
  if (tab.type === "terminal") {
    const terminalId = TerminalIdSchema.safeParse(tab.terminalId);
    return {
      ...tab,
      // "" is the execution root, which is where a terminal starts when it
      // has nowhere else recorded.
      cwd: RelativePathSchema.safeParse(tab.cwd).success ? tab.cwd : "",
      terminalId: terminalId.success ? terminalId.data : null,
    };
  }
  if (tab.type === "browser") {
    const history = tab.history.filter(isEmbeddableAddress);
    return {
      ...tab,
      url: isEmbeddableAddress(tab.url) ? tab.url : "",
      history,
      historyIndex: restoredHistoryIndex(tab.historyIndex, history.length),
    };
  }
  return tab;
}

// -1 is "nowhere in the history", which is the only honest position when the
// history is empty. Anything else is brought inside the history it indexes,
// so a stored `historyIndex: 99` beside an empty `history` cannot make back
// and forward controls claim a page that is not there.
function restoredHistoryIndex(stored: number, length: number): number {
  if (length === 0) return -1;
  if (!Number.isFinite(stored)) return 0;
  return Math.min(Math.max(Math.trunc(stored), 0), length - 1);
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
      return {
        type: "files",
        context: null,
        search: "",
        expanded: [],
        showIgnored: false,
      };
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
  return { ...state, width: storedWidth(width), open };
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
          root: root === null ? null : normalizedTree(root),
          groups,
          tabs,
          focusedGroupId,
          width: storedWidth(width),
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
    // The panel is best-effort when browser storage is unavailable — but a
    // record that made the read throw is a record that will make the next
    // read throw too, so it is quarantined like any other one we refused to
    // trust rather than left to reset the panel on every reload.
    discardPanelRecord();
  }
  return defaultPanelState(makeId);
}

// Removing the key is itself a storage call, so it can throw for exactly the
// reason we are already here (storage denied); a failure to quarantine must
// not become a failure to return a panel.
function discardPanelRecord(): void {
  try {
    preferenceStorage()?.removeItem(PANEL_STORAGE_KEY);
  } catch {
    // Nothing left to try: the in-memory default panel is still usable.
  }
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

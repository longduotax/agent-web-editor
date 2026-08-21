import { z } from "zod";
import { ThreadIdSchema } from "@pi-web/contracts";
import type { ProjectId } from "@pi-web/contracts";

import { createInitialLayout, restoreIntoTree } from "./layoutTree.js";
import type { LayoutNode, PaneId, WorkspaceLayout } from "./layoutTree.js";

export const WORKSPACE_LAYOUT_VERSION = 2;

const LayoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("pane"),
      id: z.string(),
    }),
    z.object({
      type: z.literal("split"),
      id: z.string(),
      axis: z.enum(["row", "column"]),
      children: z.tuple([LayoutNodeSchema, LayoutNodeSchema]),
      sizes: z.tuple([z.number(), z.number()]),
    }),
  ]),
);

// Retained only to read pre-migration (v1) payloads, which had a
// `docked: PaneId[]` collapse-to-dock tier that v2 no longer has.
const WorkspaceLayoutV1Schema = z.object({
  version: z.literal(1),
  root: LayoutNodeSchema.nullable(),
  panes: z.record(
    z.string(),
    z.object({ threadId: ThreadIdSchema.nullable() }),
  ),
  docked: z.array(z.string()),
  focusedPaneId: z.string().nullable(),
  boundPaneId: z.string().nullable(),
});

const WorkspaceLayoutSchema = z.object({
  version: z.literal(2),
  root: LayoutNodeSchema.nullable(),
  panes: z.record(
    z.string(),
    z.object({ threadId: ThreadIdSchema.nullable() }),
  ),
  focusedPaneId: z.string().nullable(),
  boundPaneId: z.string().nullable(),
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

export function layoutStorageKey(projectId: ProjectId): string {
  return `pi-workspace:layout:${projectId}`;
}

export function readLayout(
  projectId: ProjectId,
  makeId: () => PaneId,
): WorkspaceLayout {
  const key = layoutStorageKey(projectId);
  try {
    const storage = preferenceStorage();
    const stored = storage?.getItem(key);
    if (stored === null || stored === undefined)
      return createInitialLayout(makeId);
    if (typeof stored !== "string") {
      storage?.removeItem(key);
      return createInitialLayout(makeId);
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stored);
    } catch {
      storage?.removeItem(key);
      return createInitialLayout(makeId);
    }
    const parsed = WorkspaceLayoutSchema.safeParse(parsedJson);
    if (parsed.success) {
      const { root, panes, focusedPaneId, boundPaneId } = parsed.data;
      return { root, panes, focusedPaneId, boundPaneId };
    }
    const parsedV1 = WorkspaceLayoutV1Schema.safeParse(parsedJson);
    if (parsedV1.success) {
      const { root, panes, docked, focusedPaneId, boundPaneId } =
        parsedV1.data;
      let migrated: WorkspaceLayout = {
        root,
        panes,
        focusedPaneId,
        boundPaneId,
      };
      // Fold every previously-docked pane back into the tiled tree — a v1
      // docked pane must never be dropped by the migration.
      for (const id of docked) migrated = restoreIntoTree(migrated, id);
      return migrated;
    }
    storage?.removeItem(key);
  } catch {
    // Workspace layout is best-effort when browser storage is unavailable.
  }
  return createInitialLayout(makeId);
}

export function writeLayout(
  projectId: ProjectId,
  layout: WorkspaceLayout,
): void {
  try {
    preferenceStorage()?.setItem(
      layoutStorageKey(projectId),
      JSON.stringify({ version: WORKSPACE_LAYOUT_VERSION, ...layout }),
    );
  } catch {
    // The in-memory layout remains usable when persistence is unavailable.
  }
}

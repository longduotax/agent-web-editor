import { z } from "zod";
import { ThreadIdSchema } from "@pi-web/contracts";
import type { ProjectId } from "@pi-web/contracts";

import { preferenceStorage } from "../storage/preferenceStorage.js";
import { createInitialLayout, restoreIntoTree } from "./layoutTree.js";
import type { LayoutNode, PaneId, WorkspaceLayout } from "./layoutTree.js";

export const WORKSPACE_LAYOUT_VERSION = 3;

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

const LegacyPaneSchema = z.object({ threadId: ThreadIdSchema.nullable() });

// Retained only to read pre-migration (v1) payloads, which had a
// `docked: PaneId[]` collapse-to-dock tier.
const WorkspaceLayoutV1Schema = z.object({
  version: z.literal(1),
  root: LayoutNodeSchema.nullable(),
  panes: z.record(z.string(), LegacyPaneSchema),
  docked: z.array(z.string()),
  focusedPaneId: z.string().nullable(),
  boundPaneId: z.string().nullable(),
});

const WorkspaceLayoutV2Schema = z.object({
  version: z.literal(2),
  root: LayoutNodeSchema.nullable(),
  panes: z.record(z.string(), LegacyPaneSchema),
  focusedPaneId: z.string().nullable(),
  boundPaneId: z.string().nullable(),
});

const PaneAssignmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thread"), threadId: ThreadIdSchema }),
  z.object({ type: z.literal("new") }),
  z.object({
    type: z.literal("continuation"),
    sourceThreadId: ThreadIdSchema,
  }),
]);

const WorkspaceLayoutSchema = z.object({
  version: z.literal(3),
  root: LayoutNodeSchema.nullable(),
  panes: z.record(z.string(), PaneAssignmentSchema),
  focusedPaneId: z.string().nullable(),
  boundPaneId: z.string().nullable(),
});

function migratePanes(
  panes: Record<string, z.infer<typeof LegacyPaneSchema>>,
): WorkspaceLayout["panes"] {
  return Object.fromEntries(
    Object.entries(panes).map(([id, pane]) => [
      id,
      pane.threadId === null
        ? { type: "new" as const }
        : { type: "thread" as const, threadId: pane.threadId },
    ]),
  );
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
    const parsedV2 = WorkspaceLayoutV2Schema.safeParse(parsedJson);
    if (parsedV2.success) {
      const { root, panes, focusedPaneId, boundPaneId } = parsedV2.data;
      return {
        root,
        panes: migratePanes(panes),
        focusedPaneId,
        boundPaneId,
      };
    }
    const parsedV1 = WorkspaceLayoutV1Schema.safeParse(parsedJson);
    if (parsedV1.success) {
      const { root, panes, docked, focusedPaneId, boundPaneId } = parsedV1.data;
      let migrated: WorkspaceLayout = {
        root,
        panes: migratePanes(panes),
        focusedPaneId,
        boundPaneId,
      };
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

interface DraftStorage {
  getItem(key: string): unknown;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storageMethods(value: object): DraftStorage | null {
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

function draftStorage(): DraftStorage | null {
  const storage: unknown = globalThis.localStorage;
  return typeof storage === "object" && storage !== null
    ? storageMethods(storage)
    : null;
}

export function readDraft(key: string): string {
  try {
    const value = draftStorage()?.getItem(key);
    return typeof value === "string" ? value : "";
  } catch {
    // Browser storage can be disabled or replaced by an incomplete test shim.
  }
  return "";
}

export function writeDraft(key: string, value: string): void {
  try {
    // An empty draft is not a draft. Storing it left one key per pane the
    // user had merely opened, forever -- the keys are never revisited once
    // the pane is gone, so storage grew without bound.
    if (value === "") draftStorage()?.removeItem(key);
    else draftStorage()?.setItem(key, value);
  } catch {
    // Draft persistence is best-effort.
  }
}

export function removeDraft(key: string): void {
  try {
    draftStorage()?.removeItem(key);
  } catch {
    // Draft persistence is best-effort.
  }
}

// One draft per PANE, not per project: two new-chat panes can be open for the
// same project at once, and a project-wide key made them share (and clobber)
// a single draft.
export function newChatDraftKey(projectId: string, paneId: string): string {
  return `pi-new-draft:${projectId}:${paneId}`;
}

/**
 * Removes every new-chat draft belonging to `projectId` whose pane is no
 * longer in the layout.
 *
 * Closing a pane drops its own key, but keys written before that fix (and any
 * left by a layout restored from another device) have no owner left to clean
 * them up, so they would sit in storage forever.
 */
export function pruneNewChatDrafts(
  projectId: string,
  livePaneIds: readonly string[],
): void {
  try {
    const storage: unknown = globalThis.localStorage;
    if (typeof storage !== "object" || storage === null) return;
    const { length, key, removeItem } = storage as {
      length?: unknown;
      key?: unknown;
      removeItem?: unknown;
    };
    // A test shim or a restricted browser may expose only get/set/remove.
    if (
      typeof length !== "number" ||
      typeof key !== "function" ||
      typeof removeItem !== "function"
    )
      return;
    const prefix = `pi-new-draft:${projectId}:`;
    // Drafts predate per-pane keys and were stored project-wide under
    // `pi-new-draft:<projectId>` with no pane suffix. That key can never be
    // read or written again, and the prefix above (with its trailing colon)
    // does not match it, so it survived every prune (NEW-R3-5).
    const legacyKey = `pi-new-draft:${projectId}`;
    const live = new Set(livePaneIds.map((paneId) => prefix + paneId));
    const stale: string[] = [];
    const readKey = key.bind(storage) as (index: number) => string | null;
    for (let index = 0; index < length; index += 1) {
      const candidate = readKey(index);
      if (candidate === null) continue;
      if (candidate === legacyKey) {
        stale.push(candidate);
        continue;
      }
      if (candidate.startsWith(prefix) && !live.has(candidate))
        stale.push(candidate);
    }
    const drop = removeItem.bind(storage) as (name: string) => void;
    for (const name of stale) drop(name);
  } catch {
    // Draft persistence is best-effort.
  }
}

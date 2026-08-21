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
    draftStorage()?.setItem(key, value);
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

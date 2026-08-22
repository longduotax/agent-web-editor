// The one guarded handle on `localStorage` that every device-local
// preference reads and writes through: the workspace layout, the workspace
// panel, the theme choice, and composer drafts.
//
// It is a guard rather than a direct use because `globalThis.localStorage`
// is not reliably a Storage: a browser can refuse it outright, a privacy
// mode can leave it present but throwing, and a test shim can expose two of
// its three methods. Everything downstream wants one answer to "can I store
// preferences?", so the check happens once, here, and the callers get a
// handle or null.
//
// The methods are bound to the storage object, so a caller holding the
// handle cannot lose `this` by destructuring it.

export interface PreferenceStorage {
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

/**
 * The device's preference storage, or null when there is nothing usable to
 * store in. `getItem` returns `unknown` deliberately: a real Storage yields
 * strings, but this handle is only as trustworthy as whatever is standing in
 * for one, so the caller parses.
 *
 * Calls can still throw after this returns a handle — storage that is
 * present but denied throws on access, not on lookup — so every caller wraps
 * its use in its own try/catch and falls back to an in-memory default.
 */
export function preferenceStorage(): PreferenceStorage | null {
  const storage: unknown = globalThis.localStorage;
  return typeof storage === "object" && storage !== null
    ? storageMethods(storage)
    : null;
}

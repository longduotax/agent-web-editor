import { z } from "zod";

// Device-local visibility for the single, shared, focus-following Environment
// panel (CWS-06). Tri-state: "auto" follows the surface's tile count (open
// at <= 1 tiled pane, hidden once it tiles), while "shown"/"hidden" are an
// explicit user override that sticks regardless of pane count.
export type EnvironmentVisibility = "auto" | "shown" | "hidden";

const EnvironmentPreferencesSchema = z.object({
  version: z.literal(1),
  visibility: z.enum(["auto", "shown", "hidden"]),
});

export const ENVIRONMENT_PREFERENCE_VERSION = 1;
export const ENVIRONMENT_PREFERENCE_KEY = "pi-workspace:environment";

const DEFAULT_ENVIRONMENT_VISIBILITY: EnvironmentVisibility = "auto";

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

export function readEnvironmentVisibility(): EnvironmentVisibility {
  try {
    const storage = preferenceStorage();
    const stored = storage?.getItem(ENVIRONMENT_PREFERENCE_KEY);
    if (stored === null || stored === undefined)
      return DEFAULT_ENVIRONMENT_VISIBILITY;
    if (typeof stored !== "string") {
      storage?.removeItem(ENVIRONMENT_PREFERENCE_KEY);
      return DEFAULT_ENVIRONMENT_VISIBILITY;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stored);
    } catch {
      storage?.removeItem(ENVIRONMENT_PREFERENCE_KEY);
      return DEFAULT_ENVIRONMENT_VISIBILITY;
    }
    const parsed = EnvironmentPreferencesSchema.safeParse(parsedJson);
    if (parsed.success) return parsed.data.visibility;
    storage?.removeItem(ENVIRONMENT_PREFERENCE_KEY);
  } catch {
    // UI preferences are best-effort when browser storage is unavailable.
  }
  return DEFAULT_ENVIRONMENT_VISIBILITY;
}

export function writeEnvironmentVisibility(
  visibility: EnvironmentVisibility,
): void {
  try {
    preferenceStorage()?.setItem(
      ENVIRONMENT_PREFERENCE_KEY,
      JSON.stringify({
        version: ENVIRONMENT_PREFERENCE_VERSION,
        visibility,
      }),
    );
  } catch {
    // The in-memory preference remains usable when persistence is unavailable.
  }
}

// "auto" resolves to shown while the surface has <= 1 tiled pane, hidden once
// it tiles (a fresh device starts single-pane, so the panel is visible until
// splitting crowds it out); "shown"/"hidden" are unconditional.
export function isEnvironmentOpen(
  visibility: EnvironmentVisibility,
  tiledPaneCount: number,
): boolean {
  switch (visibility) {
    case "shown":
      return true;
    case "hidden":
      return false;
    case "auto":
      return tiledPaneCount <= 1;
  }
}

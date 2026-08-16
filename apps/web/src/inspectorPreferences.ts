import { z } from "zod";

export const INSPECTOR_TABS = ["changes", "files", "terminal"] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];
export const INSPECTOR_MIN_WIDTH = 280;
export const INSPECTOR_MAX_WIDTH = 4096;

const InspectorPreferencesSchema = z.object({
  version: z.literal(1),
  open: z.boolean(),
  activeTab: z.enum(INSPECTOR_TABS),
  width: z.number().int().min(INSPECTOR_MIN_WIDTH).max(INSPECTOR_MAX_WIDTH),
});

export type InspectorPreferences = z.infer<typeof InspectorPreferencesSchema>;

export const INSPECTOR_PREFERENCES_KEY = "pi-workspace:inspector";

export const DEFAULT_INSPECTOR_PREFERENCES: InspectorPreferences = {
  version: 1,
  open: false,
  activeTab: "changes",
  width: 400,
};

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

export function readInspectorPreferences(): InspectorPreferences {
  try {
    const storage = preferenceStorage();
    const stored = storage?.getItem(INSPECTOR_PREFERENCES_KEY);
    if (stored === null || stored === undefined)
      return DEFAULT_INSPECTOR_PREFERENCES;
    if (typeof stored !== "string") {
      storage?.removeItem(INSPECTOR_PREFERENCES_KEY);
      return DEFAULT_INSPECTOR_PREFERENCES;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stored);
    } catch {
      storage?.removeItem(INSPECTOR_PREFERENCES_KEY);
      return DEFAULT_INSPECTOR_PREFERENCES;
    }
    const parsed = InspectorPreferencesSchema.safeParse(parsedJson);
    if (parsed.success) return parsed.data;
    storage?.removeItem(INSPECTOR_PREFERENCES_KEY);
  } catch {
    // UI preferences are best-effort when browser storage is unavailable.
  }
  return DEFAULT_INSPECTOR_PREFERENCES;
}

export function writeInspectorPreferences(
  preferences: InspectorPreferences,
): void {
  try {
    preferenceStorage()?.setItem(
      INSPECTOR_PREFERENCES_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    // The in-memory preference remains usable when persistence is unavailable.
  }
}

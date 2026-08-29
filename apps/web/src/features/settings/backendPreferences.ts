import type { RuntimeKind } from "@pi-web/contracts";
import { z } from "zod";

/**
 * "follow-machine" defers to whatever the server was configured with, so an
 * operator's PI_WEB_DEFAULT_RUNTIME still governs every browser that has not
 * deliberately chosen otherwise (AGB-02).
 */
export type BackendChoice = "follow-machine" | RuntimeKind;

const BackendPreferencesSchema = z.object({
  version: z.literal(1),
  choice: z.enum(["follow-machine", "pi", "codex"]),
});

export const BACKEND_PREFERENCE_VERSION = 1;
export const BACKEND_PREFERENCE_KEY = "pi-workspace:default-backend";

const DEFAULT_BACKEND_CHOICE: BackendChoice = "follow-machine";
/** Used only when the server has not said what the machine default is. */
const FALLBACK_RUNTIME: RuntimeKind = "codex";

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

export function readBackendChoice(): BackendChoice {
  try {
    const storage = preferenceStorage();
    const stored = storage?.getItem(BACKEND_PREFERENCE_KEY);
    if (stored === null || stored === undefined) return DEFAULT_BACKEND_CHOICE;
    if (typeof stored !== "string") {
      storage?.removeItem(BACKEND_PREFERENCE_KEY);
      return DEFAULT_BACKEND_CHOICE;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stored);
    } catch {
      storage?.removeItem(BACKEND_PREFERENCE_KEY);
      return DEFAULT_BACKEND_CHOICE;
    }
    const parsed = BackendPreferencesSchema.safeParse(parsedJson);
    if (parsed.success) return parsed.data.choice;
    storage?.removeItem(BACKEND_PREFERENCE_KEY);
  } catch {
    // UI preferences are best-effort when browser storage is unavailable.
  }
  return DEFAULT_BACKEND_CHOICE;
}

export function writeBackendChoice(choice: BackendChoice): void {
  try {
    preferenceStorage()?.setItem(
      BACKEND_PREFERENCE_KEY,
      JSON.stringify({ version: BACKEND_PREFERENCE_VERSION, choice }),
    );
  } catch {
    // The in-memory preference remains usable when persistence is unavailable.
  }
}

/** Device preference, then machine default, then Codex (AGB-02). */
export function resolveDefaultBackend(
  choice: BackendChoice,
  machineDefault: RuntimeKind | undefined,
): RuntimeKind {
  if (choice !== "follow-machine") return choice;
  return machineDefault ?? FALLBACK_RUNTIME;
}

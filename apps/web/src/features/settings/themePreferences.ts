import { z } from "zod";
import { preferenceStorage } from "../storage/preferenceStorage.js";

export type ThemeChoice = "system" | "light" | "dark";

const ThemePreferencesSchema = z.object({
  version: z.literal(1),
  choice: z.enum(["system", "light", "dark"]),
});

export type ThemePreferences = z.infer<typeof ThemePreferencesSchema>;

export const THEME_PREFERENCE_VERSION = 1;
export const THEME_PREFERENCE_KEY = "pi-workspace:theme";

const DEFAULT_THEME_CHOICE: ThemeChoice = "system";

export function readThemeChoice(): ThemeChoice {
  try {
    const storage = preferenceStorage();
    const stored = storage?.getItem(THEME_PREFERENCE_KEY);
    if (stored === null || stored === undefined) return DEFAULT_THEME_CHOICE;
    if (typeof stored !== "string") {
      storage?.removeItem(THEME_PREFERENCE_KEY);
      return DEFAULT_THEME_CHOICE;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stored);
    } catch {
      storage?.removeItem(THEME_PREFERENCE_KEY);
      return DEFAULT_THEME_CHOICE;
    }
    const parsed = ThemePreferencesSchema.safeParse(parsedJson);
    if (parsed.success) return parsed.data.choice;
    storage?.removeItem(THEME_PREFERENCE_KEY);
  } catch {
    // UI preferences are best-effort when browser storage is unavailable.
  }
  return DEFAULT_THEME_CHOICE;
}

export function writeThemeChoice(choice: ThemeChoice): void {
  try {
    preferenceStorage()?.setItem(
      THEME_PREFERENCE_KEY,
      JSON.stringify({ version: THEME_PREFERENCE_VERSION, choice }),
    );
  } catch {
    // The in-memory preference remains usable when persistence is unavailable.
  }
}

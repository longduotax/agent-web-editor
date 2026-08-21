import { useCallback, useEffect, useState } from "react";

import {
  readThemeChoice,
  writeThemeChoice,
  type ThemeChoice,
} from "./themePreferences.js";

export function applyThemeChoice(choice: ThemeChoice): void {
  if (choice === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", choice);
  }
}

export interface ThemeController {
  choice: ThemeChoice;
  setChoice(choice: ThemeChoice): void;
}

export function useTheme(): ThemeController {
  const [choice, setChoiceState] = useState<ThemeChoice>(() =>
    readThemeChoice(),
  );

  useEffect(() => {
    applyThemeChoice(choice);
  }, [choice]);

  useEffect(() => {
    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyThemeChoice("system");
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    writeThemeChoice(next);
    setChoiceState(next);
  }, []);

  return { choice, setChoice };
}

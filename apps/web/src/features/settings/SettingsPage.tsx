import type { ThemeChoice } from "./themePreferences.js";
import { useTheme } from "./useTheme.js";

const THEME_OPTIONS: readonly { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsPage() {
  const theme = useTheme();

  return (
    <main className="center settings-page">
      <div className="settings-body">
        <h1>Settings</h1>
        <section
          className="settings-section"
          aria-labelledby="settings-theme-heading"
        >
          <h2 id="settings-theme-heading">Theme</h2>
          <p className="settings-section-description">
            Choose how Pi Workspace looks on this device. This preference is
            stored locally and does not sync across devices.
          </p>
          <div role="radiogroup" aria-label="Theme" className="theme-control">
            {THEME_OPTIONS.map((option) => (
              <label key={option.value} className="theme-option">
                <input
                  type="radio"
                  name="theme"
                  value={option.value}
                  checked={theme.choice === option.value}
                  onChange={() => {
                    theme.setChoice(option.value);
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

import {
  detectPlatform,
  shortcutKeys,
  WORKSPACE_KEYBINDINGS,
} from "../workspace/keybindings.js";
import type { ThemeChoice } from "./themePreferences.js";
import { useTheme } from "./useTheme.js";

const THEME_OPTIONS: readonly { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsPage() {
  const theme = useTheme();
  // Rendered from the same table resolveCommand dispatches from, so the list
  // cannot drift from the bindings and an inert chord cannot be advertised.
  const platform = detectPlatform(navigator);

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
        <section
          className="settings-section"
          aria-labelledby="settings-shortcuts-heading"
        >
          <h2 id="settings-shortcuts-heading">Keyboard shortcuts</h2>
          <p className="settings-section-description">
            Pane and panel shortcuts work anywhere in the workspace, except
            while you are typing in a composer.
          </p>
          <dl className="shortcut-list">
            {WORKSPACE_KEYBINDINGS.map((binding) => (
              <div className="shortcut-row" key={binding.label}>
                <dt>{binding.label}</dt>
                <dd>
                  {shortcutKeys(binding, platform).map((keyLabel) => (
                    <kbd key={keyLabel}>{keyLabel}</kbd>
                  ))}
                </dd>
              </div>
            ))}
            <div className="shortcut-row">
              <dt>Send a message</dt>
              <dd>
                <kbd>Enter</kbd>
              </dd>
            </div>
            <div className="shortcut-row">
              <dt>New line in a message</dt>
              <dd>
                <kbd>⇧</kbd>
                <kbd>Enter</kbd>
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </main>
  );
}

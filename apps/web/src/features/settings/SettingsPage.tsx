import {
  detectPlatform,
  shortcutKeys,
  WORKSPACE_KEYBINDINGS,
} from "../workspace/keybindings.js";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getAgentBackends } from "../../api/client.js";
import {
  readBackendChoice,
  writeBackendChoice,
  type BackendChoice,
} from "./backendPreferences.js";
import type { ThemeChoice } from "./themePreferences.js";
import { useTheme } from "./useTheme.js";

const THEME_OPTIONS: readonly { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const BACKEND_LABEL: Record<string, string> = { pi: "Pi", codex: "Codex" };

export function SettingsPage() {
  const theme = useTheme();
  const [backendChoice, setBackendChoice] = useState<BackendChoice>(() =>
    readBackendChoice(),
  );
  const backends = useQuery({
    queryKey: ["agent-backends"],
    queryFn: getAgentBackends,
  });
  const machineDefault = backends.data?.defaultRuntime;
  const backendOptions: readonly { value: BackendChoice; label: string }[] = [
    {
      value: "follow-machine",
      label:
        machineDefault === undefined
          ? "Follow this machine"
          : `Follow this machine (${BACKEND_LABEL[machineDefault] ?? machineDefault})`,
    },
    { value: "pi", label: "Pi" },
    { value: "codex", label: "Codex" },
  ];
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
          aria-labelledby="settings-backend-heading"
        >
          <h2 id="settings-backend-heading">Default agent</h2>
          <p className="settings-section-description">
            Which coding agent new chats start on. Existing chats never change
            agent. This preference is stored locally and does not sync across
            devices.
          </p>
          <div
            role="radiogroup"
            aria-label="Default agent"
            className="theme-control"
          >
            {backendOptions.map((option) => {
              const backend = backends.data?.backends.find(
                (entry) => entry.kind === option.value,
              );
              const unusable = backend !== undefined && !backend.available;
              return (
                <label key={option.value} className="theme-option">
                  <input
                    type="radio"
                    name="default-agent"
                    value={option.value}
                    checked={backendChoice === option.value}
                    disabled={unusable}
                    onChange={() => {
                      setBackendChoice(option.value);
                      writeBackendChoice(option.value);
                    }}
                  />
                  <span>
                    {option.label}
                    {unusable && (
                      <span className="settings-option-note">
                        {` — ${backend.reason ?? "unavailable"}`}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </section>
        <section
          className="settings-section"
          aria-labelledby="settings-shortcuts-heading"
        >
          <h2 id="settings-shortcuts-heading">Keyboard shortcuts</h2>
          <p className="settings-section-description">
            Pane shortcuts work anywhere in the workspace, except while you are
            typing in a composer.
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

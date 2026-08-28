import type { JSX, ReactNode } from "react";

import {
  asPanelCommand,
  detectPlatform,
  shortcutKeys,
  WORKSPACE_KEYBINDINGS,
  type KeyBinding,
  type Platform,
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

/**
 * The composer's keys, which are not in WORKSPACE_KEYBINDINGS because they are
 * handled by the textarea itself rather than by the window-level chord
 * resolver. They are listed FIRST: these three are the only shortcuts every
 * user needs, and they used to sit below sixteen rows of pane and panel
 * management where nobody would scroll to find them.
 */
const COMPOSER_SHORTCUTS: readonly {
  label: string;
  keys: readonly string[];
}[] = [
  { label: "Send a message", keys: ["Enter"] },
  { label: "New line in a message", keys: ["⇧", "Enter"] },
  { label: "Leave the composer, keeping the draft", keys: ["Esc"] },
];

function ShortcutRow({
  label,
  keys,
}: {
  label: string;
  keys: readonly string[];
}): JSX.Element {
  return (
    <div className="shortcut-row">
      <dt>{label}</dt>
      <dd>
        {keys.map((keyLabel) => (
          <kbd key={keyLabel}>{keyLabel}</kbd>
        ))}
      </dd>
    </div>
  );
}

function ShortcutGroup({
  heading,
  note,
  children,
}: {
  heading: string;
  note?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="shortcut-group">
      <h3 className="shortcut-group-heading">{heading}</h3>
      {note !== undefined && <p className="shortcut-group-note">{note}</p>}
      <dl className="shortcut-list">{children}</dl>
    </div>
  );
}

function bindingRows(
  bindings: readonly KeyBinding[],
  platform: Platform,
): JSX.Element[] {
  return bindings.map((binding) => (
    <ShortcutRow
      key={binding.label}
      label={binding.label}
      keys={shortcutKeys(binding, platform)}
    />
  ));
}

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
  // Which surface owns a chord decides which subheading it belongs under, and
  // that is derived from the command rather than restated as a second field —
  // a category the table did not have could go stale against the dispatcher.
  const paneBindings = WORKSPACE_KEYBINDINGS.filter(
    (binding) => asPanelCommand(binding.command) === null,
  );
  const panelBindings = WORKSPACE_KEYBINDINGS.filter(
    (binding) => asPanelCommand(binding.command) !== null,
  );

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
          <ShortcutGroup
            heading="Composer"
            note="These work while you are typing a message."
          >
            {COMPOSER_SHORTCUTS.map((shortcut) => (
              <ShortcutRow
                key={shortcut.label}
                label={shortcut.label}
                keys={shortcut.keys}
              />
            ))}
          </ShortcutGroup>
          <ShortcutGroup
            heading="Panes"
            note="Everything below works anywhere in the workspace except while you are typing in a composer. Press Esc to leave the composer first."
          >
            {bindingRows(paneBindings, platform)}
          </ShortcutGroup>
          <ShortcutGroup heading="Workspace panel">
            {bindingRows(panelBindings, platform)}
          </ShortcutGroup>
        </section>
      </div>
    </main>
  );
}

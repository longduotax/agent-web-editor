// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as axe from "axe-core";

const api = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  getAgentBackends: vi.fn(),
}));

vi.mock("../../api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("../../api/client.js")>();
  return { ...client, ...api };
});

import {
  asPanelCommand,
  detectPlatform,
  shortcutKeys,
  WORKSPACE_KEYBINDINGS,
} from "../workspace/keybindings.js";
import { readBackendChoice } from "./backendPreferences.js";
import { readThemeChoice } from "./themePreferences.js";
import { App } from "../../App.js";

function stubMatchMedia() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

function renderSettings(
  backends: {
    defaultRuntime: string;
    backends: { kind: string; available: boolean; reason: string | null }[];
  } = {
    defaultRuntime: "codex",
    backends: [
      { kind: "pi", available: true, reason: null },
      { kind: "codex", available: true, reason: null },
    ],
  },
) {
  api.getWorkspace.mockResolvedValue({
    projects: [],
    threads: [],
    diagnostics: [],
  });
  api.getAgentBackends.mockResolvedValue(backends);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SettingsPage", () => {
  it("renders a Theme radiogroup with System preselected", () => {
    stubMatchMedia();
    renderSettings();

    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Dark" })).not.toBeChecked();
  });

  it("selecting Dark applies the theme immediately and persists it", async () => {
    stubMatchMedia();
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(readThemeChoice()).toBe("dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "System" })).not.toBeChecked();
  });

  // R2-14: multi-pane tiling is the app's differentiating feature and its
  // controls were hover-buttons plus undocumented chords.
  it("lists every active pane shortcut, and nothing inert", () => {
    stubMatchMedia();
    renderSettings();

    const shortcuts = screen.getByRole("heading", {
      name: "Keyboard shortcuts",
    }).parentElement;
    if (shortcuts === null) throw new Error("expected a shortcuts section");

    for (const binding of WORKSPACE_KEYBINDINGS)
      expect(
        within(shortcuts).getByText(binding.label),
        `${binding.label} must be documented`,
      ).toBeVisible();

    // Every listed chord renders its keys as <kbd>, platform-correctly.
    const platform = detectPlatform(navigator);
    const closeBinding = WORKSPACE_KEYBINDINGS.find(
      (binding) => binding.command.type === "close",
    );
    if (closeBinding === undefined) throw new Error("missing close binding");
    const row = within(shortcuts)
      .getByText(closeBinding.label)
      .closest(".shortcut-row");
    if (row === null) throw new Error("expected a shortcut row");
    expect(
      [...row.querySelectorAll("kbd")].map((element) => element.textContent),
    ).toEqual(shortcutKeys(closeBinding, platform));

    // The inert "bind" chord is not advertised.
    expect(within(shortcuts).queryByText(/bind/i)).not.toBeInTheDocument();
    // The composer hints live here too, so this is the one place to look.
    expect(within(shortcuts).getByText("Send a message")).toBeVisible();
  });

  // F14. Nineteen rows in one undifferentiated table, sixteen of them pane or
  // panel management, and the three keys every user needs were the LAST rows.
  it("groups the shortcuts by surface, with the composer's keys first", () => {
    stubMatchMedia();
    renderSettings();

    const shortcuts = screen.getByRole("heading", {
      name: "Keyboard shortcuts",
    }).parentElement;
    if (shortcuts === null) throw new Error("expected a shortcuts section");

    expect(
      [...shortcuts.querySelectorAll(".shortcut-group-heading")].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(["Composer", "Panes", "Workspace panel"]);

    const groups = [
      ...shortcuts.querySelectorAll<HTMLElement>(".shortcut-group"),
    ];
    const [composer, panes, panel] = groups;
    if (composer === undefined || panes === undefined || panel === undefined)
      throw new Error("expected three shortcut groups");

    // The keys a user needs on day one, in the first group.
    for (const label of [
      "Send a message",
      "New line in a message",
      "Leave the composer, keeping the draft",
    ])
      expect(within(composer).getByText(label)).toBeVisible();

    // Every chord is filed under the surface that actually handles it, and
    // the split is derived from the command rather than restated, so it
    // cannot drift from resolveCommand.
    for (const binding of WORKSPACE_KEYBINDINGS) {
      const owner = asPanelCommand(binding.command) === null ? panes : panel;
      expect(
        within(owner).getByText(binding.label),
        `${binding.label} is filed under the wrong surface`,
      ).toBeVisible();
    }
  });

  // Bare ⇞ / ⇟ are unreadable to most people, and this list is the only place
  // these chords are documented at all.
  it("spells out Page Up and Page Down instead of printing the glyphs", () => {
    stubMatchMedia();
    renderSettings();

    const shortcuts = screen.getByRole("heading", {
      name: "Keyboard shortcuts",
    }).parentElement;
    if (shortcuts === null) throw new Error("expected a shortcuts section");

    const keyLabels = [...shortcuts.querySelectorAll("kbd")].map(
      (key) => key.textContent,
    );
    expect(keyLabels).toContain("Page Down");
    expect(keyLabels).toContain("Page Up");
    expect(keyLabels).not.toContain("⇟");
    expect(keyLabels).not.toContain("⇞");
  });

  it("has no axe violations", async () => {
    stubMatchMedia();
    const { container } = renderSettings();

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});

describe("SettingsPage default agent", () => {
  it("follows the machine default until the user chooses", async () => {
    stubMatchMedia();
    renderSettings();

    const group = await screen.findByRole("radiogroup", {
      name: "Default agent",
    });
    expect(group).toBeInTheDocument();
    expect(
      await screen.findByRole("radio", {
        name: /Follow this machine \(Codex\)/,
      }),
    ).toBeChecked();
    expect(readBackendChoice()).toBe("follow-machine");
  });

  it("persists an explicit choice for this device", async () => {
    stubMatchMedia();
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("radio", { name: "Pi" }));

    expect(readBackendChoice()).toBe("pi");
    expect(screen.getByRole("radio", { name: "Pi" })).toBeChecked();
  });

  it("shows an unusable backend disabled with the reason", async () => {
    stubMatchMedia();
    renderSettings({
      defaultRuntime: "pi",
      backends: [
        { kind: "pi", available: true, reason: null },
        {
          kind: "codex",
          available: false,
          reason: "Codex could not be started.",
        },
      ],
    });

    const codex = await screen.findByRole("radio", {
      name: /Codex.*could not be started/,
    });
    expect(codex).toBeDisabled();
  });
});

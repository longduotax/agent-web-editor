// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectId } from "@pi-web/contracts";

const api = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  getWorkspacePreflight: vi.fn(),
  getAgentBackends: vi.fn(),
  startThread: vi.fn(),
}));

vi.mock("../../api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("../../api/client.js")>();
  return { ...client, ...api };
});

import { writeBackendChoice } from "../settings/backendPreferences.js";
import { NewChatPane } from "./NewChatPane.js";
import type { PaneId } from "./layoutTree.js";

const projectId = "00000000-0000-4000-8000-000000000001" as ProjectId;
const paneId = "pane-1" as PaneId;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

function renderComposer(
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
    projects: [
      {
        id: projectId,
        displayName: "Example project",
        displayPath: "/example",
        createdAt: "2026-01-01T00:00:00.000Z",
        available: true,
        gitAvailable: true,
        sidebarExpanded: true,
        unreadCount: 0,
        lastOpenedThreadId: null,
      },
    ],
    threads: [],
    diagnostics: [],
  });
  api.getWorkspacePreflight.mockResolvedValue({
    worktreeAvailable: true,
    currentBranch: "main",
    branches: ["main"],
    changes: null,
  });
  api.getAgentBackends.mockResolvedValue(backends);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NewChatPane
          projectId={projectId}
          paneId={paneId}
          focused
          onFocus={vi.fn()}
          onClose={vi.fn()}
          onSplit={vi.fn()}
          onThreadStarted={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NewChatPane agent choice", () => {
  it("opens on the machine default when the device follows it", async () => {
    renderComposer();
    const select = await screen.findByRole("combobox", { name: "Agent" });
    await waitFor(() => {
      expect(select).toHaveValue("codex");
    });
  });

  it("opens on the device preference when one is set", async () => {
    writeBackendChoice("pi");
    renderComposer();
    const select = await screen.findByRole("combobox", { name: "Agent" });
    await waitFor(() => {
      expect(select).toHaveValue("pi");
    });
  });

  it("starts the chat on the chosen backend", async () => {
    const user = userEvent.setup();
    api.startThread.mockResolvedValue({
      thread: { id: "00000000-0000-4000-8000-000000000002" },
      run: {},
    });
    renderComposer();
    const select = await screen.findByRole("combobox", { name: "Agent" });
    await waitFor(() => {
      expect(select).toHaveValue("codex");
    });
    await user.selectOptions(select, "pi");
    await user.type(screen.getByRole("textbox"), "do the thing");
    await user.click(screen.getByRole("button", { name: /start|send/i }));

    await waitFor(() => {
      expect(api.startThread).toHaveBeenCalled();
    });
    const call = api.startThread.mock.calls[0] as unknown[];
    expect(call[call.length - 1]).toBe("pi");
  });

  it("shows an unusable backend disabled, with its reason", async () => {
    renderComposer({
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
    const option = await screen.findByRole("option", {
      name: /Codex.*could not be started/,
    });
    expect(option).toBeDisabled();
  });
});

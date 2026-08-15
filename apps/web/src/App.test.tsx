// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  discoverSessions: vi.fn(),
  getSnapshot: vi.fn(),
  getWorkspace: vi.fn(),
  importThread: vi.fn(),
  renameThread: vi.fn(),
}));

vi.mock("./api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("./api/client.js")>();
  return { ...client, ...api };
});

import { Markdown } from "./components/Markdown.js";
import { Status } from "./components/Status.js";
import { App } from "./App.js";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("safe and accessible workspace rendering", () => {
  it("gives run states a non-color cue and accessible label", () => {
    render(<Status state="running" unread={false} />);
    expect(screen.getByLabelText("Running")).toHaveTextContent("Running");
  });

  it("does not enable raw Markdown HTML", () => {
    const { container } = render(
      <Markdown>{`<img src=x onerror="alert(1)">\n\n[unsafe](javascript:alert(1))`}</Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(screen.getByText("unsafe").closest("a")).not.toHaveAttribute(
      "href",
      expect.stringContaining("javascript:"),
    );
  });

  it("imports a discovered session and renames a thread", async () => {
    const user = userEvent.setup();
    const drafts = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => drafts.get(key) ?? null,
      setItem: (key: string, value: string) => {
        drafts.set(key, value);
      },
      removeItem: (key: string) => {
        drafts.delete(key);
      },
    });
    const projectId = "10000000-0000-4000-8000-000000000001";
    const threadId = "20000000-0000-4000-8000-000000000001";
    const importedThreadId = "30000000-0000-4000-8000-000000000001";
    let workspace = {
      projects: [
        {
          id: projectId,
          displayName: "Example project",
          displayPath: "/example",
          available: true,
          sidebarExpanded: true,
          unreadCount: 0,
          lastOpenedThreadId: threadId,
        },
      ],
      threads: [
        {
          id: threadId,
          projectId,
          title: "Original thread",
          runtimeSessionId: "40000000-0000-4000-8000-000000000001",
          runState: null,
          unread: false,
        },
      ],
      diagnostics: [],
    };
    api.getWorkspace.mockImplementation(() => Promise.resolve(workspace));
    api.discoverSessions.mockResolvedValue({
      sessions: [
        {
          id: "50000000-0000-4000-8000-000000000001",
          name: "Existing session",
          createdAt: "2026-01-01T00:00:00.000Z",
          modifiedAt: "2026-01-01T00:00:00.000Z",
          messageCount: 1,
          preview: "Existing work",
          imported: false,
        },
      ],
      diagnostics: ["One session could not be read."],
    });
    api.importThread.mockResolvedValue({
      thread: {
        id: importedThreadId,
        projectId,
        title: "Existing session",
        runtimeSessionId: "50000000-0000-4000-8000-000000000001",
        runState: null,
        unread: false,
      },
    });
    api.getSnapshot.mockResolvedValue({
      version: 1,
      project: workspace.projects[0],
      thread: {
        id: importedThreadId,
        projectId,
        title: "Existing session",
        runtimeSessionId: "50000000-0000-4000-8000-000000000001",
        runState: null,
        unread: false,
      },
      transcript: [],
      currentRun: null,
      lastRun: null,
      epoch: "60000000-0000-4000-8000-000000000001",
      highWaterSequence: 0,
      capabilities: { prompt: true, steer: true, stop: true },
      diagnostics: [],
    });
    api.renameThread.mockImplementation(
      (_projectId: ProjectId, renamedThreadId: ThreadId, title: string) => {
        workspace = {
          ...workspace,
          threads: workspace.threads.map((thread) =>
            thread.id === renamedThreadId ? { ...thread, title } : thread,
          ),
        };
        const thread = workspace.threads.find(
          (candidate) => candidate.id === renamedThreadId,
        );
        if (thread === undefined) throw new Error("Expected test thread");
        return Promise.resolve({ thread });
      },
    );

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Import an existing session into Example project",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Import" }),
    ).toBeInTheDocument();
    expect(api.discoverSessions).toHaveBeenCalledWith(projectId);
    expect(
      screen.getByText("One session could not be read."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => {
      expect(api.importThread).toHaveBeenCalledWith(
        projectId,
        "50000000-0000-4000-8000-000000000001",
      );
      expect(api.getSnapshot).toHaveBeenCalledWith(projectId, importedThreadId);
    });
    expect(
      await screen.findByRole("heading", { name: "Existing session" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Rename Original thread" }),
    );
    const title = screen.getByRole("textbox", {
      name: "Rename Original thread",
    });
    await user.clear(title);
    await user.type(title, "Renamed thread");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(api.renameThread).toHaveBeenCalledWith(
        projectId,
        threadId,
        "Renamed thread",
      );
    });
    expect(await screen.findByText("Renamed thread")).toBeInTheDocument();
  });
});

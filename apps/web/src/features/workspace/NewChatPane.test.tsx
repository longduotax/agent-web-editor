// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

const api = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  getWorkspacePreflight: vi.fn(),
  startThread: vi.fn(),
}));

vi.mock("../../api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("../../api/client.js")>();
  return { ...client, ...api };
});

import { newChatDraftKey, readDraft } from "./drafts.js";
import { NewChatPane } from "./NewChatPane.js";

const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
const paneId = "pane-1";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

function renderNewChat() {
  api.getWorkspace.mockResolvedValue({
    projects: [
      {
        id: projectId,
        displayName: "Example project",
        displayPath: "example",
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
    unavailableReason: null,
    currentBranch: "master",
    branches: ["master"],
    changes: null,
  });
  const onThreadStarted = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NewChatPane
          projectId={projectId}
          paneId={paneId}
          focused
          onFocus={vi.fn()}
          onClose={vi.fn()}
          onSplit={vi.fn()}
          onThreadStarted={onThreadStarted}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onThreadStarted };
}

// F7. Starting the first thread creates a git worktree, measured at 1.6-2.6s.
// For all of that time the typed text sat in the composer, the header still
// said "New chat", and the only feedback was an 11.5px grey hint -- it read
// as "my Enter key did not register".
describe("NewChatPane while the workspace is being prepared", () => {
  it("clears the composer and echoes the message the moment it is sent", async () => {
    const user = userEvent.setup();
    let release: ((value: { thread: { id: ThreadId } }) => void) | undefined;
    api.startThread.mockImplementation(
      async () =>
        await new Promise<{ thread: { id: ThreadId } }>((resolve) => {
          release = resolve;
        }),
    );
    const { onThreadStarted } = renderNewChat();

    const composer = await screen.findByRole("textbox", {
      name: "First message",
    });
    await user.type(composer, "Build a Pomodoro timer");
    await user.keyboard("{Enter}");

    // The message is on screen and the composer is empty before the server
    // has answered anything.
    expect(screen.getByText("Build a Pomodoro timer")).toBeInTheDocument();
    expect(composer).toHaveValue("");
    expect(onThreadStarted).not.toHaveBeenCalled();

    // Worktree preparation is a step in the transcript, not a grey hint.
    expect(screen.getByText("Preparing")).toBeInTheDocument();
    expect(screen.getByLabelText("Running")).toBeInTheDocument();

    release?.({ thread: { id: threadId } });
    await waitFor(() => {
      expect(onThreadStarted).toHaveBeenCalledWith(threadId);
    });
  });

  it("sends what was typed, not the cleared composer", async () => {
    const user = userEvent.setup();
    api.startThread.mockResolvedValue({ thread: { id: threadId } });
    renderNewChat();

    const composer = await screen.findByRole("textbox", {
      name: "First message",
    });
    await user.type(composer, "Explain the repository layout");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(api.startThread).toHaveBeenCalled();
    });
    expect(api.startThread.mock.calls[0]?.[1]).toBe(
      "Explain the repository layout",
    );
  });

  // S1. `requestSubmit()` ignores the disabled submit button, so Enter still
  // reaches the handler while the worktree is being created. Clearing the
  // composer removed the accidental protection that used to cover this: the
  // resent text was identical and carried the same idempotency key, so the
  // server deduplicated it. Typing again regenerates that key.
  it("cannot start a second thread while the first is still being created", async () => {
    const user = userEvent.setup();
    api.startThread.mockImplementation(
      async () => await new Promise<never>(() => undefined),
    );
    renderNewChat();

    const composer = await screen.findByRole("textbox", {
      name: "First message",
    });
    await user.type(composer, "First intent");
    await user.keyboard("{Enter}");
    expect(api.startThread).toHaveBeenCalledTimes(1);

    // Typing during the creation window regenerates the idempotency key, so
    // nothing downstream would collapse these into one thread.
    await user.type(composer, "Second intent");
    await user.keyboard("{Enter}");

    expect(api.startThread).toHaveBeenCalledTimes(1);
  });

  // S2. The tester called out draft persistence across a full page reload as
  // something that already worked. Clearing the composer must not narrow it:
  // until the thread exists, storage is the only copy of the message.
  it("keeps the typed message in storage for the whole creation window", async () => {
    const user = userEvent.setup();
    let release: ((value: { thread: { id: ThreadId } }) => void) | undefined;
    api.startThread.mockImplementation(
      async () =>
        await new Promise<{ thread: { id: ThreadId } }>((resolve) => {
          release = resolve;
        }),
    );
    renderNewChat();

    const composer = await screen.findByRole("textbox", {
      name: "First message",
    });
    await user.type(composer, "Survives a reload");
    await user.keyboard("{Enter}");

    expect(composer).toHaveValue("");
    expect(readDraft(newChatDraftKey(projectId, paneId))).toBe(
      "Survives a reload",
    );

    release?.({ thread: { id: threadId } });
    await waitFor(() => {
      expect(readDraft(newChatDraftKey(projectId, paneId))).toBe("");
    });
  });

  it("gives the draft back instead of eating it when the submit fails", async () => {
    const user = userEvent.setup();
    api.startThread.mockRejectedValue(new Error("worktree_create_failed"));
    renderNewChat();

    const composer = await screen.findByRole("textbox", {
      name: "First message",
    });
    await user.type(composer, "Start a risky thread");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(composer).toHaveValue("Start a risky thread");
    });
    expect(readDraft(newChatDraftKey(projectId, paneId))).toBe(
      "Start a risky thread",
    );
    // Only one copy of the text: the echo is withdrawn when the send fails.
    expect(screen.queryByText("Preparing")).toBeNull();
  });
});

// F8. The pane had a header, a composer, and ~450px of nothing in between --
// on the screen where a first-time user decides what this tool is. The empty
// space now carries the two things the pane could not say any other way.
describe("NewChatPane's starter block", () => {
  it("offers example first messages that put themselves in the composer", async () => {
    const user = userEvent.setup();
    renderNewChat();

    const composer = await screen.findByRole("textbox", {
      name: "First message",
    });
    const examples = screen.getAllByRole("button", {
      name: /^(Walk the repository|Run the test suite|Summarise the last)/,
    });
    expect(examples).toHaveLength(3);

    const example = examples[1];
    if (example === undefined) throw new Error("expected an example");
    const text = example.textContent;
    await user.click(example);

    // Filled and focused, but NOT sent -- clicking an example is a way to
    // start writing, not a way to launch a run.
    expect(composer).toHaveValue(text);
    expect(composer).toHaveFocus();
    expect(api.startThread).not.toHaveBeenCalled();
  });

  // The third example names the project's real base branch, so it reads as a
  // thing to ask about THIS repository rather than a placeholder.
  it("names the real base branch in the history example", async () => {
    renderNewChat();
    // The branch arrives with the preflight query, so the example starts on
    // the neutral "this branch" and adopts the real one when it lands.
    expect(
      await screen.findByRole("button", { name: /Summarise the last ten/ }),
    ).toHaveTextContent("the last ten commits on this branch");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Summarise the last ten/ }),
      ).toHaveTextContent("the last ten commits on master");
    });
  });

  // The explanation must describe options that actually exist. The option
  // labels are read from the rendered selects rather than restated here, so
  // the copy cannot advertise a mode the app does not offer.
  it("explains every option the two mode selects actually offer", async () => {
    renderNewChat();
    await screen.findByRole("textbox", { name: "First message" });

    const optionLabels = ["Execution location", "Starting state"].flatMap(
      (name) =>
        [
          ...screen.getByRole("combobox", { name }).querySelectorAll("option"),
        ].map((option) => option.textContent),
    );
    expect(optionLabels).toEqual([
      "New worktree",
      "Local checkout",
      "Clean start",
      "Include local changes",
    ]);

    const terms = [...document.querySelectorAll(".new-chat-choices dt")].map(
      (term) => term.textContent,
    );
    for (const label of optionLabels) expect(terms).toContain(label);
  });

  it("gets out of the way once a message is sent", async () => {
    const user = userEvent.setup();
    api.startThread.mockImplementation(
      async () => await new Promise<never>(() => undefined),
    );
    renderNewChat();

    const composer = await screen.findByRole("textbox", {
      name: "First message",
    });
    await user.type(composer, "Go");
    await user.keyboard("{Enter}");

    expect(
      screen.queryByRole("button", { name: /^Walk the repository/ }),
    ).toBeNull();
    expect(document.querySelector(".new-chat-intro")).toBeNull();
  });
});

// F9. Escape used to leave both the value and document.activeElement
// untouched, so once you were in a composer Tab was the only way out and
// every pane shortcut the Settings page advertises was unreachable.
describe("NewChatPane's composer on Escape", () => {
  it("hands focus to the pane and keeps the draft", async () => {
    const user = userEvent.setup();
    renderNewChat();

    const composer = await screen.findByRole("textbox", {
      name: "First message",
    });
    await user.click(composer);
    await user.paste("draft line one\ndraft line two");
    expect(composer).toHaveFocus();

    await user.keyboard("{Escape}");

    const pane = screen.getByRole("region", { name: "New chat" });
    expect(pane).toHaveFocus();
    // The pane is a landing site for Escape, not a Tab stop.
    expect(pane).toHaveAttribute("tabindex", "-1");
    // Escape releases focus; it does not discard work.
    expect(composer).toHaveValue("draft line one\ndraft line two");
    expect(readDraft(newChatDraftKey(projectId, paneId))).toBe(
      "draft line one\ndraft line two",
    );
  });
});

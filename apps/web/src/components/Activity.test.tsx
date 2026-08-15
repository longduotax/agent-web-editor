// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "@pi-web/contracts";

import { Activity, compactTranscript } from "./Activity.js";

const runningRead: TranscriptItem = {
  id: "call",
  kind: "tool",
  name: "read",
  status: "running",
  input: '{"path":"/workspace/docs/design/runtime.md","offset":21,"limit":40}',
  output: "",
  cwd: null,
  exitCode: null,
  timestamp: "2026-08-16T00:00:00.000Z",
};

const completedRead: TranscriptItem = {
  ...runningRead,
  id: "result",
  status: "completed",
  output: "# Runtime design\n\nDetails",
  timestamp: "2026-08-16T00:00:01.000Z",
};

describe("agent tool activity", () => {
  it("renders a compact, human-readable summary and reveals details on demand", async () => {
    const user = userEvent.setup();
    render(<Activity item={completedRead} projectPath="/workspace" />);

    const disclosure = screen.getByText("runtime.md").closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByLabelText("Completed")).toBeInTheDocument();
    expect(screen.getByText("docs/design/")).toBeInTheDocument();
    expect(screen.getByText("lines 21–60")).toBeInTheDocument();
    expect(screen.queryByText("# Runtime design", { exact: false })).toBeNull();

    await user.click(screen.getByText("runtime.md"));
    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(
      screen.getByText("# Runtime design", { exact: false }),
    ).toBeVisible();
  });

  it("coalesces a tool call with its result and omits empty assistant shells", () => {
    const items: TranscriptItem[] = [
      {
        id: "assistant",
        kind: "message",
        role: "assistant",
        text: "",
        timestamp: "2026-08-16T00:00:00.000Z",
      },
      runningRead,
      completedRead,
    ];

    expect(compactTranscript(items)).toEqual([completedRead]);
  });

  it("falls back safely for malformed or custom tool input", () => {
    render(
      <Activity
        item={{
          ...completedRead,
          id: "custom",
          name: "deploy_preview",
          input: "not-json",
          output: "",
        }}
        projectPath="/workspace"
      />,
    );

    expect(screen.getByText("deploy preview")).toBeInTheDocument();
    expect(screen.getByText("not-json")).toBeInTheDocument();
  });
});

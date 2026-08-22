// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { TranscriptItem } from "@pi-web/contracts";

import { Activity, ActivityGroup, displayTranscript } from "./Activity.js";

afterEach(() => {
  cleanup();
});

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

  it("omits empty assistant shells without guessing tool-call identity", () => {
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

    expect(displayTranscript(items)).toEqual([runningRead, completedRead]);
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

describe("worked-for run grouping", () => {
  it("collapses a contiguous run of tool items behind a single disclosure and reveals them on expand", async () => {
    const user = userEvent.setup();
    render(
      <ActivityGroup
        items={[runningRead, completedRead]}
        projectPath="/workspace"
      />,
    );

    expect(screen.queryByText("runtime.md")).toBeNull();
    const summary = screen.getByText("Worked for 1s");
    const disclosure = summary.closest("details");
    expect(disclosure).not.toHaveAttribute("open");

    await user.click(summary);

    expect(disclosure).toHaveAttribute("open");
    expect(screen.getAllByText("runtime.md")).toHaveLength(2);
  });

  // F3: the step list is the only detailed progress the app has, and it used
  // to be sealed behind a collapsed disclosure until the run ended -- a
  // 96-second run showed a blank transcript and then revealed fourteen steps
  // at the moment they stopped mattering.
  it("opens itself while the run is live and shows the steps as they land", () => {
    render(
      <ActivityGroup items={[runningRead]} live projectPath="/workspace" />,
    );

    const disclosure = screen.getByText("Working…").closest("details");
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByText("runtime.md")).toBeInTheDocument();
    expect(screen.queryByText(/^Worked for/)).toBeNull();
  });

  it("collapses back to its Worked-for summary once the run settles", () => {
    const view = render(
      <ActivityGroup
        items={[runningRead, completedRead]}
        live
        projectPath="/workspace"
      />,
    );
    expect(screen.getByText("Working…").closest("details")).toHaveAttribute(
      "open",
    );

    view.rerender(
      <ActivityGroup
        items={[completedRead, { ...completedRead, id: "second" }]}
        live={false}
        projectPath="/workspace"
      />,
    );

    const summary = screen.getByText("Worked for <1s");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText("Working…")).toBeNull();
  });

  it("keeps the duration slot filled when tool timestamps do not establish a duration", () => {
    render(
      <ActivityGroup
        items={[{ ...completedRead, timestamp: null }]}
        projectPath="/workspace"
      />,
    );

    // Never a bare "Worked": beside a sibling "Worked for 27s" that reads as
    // a different kind of row instead of an unknown duration.
    expect(screen.getByText("Worked for <1s")).toBeInTheDocument();
    expect(screen.queryByText("Worked")).toBeNull();
  });
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { TranscriptItem } from "@pi-web/contracts";

import {
  Activity,
  ActivityGroup,
  displayTranscript,
  failedStepCount,
  formatDuration,
} from "./Activity.js";

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
  completedAt: null,
};

const completedRead: TranscriptItem = {
  ...runningRead,
  id: "result",
  status: "completed",
  output: "# Runtime design\n\nDetails",
  completedAt: "2026-08-16T00:00:01.000Z",
};

// G6: the shape of the run that reported a green "Done" with nothing to show
// for it -- a tool call that failed, whose error is correct once you expand
// the step and invisible until you do.
const failedRead: TranscriptItem = {
  ...runningRead,
  id: "failed",
  name: "bash",
  status: "failed",
  input: '{"command":"cat /nonexistent/path/xyz.txt"}',
  output: "cat: /nonexistent/path/xyz.txt: No such file or directory",
  exitCode: 1,
  completedAt: "2026-08-16T00:00:01.000Z",
};

// N1: the shape that produced "Worked for <1s" for a 45-second wait -- one
// tool call, alone in its group, whose start and end are 45s apart.
const longSleep: TranscriptItem = {
  id: "sleep",
  kind: "tool",
  name: "bash",
  status: "completed",
  input: '{"command":"sleep 45 && ls","timeout":60}',
  output: "README.md\n",
  cwd: "/workspace",
  exitCode: 0,
  timestamp: "2026-08-16T00:00:00.000Z",
  completedAt: "2026-08-16T00:00:45.054Z",
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

  it("reports a step's own elapsed time in its details, and omits it while the step is still running", async () => {
    const user = userEvent.setup();
    const view = render(<Activity item={longSleep} projectPath="/workspace" />);

    await user.click(screen.getByText("sleep 45 && ls"));
    expect(screen.getByText("took 46s")).toBeInTheDocument();

    view.rerender(
      <Activity
        item={{ ...longSleep, status: "running", completedAt: null }}
        projectPath="/workspace"
      />,
    );
    expect(screen.queryByText(/^took /)).toBeNull();
  });

  // S1: this branch was dead until the adapter learned to say "unknown". A
  // step with no recorded start must show no duration rather than "took <1s".
  it("shows no elapsed time for a step whose start was never recorded", async () => {
    const user = userEvent.setup();
    render(
      <Activity
        item={{ ...longSleep, timestamp: null }}
        projectPath="/workspace"
      />,
    );

    await user.click(screen.getByText("sleep 45 && ls"));
    expect(screen.queryByText(/^took /)).toBeNull();
    // The rest of the footer still renders -- only the duration is withheld.
    expect(document.querySelector("footer")?.textContent).toBe(
      "cwd /workspaceexit 0",
    );
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
    const summary = screen.getByText("2 steps · 1s");
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
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it("collapses back to its settled summary once the run settles", () => {
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

    const summary = screen.getByText("2 steps · 1s");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText("Working…")).toBeNull();
  });

  // G6: both tool calls failed and the collapsed summary read exactly
  // "Worked for <1s" -- no count, no badge, no colour. The failures were
  // marked correctly, but only inside a disclosure nobody had opened, so a
  // run that got nothing done looked identical to one that did everything.
  it("names the failure count in the collapsed summary", () => {
    render(
      <ActivityGroup
        items={[failedRead, { ...failedRead, id: "second" }]}
        projectPath="/workspace"
      />,
    );

    expect(screen.getByText("2 steps · 1s")).toBeInTheDocument();
    expect(screen.getByText("2 failed")).toBeInTheDocument();
  });

  it("says nothing about failures when there were none", () => {
    render(
      <ActivityGroup
        items={[completedRead, { ...completedRead, id: "second" }]}
        projectPath="/workspace"
      />,
    );

    expect(screen.queryByText(/failed/)).toBeNull();
  });

  it("counts only the steps that failed", () => {
    render(
      <ActivityGroup
        items={[completedRead, failedRead, { ...completedRead, id: "third" }]}
        projectPath="/workspace"
      />,
    );

    expect(screen.getByText("1 failed")).toBeInTheDocument();
  });

  // Nit 4. A failed group used to open itself in the `useState` INITIALISER,
  // so every historical failure re-opened on every mount -- on reload, and on
  // any pane remount, which `key={threadId}` makes routine. A reader's
  // collapse survived only until the next rebind, and scrolling back through
  // a long thread meant folding the same groups away again.
  //
  // A group that was never live in this mount is one whose run ended before
  // the reader arrived, and nothing is hidden by leaving it closed: the red
  // failure count is IN the collapsed summary, and that count is what closed
  // G6.
  it("leaves a group that already failed before this mount collapsed", () => {
    render(<ActivityGroup items={[failedRead]} projectPath="/workspace" />);

    expect(
      screen.getByText("1 step · 1s").closest("details"),
    ).not.toHaveAttribute("open");
    // Still says so where a skim reads it.
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(
      screen.queryByText("cat /nonexistent/path/xyz.txt"),
    ).not.toBeInTheDocument();
  });

  // The auto-expansion rides ON the live rule rather than against it: a group
  // that opened because it was live must not slam shut at the moment its
  // contents matter most.
  it("stays open when a run with failures settles", () => {
    const view = render(
      <ActivityGroup items={[runningRead]} live projectPath="/workspace" />,
    );
    expect(screen.getByText("Working…").closest("details")).toHaveAttribute(
      "open",
    );

    view.rerender(
      <ActivityGroup
        items={[completedRead, failedRead]}
        live={false}
        projectPath="/workspace"
      />,
    );

    expect(screen.getByText("2 steps · 1s").closest("details")).toHaveAttribute(
      "open",
    );
    expect(screen.getByText("1 failed")).toBeInTheDocument();
  });

  it("counts failures without needing a duration", () => {
    expect(
      failedStepCount([
        { ...failedRead, timestamp: "", completedAt: null },
        completedRead,
      ]),
    ).toBe(1);
  });

  it("lets the user fold a live group away, and keeps it folded while it runs", async () => {
    const user = userEvent.setup();
    const view = render(
      <ActivityGroup items={[runningRead]} live projectPath="/workspace" />,
    );
    const summary = screen.getByText("Working…");
    expect(summary.closest("details")).toHaveAttribute("open");

    await user.click(summary);
    expect(summary.closest("details")).not.toHaveAttribute("open");

    // More steps land while it is folded: it stays folded.
    view.rerender(
      <ActivityGroup
        items={[runningRead, { ...completedRead, id: "later" }]}
        live
        projectPath="/workspace"
      />,
    );
    expect(screen.getByText("Working…").closest("details")).not.toHaveAttribute(
      "open",
    );
  });

  // N1: the bug this whole group of tests exists for. A single tool call is
  // the *common* case, and the old label -- max minus min over one timestamp
  // -- could only ever be zero for it, so every single-step run reported
  // "<1s" no matter how long it took. A verifier watched a real 45-second
  // sleep and read "Worked for <1s" without anyone noticing.
  it("reports the real duration of a run that is one long tool call", () => {
    render(<ActivityGroup items={[longSleep]} projectPath="/workspace" />);

    expect(screen.getByText("1 step · 46s")).toBeInTheDocument();
    expect(screen.queryByText(/<1s/)).toBeNull();
  });

  it("spans from the first step's start to the last step's finish", () => {
    render(
      <ActivityGroup
        items={[
          completedRead,
          { ...longSleep, timestamp: "2026-08-16T00:00:02.000Z" },
        ]}
        projectPath="/workspace"
      />,
    );

    // 00:00:00.000 (first call issued) to 00:00:45.054 (last result) -- not
    // the 45.054s of the slow step alone, and not the 44s between the two
    // steps' start times.
    expect(screen.getByText("2 steps · 46s")).toBeInTheDocument();
  });

  it("names how many steps ran when the transcript carries no timing at all", () => {
    render(
      <ActivityGroup
        items={[
          { ...completedRead, timestamp: null, completedAt: null },
          { ...runningRead, id: "second", timestamp: null },
        ]}
        projectPath="/workspace"
      />,
    );

    // The same sentence as a timed group, minus its last clause -- never an
    // invented duration, because an unknown number is not "<1s".
    expect(screen.getByText("2 steps")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it("does not let a still-running step shorten the span", () => {
    render(
      <ActivityGroup
        items={[longSleep, { ...runningRead, id: "next" }]}
        projectPath="/workspace"
      />,
    );

    expect(screen.getByText("2 steps · 46s")).toBeInTheDocument();
  });

  // S1: a result whose call entry is gone -- compacted away, or left on
  // another branch -- has no start. The group must say so instead of bounding
  // itself at the single instant it does have and reporting the run as
  // instantaneous, which is N1's defect wearing the fix's clothes.
  it("declines to time a group whose only step has no recorded start", () => {
    render(
      <ActivityGroup
        items={[{ ...longSleep, timestamp: null }]}
        projectPath="/workspace"
      />,
    );

    expect(screen.getByText("1 step")).toBeInTheDocument();
    expect(screen.queryByText(/<1s/)).toBeNull();
  });

  it("still spans a group where only some steps lost their start", () => {
    render(
      <ActivityGroup
        items={[completedRead, { ...longSleep, timestamp: null }]}
        projectPath="/workspace"
      />,
    );

    // The known start (00:00:00.000) and the known end (00:00:45.054) come
    // from different steps, which is still a real lower bound on the group.
    expect(screen.getByText("2 steps · 46s")).toBeInTheDocument();
  });
});

/** Reads a rendered label back into the number of seconds it claims. */
function labelSeconds(label: string): number {
  const unit: Record<string, number> = { h: 3_600, m: 60, s: 1 };
  let total = 0;
  for (const match of label.matchAll(/(\d+)([hms])/g))
    total += Number(match[1]) * (unit[match[2] ?? "s"] ?? 1);
  return total;
}

describe("duration formatting", () => {
  // The label must never claim less time than actually elapsed, so every
  // value rounds up and every unit down to the second is printed.
  it.each([
    [0, "<1s"],
    [600, "<1s"],
    [999, "<1s"],
    [1_000, "1s"],
    [1_400, "2s"],
    [45_054, "46s"],
    [59_000, "59s"],
    [59_001, "1m"],
    [60_000, "1m"],
    [90_000, "1m 30s"],
    [3_600_000, "1h"],
    [3_660_000, "1h 1m"],
    [3_661_000, "1h 1m 1s"],
  ])("formats %ims as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it("never names a duration shorter than the time that passed", () => {
    const understated: number[] = [];
    const overstated: number[] = [];
    for (let ms = 1_000; ms < 4_000_000; ms += 997) {
      const named = labelSeconds(formatDuration(ms)) * 1_000;
      if (named < ms) understated.push(ms);
      // Bounded from above as well: without this, ceil-plus-a-minute passes.
      if (named >= ms + 1_000) overstated.push(ms);
    }
    expect(understated).toEqual([]);
    expect(overstated).toEqual([]);
  });
});

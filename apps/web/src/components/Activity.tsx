import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TranscriptItem } from "@pi-web/contracts";

type ToolActivity = Extract<TranscriptItem, { kind: "tool" }>;
type ToolArguments = Record<string, unknown>;

export interface ActivityLabel {
  action: string;
  prefix?: string | undefined;
  target?: string | undefined;
  meta?: string | undefined;
}

function parseArguments(input: string): ToolArguments | null {
  try {
    const parsed: unknown = JSON.parse(input);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as ToolArguments)
      : null;
  } catch {
    return null;
  }
}

function stringArgument(
  args: ToolArguments | null,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = args?.[name];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

function numberArgument(
  args: ToolArguments | null,
  name: string,
): number | undefined {
  const value = args?.[name];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function relativePath(path: string, projectPath: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  const normalizedProject = projectPath
    .replaceAll("\\", "/")
    .replace(/\/$/, "");
  return normalizedPath.startsWith(`${normalizedProject}/`)
    ? normalizedPath.slice(normalizedProject.length + 1)
    : normalizedPath;
}

function pathParts(path: string): { prefix?: string; target: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1
    ? { target: path }
    : { prefix: path.slice(0, slash + 1), target: path.slice(slash + 1) };
}

function humanizeToolName(name: string): string {
  return name.replaceAll(/[_-]+/g, " ");
}

function formatToolLabel(
  item: ToolActivity,
  projectPath: string,
): ActivityLabel {
  const args = parseArguments(item.input);
  const rawPath = stringArgument(args, "path", "file_path");
  const path =
    rawPath === undefined ? undefined : relativePath(rawPath, projectPath);
  const parts = path === undefined ? undefined : pathParts(path);

  switch (item.name.toLowerCase()) {
    case "read": {
      const offset = numberArgument(args, "offset") ?? 1;
      const limit = numberArgument(args, "limit");
      return {
        action: "Read",
        ...parts,
        meta:
          limit === undefined
            ? offset > 1
              ? `from line ${String(offset)}`
              : undefined
            : `lines ${String(offset)}–${String(offset + Math.max(0, limit - 1))}`,
      };
    }
    case "write":
      return { action: "Wrote", ...parts };
    case "edit": {
      const edits = args?.edits;
      const count = Array.isArray(edits) ? edits.length : undefined;
      return {
        action: "Edited",
        ...parts,
        meta:
          count === undefined
            ? undefined
            : `${String(count)} ${count === 1 ? "change" : "changes"}`,
      };
    }
    case "bash":
      return {
        action: "$",
        target: stringArgument(args, "command") ?? item.input,
        meta:
          item.exitCode === null ? undefined : `exit ${String(item.exitCode)}`,
      };
    case "grep":
      return {
        action: "Searched",
        target: stringArgument(args, "pattern") ?? "project",
        meta: path,
      };
    case "find":
      return {
        action: "Found",
        target: stringArgument(args, "pattern") ?? path ?? item.input,
      };
    case "ls":
      return { action: "Listed", ...(parts ?? { target: "." }) };
    default:
      return {
        action: humanizeToolName(item.name),
        target: args === null ? item.input : path,
      };
  }
}

function formattedInput(input: string): string {
  try {
    return JSON.stringify(JSON.parse(input) as unknown, null, 2);
  } catch {
    return input;
  }
}

/**
 * A duration at second granularity, always rounded **up**.
 *
 * Rounding to nearest would let the label claim less time than actually
 * elapsed -- a 1.4s step reading "1s" -- and a duration that undersells itself
 * is the exact failure this label is recovering from. Rounding up costs at
 * most a second of overstatement and can never understate. Every unit down to
 * the second is printed, because dropping the seconds off "1h 1m 1s" would
 * understate too.
 */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return "<1s";
  const total = Math.ceil(ms / 1_000);
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${String(hours)}h`);
  if (minutes > 0) parts.push(`${String(minutes)}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${String(seconds)}s`);
  return parts.join(" ");
}

function instant(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * How long one step took, or `null` when the transcript cannot say.
 *
 * A step that is still running has no completion time; a step that arrived
 * without a matching call has no start. Neither is reported as a duration --
 * an absent number is honest, a zero is not.
 */
function stepDurationMs(item: ToolActivity): number | null {
  const start = instant(item.timestamp);
  const end = instant(item.completedAt);
  return start === null || end === null ? null : Math.max(0, end - start);
}

/**
 * The wall-clock span a group of steps occupied: from the earliest moment any
 * of them was known to exist to the latest moment any of them was known to
 * have finished.
 *
 * This used to be max-minus-min over the steps' single timestamps, which for
 * the common case of one long tool call is always zero -- a 45-second `sleep`
 * summarised itself as "<1s". A step's own elapsed time only became
 * representable once the contract started carrying its completion time.
 */
function runSpanMs(items: readonly ToolActivity[]): number | null {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const item of items) {
    const start = instant(item.timestamp);
    const end = instant(item.completedAt);
    // A still-running step at least establishes that the run reached it, and
    // a step with no call behind it at least establishes that it finished.
    const first = start ?? end;
    const last = end ?? start;
    if (first === null || last === null) continue;
    starts.push(first);
    ends.push(last);
  }
  if (starts.length === 0 || ends.length === 0) return null;
  return Math.max(0, Math.max(...ends) - Math.min(...starts));
}

function runLabel(items: readonly ToolActivity[]): string {
  const span = runSpanMs(items);
  // Never a bare "Worked": beside a sibling group's "Worked for 27s" that
  // reads as a different kind of row rather than as the same row with an
  // unknown duration. But naming a duration the transcript does not support
  // is worse than naming none, so the slot is filled with what is actually
  // known -- how many steps ran.
  if (span === null)
    return `Worked (${String(items.length)} ${items.length === 1 ? "step" : "steps"})`;
  return `Worked for ${formatDuration(span)}`;
}

export function displayTranscript(
  items: readonly TranscriptItem[],
): TranscriptItem[] {
  return items.filter(
    (item) =>
      item.kind !== "message" ||
      item.role !== "assistant" ||
      item.text.trim() !== "",
  );
}

export type ActivityStatus = ToolActivity["status"];

const STATUS_LABEL: Record<ActivityStatus, string> = {
  running: "Running",
  failed: "Failed",
  completed: "Completed",
};
const STATUS_GLYPH: Record<ActivityStatus, string> = {
  running: "◌",
  failed: "!",
  completed: "✓",
};

/**
 * One step row in the transcript: a status glyph, a label, and a body that
 * only mounts once the row is opened.
 *
 * Exported so that surfaces which have a step to show but no tool call behind
 * it -- the new-chat pane, while it prepares a worktree -- render the real
 * component instead of a copy of its markup that drifts the first time this
 * file changes.
 */
export function ActivityStep({
  status,
  label,
  children,
}: {
  status: ActivityStatus;
  label: ActivityLabel;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className={`activity activity-${status}`}
      onToggle={(event) => {
        setExpanded(event.currentTarget.open);
      }}
    >
      <summary>
        <span className="activity-state" aria-label={STATUS_LABEL[status]}>
          <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
        </span>
        <span className="activity-action">{label.action}</span>
        {label.prefix !== undefined && (
          <span className="activity-path-prefix">{label.prefix}</span>
        )}
        {label.target !== undefined && (
          <span className="activity-target">{label.target}</span>
        )}
        {label.meta !== undefined && (
          <span className="activity-meta">{label.meta}</span>
        )}
        <span className="activity-chevron" aria-hidden="true">
          ›
        </span>
      </summary>
      {expanded && <div className="activity-details">{children}</div>}
    </details>
  );
}

/**
 * The detail footer, where a step's own elapsed time joins `cwd` and `exit`.
 *
 * Per-step timing stays out of the collapsed summary row on purpose: putting
 * "1s" beside every trivial read buys noise, while the one number a user
 * actually goes looking for -- which step ate the minute -- is worth a click.
 */
function footer(item: ToolActivity) {
  const elapsed = stepDurationMs(item);
  if (item.cwd === null && item.exitCode === null && elapsed === null)
    return null;
  return (
    <footer>
      {item.cwd !== null && <span>cwd {item.cwd}</span>}
      {item.exitCode !== null && <span>exit {String(item.exitCode)}</span>}
      {elapsed !== null && <span>took {formatDuration(elapsed)}</span>}
    </footer>
  );
}

export function Activity({
  item,
  projectPath,
}: {
  item: ToolActivity;
  projectPath: string;
}) {
  return (
    <ActivityStep
      label={formatToolLabel(item, projectPath)}
      status={item.status}
    >
      <section>
        <h3>Input</h3>
        <pre>{formattedInput(item.input)}</pre>
      </section>
      {item.output !== "" && (
        <section>
          <h3>Output</h3>
          <pre>{item.output}</pre>
        </section>
      )}
      {footer(item)}
    </ActivityStep>
  );
}

export function ActivityGroup({
  items,
  projectPath,
  live = false,
}: {
  items: readonly ToolActivity[];
  projectPath: string;
  /**
   * Whether these steps belong to a run that is still going.
   *
   * The step list is the only detailed progress the app has, and it used to
   * be sealed behind a collapsed disclosure until the run ended — so a
   * 96-second run showed a blank transcript and then revealed fourteen steps
   * at the moment they stopped mattering. A live group opens itself and
   * collapses back to its "Worked for Nm" summary when the run settles. The
   * user may still fold it away by hand while it runs; that choice survives
   * until the group's live state flips.
   */
  live?: boolean;
}) {
  const [expanded, setExpanded] = useState(live);
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current === live) return;
    wasLive.current = live;
    setExpanded(live);
  }, [live]);
  const label = live ? "Working…" : runLabel(items);

  return (
    <details
      className="worked-group"
      open={expanded}
      onToggle={(event) => {
        setExpanded(event.currentTarget.open);
      }}
    >
      <summary className="worked">
        <span>{label}</span>
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </summary>
      {expanded && (
        <div className="worked-items">
          {items.map((item) => (
            <Activity item={item} key={item.id} projectPath={projectPath} />
          ))}
        </div>
      )}
    </details>
  );
}

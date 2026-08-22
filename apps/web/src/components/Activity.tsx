import { useEffect, useRef, useState } from "react";
import type { TranscriptItem } from "@pi-web/contracts";

type ToolActivity = Extract<TranscriptItem, { kind: "tool" }>;
type ToolArguments = Record<string, unknown>;

interface ActivityLabel {
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

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0
    ? `${String(minutes)}m`
    : `${String(minutes)}m ${String(remainingSeconds)}s`;
}

function runLabel(items: readonly ToolActivity[]): string {
  const timestamps = items
    .map((item) => item.timestamp)
    .filter((value): value is string => value !== null)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  // Always name the duration slot: a bare "Worked" next to a sibling group's
  // "Worked for 27s" reads as a different kind of row rather than as the same
  // row with an unknown duration.
  if (timestamps.length < 2) return "Worked for <1s";
  const duration = Math.max(...timestamps) - Math.min(...timestamps);
  return duration <= 0
    ? "Worked for <1s"
    : `Worked for ${formatDuration(duration)}`;
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

export function Activity({
  item,
  projectPath,
}: {
  item: ToolActivity;
  projectPath: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = formatToolLabel(item, projectPath);
  const stateLabel =
    item.status === "running"
      ? "Running"
      : item.status === "failed"
        ? "Failed"
        : "Completed";

  return (
    <details
      className={`activity activity-${item.status}`}
      onToggle={(event) => {
        setExpanded(event.currentTarget.open);
      }}
    >
      <summary>
        <span className="activity-state" aria-label={stateLabel}>
          <span aria-hidden="true">
            {item.status === "running"
              ? "◌"
              : item.status === "failed"
                ? "!"
                : "✓"}
          </span>
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
      {expanded && (
        <div className="activity-details">
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
          {(item.cwd !== null || item.exitCode !== null) && (
            <footer>
              {item.cwd !== null && <span>cwd {item.cwd}</span>}
              {item.exitCode !== null && (
                <span>exit {String(item.exitCode)}</span>
              )}
            </footer>
          )}
        </div>
      )}
    </details>
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

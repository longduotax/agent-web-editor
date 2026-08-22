import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  clampTerminalSize,
  TerminalServerFrameSchema,
  type ProjectId,
  type TerminalId,
  type ThreadId,
} from "@pi-web/contracts";

import { webSocketUrl } from "../api/client.js";

// The terminal is the one surface xterm paints itself, so it cannot inherit
// the app's CSS tokens. Read them off the document instead of hardcoding a
// palette that is only correct in one theme (styles.css defines --term-bg /
// --term-fg / --term-cursor for light and dark alike).
interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
}

function readTerminalTheme(): TerminalTheme {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    return value === "" ? fallback : value;
  };
  return {
    background: token("--term-bg", "#ffffff"),
    foreground: token("--term-fg", "#1d1d1f"),
    cursor: token("--term-cursor", token("--term-fg", "#1d1d1f")),
  };
}

// Fires whenever the effective theme could have changed: an explicit choice
// stamps/removes data-theme on <html>, and the "system" choice follows
// prefers-color-scheme with no attribute change at all.
function observeThemeChanges(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

export function TerminalView({
  projectId,
  threadId,
  visible = true,
}: {
  projectId: ProjectId;
  threadId: ThreadId;
  /**
   * Whether this terminal is on screen. WSP-09: a terminal that is not
   * visible "keeps its process and buffers output but performs no rendering
   * work". Output frames are still written, because xterm's own buffer IS
   * the buffering the requirement asks for and it is the only one that trims
   * to the scrollback bound; what this suppresses is the measuring work,
   * which is both wasted and wrong on a `display: none` element — a zero-size
   * box makes the fit addon propose nonsense and pushes a bogus resize to the
   * PTY. The terminal is refitted once, on the way back to visible, because
   * the panel may have been resized while it was away.
   */
  visible?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const terminalId = useRef<TerminalId | null>(null);
  // Read by the resize observer, which must not be torn down and rebuilt
  // when visibility changes: that effect owns the socket and the process.
  const visibleRef = useRef(visible);
  const refit = useRef<() => void>(() => undefined);
  // Mirrors terminalId for rendering. Reading the ref during render made the
  // "Start terminal" button's visibility depend on an unrelated re-render.
  const [attached, setAttached] = useState(false);
  // The terminal's lifecycle, which only a lifecycle event changes: starting,
  // running, exited, disconnected. A refused command is NOT one of these.
  const [status, setStatus] = useState("Starting terminal…");
  /**
   * The last thing that went wrong that the shell survived — a command the
   * server refused, a frame that would not parse — or null.
   *
   * Separate from `status` because it is transient and `status` is not (F1).
   * A protocol rejection used to be written into `status`, where nothing ever
   * cleared it: the toolbar read "Terminal error" for the rest of the session
   * while the shell ran normally, and only a reload got rid of it. This
   * clears itself on the next frame that proves the connection works.
   */
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      theme: readTerminalTheme(),
    });
    const stopWatchingTheme = observeThemeChanges(() => {
      terminal.options.theme = readTerminalTheme();
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    fit.fit();
    const ws = new WebSocket(webSocketUrl("/api/terminal"));
    socket.current = ws;
    terminalId.current = null;
    setAttached(false);
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({ version: 1, type: "attach", projectId, threadId }),
      );
    });
    ws.addEventListener("message", (event) => {
      let value: unknown;
      try {
        value = JSON.parse(String(event.data));
      } catch {
        setNotice("A terminal frame could not be read.");
        return;
      }
      const parsed = TerminalServerFrameSchema.safeParse(value);
      if (!parsed.success) {
        setNotice("A terminal frame could not be read.");
        return;
      }
      // Any frame the server sends and this client understands is proof the
      // exchange works again, so whatever went wrong last is over (F1).
      setNotice(null);
      if (parsed.data.type === "ready") {
        terminalId.current = parsed.data.terminalId;
        setAttached(true);
        setStatus("Terminal running");
      } else if (parsed.data.type === "output")
        terminal.write(parsed.data.data);
      else if (parsed.data.type === "exit") {
        terminalId.current = null;
        setAttached(false);
        terminal.writeln(
          `\r\n[process exited ${String(parsed.data.exitCode)}]`,
        );
        setStatus("Terminal exited");
      } else if (parsed.data.type === "reset") {
        terminal.clear();
        setStatus(parsed.data.reason);
      } else {
        // Deliberately NOT written into the terminal buffer: a protocol
        // error is not program output, and in the scrollback it is
        // indistinguishable from one and outlives the problem (F1).
        setNotice(parsed.data.message);
      }
    });
    ws.addEventListener("close", () => {
      terminalId.current = null;
      setAttached(false);
      setStatus("Terminal disconnected");
    });
    const input = terminal.onData((data) => {
      const currentTerminalId = terminalId.current;
      if (ws.readyState === WebSocket.OPEN && currentTerminalId !== null)
        ws.send(
          JSON.stringify({
            version: 1,
            type: "input",
            projectId,
            threadId,
            terminalId: currentTerminalId,
            data,
          }),
        );
    });
    const fitToContainer = () => {
      fit.fit();
      const currentTerminalId = terminalId.current;
      if (ws.readyState !== WebSocket.OPEN || currentTerminalId === null)
        return;
      // The fit addon proposes whatever the box allows, and a group shrunk
      // to its floor allows `rows: 1` — which the contract refuses, so the
      // server answered with an error the user saw in their shell (F1). The
      // bounds come from the contract itself: duplicating the numbers here
      // would let the two drift apart silently.
      const { columns, rows } = clampTerminalSize(terminal.cols, terminal.rows);
      ws.send(
        JSON.stringify({
          version: 1,
          type: "resize",
          projectId,
          threadId,
          terminalId: currentTerminalId,
          columns,
          rows,
        }),
      );
    };
    refit.current = fitToContainer;
    const resize = new ResizeObserver(() => {
      // A hidden terminal is a zero-size box: measuring it proposes nonsense
      // and would push a bogus size to the PTY (WSP-09).
      if (!visibleRef.current) return;
      fitToContainer();
    });
    resize.observe(element);
    return () => {
      stopWatchingTheme();
      resize.disconnect();
      input.dispose();
      ws.close();
      terminal.dispose();
      terminalId.current = null;
      socket.current = null;
      refit.current = () => undefined;
    };
  }, [projectId, threadId]);

  // Deliberately separate from the effect above: that one owns the socket and
  // the process, and re-running it on a tab switch is exactly what WSP-09
  // forbids.
  useEffect(() => {
    visibleRef.current = visible;
    if (visible) refit.current();
  }, [visible]);

  const attach = () => {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(
        JSON.stringify({ version: 1, type: "attach", projectId, threadId }),
      );
  };

  const send = (type: "restart" | "terminate") => {
    const currentTerminalId = terminalId.current;
    if (
      socket.current?.readyState === WebSocket.OPEN &&
      currentTerminalId !== null
    )
      socket.current.send(
        JSON.stringify({
          version: 1,
          type,
          projectId,
          threadId,
          terminalId: currentTerminalId,
        }),
      );
  };
  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        <span>{status}</span>
        {notice !== null && (
          <span className="terminal-notice" aria-live="polite">
            {notice}
          </span>
        )}
        {!attached && <button onClick={attach}>Start terminal</button>}
        <button
          onClick={() => {
            send("restart");
          }}
        >
          Restart
        </button>
        <button
          onClick={() => {
            send("terminate");
          }}
        >
          Terminate
        </button>
      </div>
      <p className="terminal-warning">
        Direct local shell — not sandboxed and separate from agent execution.
      </p>
      {/* Two elements, not one (F4). The fit addon measures
          `getComputedStyle(parent).height`, which for a border-box element
          is its BORDER box — 218.917px measured against a 206.1px content
          box — and subtracts only the `.xterm` element's own padding, which
          is zero. So a padded container had its padding counted as space
          the terminal could use, and between 0 and 12.8px of the last text
          row was cut off. The padding lives out here; the box the addon
          measures has none, so its computed height IS its content box. */}
      <div className="terminal-surface" aria-label="Project terminal">
        <div ref={container} className="terminal-canvas" />
      </div>
    </div>
  );
}

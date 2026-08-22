import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
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
}: {
  projectId: ProjectId;
  threadId: ThreadId;
}) {
  const container = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const terminalId = useRef<TerminalId | null>(null);
  // Mirrors terminalId for rendering. Reading the ref during render made the
  // "Start terminal" button's visibility depend on an unrelated re-render.
  const [attached, setAttached] = useState(false);
  const [status, setStatus] = useState("Starting terminal…");

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
        setStatus("Terminal protocol error");
        return;
      }
      const parsed = TerminalServerFrameSchema.safeParse(value);
      if (!parsed.success) {
        setStatus("Terminal protocol error");
        return;
      }
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
        terminal.writeln(`\r\n[${parsed.data.message}]`);
        setStatus("Terminal error");
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
    const resize = new ResizeObserver(() => {
      fit.fit();
      const currentTerminalId = terminalId.current;
      if (ws.readyState === WebSocket.OPEN && currentTerminalId !== null)
        ws.send(
          JSON.stringify({
            version: 1,
            type: "resize",
            projectId,
            threadId,
            terminalId: currentTerminalId,
            columns: terminal.cols,
            rows: terminal.rows,
          }),
        );
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
    };
  }, [projectId, threadId]);

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
      <div
        ref={container}
        className="terminal-surface"
        aria-label="Project terminal"
      />
    </div>
  );
}

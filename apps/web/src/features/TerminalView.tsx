import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { TerminalServerFrameSchema, type ProjectId } from "@pi-web/contracts";

import { webSocketUrl } from "../api/client.js";

export function TerminalView({ projectId }: { projectId: ProjectId }) {
  const container = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState("Starting terminal…");

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      theme: { background: "#0d0f13", foreground: "#d8dce5" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    fit.fit();
    const ws = new WebSocket(webSocketUrl("/api/terminal"));
    socket.current = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ version: 1, type: "attach", projectId }));
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
      if (parsed.data.type === "ready") setStatus("Terminal running");
      else if (parsed.data.type === "output") terminal.write(parsed.data.data);
      else if (parsed.data.type === "exit") {
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
      setStatus("Terminal disconnected");
    });
    const input = terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ version: 1, type: "input", projectId, data }));
    });
    const resize = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN)
        ws.send(
          JSON.stringify({
            version: 1,
            type: "resize",
            projectId,
            columns: terminal.cols,
            rows: terminal.rows,
          }),
        );
    });
    resize.observe(element);
    return () => {
      resize.disconnect();
      input.dispose();
      ws.close();
      terminal.dispose();
      socket.current = null;
    };
  }, [projectId]);

  const send = (type: "restart" | "terminate") => {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify({ version: 1, type, projectId }));
  };
  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        <span>{status}</span>
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

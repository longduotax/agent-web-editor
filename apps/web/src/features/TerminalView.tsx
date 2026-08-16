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

export function TerminalView({
  projectId,
  threadId,
}: {
  projectId: ProjectId;
  threadId?: ThreadId;
}) {
  const container = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const terminalId = useRef<TerminalId | null>(null);
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
    terminalId.current = null;
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
        setStatus("Terminal running");
      } else if (parsed.data.type === "output")
        terminal.write(parsed.data.data);
      else if (parsed.data.type === "exit") {
        terminalId.current = null;
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
        {terminalId.current === null && (
          <button onClick={attach}>Start terminal</button>
        )}
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

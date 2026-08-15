import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";

import * as nodePty from "node-pty";
import {
  ProjectIdSchema,
  TerminalIdSchema,
  type ProjectId,
} from "@pi-web/contracts";

export interface PtyProcess {
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): {
    dispose(): void;
  };
}
export interface PtyFactory {
  spawn(cwd: string, columns: number, rows: number): PtyProcess;
}

function terminalEnvironment(): Record<string, string> {
  const denied = /(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTH|CREDENTIAL|PI_WEB)/i;
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !denied.test(entry[0]),
    ),
  );
}

export class NodePtyFactory implements PtyFactory {
  public spawn(cwd: string, columns: number, rows: number): PtyProcess {
    const configured = process.env.SHELL;
    const shell = configured?.startsWith("/") === true ? configured : "/bin/sh";
    return nodePty.spawn(shell, [], {
      cwd,
      cols: columns,
      rows,
      env: terminalEnvironment(),
      name: "xterm-256color",
    });
  }
}

export interface TerminalAttachment {
  send(frame: unknown): void;
}

interface TerminalOwner {
  id: string;
  process: PtyProcess;
  listeners: { dispose(): void }[];
  attachments: Set<TerminalAttachment>;
  replay: string;
  root: string;
}

export class ProjectTerminalManager {
  private readonly owners = new Map<ProjectId, TerminalOwner>();
  public constructor(
    private readonly factory: PtyFactory = new NodePtyFactory(),
  ) {}

  public async attach(
    rawProjectId: string,
    root: string,
    attachment: TerminalAttachment,
  ): Promise<() => void> {
    const projectId = ProjectIdSchema.parse(rawProjectId);
    await access(root);
    let owner = this.owners.get(projectId);
    owner ??= this.create(projectId, root, 100, 30);
    owner.attachments.add(attachment);
    attachment.send({
      version: 1,
      type: "ready",
      projectId,
      terminalId: owner.id,
    });
    if (owner.replay !== "")
      attachment.send({
        version: 1,
        type: "output",
        projectId,
        data: owner.replay,
      });
    return () => {
      owner.attachments.delete(attachment);
    };
  }

  private create(
    projectId: ProjectId,
    root: string,
    columns: number,
    rows: number,
  ): TerminalOwner {
    const process = this.factory.spawn(root, columns, rows);
    const owner: TerminalOwner = {
      id: TerminalIdSchema.parse(randomUUID()),
      process,
      listeners: [],
      attachments: new Set(),
      replay: "",
      root,
    };
    owner.listeners.push(
      process.onData((data) => {
        owner.replay += data;
        while (Buffer.byteLength(owner.replay) > 1_048_576)
          owner.replay = owner.replay.slice(
            Math.max(1, Math.floor(owner.replay.length / 10)),
          );
        for (const attachment of owner.attachments)
          attachment.send({
            version: 1,
            type: "output",
            projectId,
            data: data.slice(0, 1_048_576),
          });
      }),
    );
    owner.listeners.push(
      process.onExit((event) => {
        for (const attachment of owner.attachments)
          attachment.send({
            version: 1,
            type: "exit",
            projectId,
            exitCode: event.exitCode,
            signal: event.signal ?? null,
          });
        this.dispose(projectId, false);
      }),
    );
    this.owners.set(projectId, owner);
    return owner;
  }

  public input(rawProjectId: string, data: string): void {
    const owner = this.owners.get(ProjectIdSchema.parse(rawProjectId));
    if (owner === undefined) throw new Error("terminal_gone");
    if (Buffer.byteLength(data) > 65_536)
      throw new Error("terminal_input_too_large");
    owner.process.write(data);
  }

  public resize(rawProjectId: string, columns: number, rows: number): void {
    if (
      !Number.isInteger(columns) ||
      columns < 2 ||
      columns > 500 ||
      !Number.isInteger(rows) ||
      rows < 2 ||
      rows > 200
    )
      throw new Error("terminal_dimensions_invalid");
    const owner = this.owners.get(ProjectIdSchema.parse(rawProjectId));
    if (owner === undefined) throw new Error("terminal_gone");
    owner.process.resize(columns, rows);
  }

  public restart(rawProjectId: string): void {
    const projectId = ProjectIdSchema.parse(rawProjectId);
    const owner = this.owners.get(projectId);
    if (owner === undefined) throw new Error("terminal_gone");
    const attachments = [...owner.attachments];
    const root = owner.root;
    this.dispose(projectId, true);
    const replacement = this.create(projectId, root, 100, 30);
    for (const attachment of attachments)
      replacement.attachments.add(attachment);
    for (const attachment of attachments)
      attachment.send({
        version: 1,
        type: "ready",
        projectId,
        terminalId: replacement.id,
      });
  }

  public terminate(rawProjectId: string): void {
    this.dispose(ProjectIdSchema.parse(rawProjectId), true);
  }

  private dispose(projectId: ProjectId, kill: boolean): void {
    const owner = this.owners.get(projectId);
    if (owner === undefined) return;
    this.owners.delete(projectId);
    for (const listener of owner.listeners) listener.dispose();
    owner.listeners.length = 0;
    if (kill) owner.process.kill();
    owner.attachments.clear();
  }

  public close(): void {
    for (const projectId of [...this.owners.keys()])
      this.dispose(projectId, true);
  }
}

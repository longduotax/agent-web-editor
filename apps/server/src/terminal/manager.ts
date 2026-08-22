import { randomUUID } from "node:crypto";
import { access, constants, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import * as nodePty from "node-pty";
import {
  ProjectIdSchema,
  TERMINAL_MAX_COLUMNS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLUMNS,
  TERMINAL_MIN_ROWS,
  TerminalIdSchema,
  TerminalServerFrameSchema,
  type ProjectId,
  type TerminalId,
  type TerminalServerFrame,
} from "@pi-web/contracts";

export interface PtyProcess {
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(): void;
  onData(listener: (data: unknown) => void): { dispose(): void };
  onExit(listener: (event: unknown) => void): {
    dispose(): void;
  };
}
export interface PtyFactory {
  spawn(
    cwd: string,
    columns: number,
    rows: number,
  ): PtyProcess | Promise<PtyProcess>;
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
  public async spawn(
    cwd: string,
    columns: number,
    rows: number,
  ): Promise<PtyProcess> {
    const shell = await shellPath(process.env.SHELL);
    const pty = nodePty.spawn(shell, [], {
      cwd,
      cols: columns,
      rows,
      env: terminalEnvironment(),
      name: "xterm-256color",
    });
    return {
      write: (data) => {
        pty.write(data);
      },
      resize: (width, height) => {
        pty.resize(width, height);
      },
      kill: () => {
        pty.kill();
      },
      onData: (listener) =>
        pty.onData((data) => {
          listener(data);
        }),
      onExit: (listener) =>
        pty.onExit((event) => {
          listener(event);
        }),
    };
  }
}

async function executable(path: unknown): Promise<string | null> {
  if (typeof path !== "string" || !isAbsolute(path)) return null;
  try {
    if (!(await stat(path)).isFile()) return null;
    await access(path, constants.X_OK);
    return path;
  } catch {
    return null;
  }
}

export async function shellPath(value: unknown): Promise<string> {
  return (
    (await executable(value)) ?? (await executable("/bin/sh")) ?? "/bin/sh"
  );
}

export interface TerminalAttachment {
  send(frame: TerminalServerFrame): void;
}

const terminalOutputLimit = 1_048_576;

function terminalFrame(value: unknown): TerminalServerFrame {
  return TerminalServerFrameSchema.parse(value);
}

function truncateUtf8Prefix(
  value: string,
  limit = terminalOutputLimit,
): string {
  if (Buffer.byteLength(value) <= limit) return value;
  const output: string[] = [];
  let size = 0;
  for (const character of value) {
    const characterSize = Buffer.byteLength(character);
    if (size + characterSize > limit) break;
    output.push(character);
    size += characterSize;
  }
  return output.join("");
}

function truncateUtf8Suffix(
  value: string,
  limit = terminalOutputLimit,
): string {
  if (Buffer.byteLength(value) <= limit) return value;
  const characters = Array.from(value);
  const output: string[] = [];
  let size = 0;
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index];
    if (character === undefined) continue;
    const characterSize = Buffer.byteLength(character);
    if (size + characterSize > limit) break;
    output.push(character);
    size += characterSize;
  }
  return output.reverse().join("");
}

function normalizePtyOutput(
  value: unknown,
): { data: string; truncated: boolean } | null {
  if (typeof value !== "string") return null;
  const data = truncateUtf8Prefix(value);
  return { data, truncated: data !== value };
}

function exitPayload(
  value: unknown,
): { exitCode: number; signal: number | null } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const exitCode = record.exitCode;
  const signal = record.signal;
  if (
    typeof exitCode !== "number" ||
    !Number.isFinite(exitCode) ||
    !Number.isInteger(exitCode)
  )
    return null;
  if (
    signal !== undefined &&
    (typeof signal !== "number" ||
      !Number.isFinite(signal) ||
      !Number.isInteger(signal))
  )
    return null;
  return {
    exitCode,
    signal: signal ?? null,
  };
}

interface TerminalOwner {
  id: TerminalId;
  projectId: ProjectId;
  scopeId: string;
  process: PtyProcess;
  listeners: { dispose(): void }[];
  attachments: Set<TerminalAttachment>;
  replay: string;
  replayTruncated: boolean;
  root: string;
}

interface PendingTerminalOwner {
  promise?: Promise<TerminalOwner>;
  cancelled: boolean;
  projectId: ProjectId;
}

export class ProjectTerminalManager {
  private readonly owners = new Map<string, TerminalOwner>();
  private readonly pendingOwners = new Map<string, PendingTerminalOwner>();
  public constructor(
    private readonly factory: PtyFactory = new NodePtyFactory(),
  ) {}

  public async attach(
    rawProjectId: string,
    root: string,
    attachment: TerminalAttachment,
    rawScopeId: string = rawProjectId,
  ): Promise<() => void> {
    const projectId = ProjectIdSchema.parse(rawProjectId);
    const scopeId = TerminalIdSchema.parse(rawScopeId);
    await access(root);
    const owner = await this.ownerFor(scopeId, projectId, root, 100, 30);
    owner.attachments.add(attachment);
    attachment.send(
      terminalFrame({
        version: 1,
        type: "ready",
        projectId,
        terminalId: owner.id,
      }),
    );
    if (owner.replayTruncated)
      attachment.send(
        terminalFrame({
          version: 1,
          type: "reset",
          projectId,
          reason: "Terminal replay was truncated.",
        }),
      );
    if (owner.replay !== "")
      attachment.send(
        terminalFrame({
          version: 1,
          type: "output",
          projectId,
          data: owner.replay,
        }),
      );
    return () => {
      const currentOwner = this.owners.get(scopeId);
      if (currentOwner?.attachments.has(attachment))
        currentOwner.attachments.delete(attachment);
    };
  }

  private async ownerFor(
    scopeId: string,
    projectId: ProjectId,
    root: string,
    columns: number,
    rows: number,
  ): Promise<TerminalOwner> {
    const existing = this.owners.get(scopeId);
    if (existing !== undefined) return existing;
    const pending = this.pendingOwners.get(scopeId);
    if (pending !== undefined) {
      if (pending.promise === undefined) throw new Error("terminal_gone");
      return pending.promise;
    }
    const creation: PendingTerminalOwner = { cancelled: false, projectId };
    const creationPromise = this.create(
      scopeId,
      projectId,
      root,
      columns,
      rows,
      creation,
    );
    creation.promise = creationPromise;
    this.pendingOwners.set(scopeId, creation);
    try {
      return await creationPromise;
    } finally {
      if (this.pendingOwners.get(scopeId) === creation)
        this.pendingOwners.delete(scopeId);
    }
  }

  private async create(
    scopeId: string,
    projectId: ProjectId,
    root: string,
    columns: number,
    rows: number,
    creation: PendingTerminalOwner,
  ): Promise<TerminalOwner> {
    const process = await this.factory.spawn(root, columns, rows);
    if (creation.cancelled || this.pendingOwners.get(scopeId) !== creation) {
      process.kill();
      throw new Error("terminal_gone");
    }
    const owner: TerminalOwner = {
      id: TerminalIdSchema.parse(randomUUID()),
      projectId,
      scopeId,
      process,
      listeners: [],
      attachments: new Set(),
      replay: "",
      replayTruncated: false,
      root,
    };
    owner.listeners.push(
      process.onData((data) => {
        const output = normalizePtyOutput(data);
        if (output === null) {
          for (const attachment of owner.attachments)
            attachment.send(
              terminalFrame({
                version: 1,
                type: "error",
                projectId,
                message: "Terminal emitted malformed output.",
              }),
            );
          return;
        }
        const replay = `${owner.replay}${output.data}`;
        owner.replay = truncateUtf8Suffix(replay);
        if (output.truncated || owner.replay !== replay)
          owner.replayTruncated = true;
        for (const attachment of owner.attachments)
          attachment.send(
            terminalFrame({
              version: 1,
              type: "output",
              projectId,
              data: output.data,
            }),
          );
      }),
    );
    owner.listeners.push(
      process.onExit((event) => {
        const parsed = exitPayload(event);
        if (parsed === null) {
          for (const attachment of owner.attachments)
            attachment.send(
              terminalFrame({
                version: 1,
                type: "error",
                projectId,
                message: "Terminal exited with malformed status.",
              }),
            );
          this.dispose(scopeId, owner, false);
          return;
        }
        for (const attachment of owner.attachments)
          attachment.send(
            terminalFrame({
              version: 1,
              type: "exit",
              projectId,
              exitCode: parsed.exitCode,
              signal: parsed.signal,
            }),
          );
        this.dispose(scopeId, owner, false);
      }),
    );
    this.owners.set(scopeId, owner);
    return owner;
  }

  public input(
    rawProjectId: string,
    rawTerminalId: string,
    data: string,
    rawScopeId: string = rawProjectId,
  ): void {
    const owner = this.activeOwner(rawScopeId, rawProjectId, rawTerminalId);
    if (Buffer.byteLength(data) > 65_536)
      throw new Error("terminal_input_too_large");
    owner.process.write(data);
  }

  public resize(
    rawProjectId: string,
    rawTerminalId: string,
    columns: number,
    rows: number,
    rawScopeId: string = rawProjectId,
  ): void {
    if (
      !Number.isInteger(columns) ||
      columns < TERMINAL_MIN_COLUMNS ||
      columns > TERMINAL_MAX_COLUMNS ||
      !Number.isInteger(rows) ||
      rows < TERMINAL_MIN_ROWS ||
      rows > TERMINAL_MAX_ROWS
    )
      throw new Error("terminal_dimensions_invalid");
    const owner = this.activeOwner(rawScopeId, rawProjectId, rawTerminalId);
    owner.process.resize(columns, rows);
  }

  public async restart(
    rawProjectId: string,
    rawTerminalId: string,
    rawScopeId: string = rawProjectId,
  ): Promise<void> {
    const projectId = ProjectIdSchema.parse(rawProjectId);
    const scopeId = TerminalIdSchema.parse(rawScopeId);
    const owner = this.activeOwner(scopeId, projectId, rawTerminalId);
    const attachments = [...owner.attachments];
    const root = owner.root;
    this.dispose(scopeId, owner, true);
    const replacement = await this.ownerFor(scopeId, projectId, root, 100, 30);
    for (const attachment of attachments)
      replacement.attachments.add(attachment);
    for (const attachment of attachments)
      attachment.send(
        terminalFrame({
          version: 1,
          type: "ready",
          projectId,
          terminalId: replacement.id,
        }),
      );
  }

  public terminate(
    rawProjectId: string,
    rawTerminalId?: string,
    rawScopeId: string = rawProjectId,
  ): void {
    const projectId = ProjectIdSchema.parse(rawProjectId);
    if (rawTerminalId !== undefined) {
      const scopeId = TerminalIdSchema.parse(rawScopeId);
      const owner = this.activeOwner(scopeId, projectId, rawTerminalId);
      this.notifyTermination(projectId, owner);
      this.dispose(scopeId, owner, true);
      return;
    }
    for (const pending of this.pendingOwners.values())
      if (pending.projectId === projectId) pending.cancelled = true;
    for (const [scopeId, owner] of this.owners) {
      if (owner.projectId !== projectId) continue;
      this.notifyTermination(projectId, owner);
      this.dispose(scopeId, owner, true);
    }
  }

  private notifyTermination(projectId: ProjectId, owner: TerminalOwner): void {
    for (const attachment of owner.attachments)
      attachment.send(
        terminalFrame({
          version: 1,
          type: "exit",
          projectId,
          exitCode: 143,
          signal: 15,
        }),
      );
  }

  private activeOwner(
    rawScopeId: string,
    rawProjectId: string,
    rawTerminalId: string,
  ): TerminalOwner {
    const scopeId = TerminalIdSchema.parse(rawScopeId);
    const projectId = ProjectIdSchema.parse(rawProjectId);
    const terminalId = TerminalIdSchema.parse(rawTerminalId);
    const owner = this.owners.get(scopeId);
    if (owner?.id !== terminalId || owner.projectId !== projectId)
      throw new Error("terminal_gone");
    return owner;
  }

  private dispose(scopeId: string, owner: TerminalOwner, kill: boolean): void {
    if (this.owners.get(scopeId) !== owner) return;
    this.owners.delete(scopeId);
    for (const listener of owner.listeners) listener.dispose();
    owner.listeners.length = 0;
    if (kill) owner.process.kill();
    owner.attachments.clear();
  }

  public close(): void {
    for (const pending of this.pendingOwners.values()) pending.cancelled = true;
    for (const [scopeId, owner] of this.owners)
      this.dispose(scopeId, owner, true);
  }
}

import { randomUUID } from "node:crypto";
import { access, constants, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import * as nodePty from "node-pty";
import {
  ProjectIdSchema,
  TERMINAL_MAX_COLUMNS,
  TERMINAL_MAX_PER_SCOPE,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLUMNS,
  TERMINAL_MIN_ROWS,
  TerminalIdSchema,
  TerminalServerFrameSchema,
  type ProjectId,
  type TerminalDescriptor,
  type TerminalErrorCode,
  type TerminalId,
  type TerminalServerFrame,
} from "@pi-web/contracts";

import { resolveContained } from "../inspector/files.js";
import { cwdProbeSupported, probeCwd, workspaceRelativeCwd } from "./cwd.js";

export interface PtyProcess {
  /**
   * The operating-system process id, or `null` where the adapter cannot
   * report one. Needed only to OBSERVE the shell's working directory
   * (WSP-07); everything else here goes through the adapter's own methods.
   * The test fake returns `null`, which exercises the unobservable path.
   */
  readonly pid: number | null;
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
      pid: pty.pid,
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

/**
 * A refusal the client has to act on differently from any other.
 *
 * Reaching the per-scope cap, naming a terminal that is gone, and asking for
 * a spawn directory outside the execution root each become their own state
 * in the tab — a cap message, a restart action, a refused path — so the
 * rejection carries the code the `error` frame will quote rather than a
 * string the client would have to match on prose (D-2).
 */
export class TerminalRejection extends Error {
  public constructor(public readonly code: TerminalErrorCode) {
    super(code);
    this.name = "TerminalRejection";
  }
}

const terminalOutputLimit = 1_048_576;

/**
 * The shortest interval between two working-directory observations of one
 * terminal (WSP-07). It is a ceiling on the rate, not a promise to run: the
 * probe runs only while a client is attached, and not at all where the
 * platform cannot answer or the process has no id (WSP-09).
 */
const CWD_POLL_INTERVAL_MS = 1000;

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
  /** The execution root this terminal belongs to, absolute. */
  root: string;
  /** The last observed directory, workspace-relative; null if unobservable. */
  observedCwd: string | null;
  /** The poll, which exists only while something is attached. */
  poll: ReturnType<typeof setInterval> | null;
  /** Guards against a slow probe overlapping the next tick. */
  probing: boolean;
  lastProbeAt: number;
}

interface PendingTerminalOwner {
  promise?: Promise<TerminalOwner>;
  cancelled: boolean;
  projectId: ProjectId;
  scopeId: string;
}

export interface TerminalAttachRequest {
  projectId: string;
  /**
   * The execution scope: the project id for a shared thread, the worktree id
   * for an isolated one. It is derived by the server's execution-context
   * resolver from a thread record and never carried on the wire, so it is
   * compared rather than parsed. It used to be run through
   * `TerminalIdSchema`, which passed only because all three brands are
   * UUIDs — a validation that proved nothing about the value it checked.
   */
  scopeId?: string | undefined;
  /** The scope's execution root, already resolved by the caller. */
  executionRoot: string;
  attachment: TerminalAttachment;
  /**
   * Re-attach to this terminal (WSP-07). Absent, this takes a NEW terminal,
   * which is what `create` and a first attach both mean.
   */
  terminalId?: string | undefined;
  /** Spawn directory, workspace-relative; the execution root when absent. */
  cwd?: string | undefined;
}

export interface TerminalManagerOptions {
  /**
   * How a running shell's directory is observed. Injected so the manager's
   * own tests need neither a real process nor a particular operating system.
   */
  observeCwd?: (pid: number) => Promise<string | null>;
  /** Whether this platform can observe one at all. */
  cwdObservable?: boolean;
}

export class ProjectTerminalManager {
  /**
   * Ownership is keyed by terminal identity, not by execution scope (WSP-07).
   * The scope key was only ever an addressing shortcut, and it made "two
   * shells in one worktree" unrepresentable rather than merely unavailable.
   */
  private readonly owners = new Map<TerminalId, TerminalOwner>();
  /** The index every scope-wide operation reads. Kept beside `owners`. */
  private readonly scopeTerminals = new Map<string, Set<TerminalId>>();
  /**
   * Creations in flight, keyed by a creation token rather than by scope:
   * two concurrent creates in one scope are now legitimate, so they cannot
   * share an entry. They are counted against the cap while they last.
   */
  private readonly pendingOwners = new Map<string, PendingTerminalOwner>();
  private readonly observeCwd: (pid: number) => Promise<string | null>;
  private readonly cwdObservable: boolean;

  public constructor(
    private readonly factory: PtyFactory = new NodePtyFactory(),
    options: TerminalManagerOptions = {},
  ) {
    this.observeCwd = options.observeCwd ?? probeCwd;
    this.cwdObservable = options.cwdObservable ?? cwdProbeSupported();
  }

  public async attach(request: TerminalAttachRequest): Promise<() => void> {
    const projectId = ProjectIdSchema.parse(request.projectId);
    const scopeId = request.scopeId ?? projectId;
    const root = request.executionRoot;
    await access(root);
    const owner =
      request.terminalId === undefined
        ? await this.createOwner(projectId, scopeId, root, request.cwd)
        : this.activeOwner(projectId, request.terminalId, scopeId);
    const attachment = request.attachment;
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
    // What is known now, so the tab has a directory to show before the first
    // poll lands. `null` is the honest answer until one does.
    attachment.send(this.cwdFrame(owner));
    this.startPolling(owner);
    return () => {
      // Looked for rather than remembered: a restart disposes this terminal
      // and carries its attachments to the replacement, so the owner this
      // closure was created against may no longer be the one holding it.
      for (const current of this.owners.values())
        if (
          current.attachments.delete(attachment) &&
          current.attachments.size === 0
        )
          this.stopPolling(current);
    };
  }

  /** The live terminals of one execution scope, as the listing route reports. */
  public list(rawProjectId: string, scopeId: string): TerminalDescriptor[] {
    const projectId = ProjectIdSchema.parse(rawProjectId);
    const descriptors: TerminalDescriptor[] = [];
    for (const terminalId of this.scopeTerminals.get(scopeId) ?? []) {
      const owner = this.owners.get(terminalId);
      if (owner?.projectId !== projectId) continue;
      descriptors.push({ id: owner.id, cwd: owner.observedCwd });
    }
    return descriptors;
  }

  private scopeCount(scopeId: string): number {
    let pending = 0;
    for (const creation of this.pendingOwners.values())
      if (creation.scopeId === scopeId) pending += 1;
    return (this.scopeTerminals.get(scopeId)?.size ?? 0) + pending;
  }

  private async createOwner(
    projectId: ProjectId,
    scopeId: string,
    root: string,
    cwd: string | undefined,
  ): Promise<TerminalOwner> {
    if (this.scopeCount(scopeId) >= TERMINAL_MAX_PER_SCOPE)
      throw new TerminalRejection("terminal_limit_reached");
    // Resolved and contained before anything is spawned, so a refused path
    // costs no process (WSP-07).
    const directory = await this.spawnDirectory(root, cwd);
    const token = randomUUID();
    const creation: PendingTerminalOwner = {
      cancelled: false,
      projectId,
      scopeId,
    };
    const creationPromise = this.create(
      token,
      projectId,
      scopeId,
      root,
      directory,
      creation,
    );
    creation.promise = creationPromise;
    this.pendingOwners.set(token, creation);
    try {
      return await creationPromise;
    } finally {
      if (this.pendingOwners.get(token) === creation)
        this.pendingOwners.delete(token);
    }
  }

  /**
   * Where a new terminal starts, proven to be inside its execution root.
   *
   * The path goes through exactly the resolver every file route uses: the
   * same relative-path schema, the same `.git` refusal, the same realpath
   * containment check. A directory that does not resolve inside the root is
   * refused rather than clamped to it — a shell that silently starts
   * somewhere else is worse than one that does not start.
   */
  private async spawnDirectory(
    root: string,
    cwd: string | undefined,
  ): Promise<string> {
    if (cwd === undefined || cwd === "") return root;
    try {
      const resolved = await resolveContained(root, cwd);
      if (!(await stat(resolved.target)).isDirectory())
        throw new Error("path_not_directory");
      return resolved.target;
    } catch {
      throw new TerminalRejection("terminal_cwd_invalid");
    }
  }

  private async create(
    token: string,
    projectId: ProjectId,
    scopeId: string,
    root: string,
    directory: string,
    creation: PendingTerminalOwner,
  ): Promise<TerminalOwner> {
    const process = await this.factory.spawn(directory, 100, 30);
    if (creation.cancelled || this.pendingOwners.get(token) !== creation) {
      process.kill();
      throw new TerminalRejection("terminal_gone");
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
      observedCwd: null,
      poll: null,
      probing: false,
      lastProbeAt: 0,
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
          this.dispose(owner, false);
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
        this.dispose(owner, false);
      }),
    );
    this.owners.set(owner.id, owner);
    this.index(scopeId).add(owner.id);
    return owner;
  }

  private index(scopeId: string): Set<TerminalId> {
    const existing = this.scopeTerminals.get(scopeId);
    if (existing !== undefined) return existing;
    const created = new Set<TerminalId>();
    this.scopeTerminals.set(scopeId, created);
    return created;
  }

  public input(
    rawProjectId: string,
    rawTerminalId: string,
    data: string,
    scopeId?: string,
  ): void {
    const owner = this.activeOwner(rawProjectId, rawTerminalId, scopeId);
    if (Buffer.byteLength(data) > 65_536)
      throw new Error("terminal_input_too_large");
    owner.process.write(data);
  }

  public resize(
    rawProjectId: string,
    rawTerminalId: string,
    columns: number,
    rows: number,
    scopeId?: string,
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
    const owner = this.activeOwner(rawProjectId, rawTerminalId, scopeId);
    owner.process.resize(columns, rows);
  }

  /**
   * Dispose this terminal and create another in its place.
   *
   * The replacement has a NEW id, which the client adopts from the `ready`
   * frame below, and starts in `cwd` — the directory the tab recorded, which
   * is how a restart carries the working directory forward (WSP-07). The old
   * terminal is disposed first, so a restart at the cap still has a slot.
   */
  public async restart(
    rawProjectId: string,
    rawTerminalId: string,
    scopeId?: string,
    cwd?: string,
  ): Promise<void> {
    const owner = this.activeOwner(rawProjectId, rawTerminalId, scopeId);
    const attachments = [...owner.attachments];
    const { projectId, root } = owner;
    const ownerScope = owner.scopeId;
    this.dispose(owner, true);
    const replacement = await this.createOwner(
      projectId,
      ownerScope,
      root,
      cwd,
    );
    for (const attachment of attachments)
      replacement.attachments.add(attachment);
    for (const attachment of attachments) {
      attachment.send(
        terminalFrame({
          version: 1,
          type: "ready",
          projectId,
          terminalId: replacement.id,
        }),
      );
      attachment.send(this.cwdFrame(replacement));
    }
    this.startPolling(replacement);
  }

  public terminate(
    rawProjectId: string,
    rawTerminalId?: string,
    scopeId?: string,
  ): void {
    const projectId = ProjectIdSchema.parse(rawProjectId);
    if (rawTerminalId !== undefined) {
      const owner = this.activeOwner(projectId, rawTerminalId, scopeId);
      this.notifyTermination(projectId, owner);
      this.dispose(owner, true);
      return;
    }
    for (const pending of this.pendingOwners.values())
      if (pending.projectId === projectId) pending.cancelled = true;
    for (const owner of [...this.owners.values()]) {
      if (owner.projectId !== projectId) continue;
      this.notifyTermination(projectId, owner);
      this.dispose(owner, true);
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

  /**
   * The terminal this request may address, or a typed refusal.
   *
   * Looked up by id and then required to belong to the request's project AND
   * its execution scope. Both checks matter: the scope key alone no longer
   * proves anything now that a scope holds several terminals, and a live id
   * from another worktree or another project must be rejected rather than
   * reachable.
   */
  private activeOwner(
    rawProjectId: string,
    rawTerminalId: string,
    rawScopeId?: string,
  ): TerminalOwner {
    const projectId = ProjectIdSchema.parse(rawProjectId);
    const terminalId = TerminalIdSchema.parse(rawTerminalId);
    const scopeId = rawScopeId ?? projectId;
    const owner = this.owners.get(terminalId);
    if (owner?.projectId !== projectId || owner.scopeId !== scopeId)
      throw new TerminalRejection("terminal_gone");
    return owner;
  }

  private dispose(owner: TerminalOwner, kill: boolean): void {
    if (this.owners.get(owner.id) !== owner) return;
    this.owners.delete(owner.id);
    const scope = this.scopeTerminals.get(owner.scopeId);
    scope?.delete(owner.id);
    if (scope?.size === 0) this.scopeTerminals.delete(owner.scopeId);
    this.stopPolling(owner);
    for (const listener of owner.listeners) listener.dispose();
    owner.listeners.length = 0;
    if (kill) owner.process.kill();
    owner.attachments.clear();
  }

  // The working-directory probe. WSP-09 asks that nothing unobserved does
  // ongoing work, and this is the terminal's share of that: the poll exists
  // only while a client is attached, and not at all where the platform
  // cannot answer or the adapter reported no process id.
  private startPolling(owner: TerminalOwner): void {
    if (owner.poll !== null || owner.attachments.size === 0) return;
    if (!this.cwdObservable || owner.process.pid === null) return;
    const poll = setInterval(() => {
      void this.pollCwd(owner);
    }, CWD_POLL_INTERVAL_MS);
    // The poll must never be the reason the process stays alive.
    poll.unref();
    owner.poll = poll;
  }

  private stopPolling(owner: TerminalOwner): void {
    if (owner.poll === null) return;
    clearInterval(owner.poll);
    owner.poll = null;
  }

  private async pollCwd(owner: TerminalOwner): Promise<void> {
    if (owner.probing || owner.attachments.size === 0) return;
    const pid = owner.process.pid;
    if (pid === null) return;
    const now = Date.now();
    if (now - owner.lastProbeAt < CWD_POLL_INTERVAL_MS) return;
    owner.lastProbeAt = now;
    owner.probing = true;
    try {
      const observed = workspaceRelativeCwd(
        owner.root,
        await this.observeCwd(pid),
      );
      // The terminal may have been disposed while the probe was out.
      if (this.owners.get(owner.id) !== owner) return;
      if (observed === owner.observedCwd) return;
      owner.observedCwd = observed;
      const frame = this.cwdFrame(owner);
      for (const attachment of owner.attachments) attachment.send(frame);
    } catch {
      // An observation that failed is not something the shell should hear
      // about; the directory is simply still what it was.
    } finally {
      owner.probing = false;
    }
  }

  private cwdFrame(owner: TerminalOwner): TerminalServerFrame {
    return terminalFrame({
      version: 1,
      type: "cwd",
      projectId: owner.projectId,
      terminalId: owner.id,
      cwd: owner.observedCwd,
    });
  }

  public close(): void {
    for (const pending of this.pendingOwners.values()) pending.cancelled = true;
    for (const owner of [...this.owners.values()]) this.dispose(owner, true);
  }
}

import { RuntimeFailure } from "@pi-web/agent-runtime";
import { z } from "zod";

/**
 * The byte-level seam to one `codex app-server` process. Keeping it an
 * interface lets every test drive the protocol without spawning Codex.
 */
export interface CodexTransport {
  send(line: string): void;
  onLine(listener: (line: string) => void): void;
  onExit(
    listener: (info: {
      code: number | null;
      signal: string | null;
      /** Set when the child never started, e.g. the binary is missing. */
      error?: Error;
    }) => void,
  ): void;
  close(): void;
}

export interface CodexClientOptions {
  connect: () => Promise<CodexTransport>;
  handshakeTimeoutMs?: number;
  restartDelayMs?: number;
  clientName?: string;
}

/**
 * Everything below arrives from an external program, so each frame is parsed
 * into one of the three shapes JSON-RPC allows rather than trusted by shape.
 */
const responseFrameSchema = z
  .object({
    jsonrpc: z.literal("2.0").optional(),
    id: z.union([z.number(), z.string()]),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number().optional(),
        message: z.string().optional(),
        data: z.unknown().optional(),
      })
      .optional(),
  })
  .strict();
const notificationFrameSchema = z
  .object({
    jsonrpc: z.literal("2.0").optional(),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();
const serverRequestFrameSchema = z
  .object({
    jsonrpc: z.literal("2.0").optional(),
    id: z.union([z.number(), z.string()]),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();

type NotificationListener = (method: string, params: unknown) => void;
type ServerRequestHandler = (method: string, params: unknown) => unknown;
type DisconnectListener = (reason: string) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

interface Session {
  transport: CodexTransport;
  pending: Map<string, Pending>;
  alive: boolean;
}

const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * A JSON-RPC client over one supervised `codex app-server` process.
 *
 * One process serves every thread: the protocol addresses threads explicitly,
 * so multiplexing keeps memory flat as pane count grows and leaves a single
 * supervisor to reason about instead of one per open chat.
 */
export class CodexClient {
  private session: Promise<Session> | undefined;
  private nextId = 1;
  private disposed = false;
  private readonly notificationListeners = new Set<NotificationListener>();
  private readonly disconnectListeners = new Set<DisconnectListener>();
  private serverRequestHandler: ServerRequestHandler | undefined;
  /** Frames Codex sent that could not be understood, kept for diagnostics. */
  public droppedFrames = 0;

  public constructor(private readonly options: CodexClientOptions) {}

  /** Resolves once a live, handshaken session exists. */
  public async ready(): Promise<void> {
    await this.session0();
  }

  public onNotification(listener: NotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  public onDisconnect(listener: DisconnectListener): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  /**
   * Registered once by the runtime. Returning a value answers Codex; returning
   * null declines to answer and the request is reported as unsupported.
   */
  public onServerRequest(handler: ServerRequestHandler): void {
    this.serverRequestHandler = handler;
  }

  public async request(method: string, params: unknown): Promise<unknown> {
    const session = await this.session0();
    const id = this.nextId++;
    return await new Promise<unknown>((resolve, reject) => {
      session.pending.set(String(id), { resolve, reject });
      session.transport.send(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      );
    });
  }

  public async notify(method: string, params?: unknown): Promise<void> {
    const session = await this.session0();
    session.transport.send(
      params === undefined
        ? JSON.stringify({ jsonrpc: "2.0", method })
        : JSON.stringify({ jsonrpc: "2.0", method, params }),
    );
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    const session = this.session;
    this.session = undefined;
    if (session === undefined) return;
    try {
      const live = await session;
      live.alive = false;
      live.transport.close();
    } catch {
      // A session that never started has nothing to close.
    }
  }

  private session0(): Promise<Session> {
    if (this.disposed)
      throw new RuntimeFailure("unavailable", "Codex client is closed.");
    this.session ??= this.start();
    return this.session;
  }

  private async start(): Promise<Session> {
    let transport: CodexTransport;
    try {
      if (this.options.restartDelayMs !== undefined && this.nextId > 1)
        await delay(this.options.restartDelayMs);
      transport = await this.options.connect();
    } catch (error) {
      this.session = undefined;
      throw new RuntimeFailure(
        "unavailable",
        "Codex could not be started. Check that the Codex CLI is installed and on PATH.",
        { cause: error },
      );
    }
    const session: Session = { transport, pending: new Map(), alive: true };
    transport.onLine((line) => {
      this.receive(session, line);
    });
    transport.onExit((info) => {
      this.dropSession(session, describeExit(info));
    });
    try {
      await this.handshake(session);
    } catch (error) {
      session.alive = false;
      transport.close();
      this.session = undefined;
      throw error instanceof RuntimeFailure
        ? error
        : new RuntimeFailure("unavailable", "Codex did not start.", {
            cause: error,
          });
    }
    return session;
  }

  private async handshake(session: Session): Promise<void> {
    const id = this.nextId++;
    const timeoutMs = this.options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    const answered = new Promise<unknown>((resolve, reject) => {
      session.pending.set(String(id), { resolve, reject });
      session.transport.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "initialize",
          params: {
            clientInfo: {
              name: this.options.clientName ?? "pi-web-workspace",
              version: "0.0.0",
            },
          },
        }),
      );
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new RuntimeFailure(
            "unavailable",
            "Codex did not answer the app-server handshake.",
          ),
        );
      }, timeoutMs);
    });
    try {
      await Promise.race([answered, timedOut]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    session.transport.send(
      JSON.stringify({ jsonrpc: "2.0", method: "initialized" }),
    );
  }

  private receive(session: Session, line: string): void {
    if (!session.alive) return;
    const trimmed = line.trim();
    if (trimmed === "") {
      this.droppedFrames += 1;
      return;
    }
    let frame: unknown;
    try {
      frame = JSON.parse(trimmed);
    } catch {
      this.droppedFrames += 1;
      return;
    }

    const response = responseFrameSchema.safeParse(frame);
    if (response.success) {
      const pending = session.pending.get(String(response.data.id));
      if (pending === undefined) {
        this.droppedFrames += 1;
        return;
      }
      session.pending.delete(String(response.data.id));
      if (response.data.error !== undefined)
        pending.reject(
          new RuntimeFailure(
            "provider",
            response.data.error.message ?? "Codex rejected the request.",
          ),
        );
      else pending.resolve(response.data.result);
      return;
    }

    const serverRequest = serverRequestFrameSchema.safeParse(frame);
    if (serverRequest.success) {
      this.answerServerRequest(session, serverRequest.data);
      return;
    }

    const notification = notificationFrameSchema.safeParse(frame);
    if (notification.success) {
      for (const listener of this.notificationListeners)
        listener(notification.data.method, notification.data.params);
      return;
    }
    this.droppedFrames += 1;
  }

  private answerServerRequest(
    session: Session,
    frame: { id: number | string; method: string; params?: unknown },
  ): void {
    const answer = this.serverRequestHandler?.(frame.method, frame.params);
    session.transport.send(
      answer === null || answer === undefined
        ? JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id,
            error: { code: -32601, message: "Unsupported request" },
          })
        : JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: answer }),
    );
  }

  private dropSession(session: Session, reason: string): void {
    if (!session.alive) return;
    session.alive = false;
    // A dead process cannot answer anything still in flight; fail those now
    // rather than leaving a run hanging on a promise that can never settle.
    const failure = new RuntimeFailure("unavailable", reason);
    for (const [, pending] of session.pending) pending.reject(failure);
    session.pending.clear();
    // Drop the cached session so the next call reconnects.
    this.session = undefined;
    for (const listener of this.disconnectListeners) listener(reason);
  }
}

function describeExit(info: {
  code: number | null;
  signal: string | null;
  error?: Error;
}): string {
  // A child that never started is a different problem from one that died, and
  // the remedy is different too: say which, and what to do about it (AGB-08).
  if (info.error !== undefined)
    return `Codex could not be started (${info.error.message}). Check that the Codex CLI is installed and on PATH, or set PI_WEB_CODEX_BIN to its location.`;
  const detail =
    info.signal !== null
      ? `signal ${info.signal}`
      : `exit code ${String(info.code ?? "unknown")}`;
  return `The Codex app-server stopped (${detail}).`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

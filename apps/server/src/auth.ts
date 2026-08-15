import { randomBytes } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

const SESSION_COOKIE = "pi_web_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

interface SessionRecord {
  idleExpiresAt: number;
  absoluteExpiresAt: number;
}

export interface AuthOptions {
  now?: () => number;
  launchLifetimeMs?: number;
  idleLifetimeMs?: number;
  absoluteLifetimeMs?: number;
}

export class ProcessAuth {
  public readonly launchToken: string;
  private launchExpiresAt: number;
  private launchConsumed = false;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly now: () => number;
  private readonly idleLifetimeMs: number;
  private readonly absoluteLifetimeMs: number;

  public constructor(options: AuthOptions = {}) {
    this.now = options.now ?? Date.now;
    this.idleLifetimeMs = options.idleLifetimeMs ?? 30 * 60_000;
    this.absoluteLifetimeMs = options.absoluteLifetimeMs ?? 12 * 60 * 60_000;
    this.launchToken = randomBytes(32).toString("base64url");
    this.launchExpiresAt =
      this.now() + (options.launchLifetimeMs ?? 5 * 60_000);
  }

  public consumeLaunchToken(token: string): string | null {
    if (
      this.launchConsumed ||
      this.now() >= this.launchExpiresAt ||
      token !== this.launchToken
    )
      return null;
    this.launchConsumed = true;
    const sessionId = randomBytes(32).toString("base64url");
    this.sessions.set(sessionId, {
      idleExpiresAt: this.now() + this.idleLifetimeMs,
      absoluteExpiresAt: this.now() + this.absoluteLifetimeMs,
    });
    return sessionId;
  }

  public verify(sessionId: string | undefined): boolean {
    if (sessionId === undefined) return false;
    const record = this.sessions.get(sessionId);
    if (record === undefined) return false;
    const now = this.now();
    if (now >= record.idleExpiresAt || now >= record.absoluteExpiresAt) {
      this.sessions.delete(sessionId);
      return false;
    }
    record.idleExpiresAt = Math.min(
      now + this.idleLifetimeMs,
      record.absoluteExpiresAt,
    );
    return true;
  }

  public logout(sessionId: string | undefined): void {
    if (sessionId !== undefined) this.sessions.delete(sessionId);
  }

  public clear(): void {
    this.sessions.clear();
  }
}

export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure: false,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/", sameSite: "strict" });
}

export function sessionCookie(request: FastifyRequest): string | undefined {
  return request.cookies[SESSION_COOKIE];
}

export interface RequestPolicyOptions {
  allowedHosts: ReadonlySet<string>;
  allowedOrigins: ReadonlySet<string>;
  auth: ProcessAuth;
}

export function checkHost(
  request: FastifyRequest,
  allowedHosts: ReadonlySet<string>,
): boolean {
  const host = request.headers.host;
  return host !== undefined && allowedHosts.has(host);
}

export function checkOrigin(
  request: FastifyRequest,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  const origin = request.headers.origin;
  return origin !== undefined && allowedOrigins.has(origin);
}

export function enforceRequestPolicy(options: RequestPolicyOptions) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    if (!checkHost(request, options.allowedHosts)) {
      await reply.code(403).send({
        error: {
          code: "forbidden_host",
          message: "Request host is not allowed.",
        },
      });
      return;
    }
    const path = request.url.split("?", 1)[0] ?? request.url;
    if (
      path === "/api/ready" ||
      path === "/api/auth/bootstrap" ||
      !path.startsWith("/api/")
    )
      return;
    if (!options.auth.verify(sessionCookie(request))) {
      await reply.code(401).send({
        error: {
          code: "unauthorized",
          message: "Authentication is required.",
        },
      });
      return;
    }
    if (!SAFE_METHODS.has(request.method)) {
      if (
        !checkOrigin(request, options.allowedOrigins) ||
        request.headers["x-pi-web-request"] !== "1"
      ) {
        await reply.code(403).send({
          error: {
            code: "forbidden_request",
            message: "Request origin or CSRF signal is invalid.",
          },
        });
      }
    }
  };
}

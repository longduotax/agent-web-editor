import type { FastifyReply, FastifyRequest } from "fastify";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface RequestPolicyOptions {
  allowedHosts: ReadonlySet<string>;
  allowedOrigins: ReadonlySet<string>;
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
    if (path.startsWith("/api/") && !SAFE_METHODS.has(request.method)) {
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

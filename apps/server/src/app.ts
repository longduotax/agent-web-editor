import Fastify, { type FastifyInstance } from "fastify";

export function buildServer(): FastifyInstance {
  return Fastify({ logger: true });
}

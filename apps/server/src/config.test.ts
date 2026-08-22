import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseConfig, parsePort } from "./config.js";

describe("server configuration", () => {
  it("uses CLI over environment over default", () => {
    expect(
      parseConfig({
        argv: ["--port", "4100"],
        environment: {
          PI_WEB_PORT: "4200",
          PI_WEB_STATE_DIR: resolve("tmp-state"),
        },
      }).port,
    ).toBe(4100);
    expect(
      parseConfig({
        argv: [],
        environment: {
          PI_WEB_PORT: "4200",
          PI_WEB_STATE_DIR: resolve("tmp-state"),
        },
      }).port,
    ).toBe(4200);
    const defaults = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: resolve("tmp-state") },
    });
    expect(defaults.port).toBe(3001);
    expect(defaults.devPort).toBe(5173);
  });

  it.each(["", "-1", "1.5", "65536", "abc"])(
    "rejects invalid port %s",
    (port) => {
      expect(() => parsePort(port)).toThrow(/Port/);
    },
  );

  it("parses a configurable development web port", () => {
    const config = parseConfig({
      argv: [],
      environment: {
        PI_WEB_DEV_PORT: "5300",
        PI_WEB_STATE_DIR: resolve("tmp-state"),
      },
    });
    expect(config.devPort).toBe(5300);
    expect(config.allowedOrigins.has("http://127.0.0.1:5300")).toBe(true);
    expect(config.allowedOrigins.has("http://localhost:5300")).toBe(true);
  });

  // `localhost`, `127.0.0.1` and `[::1]` name the SAME machine, and this
  // server is bound to loopback only. Accepting one spelling but not the
  // others made every mutation from a browser pointed at `localhost` fail
  // with 403 forbidden_request while reads kept working, so the app looked
  // healthy and then nothing the user did worked.
  it("treats every loopback spelling of its own address as one allowed origin", () => {
    const config = parseConfig({
      argv: ["--port", "60302"],
      environment: { PI_WEB_STATE_DIR: resolve("tmp-state") },
    });
    for (const loopback of ["127.0.0.1", "localhost", "[::1]"]) {
      expect(
        config.allowedOrigins.has(`http://${loopback}:60302`),
        `${loopback} must be an allowed origin`,
      ).toBe(true);
      expect(
        config.allowedHosts.has(`${loopback}:60302`),
        `${loopback} must be an allowed host`,
      ).toBe(true);
      // The Vite dev server is a separate loopback origin on the dev port.
      expect(config.allowedOrigins.has(`http://${loopback}:5173`)).toBe(true);
    }
  });

  // The whole point of the allowlist is DNS-rebinding defence for a
  // local-first app. Widening it to loopback must not widen it to anything
  // else -- in particular not to hostnames that merely *contain* a loopback
  // spelling, and not to https/other schemes or other ports.
  it("still rejects every non-loopback origin and host", () => {
    const config = parseConfig({
      argv: ["--port", "60302"],
      environment: { PI_WEB_STATE_DIR: resolve("tmp-state") },
    });
    for (const origin of [
      "http://hostile.invalid",
      "http://localhost.hostile.invalid:60302",
      "http://notlocalhost:60302",
      "http://127.0.0.1.hostile.invalid:60302",
      "http://192.168.1.10:60302",
      "http://127.0.0.2:60302",
      "https://localhost:60302",
      "http://localhost:1234",
      "null",
    ])
      expect(
        config.allowedOrigins.has(origin),
        `${origin} must not be allowed`,
      ).toBe(false);
    for (const host of [
      "hostile.invalid",
      "localhost.hostile.invalid:60302",
      "localhost:1234",
      "192.168.1.10:60302",
    ])
      expect(config.allowedHosts.has(host), `${host} must not be allowed`).toBe(
        false,
      );
  });

  it("allows both explicit and canonical default-port origins", () => {
    const config = parseConfig({
      argv: ["--port", "80"],
      environment: { PI_WEB_STATE_DIR: resolve("tmp-state") },
    });
    // The set stays exhaustively enumerated (no wildcard, no suffix match):
    // the three loopback spellings times the ports this server serves.
    expect(config.allowedOrigins).toEqual(
      new Set([
        "http://127.0.0.1:80",
        "http://127.0.0.1",
        "http://127.0.0.1:5173",
        "http://localhost:80",
        "http://localhost",
        "http://localhost:5173",
        "http://[::1]:80",
        "http://[::1]",
        "http://[::1]:5173",
      ]),
    );
    expect(config.allowedHosts).toEqual(
      new Set([
        "127.0.0.1:80",
        "127.0.0.1",
        "localhost:80",
        "localhost",
        "[::1]:80",
        "[::1]",
      ]),
    );
  });

  it("rejects an invalid development web port", () => {
    expect(() =>
      parseConfig({
        argv: [],
        environment: {
          PI_WEB_DEV_PORT: "not-a-port",
          PI_WEB_STATE_DIR: resolve("tmp-state"),
        },
      }),
    ).toThrow(/Port/);
  });

  it("allows port zero only for injected tests", () => {
    expect(() => parsePort("0")).toThrow();
    expect(parsePort("0", true)).toBe(0);
  });

  it("parses an optional naming model and rejects malformed selectors", () => {
    expect(
      parseConfig({
        argv: [],
        environment: {
          PI_WEB_STATE_DIR: resolve("tmp-state"),
          PI_WEB_NAMING_MODEL: "openai-codex/gpt-5.4-mini",
        },
      }).namingModel,
    ).toEqual({ provider: "openai-codex", id: "gpt-5.4-mini" });
    expect(() =>
      parseConfig({
        argv: [],
        environment: {
          PI_WEB_STATE_DIR: resolve("tmp-state"),
          PI_WEB_NAMING_MODEL: "missing-separator",
        },
      }),
    ).toThrow(/provider\/model/);
  });

  it("rejects relative state directories", () => {
    expect(() =>
      parseConfig({ argv: [], environment: { PI_WEB_STATE_DIR: "relative" } }),
    ).toThrow(/absolute/);
  });
});

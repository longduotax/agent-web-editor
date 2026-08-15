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
  });

  it("allows both explicit and canonical default-port origins", () => {
    const config = parseConfig({
      argv: ["--port", "80"],
      environment: { PI_WEB_STATE_DIR: resolve("tmp-state") },
    });
    expect(config.allowedOrigins).toEqual(
      new Set([
        "http://127.0.0.1:80",
        "http://127.0.0.1",
        "http://127.0.0.1:5173",
      ]),
    );
    expect(config.allowedHosts).toEqual(new Set(["127.0.0.1:80", "127.0.0.1"]));
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

  it("rejects relative state directories", () => {
    expect(() =>
      parseConfig({ argv: [], environment: { PI_WEB_STATE_DIR: "relative" } }),
    ).toThrow(/absolute/);
  });
});

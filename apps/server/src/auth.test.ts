import { describe, expect, it } from "vitest";

import { ProcessAuth } from "./auth.js";

describe("process authentication", () => {
  it("consumes a high-entropy launch token exactly once", () => {
    const auth = new ProcessAuth();
    expect(auth.launchToken.length).toBeGreaterThanOrEqual(40);
    const session = auth.consumeLaunchToken(auth.launchToken);
    expect(session).not.toBeNull();
    expect(auth.consumeLaunchToken(auth.launchToken)).toBeNull();
    expect(auth.verify(session ?? undefined)).toBe(true);
  });

  it("expires launch tokens and sessions", () => {
    let now = 10;
    const auth = new ProcessAuth({
      now: () => now,
      launchLifetimeMs: 10,
      idleLifetimeMs: 20,
      absoluteLifetimeMs: 30,
    });
    now = 20;
    expect(auth.consumeLaunchToken(auth.launchToken)).toBeNull();

    now = 100;
    const other = new ProcessAuth({
      now: () => now,
      idleLifetimeMs: 10,
      absoluteLifetimeMs: 20,
    });
    const session = other.consumeLaunchToken(other.launchToken);
    now = 111;
    expect(other.verify(session ?? undefined)).toBe(false);
  });
});

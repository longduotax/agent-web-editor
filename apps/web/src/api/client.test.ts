import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, getWorkspace, NETWORK_UNREACHABLE } from "./client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

// NEW-3. The workspace server stopping or restarting is an ordinary event for
// a local-first dev tool -- the thing runs on loopback next to the editor.
// When it happened, `fetch` rejected with its own `TypeError: Failed to
// fetch` and that string went straight into a `role="alert"` in front of the
// reader. Everywhere else this app maps a failure to a sentence with a next
// step in it; this was the one hole, and it was in the surface that only
// appears when something has already gone wrong.
describe("an unreachable workspace server", () => {
  const reject = (error: Error) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(error)),
    );
  };

  it("replaces the browser's 'Failed to fetch' with a sentence about the server", async () => {
    reject(new TypeError("Failed to fetch"));
    const error = await getWorkspace().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiClientError);
    const api = error as ApiClientError;
    expect(api.code).toBe(NETWORK_UNREACHABLE);
    expect(api.message).not.toContain("Failed to fetch");
    // Names the thing that is unreachable, says what probably happened, and
    // says what to do -- and reassures, because the composer keeps the draft.
    expect(api.message).toContain("Pi workspace server");
    expect(api.message).toMatch(/stopped|restarting/);
    expect(api.message).toMatch(/retry/i);
  });

  // A deliberately cancelled request is not a failure. Flattening an abort
  // into "the server is unreachable" would put a red alert on screen every
  // time a query was superseded or a pane was closed mid-flight.
  it("lets an abort keep its own identity", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    reject(abort);
    const error = await getWorkspace().catch((cause: unknown) => cause);
    expect(error).toBe(abort);
  });
});

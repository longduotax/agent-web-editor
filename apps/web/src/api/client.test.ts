// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiClientError,
  PANEL_READ_TIMEOUT_MS,
  getFiles,
  shouldRetryRequest,
} from "./client.js";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// H5. A request that FAILS reaches the error state on its own; a request that
// never answers did not, because nothing in the client bounded how long it
// would wait. React Query cannot fail a promise that never settles, so the
// row read "Listing ops…" for as long as the page was open, and unpatching
// the server did not recover it — the in-flight promise stayed in flight.
describe("a read that never answers", () => {
  it("fails with a typed timeout rather than waiting for ever", async () => {
    vi.useFakeTimers();
    const aborts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              aborts.push(init.signal?.reason);
              reject(new Error("aborted"));
            });
          }),
      ),
    );

    const pending = getFiles(projectId, threadId, { path: "ops" });
    const settled = expect(pending).rejects.toThrow(
      "The workspace did not answer in time",
    );
    await vi.advanceTimersByTimeAsync(PANEL_READ_TIMEOUT_MS);
    await settled;
    // The request is actually cancelled, not merely given up on.
    expect(aborts.length).toBe(1);
  });

  it("leaves a request that answers in time alone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              entries: [],
              truncated: false,
              ignoredHidden: false,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );
    await expect(getFiles(projectId, threadId, {})).resolves.toEqual({
      entries: [],
      truncated: false,
      ignoredHidden: false,
    });
  });
});

describe("what is worth retrying", () => {
  it("retries a server fault twice and then stops", () => {
    const fault = new ApiClientError(500, "internal_error", "Server fault.");
    expect(shouldRetryRequest(0, fault)).toBe(true);
    expect(shouldRetryRequest(1, fault)).toBe(true);
    expect(shouldRetryRequest(2, fault)).toBe(false);
  });

  it("never retries a client error, which says the request was the problem", () => {
    // H6: a persisted expansion pointing at a deleted directory. Retrying it
    // twice delays the row's error state and changes nothing about it.
    for (const status of [400, 401, 403, 404]) {
      expect(
        shouldRetryRequest(0, new ApiClientError(status, "any", "No.")),
      ).toBe(false);
    }
  });

  it("never retries a timeout, which has already waited its whole deadline", () => {
    expect(
      shouldRetryRequest(
        0,
        new ApiClientError(504, "request_timeout", "Too slow."),
      ),
    ).toBe(false);
  });

  it("retries a transport failure, which is what a dropped connection is", () => {
    expect(shouldRetryRequest(0, new TypeError("Failed to fetch"))).toBe(true);
  });
});

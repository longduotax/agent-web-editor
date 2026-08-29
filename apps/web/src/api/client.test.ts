// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiClientError,
  NETWORK_UNREACHABLE,
  PANEL_READ_TIMEOUT_MS,
  getFiles,
  getWorkspace,
  prompt,
  shouldRetryRequest,
} from "./client.js";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
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

describe("image-bearing chat commands", () => {
  it("uses multipart without overriding the browser boundary header", async () => {
    let sent: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_path: string, init?: RequestInit) => {
        sent = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              run: {
                id: "30000000-0000-4000-8000-000000000001",
                threadId,
                projectId,
                state: "running",
                startedAt: "2026-01-01T00:00:00.000Z",
                endedAt: null,
                failureCode: null,
                failureMessage: null,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }),
    );
    const image = new File([new Uint8Array([1, 2, 3])], "photo.png", {
      type: "image/png",
    });
    await prompt(
      projectId,
      threadId,
      "Inspect this",
      [image],
      "40000000-0000-4000-8000-000000000001",
    );

    expect(sent?.body).toBeInstanceOf(FormData);
    const form = sent?.body as FormData;
    const metadata = form.get("metadata");
    expect(typeof metadata).toBe("string");
    if (typeof metadata !== "string") throw new Error("metadata was not text");
    expect(JSON.parse(metadata)).toEqual({
      prompt: "Inspect this",
      idempotencyKey: "40000000-0000-4000-8000-000000000001",
    });
    expect(form.getAll("images")).toEqual([image]);
    const headers = new Headers(sent?.headers);
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("x-pi-web-request")).toBe("1");
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

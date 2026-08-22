import { afterEach, describe, expect, it, vi } from "vitest";

import {
  newChatDraftKey,
  pruneNewChatDrafts,
  readDraft,
  removeDraft,
  writeDraft,
} from "./drafts.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  return values;
}

describe("composer drafts", () => {
  it("round-trips a draft", () => {
    const values = stubStorage();
    writeDraft("pi-draft:a", "half a sentence");
    expect(values.get("pi-draft:a")).toBe("half a sentence");
    expect(readDraft("pi-draft:a")).toBe("half a sentence");
    removeDraft("pi-draft:a");
    expect(values.has("pi-draft:a")).toBe(false);
  });

  // R2-10: every pane wrote a key on mount whether or not the user typed, and
  // nothing ever removed them, so localStorage accumulated one empty
  // `pi-new-draft:<project>:<pane>` entry per pane ever opened.
  it("removes rather than stores an emptied draft", () => {
    const values = stubStorage({ "pi-new-draft:p:pane-1": "typed" });

    writeDraft("pi-new-draft:p:pane-1", "");

    expect(values.has("pi-new-draft:p:pane-1")).toBe(false);
    expect(readDraft("pi-new-draft:p:pane-1")).toBe("");
  });

  it("never writes a key for a pane the user never typed in", () => {
    const values = stubStorage();

    writeDraft("pi-new-draft:p:pane-2", "");

    expect([...values.keys()]).toEqual([]);
  });

  it("prunes drafts whose pane is gone, including the pre-per-pane key, and only for this project", () => {
    const values = stubStorage({
      [newChatDraftKey("p1", "pane-live")]: "keep me",
      [newChatDraftKey("p1", "pane-gone")]: "orphan",
      [newChatDraftKey("p1", "pane-also-gone")]: "",
      // The legacy project-wide key: no pane suffix, unreachable, and never
      // matched by the per-pane prefix (NEW-R3-5).
      "pi-new-draft:p1": "",
      "pi-new-draft:p2": "another project's legacy key",
      [newChatDraftKey("p2", "pane-other")]: "another project",
      "pi-draft:thread-1": "a thread draft",
    });

    pruneNewChatDrafts("p1", ["pane-live"]);

    expect([...values.keys()].sort()).toEqual(
      [
        newChatDraftKey("p1", "pane-live"),
        newChatDraftKey("p2", "pane-other"),
        "pi-new-draft:p2",
        "pi-draft:thread-1",
      ].sort(),
    );
  });

  it("does nothing when the storage shim cannot be enumerated", () => {
    const values = new Map([[newChatDraftKey("p1", "pane-gone"), "orphan"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: () => undefined,
      removeItem: (key: string) => {
        values.delete(key);
      },
    });

    expect(() => {
      pruneNewChatDrafts("p1", []);
    }).not.toThrow();
    expect(values.size).toBe(1);
  });

  it("survives storage being unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });

    expect(() => {
      writeDraft("k", "v");
    }).not.toThrow();
    expect(() => {
      removeDraft("k");
    }).not.toThrow();
    expect(readDraft("k")).toBe("");
  });
});

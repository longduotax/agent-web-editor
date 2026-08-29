// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { readDraft, writeDraft } from "./drafts.js";

describe("shared browser storage test environment", () => {
  it("permits a partial localStorage stub at a storage boundary", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });

    expect(localStorage.getItem("draft")).toBeNull();
  });

  it("restores complete jsdom storage for the next draft case", () => {
    localStorage.clear();
    localStorage.setItem("other", "value");
    writeDraft("pi-draft:storage-isolation", "survives restoration");

    expect(localStorage.getItem("other")).toBe("value");
    expect(readDraft("pi-draft:storage-isolation")).toBe(
      "survives restoration",
    );
  });
});

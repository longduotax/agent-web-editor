import { describe, expect, it } from "vitest";
import {
  detectPlatform,
  resolveCommand,
  type KeyEventLike,
  type Platform,
} from "./keybindings.js";

const mac: Platform = { isMac: true };
const other: Platform = { isMac: false };

function key(overrides: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("resolveCommand", () => {
  describe("split / collapse / restore / close (shift + primary)", () => {
    it("mac: shift+meta+= splits row", () => {
      expect(
        resolveCommand(key({ key: "=", shiftKey: true, metaKey: true }), mac),
      ).toEqual({ type: "split", axis: "row" });
    });

    it("other: shift+alt+= splits row", () => {
      expect(
        resolveCommand(key({ key: "=", shiftKey: true, altKey: true }), other),
      ).toEqual({ type: "split", axis: "row" });
    });

    it("mac: shift+meta+- splits column", () => {
      expect(
        resolveCommand(key({ key: "-", shiftKey: true, metaKey: true }), mac),
      ).toEqual({ type: "split", axis: "column" });
    });

    it("other: shift+alt+- splits column", () => {
      expect(
        resolveCommand(key({ key: "-", shiftKey: true, altKey: true }), other),
      ).toEqual({ type: "split", axis: "column" });
    });

    it("mac: shift+meta+ArrowDown collapses", () => {
      expect(
        resolveCommand(
          key({ key: "ArrowDown", shiftKey: true, metaKey: true }),
          mac,
        ),
      ).toEqual({ type: "collapse" });
    });

    it("other: shift+alt+ArrowDown collapses", () => {
      expect(
        resolveCommand(
          key({ key: "ArrowDown", shiftKey: true, altKey: true }),
          other,
        ),
      ).toEqual({ type: "collapse" });
    });

    it("mac: shift+meta+ArrowUp restores", () => {
      expect(
        resolveCommand(
          key({ key: "ArrowUp", shiftKey: true, metaKey: true }),
          mac,
        ),
      ).toEqual({ type: "restore" });
    });

    it("other: shift+alt+ArrowUp restores", () => {
      expect(
        resolveCommand(
          key({ key: "ArrowUp", shiftKey: true, altKey: true }),
          other,
        ),
      ).toEqual({ type: "restore" });
    });

    it("mac: shift+meta+Backspace closes", () => {
      expect(
        resolveCommand(
          key({ key: "Backspace", shiftKey: true, metaKey: true }),
          mac,
        ),
      ).toEqual({ type: "close" });
    });

    it("other: shift+alt+Backspace closes", () => {
      expect(
        resolveCommand(
          key({ key: "Backspace", shiftKey: true, altKey: true }),
          other,
        ),
      ).toEqual({ type: "close" });
    });
  });

  describe("focus move (primary + alt, no shift)", () => {
    const directions: {
      arrow: string;
      direction: "left" | "right" | "up" | "down";
    }[] = [
      { arrow: "ArrowLeft", direction: "left" },
      { arrow: "ArrowRight", direction: "right" },
      { arrow: "ArrowUp", direction: "up" },
      { arrow: "ArrowDown", direction: "down" },
    ];

    for (const { arrow, direction } of directions) {
      it(`mac: meta+alt+${arrow} focuses ${direction}`, () => {
        expect(
          resolveCommand(key({ key: arrow, metaKey: true, altKey: true }), mac),
        ).toEqual({ type: "focus", direction });
      });

      it(`other: ctrl+alt+${arrow} focuses ${direction}`, () => {
        expect(
          resolveCommand(
            key({ key: arrow, ctrlKey: true, altKey: true }),
            other,
          ),
        ).toEqual({ type: "focus", direction });
      });
    }
  });

  describe("bind (primary + alt + Enter)", () => {
    it("mac: meta+alt+Enter binds", () => {
      expect(
        resolveCommand(key({ key: "Enter", metaKey: true, altKey: true }), mac),
      ).toEqual({ type: "bind" });
    });

    it("other: ctrl+alt+Enter binds", () => {
      expect(
        resolveCommand(
          key({ key: "Enter", ctrlKey: true, altKey: true }),
          other,
        ),
      ).toEqual({ type: "bind" });
    });
  });

  describe("negative cases", () => {
    it("returns null for an unmapped key", () => {
      expect(resolveCommand(key({ key: "a", metaKey: true }), mac)).toBeNull();
    });

    it("returns null when the split-group combo is missing Shift", () => {
      expect(resolveCommand(key({ key: "=", metaKey: true }), mac)).toBeNull();
      expect(resolveCommand(key({ key: "=", altKey: true }), other)).toBeNull();
    });

    it("mac: meta+alt+ArrowDown resolves to focus:down, not collapse", () => {
      expect(
        resolveCommand(
          key({ key: "ArrowDown", metaKey: true, altKey: true }),
          mac,
        ),
      ).toEqual({ type: "focus", direction: "down" });
    });

    it("mac: shift+meta+ArrowDown resolves to collapse, not focus", () => {
      expect(
        resolveCommand(
          key({ key: "ArrowDown", shiftKey: true, metaKey: true }),
          mac,
        ),
      ).toEqual({ type: "collapse" });
    });
  });
});

describe("detectPlatform", () => {
  it("detects mac platforms", () => {
    expect(detectPlatform({ platform: "MacIntel" })).toEqual({ isMac: true });
  });

  it("detects non-mac platforms", () => {
    expect(detectPlatform({ platform: "Win32" })).toEqual({ isMac: false });
  });

  it("defaults to non-mac when nav is undefined", () => {
    expect(detectPlatform()).toEqual({ isMac: false });
  });

  it("defaults to non-mac when platform is missing", () => {
    expect(detectPlatform({})).toEqual({ isMac: false });
  });
});

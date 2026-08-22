import { describe, expect, it } from "vitest";
import {
  detectPlatform,
  resolveCommand,
  shortcutKeys,
  WORKSPACE_KEYBINDINGS,
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
  describe("split / close (shift + primary)", () => {
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

    it("mac: shift+meta+ArrowDown no longer resolves to a command", () => {
      expect(
        resolveCommand(
          key({ key: "ArrowDown", shiftKey: true, metaKey: true }),
          mac,
        ),
      ).toBeNull();
    });

    it("other: shift+alt+ArrowDown no longer resolves to a command", () => {
      expect(
        resolveCommand(
          key({ key: "ArrowDown", shiftKey: true, altKey: true }),
          other,
        ),
      ).toBeNull();
    });

    it("mac: shift+meta+ArrowUp no longer resolves to a command", () => {
      expect(
        resolveCommand(
          key({ key: "ArrowUp", shiftKey: true, metaKey: true }),
          mac,
        ),
      ).toBeNull();
    });

    it("other: shift+alt+ArrowUp no longer resolves to a command", () => {
      expect(
        resolveCommand(
          key({ key: "ArrowUp", shiftKey: true, altKey: true }),
          other,
        ),
      ).toBeNull();
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

  // R2-14: the "bind" chord set layoutTree's boundPaneId, which nothing has
  // ever read, so pressing it did nothing observable. An inert shortcut must
  // not be advertised on the Settings page, so it is removed rather than
  // documented.
  describe("the inert bind chord is gone", () => {
    it("mac: meta+alt+Enter resolves to nothing", () => {
      expect(
        resolveCommand(key({ key: "Enter", metaKey: true, altKey: true }), mac),
      ).toBeNull();
    });

    it("other: ctrl+alt+Enter resolves to nothing", () => {
      expect(
        resolveCommand(
          key({ key: "Enter", ctrlKey: true, altKey: true }),
          other,
        ),
      ).toBeNull();
    });
  });

  // The help list and the dispatcher read the same table, so a binding can
  // never be listed without working (or work without being listed).
  describe("WORKSPACE_KEYBINDINGS is the single source of truth", () => {
    it("resolves every advertised binding on both platforms", () => {
      for (const binding of WORKSPACE_KEYBINDINGS) {
        const modifiers =
          binding.group === "shift-primary"
            ? {
                mac: { shiftKey: true, metaKey: true },
                other: { shiftKey: true, altKey: true },
              }
            : {
                mac: { metaKey: true, altKey: true },
                other: { ctrlKey: true, altKey: true },
              };
        expect(
          resolveCommand(key({ key: binding.key, ...modifiers.mac }), mac),
          `${binding.label} on mac`,
        ).toEqual(binding.command);
        expect(
          resolveCommand(key({ key: binding.key, ...modifiers.other }), other),
          `${binding.label} elsewhere`,
        ).toEqual(binding.command);
      }
    });

    it("spells the chord with platform-correct modifier symbols", () => {
      const closeBinding = WORKSPACE_KEYBINDINGS.find(
        (binding) => binding.command.type === "close",
      );
      if (closeBinding === undefined) throw new Error("missing close binding");
      expect(shortcutKeys(closeBinding, mac)).toEqual(["⇧", "⌘", "⌫"]);
      expect(shortcutKeys(closeBinding, other)).toEqual(["Shift", "Alt", "⌫"]);
      const focusBinding = WORKSPACE_KEYBINDINGS.find(
        (binding) => binding.command.type === "focus",
      );
      if (focusBinding === undefined) throw new Error("missing focus binding");
      expect(shortcutKeys(focusBinding, mac).slice(0, 2)).toEqual(["⌘", "⌥"]);
      expect(shortcutKeys(focusBinding, other).slice(0, 2)).toEqual([
        "Ctrl",
        "Alt",
      ]);
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

    it("mac: meta+alt+ArrowDown resolves to focus:down", () => {
      expect(
        resolveCommand(
          key({ key: "ArrowDown", metaKey: true, altKey: true }),
          mac,
        ),
      ).toEqual({ type: "focus", direction: "down" });
    });

    it("mac: shift+meta+ArrowDown no longer resolves to a command", () => {
      expect(
        resolveCommand(
          key({ key: "ArrowDown", shiftKey: true, metaKey: true }),
          mac,
        ),
      ).toBeNull();
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

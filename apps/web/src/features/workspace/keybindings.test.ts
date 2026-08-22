import { describe, expect, it } from "vitest";
import {
  asPanelCommand,
  detectPlatform,
  resolveCommand,
  shortcutKeys,
  WORKSPACE_KEYBINDINGS,
  type KeyEventLike,
  type ModifierGroup,
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

  // WSP-10: every panel action reachable by drag also has a chord, and the
  // chords live in this same table so the Settings list cannot advertise one
  // the handler does not dispatch.
  describe("workspace panel (shift + primary + alt)", () => {
    const panelChords: { key: string; command: unknown }[] = [
      { key: "PageDown", command: { type: "panel-tab", direction: "next" } },
      { key: "PageUp", command: { type: "panel-tab", direction: "previous" } },
      { key: "Backspace", command: { type: "panel-close-tab" } },
      { key: "End", command: { type: "panel-move-tab", direction: "next" } },
      {
        key: "Home",
        command: { type: "panel-move-tab", direction: "previous" },
      },
      { key: "ArrowRight", command: { type: "panel-split", edge: "right" } },
      { key: "ArrowLeft", command: { type: "panel-split", edge: "left" } },
      { key: "ArrowDown", command: { type: "panel-split", edge: "bottom" } },
      { key: "ArrowUp", command: { type: "panel-split", edge: "top" } },
      { key: "Enter", command: { type: "panel-focus" } },
      { key: " ", command: { type: "panel-toggle" } },
    ];

    for (const { key: pressed, command } of panelChords) {
      it(`mac: shift+meta+alt+${pressed}`, () => {
        expect(
          resolveCommand(
            key({ key: pressed, shiftKey: true, metaKey: true, altKey: true }),
            mac,
          ),
        ).toEqual(command);
      });

      it(`other: shift+ctrl+alt+${pressed}`, () => {
        expect(
          resolveCommand(
            key({ key: pressed, shiftKey: true, ctrlKey: true, altKey: true }),
            other,
          ),
        ).toEqual(command);
      });
    }

    // The three groups must stay disjoint, or one chord would silently
    // shadow another: the panel group is the only one that holds Shift and
    // Alt at once.
    it("does not collide with the chat surface's groups", () => {
      expect(
        resolveCommand(
          key({ key: "Backspace", shiftKey: true, metaKey: true }),
          mac,
        ),
      ).toEqual({ type: "close" });
      expect(
        resolveCommand(
          key({ key: "ArrowLeft", metaKey: true, altKey: true }),
          mac,
        ),
      ).toEqual({ type: "focus", direction: "left" });
    });

    it("spells the three-modifier chord for each platform", () => {
      const binding = WORKSPACE_KEYBINDINGS.find(
        (candidate) => candidate.command.type === "panel-toggle",
      );
      if (binding === undefined) throw new Error("missing panel-toggle");
      expect(shortcutKeys(binding, mac)).toEqual(["⇧", "⌘", "⌥", "Space"]);
      expect(shortcutKeys(binding, other)).toEqual([
        "Shift",
        "Ctrl",
        "Alt",
        "Space",
      ]);
    });

    it("separates panel commands from chat-surface commands", () => {
      expect(asPanelCommand({ type: "panel-focus" })).toEqual({
        type: "panel-focus",
      });
      expect(asPanelCommand({ type: "close" })).toBeNull();
      expect(asPanelCommand({ type: "split", axis: "row" })).toBeNull();
    });

    it("advertises every panel command exactly once", () => {
      const panelCommands = WORKSPACE_KEYBINDINGS.map(
        (binding) => binding.command,
      ).filter((command) => asPanelCommand(command) !== null);
      expect(panelCommands).toHaveLength(11);
      expect(new Set(panelCommands.map((c) => JSON.stringify(c))).size).toBe(
        11,
      );
    });
  });

  // The help list and the dispatcher read the same table, so a binding can
  // never be listed without working (or work without being listed).
  describe("WORKSPACE_KEYBINDINGS is the single source of truth", () => {
    it("resolves every advertised binding on both platforms", () => {
      const modifiersByGroup: Record<
        ModifierGroup,
        { mac: Partial<KeyEventLike>; other: Partial<KeyEventLike> }
      > = {
        "shift-primary": {
          mac: { shiftKey: true, metaKey: true },
          other: { shiftKey: true, altKey: true },
        },
        "primary-alt": {
          mac: { metaKey: true, altKey: true },
          other: { ctrlKey: true, altKey: true },
        },
        "shift-primary-alt": {
          mac: { shiftKey: true, metaKey: true, altKey: true },
          other: { shiftKey: true, ctrlKey: true, altKey: true },
        },
      };
      for (const binding of WORKSPACE_KEYBINDINGS) {
        const modifiers = modifiersByGroup[binding.group];
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

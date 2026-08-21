import type { FocusDirection, SplitAxis } from "./layoutTree.js";

export type WorkspaceCommand =
  | { type: "split"; axis: SplitAxis }
  | { type: "close" }
  | { type: "focus"; direction: FocusDirection }
  | { type: "bind" };

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface Platform {
  isMac: boolean;
}

/**
 * Resolves a keyboard event to a workspace command.
 *
 * Two disjoint modifier groups on the primary modifier (Cmd on mac, Alt
 * elsewhere):
 *  - Shift + primary (no Alt on mac / no Meta elsewhere) => split/close.
 *  - primary + Alt (Meta+Alt on mac, Ctrl+Alt elsewhere), no Shift =>
 *    focus/bind.
 */
export function resolveCommand(
  e: KeyEventLike,
  p: Platform,
): WorkspaceCommand | null {
  const isShiftPrimary = p.isMac
    ? e.shiftKey && e.metaKey && !e.altKey && !e.ctrlKey
    : e.shiftKey && e.altKey && !e.metaKey && !e.ctrlKey;

  if (isShiftPrimary) {
    switch (e.key) {
      case "=":
        return { type: "split", axis: "row" };
      case "-":
        return { type: "split", axis: "column" };
      case "Backspace":
        return { type: "close" };
      default:
        return null;
    }
  }

  const isFocusBind = p.isMac
    ? e.metaKey && e.altKey && !e.shiftKey && !e.ctrlKey
    : e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey;

  if (isFocusBind) {
    switch (e.key) {
      case "ArrowLeft":
        return { type: "focus", direction: "left" };
      case "ArrowRight":
        return { type: "focus", direction: "right" };
      case "ArrowUp":
        return { type: "focus", direction: "up" };
      case "ArrowDown":
        return { type: "focus", direction: "down" };
      case "Enter":
        return { type: "bind" };
      default:
        return null;
    }
  }

  return null;
}

export function detectPlatform(nav?: { platform?: string }): Platform {
  return { isMac: /mac/i.test(nav?.platform ?? "") };
}

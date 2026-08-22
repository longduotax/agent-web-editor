import { useEffect, useRef, useState, type JSX } from "react";

import type { GroupId } from "./panelModel.js";
import { tabNeedsThread } from "./panelTabs.js";
import type { NewPanelTab, PanelTab, TabContext } from "./panelTabs.js";
import type { PanelActions } from "./usePanelState.js";

// The `+` control on a tab strip (WSP-02). It opens tabs **for the focused
// chat pane's thread**: a new tab's context is fixed at open time, and the
// focused pane is the only thing on screen that says which worktree the user
// means.

interface NewTabChoice {
  type: PanelTab["type"];
  label: string;
  build(context: TabContext | null): NewPanelTab | null;
}

// Diff and File tabs are absent on purpose: both address one path, so they
// are opened by activating a row in a Changes or Files tab, never chosen
// blind from a menu (WSP-05, WSP-06). A Browser tab arrives with WSP-08.
const NEW_TAB_CHOICES: readonly NewTabChoice[] = [
  {
    type: "changes",
    label: "Changes",
    build: (context) =>
      context === null ? null : { type: "changes", context },
  },
  {
    type: "files",
    label: "Files",
    build: (context) =>
      context === null ? null : { type: "files", context, search: "" },
  },
  {
    type: "terminal",
    label: "Terminal",
    build: (context) =>
      context === null
        ? null
        : { type: "terminal", context, cwd: "", terminalId: null },
  },
];

export function NewTabMenu({
  context,
  groupId,
  actions,
}: {
  /** The focused chat pane's execution scope, or null when none owns one. */
  context: TabContext | null;
  /** Where the tab lands; omitted when the panel has no group at all yet. */
  groupId?: GroupId | undefined;
  actions: PanelActions;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
    const dismissOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target) === true
      )
        return;
      setOpen(false);
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Focus would otherwise land on <body>, stranding a keyboard user
      // outside the strip they were working in.
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [open]);

  const unavailable = context === null;

  return (
    <div className="panel-new-tab" ref={menuRef}>
      <button
        type="button"
        ref={buttonRef}
        className="panel-new-tab-button"
        aria-label="New panel tab"
        title="New tab"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <span aria-hidden="true">＋</span>
      </button>
      {open && (
        <div className="panel-menu">
          <div role="menu" aria-label="New panel tab">
            {NEW_TAB_CHOICES.map((choice) => {
              const tab = choice.build(context);
              return (
                <button
                  key={choice.type}
                  type="button"
                  role="menuitem"
                  disabled={tab === null}
                  onClick={() => {
                    if (tab === null) return;
                    actions.openTab(
                      tab,
                      groupId === undefined ? undefined : { groupId },
                    );
                    setOpen(false);
                  }}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
          {/* WSP-02: when no chat pane owns a thread the menu still opens,
              still offers whatever needs no thread, and says plainly why the
              rest cannot be opened — rather than showing an empty popup. */}
          {unavailable && (
            <p className="panel-menu-note">
              {NEW_TAB_CHOICES.every((choice) => tabNeedsThread(choice.type))
                ? "Focus a chat pane with a thread to open these: every tab here reads that thread's worktree."
                : "Focus a chat pane with a thread to open the rest."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

import type { PanelEdge } from "./panelModel.js";

// Everything the panel says in its one live region (WSP-10), in one module.
//
// It is one module because the pointer route and the keyboard route must say
// the same thing about the same action, and for a while they did not: the
// drag narrated its pick-up, every target it crossed, and its outcome, while
// the chords — which are the route a screen-reader user actually has —
// announced nothing at all unless they were REFUSED (G5). A user driving the
// panel from the keyboard heard only the things that did not work.
//
// The wordings are shared rather than duplicated for the same reason. A
// refused split says one sentence whether it was refused to a chord or to a
// pointer hovering an edge band, because it is the same refusal.

/**
 * A split panel would otherwise expose two landmarks both called "Panel tab
 * group" and two tablists both called "Panel tabs", which a screen-reader
 * user cannot tell apart (WSP-10). Numbering them in reading order is stable
 * under tab switching — an active tab's title is not — and a single group
 * keeps the plain name, because there is nothing to distinguish it from.
 */
export function groupAccessibleName(index: number, groupCount: number): string {
  return groupCount > 1
    ? `Panel tab group ${String(index)} of ${String(groupCount)}`
    : "Panel tab group";
}

/** How each split edge reads in a sentence. */
export const EDGE_WORDS: Record<PanelEdge, string> = {
  left: "to the left",
  right: "to the right",
  top: "above",
  bottom: "below",
};

/**
 * Why a split can refuse.
 *
 * The model will not split a group holding a single tab: the tab would leave
 * its group empty and the "new" half would hold exactly what the old one
 * showed. That is the default state of a fresh panel and the state after
 * every migration, so all four split chords were a silent no-op in the most
 * common case there is (D8) — and the drag went on highlighting the edge
 * bands of exactly that group and announcing a split it would then refuse
 * (G4).
 *
 * It is NOT fixed by opening a copy of the tab in the new group, VS Code
 * style. `openTab` dedupes on `sameTarget`, so two tabs addressing the same
 * thing are unrepresentable by construction — a copy cannot exist, and
 * proposing one again will not make it exist. What the panel owes the user
 * instead is to say why nothing will happen, before it does not happen.
 */
export const SPLIT_NEEDS_TWO_TABS =
  "Nothing to split — this group has one tab.";

/** Over no drop target at all: a release here is a cancel. */
export const DROP_NO_TARGET_MESSAGE =
  "No drop target here. Releasing now leaves everything where it is.";

/** Over a target that is where the tab already is. */
export const DROP_ALREADY_THERE_MESSAGE =
  "Already here. Releasing now changes nothing.";

/** Why a drop would do nothing, resolved BEFORE the target is highlighted. */
export type DropRefusal =
  "no-target" | "already-there" | "split-needs-two-tabs";

export function dropRefusalMessage(reason: DropRefusal): string {
  switch (reason) {
    case "no-target":
      return DROP_NO_TARGET_MESSAGE;
    case "already-there":
      return DROP_ALREADY_THERE_MESSAGE;
    case "split-needs-two-tabs":
      return SPLIT_NEEDS_TWO_TABS;
  }
}

/** Where a tab landed: which strip, and where in it. */
export interface MovedTabPlace {
  /** The target group's own accessible name. */
  groupLabel: string;
  /** Whether the tab was already in that group, so it was a reorder. */
  sameGroup: boolean;
  /** Its 0-based position in the strip it is now in. */
  index: number;
  /** How long that strip is now. */
  stripLength: number;
}

/**
 * A tab that arrived somewhere.
 *
 * A reorder within one strip used to be announced as "Moved Changes into
 * Panel tab group." — no position, and "into" a group the tab never left
 * (G5). Both halves are said here instead.
 */
export function movedTabMessage(title: string, place: MovedTabPlace): string {
  const position = `position ${String(place.index + 1)} of ${String(
    place.stripLength,
  )}`;
  return place.sameGroup
    ? `Moved ${title} to ${position} in ${place.groupLabel}.`
    : `Moved ${title} into ${place.groupLabel}, ${position}.`;
}

export function splitOutcomeMessage(
  title: string,
  groupLabel: string,
  edge: PanelEdge,
): string {
  return `Split ${groupLabel} ${EDGE_WORDS[edge]} with ${title}.`;
}

export function closedTabMessage(title: string): string {
  return `Closed ${title}.`;
}

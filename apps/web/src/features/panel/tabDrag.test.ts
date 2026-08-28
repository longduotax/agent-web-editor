import { describe, expect, it } from "vitest";

import {
  contentRect,
  DRAG_CANCELLED_MESSAGE,
  DRAG_UNCHANGED_MESSAGE,
  dragPickUpMessage,
  dropAnnouncement,
  dropOutcomeMessage,
  dropTargetMessage,
  edgeBands,
  moveIndexFor,
  planDrop,
  resolveDropTarget,
  sameDropTarget,
  stripCaretOffset,
  stripInsertIndex,
  stripScrollStep,
  type DragRect,
  type GroupZone,
  type StripZone,
} from "./tabDrag.js";
import {
  DROP_ALREADY_THERE_MESSAGE,
  DROP_NO_TARGET_MESSAGE,
  SPLIT_NEEDS_TWO_TABS,
} from "./panelAnnouncements.js";
import {
  PANEL_MIN_GROUP_HEIGHT,
  PANEL_MIN_GROUP_WIDTH,
} from "./panelGeometry.js";

// The whole of WSP-03's pointer half is arithmetic on rectangles, so it is
// tested as arithmetic. jsdom has no layout at all — every rectangle it
// reports is zero — which is why these cases pass real numbers to pure
// functions rather than driving a rendered panel, and why the geometry is
// additionally measured end to end.

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DragRect {
  return { left, top, width, height };
}

/** A strip whose three tabs are 80px wide, unscrolled. */
function strip(overrides: Partial<StripZone> = {}): StripZone {
  return {
    rect: rect(0, 0, 300, 40),
    list: rect(0, 0, 240, 40),
    scrollLeft: 0,
    tabs: [
      { tabId: "tab-1", left: 0, width: 80 },
      { tabId: "tab-2", left: 80, width: 80 },
      { tabId: "tab-3", left: 160, width: 80 },
    ],
    ...overrides,
  };
}

function group(overrides: Partial<GroupZone> = {}): GroupZone {
  return {
    groupId: "group-1",
    rect: rect(0, 0, 400, 600),
    strip: strip(),
    ...overrides,
  };
}

describe("edgeBands", () => {
  it("is a percentage of the short side, with a pixel floor", () => {
    // 15% of 400 is 60: the percentage wins where the group is roomy.
    expect(edgeBands(rect(0, 0, 400, 800))).toEqual({ x: 60, y: 60 });
  });

  // The panel's minimum outer width is 280px and a group's floor is 240px,
  // where 15% is 36px — already close to unhittable — and 15% of a short
  // 160px group is 24px. The floor is what makes an edge reachable there.
  it("never falls below the pixel floor at the smallest group the panel allows", () => {
    const bands = edgeBands(
      rect(0, 0, PANEL_MIN_GROUP_WIDTH, PANEL_MIN_GROUP_HEIGHT),
    );
    expect(bands.x).toBeGreaterThanOrEqual(32);
    expect(bands.y).toBeGreaterThanOrEqual(32);
  });

  // Four bands plus a centre have to share one box: without a ceiling a
  // short group's top and bottom bands would meet and the centre — the
  // "move into this group" target — would have no area at all.
  it("leaves a centre in a group too short for two floors", () => {
    const bands = edgeBands(rect(0, 0, 120, 80));
    expect(bands.y * 2).toBeLessThan(80);
    expect(bands.x * 2).toBeLessThan(120);
  });
});

describe("resolveDropTarget", () => {
  const zones = [group()];

  it("is null when the pointer is outside every group", () => {
    expect(resolveDropTarget({ x: 900, y: 300 }, zones)).toBeNull();
    expect(resolveDropTarget({ x: 200, y: 900 }, zones)).toBeNull();
  });

  it("names the centre when the pointer is in the middle", () => {
    expect(resolveDropTarget({ x: 200, y: 300 }, zones)).toEqual({
      kind: "centre",
      groupId: "group-1",
    });
  });

  it("names each of the four edges", () => {
    const bands = edgeBands(rect(0, 0, 400, 600));
    expect(resolveDropTarget({ x: bands.x / 2, y: 300 }, zones)).toEqual({
      kind: "edge",
      groupId: "group-1",
      edge: "left",
    });
    expect(resolveDropTarget({ x: 400 - bands.x / 2, y: 300 }, zones)).toEqual({
      kind: "edge",
      groupId: "group-1",
      edge: "right",
    });
    expect(resolveDropTarget({ x: 200, y: 600 - bands.y / 2 }, zones)).toEqual({
      kind: "edge",
      groupId: "group-1",
      edge: "bottom",
    });
    // The top band is behind the tab strip in this group, so a top-edge drop
    // is only reachable below the strip; see the strip case below.
    expect(
      resolveDropTarget({ x: 200, y: 45 }, [group({ strip: null })]),
    ).toEqual({ kind: "edge", groupId: "group-1", edge: "top" });
  });

  // A corner is inside two bands at once, so the answer has to be stated
  // rather than left to whichever test happens to run: the nearer edge in
  // proportion to its own band wins.
  it("gives a corner to the nearer edge", () => {
    expect(
      resolveDropTarget({ x: 3, y: 30 }, [group({ strip: null })]),
    ).toEqual({ kind: "edge", groupId: "group-1", edge: "left" });
    expect(
      resolveDropTarget({ x: 30, y: 3 }, [group({ strip: null })]),
    ).toEqual({ kind: "edge", groupId: "group-1", edge: "top" });
  });

  // The strip overlaps the top edge band by construction — the strip is
  // ~40px tall and the band is at least 32px — and the strip is the more
  // specific target, so it wins. Without this, half of every strip would
  // silently split the group instead of reordering its tabs.
  it("gives the strip band to the strip, not to the top edge", () => {
    expect(resolveDropTarget({ x: 10, y: 20 }, zones)).toEqual({
      kind: "strip",
      groupId: "group-1",
      index: 0,
    });
  });

  // Priority alone would leave the top edge with whatever pixels the strip
  // did not cover — none at all in a short group — so the strip is taken off
  // the top and the edges divide what is left.
  it("puts a full-thickness top edge directly below the strip", () => {
    const top = { kind: "edge", groupId: "group-1", edge: "top" };
    // 5px below a 40px strip, and 59px below it: both the top edge.
    expect(resolveDropTarget({ x: 200, y: 45 }, zones)).toEqual(top);
    expect(resolveDropTarget({ x: 200, y: 99 }, zones)).toEqual(top);
    expect(resolveDropTarget({ x: 200, y: 101 }, zones)).toEqual({
      kind: "centre",
      groupId: "group-1",
    });
  });

  it("measures the edges against the group's content, strip excluded", () => {
    expect(contentRect(group())).toEqual({
      left: 0,
      top: 40,
      width: 400,
      height: 560,
    });
    expect(contentRect(group({ strip: null }))).toEqual(group().rect);
  });

  it("picks the group the pointer is actually in", () => {
    const two = [
      group({ groupId: "left", rect: rect(0, 0, 200, 600), strip: null }),
      group({ groupId: "right", rect: rect(200, 0, 200, 600), strip: null }),
    ];
    expect(resolveDropTarget({ x: 100, y: 300 }, two)).toEqual({
      kind: "centre",
      groupId: "left",
    });
    expect(resolveDropTarget({ x: 300, y: 300 }, two)).toEqual({
      kind: "centre",
      groupId: "right",
    });
  });

  it("refuses a degenerate rectangle rather than dividing by zero", () => {
    expect(
      resolveDropTarget({ x: 0, y: 0 }, [
        group({ rect: rect(0, 0, 0, 0), strip: null }),
      ]),
    ).toBeNull();
  });
});

describe("stripInsertIndex", () => {
  it("inserts before the tab whose first half the pointer is over", () => {
    expect(stripInsertIndex(strip(), 10)).toBe(0);
    expect(stripInsertIndex(strip(), 50)).toBe(1);
    expect(stripInsertIndex(strip(), 90)).toBe(1);
    expect(stripInsertIndex(strip(), 130)).toBe(2);
    expect(stripInsertIndex(strip(), 250)).toBe(3);
  });

  // The strip is a horizontal scroller (the panel is 280px at its narrowest,
  // which fits two tabs), so a viewport x means nothing until the strip's
  // own scroll offset is added back.
  it("accounts for the strip's scroll offset", () => {
    expect(stripInsertIndex(strip({ scrollLeft: 160 }), 10)).toBe(2);
  });

  it("accounts for the list's position on screen", () => {
    expect(stripInsertIndex(strip({ list: rect(500, 0, 240, 40) }), 510)).toBe(
      0,
    );
    expect(stripInsertIndex(strip({ list: rect(500, 0, 240, 40) }), 630)).toBe(
      2,
    );
  });

  it("appends when the strip holds no tabs", () => {
    expect(stripInsertIndex(strip({ tabs: [] }), 10)).toBe(0);
  });
});

describe("stripCaretOffset", () => {
  it("sits at the leading edge of the tab it would insert before", () => {
    expect(stripCaretOffset(strip(), 0)).toBe(0);
    expect(stripCaretOffset(strip(), 2)).toBe(160);
  });

  it("sits after the last tab when it would append", () => {
    expect(stripCaretOffset(strip(), 3)).toBe(240);
    expect(stripCaretOffset(strip({ tabs: [] }), 0)).toBe(0);
  });
});

describe("stripScrollStep", () => {
  it("is zero away from the ends", () => {
    expect(stripScrollStep(strip(), 120)).toBe(0);
  });

  it("scrolls back near the leading edge and on near the trailing edge", () => {
    expect(stripScrollStep(strip(), 4)).toBeLessThan(0);
    expect(stripScrollStep(strip(), 238)).toBeGreaterThan(0);
  });
});

describe("moveIndexFor", () => {
  // `moveTab` addresses the target strip as it will be after the tab has
  // left it, so a within-strip move to a later position is one index short
  // of where the pointer is.
  it("shifts a later position down by one when the tab leaves from before it", () => {
    expect(moveIndexFor(2, 0)).toBe(1);
    expect(moveIndexFor(0, 2)).toBe(0);
    expect(moveIndexFor(2, null)).toBe(2);
  });
});

describe("planDrop", () => {
  const source = { groupId: "group-1", index: 1, groupLength: 3 };

  it("does nothing when the drag ended outside every target", () => {
    expect(planDrop(null, source, 3)).toEqual({
      kind: "none",
      reason: "no-target",
    });
  });

  // WSP-03: "Dragging a tab onto its own group's centre is a no-op that does
  // not disturb the layout."
  it("does nothing on its own group's centre", () => {
    expect(planDrop({ kind: "centre", groupId: "group-1" }, source, 3)).toEqual(
      { kind: "none", reason: "already-there" },
    );
  });

  it("moves to the end of another group's centre", () => {
    expect(planDrop({ kind: "centre", groupId: "group-2" }, source, 2)).toEqual(
      { kind: "move", groupId: "group-2", index: 2 },
    );
  });

  it("does nothing when a strip drop lands where the tab already is", () => {
    expect(
      planDrop({ kind: "strip", groupId: "group-1", index: 1 }, source, 3),
    ).toEqual({ kind: "none", reason: "already-there" });
    // Either side of the tab is the same position once the tab has left.
    expect(
      planDrop({ kind: "strip", groupId: "group-1", index: 2 }, source, 3),
    ).toEqual({ kind: "none", reason: "already-there" });
  });

  it("reorders within its own strip", () => {
    expect(
      planDrop({ kind: "strip", groupId: "group-1", index: 0 }, source, 3),
    ).toEqual({ kind: "move", groupId: "group-1", index: 0 });
    expect(
      planDrop({ kind: "strip", groupId: "group-1", index: 3 }, source, 3),
    ).toEqual({ kind: "move", groupId: "group-1", index: 2 });
  });

  it("moves into another strip at the drop index", () => {
    expect(
      planDrop({ kind: "strip", groupId: "group-2", index: 1 }, source, 2),
    ).toEqual({ kind: "move", groupId: "group-2", index: 1 });
  });

  it("splits on an edge", () => {
    expect(
      planDrop({ kind: "edge", groupId: "group-2", edge: "top" }, source, 2),
    ).toEqual({ kind: "split", groupId: "group-2", edge: "top" });
  });

  // The model refuses this one — the tab would leave its group empty and the
  // new half would hold what the old one showed — so the drag must not ask
  // for it and then report that something happened.
  it("does nothing when a group's only tab is dropped on its own edge", () => {
    expect(
      planDrop(
        { kind: "edge", groupId: "group-1", edge: "right" },
        { groupId: "group-1", index: 0, groupLength: 1 },
        1,
      ),
      // G4: the reason travels with the refusal, because the drag has to
      // draw and say it BEFORE the release rather than after it.
    ).toEqual({ kind: "none", reason: "split-needs-two-tabs" });
  });
});

describe("sameDropTarget", () => {
  it("compares by value so the pointer only re-announces on a real change", () => {
    expect(
      sameDropTarget(
        { kind: "strip", groupId: "g", index: 1 },
        { kind: "strip", groupId: "g", index: 1 },
      ),
    ).toBe(true);
    expect(
      sameDropTarget(
        { kind: "strip", groupId: "g", index: 1 },
        { kind: "strip", groupId: "g", index: 2 },
      ),
    ).toBe(false);
    expect(
      sameDropTarget(
        { kind: "centre", groupId: "g" },
        { kind: "centre", groupId: "h" },
      ),
    ).toBe(false);
    expect(sameDropTarget(null, null)).toBe(true);
    expect(sameDropTarget(null, { kind: "centre", groupId: "g" })).toBe(false);
  });
});

// WSP-10: a drag is announced to assistive technology — the pick-up, each
// target as it changes, and the outcome.
describe("announcements", () => {
  it("names the tab on pick-up and says how to abandon the drag", () => {
    expect(dragPickUpMessage("Changes", null)).toContain("Changes");
    expect(dragPickUpMessage("Changes", null)).toContain("Escape");
  });

  // G5: the first target after a pick-up was never announced, because the
  // pick-up and the target were two messages and the second overwrote the
  // first before a live region had read it. They are one message now.
  it("carries the first target in the pick-up message", () => {
    const message = dragPickUpMessage(
      "Changes",
      "Drop into Panel tab group 2 of 2.",
    );
    expect(message).toBe(
      "Dragging Changes. Drop into Panel tab group 2 of 2. Press Escape to cancel.",
    );
  });

  it("names the group and the position for a strip target", () => {
    expect(
      dropTargetMessage(
        { kind: "strip", groupId: "g", index: 1 },
        {
          groupLabel: "Panel tab group 2 of 2",
          stripLength: 3,
        },
      ),
    ).toBe("Drop into Panel tab group 2 of 2 tab strip, position 2 of 3.");
  });

  it("names the group for a centre target", () => {
    expect(
      dropTargetMessage(
        { kind: "centre", groupId: "g" },
        { groupLabel: "Panel tab group", stripLength: 2 },
      ),
    ).toBe("Drop into Panel tab group.");
  });

  it("names the side for an edge target", () => {
    expect(
      dropTargetMessage(
        { kind: "edge", groupId: "g", edge: "right" },
        { groupLabel: "Panel tab group", stripLength: 2 },
      ),
    ).toBe("Split Panel tab group to the right.");
    expect(
      dropTargetMessage(
        { kind: "edge", groupId: "g", edge: "top" },
        { groupLabel: "Panel tab group", stripLength: 2 },
      ),
    ).toBe("Split Panel tab group above.");
  });

  // G4 and G5, the two halves of the same defect: a target that would be
  // refused must say WHY rather than describe the action it will not take,
  // and leaving every target must say something rather than leave the live
  // region reading the last target the pointer happened to cross.
  it("says why, for a target that would be refused", () => {
    const label = { groupLabel: "Panel tab group", stripLength: 1 };
    expect(
      dropAnnouncement(
        { kind: "none", reason: "split-needs-two-tabs" },
        { kind: "edge", groupId: "g", edge: "right" },
        label,
      ),
      // The chord's reason string, reused rather than reworded.
    ).toBe(SPLIT_NEEDS_TWO_TABS);
    expect(
      dropAnnouncement(
        { kind: "none", reason: "already-there" },
        { kind: "centre", groupId: "g" },
        label,
      ),
    ).toBe(DROP_ALREADY_THERE_MESSAGE);
    expect(
      dropAnnouncement({ kind: "none", reason: "no-target" }, null, label),
    ).toBe(DROP_NO_TARGET_MESSAGE);
  });

  it("describes the action for a target that would work", () => {
    expect(
      dropAnnouncement(
        { kind: "move", groupId: "g", index: 1 },
        { kind: "centre", groupId: "g" },
        { groupLabel: "Panel tab group 2 of 2", stripLength: 2 },
      ),
    ).toBe("Drop into Panel tab group 2 of 2.");
  });

  it("says what the drop did, and where the tab landed", () => {
    expect(
      dropOutcomeMessage({ kind: "move", groupId: "g", index: 2 }, "Changes", {
        groupLabel: "Panel tab group 1 of 2",
        sameGroup: false,
        stripLength: 3,
      }),
    ).toBe("Moved Changes into Panel tab group 1 of 2, position 3 of 3.");
    // G5: a reorder within one strip used to be announced as "Moved Changes
    // into Panel tab group." — no position, and "into" a group it never
    // left.
    expect(
      dropOutcomeMessage({ kind: "move", groupId: "g", index: 1 }, "Changes", {
        groupLabel: "Panel tab group",
        sameGroup: true,
        stripLength: 2,
      }),
    ).toBe("Moved Changes to position 2 of 2 in Panel tab group.");
    expect(
      dropOutcomeMessage(
        { kind: "split", groupId: "g", edge: "bottom" },
        "Changes",
        { groupLabel: "Panel tab group", sameGroup: false, stripLength: 1 },
      ),
    ).toBe("Split Panel tab group below with Changes.");
    expect(
      dropOutcomeMessage({ kind: "none", reason: "no-target" }, "Changes", {
        groupLabel: "Panel tab group",
        sameGroup: true,
        stripLength: 2,
      }),
    ).toBe(DRAG_UNCHANGED_MESSAGE);
  });

  it("has a distinct message for a cancelled drag", () => {
    expect(DRAG_CANCELLED_MESSAGE).not.toBe(DRAG_UNCHANGED_MESSAGE);
  });
});

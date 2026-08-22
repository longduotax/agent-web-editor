import { describe, expect, it } from "vitest";

import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from "./panelModel.js";
import { clampPanelWidth, panelMaxWidth } from "./panelGeometry.js";

describe("panelMaxWidth", () => {
  it("leaves the sidebar and a readable chat pane their room", () => {
    // 1440 - 272 (sidebar) - 360 (smallest usable chat pane) = 808.
    expect(panelMaxWidth(1440)).toBe(808);
  });

  it("never falls below the panel's own minimum, however narrow the viewport", () => {
    expect(panelMaxWidth(400)).toBe(PANEL_MIN_WIDTH);
    expect(panelMaxWidth(0)).toBe(PANEL_MIN_WIDTH);
  });

  it("stops at the model's absolute ceiling", () => {
    expect(panelMaxWidth(100_000)).toBe(PANEL_MAX_WIDTH);
  });
});

describe("clampPanelWidth", () => {
  it("keeps a width the viewport can carry", () => {
    expect(clampPanelWidth(500, 1440)).toBe(500);
  });

  // Without this the panel can be dragged — or restored — wider than the
  // viewport, squashing the chat surface to nothing.
  it("clamps a width the viewport cannot carry", () => {
    expect(clampPanelWidth(4000, 1440)).toBe(808);
  });

  it("clamps a width below the minimum", () => {
    expect(clampPanelWidth(10, 1440)).toBe(PANEL_MIN_WIDTH);
  });

  it("rounds to whole pixels", () => {
    expect(clampPanelWidth(500.6, 1440)).toBe(501);
  });

  it("falls back to the minimum for a width that is not a number", () => {
    expect(clampPanelWidth(Number.NaN, 1440)).toBe(PANEL_MIN_WIDTH);
  });
});

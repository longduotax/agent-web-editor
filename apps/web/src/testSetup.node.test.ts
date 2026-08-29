// @vitest-environment node

import { expect, it } from "vitest";

it("runs the shared test setup without browser storage", () => {
  expect(true).toBe(true);
});

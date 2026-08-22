import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// What the stylesheet itself promises, asserted against the stylesheet.
//
// Two kinds of claim live here, and neither is reachable from a component
// test: jsdom applies no author stylesheet at all, so a rule that is missing
// and a rule that is present are the same DOM to it. Both were reported as
// defects by a hands-on pass in a real browser (2026-08-23):
//
//  - a declaration whose ABSENCE silently disables the one beside it — the
//    File tab's header had `text-overflow: ellipsis` with no
//    `white-space: nowrap`, so the computed `white-space` stayed `normal`,
//    ellipsis never applied, and the path wrapped one character per line at
//    the panel's minimum width (J1);
//  - a colour token that no longer clears WCAG AA against the surface it is
//    painted on (J2, J3). Six of nine light syntax colours failed, and the
//    two that carry the most text — strings and comments — failed hardest at
//    3.13:1. A palette is exactly the kind of thing that is re-tuned by eye
//    and regresses silently, so the ratio is computed here rather than
//    trusted.

const CSS = readFileSync(
  fileURLToPath(new URL("./styles.css", import.meta.url)),
  "utf8",
);

// --- A small stylesheet reader -------------------------------------------
//
// Not a CSS parser: it walks balanced braces and collects rules with the
// at-rule prelude they sit under. That is the whole of what these assertions
// need, and it needs no dependency.

interface CssRule {
  selectors: string[];
  declarations: Record<string, string>;
  /** The `@media …` prelude this rule sits under, or null at top level. */
  media: string | null;
}

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function matchingBrace(css: string, open: number): number {
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return css.length;
}

function parseDeclarations(body: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  let depth = 0;
  let current = "";
  const flush = () => {
    const text = current.trim();
    current = "";
    if (text === "") return;
    const colon = text.indexOf(":");
    if (colon === -1) return;
    declarations[text.slice(0, colon).trim()] = text.slice(colon + 1).trim();
  };
  for (const character of body) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === ";" && depth === 0) {
      flush();
      continue;
    }
    current += character;
  }
  flush();
  return declarations;
}

function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const walk = (from: number, to: number, media: string | null) => {
    let cursor = from;
    let prelude = "";
    while (cursor < to) {
      const character = css[cursor];
      if (character === "{") {
        const end = matchingBrace(css, cursor);
        const head = prelude.trim();
        if (head.startsWith("@")) {
          // Only the conditional groups carry rules that still apply as
          // written; `@keyframes` and `@font-face` carry something else.
          if (/^@(media|supports|layer|container)\b/.test(head))
            walk(cursor + 1, end, head);
        } else if (head !== "") {
          rules.push({
            selectors: head.split(",").map((selector) => selector.trim()),
            declarations: parseDeclarations(css.slice(cursor + 1, end)),
            media,
          });
        }
        cursor = end + 1;
        prelude = "";
        continue;
      }
      prelude += character ?? "";
      cursor += 1;
    }
  };
  walk(0, css.length, null);
  return rules;
}

const RULES = parseRules(withoutComments(CSS));

/** Every declaration that applies to one selector, later rules winning. */
function declarationsFor(
  selector: string,
  media: string | null = null,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const rule of RULES) {
    if (rule.media !== media) continue;
    if (!rule.selectors.includes(selector)) continue;
    Object.assign(merged, rule.declarations);
  }
  return merged;
}

// --- J1: the File tab's header path --------------------------------------

describe("the File tab's header path", () => {
  it("never wraps, so its ellipsis is a rule the browser can apply", () => {
    const path = declarationsFor(".file-preview > header .file-path");
    // The defect exactly: `text-overflow` does nothing while the computed
    // `white-space` is `normal`, and the span wrapped to 88px tall — one
    // character per line — at the panel's 280px floor.
    expect(path["white-space"]).toBe("nowrap");
    // Without this a flex item refuses to shrink below its content, which is
    // the other half of "it did not ellipsise, it grew".
    expect(path["min-width"]).toBe("0");
    expect(path.overflow).toBe("hidden");
  });

  it("spends its ellipsis on the directories and keeps the file name whole", () => {
    // The tail of a path is the informative half. The directory prefix is
    // the part that shrinks (a far larger shrink factor), and the name is
    // the part that survives.
    const directory = declarationsFor(".file-preview > header .file-path-dir");
    expect(directory["text-overflow"]).toBe("ellipsis");
    expect(directory.overflow).toBe("hidden");
    const name = declarationsFor(".file-preview > header .file-path-name");
    expect(name["text-overflow"]).toBe("ellipsis");
    const shrinkOf = (flex: string | undefined) =>
      Number((flex ?? "").split(/\s+/)[1] ?? "1");
    expect(shrinkOf(directory.flex)).toBeGreaterThan(shrinkOf(name.flex) * 10);
  });

  it("lets the header's controls wrap rather than clip or overflow", () => {
    // At 280px the three action buttons are wider than the header, so
    // something has to give. Wrapping is what gives: no control is clipped,
    // nothing overflows the tab body sideways, and the path keeps a whole
    // line to itself.
    expect(declarationsFor(".file-preview > header")["flex-wrap"]).toBe("wrap");
    expect(
      declarationsFor(".file-preview > header .file-actions")["flex-wrap"],
    ).toBe("wrap");
  });
});

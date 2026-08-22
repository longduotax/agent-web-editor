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

/**
 * One rule's selector list, split on its own commas only.
 *
 * `.file-markdown :is(.md-file-link, .md-external-link)` is ONE selector,
 * and splitting it on every comma turns it into two that match nothing.
 */
function splitSelectors(head: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of head) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      selectors.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim() !== "") selectors.push(current.trim());
  return selectors;
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
            selectors: splitSelectors(head),
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

// --- Theme tokens, resolved the way the cascade resolves them ------------

const DARK_MEDIA = "@media (prefers-color-scheme: dark)";

/** Every custom property `:root` declares, in one theme. */
function themeTokens(theme: "light" | "dark"): Record<string, string> {
  const tokens = { ...declarationsFor(":root") };
  if (theme === "dark")
    Object.assign(tokens, declarationsFor(':root[data-theme="dark"]'));
  return tokens;
}

/** A `var(--x)` chain followed to the colour at the end of it. */
function resolve(value: string, tokens: Record<string, string>): string {
  let current = value.trim();
  for (let step = 0; step < 12; step += 1) {
    const reference = /^var\((--[a-z0-9-]+)\)$/i.exec(current);
    if (reference === null) return current;
    const name = reference[1] ?? "";
    const next = tokens[name];
    if (next === undefined) return current;
    current = next.trim();
  }
  return current;
}

function channels(colour: string): [number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (hex !== null) {
    const digits = hex[1] ?? "";
    const full =
      digits.length === 3
        ? digits
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : digits;
    const value = Number.parseInt(full, 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(colour.trim());
  if (rgb !== null) {
    const parts = (rgb[1] ?? "").split(/[,/\s]+/).filter((part) => part !== "");
    return [
      Number(parts[0] ?? 0),
      Number(parts[1] ?? 0),
      Number(parts[2] ?? 0),
    ];
  }
  throw new Error(`Not a colour this test can measure: ${colour}`);
}

function relativeLuminance(colour: string): number {
  const linear = channels(colour).map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.04045
      ? scaled / 12.92
      : Math.pow((scaled + 0.055) / 1.055, 2.4);
  });
  return (
    0.2126 * (linear[0] ?? 0) +
    0.7152 * (linear[1] ?? 0) +
    0.0722 * (linear[2] ?? 0)
  );
}

/** WCAG 2 contrast, to two decimals so a failure names a real number. */
function contrast(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return Math.round(ratio * 100) / 100;
}

/** The AA bar for normal-size text. Both surfaces below carry body text. */
const AA_NORMAL = 4.5;

/** What one selector's `color` resolves to, in one theme. */
function colourOf(
  selector: string,
  theme: "light" | "dark",
  property = "color",
): string {
  const tokens = themeTokens(theme);
  const declared = declarationsFor(selector)[property];
  if (declared === undefined)
    throw new Error(`No ${property} declared for ${selector}`);
  return resolve(declared, tokens);
}

// --- J2 and J3: every coloured word clears AA in both themes --------------

describe("the syntax palette clears WCAG AA on the surface it is painted on", () => {
  // The reported failure, in one sentence: six of nine light syntax colours
  // were below 4.5:1 against the preview's own background, and the two that
  // carry the most text were the worst of them. In one real file, of 735
  // coloured spans, 178 were strings and 202 were comments — both at
  // 3.13:1. The majority of coloured text in the light theme was the part
  // that failed, which is why it read as washed out rather than as
  // structure.
  const codeTokenNames = Object.keys(themeTokens("light")).filter((name) =>
    name.startsWith("--code-"),
  );

  it("declares a code colour for every scope the highlighter can emit", () => {
    // A guard on the loop below rather than on the palette: a token added to
    // the theme with no dark value, or a test that silently measures
    // nothing, both show up here first.
    expect(codeTokenNames.length).toBeGreaterThanOrEqual(11);
  });

  for (const theme of ["light", "dark"] as const) {
    const background = resolve(
      declarationsFor(".file-preview pre").background ?? "",
      themeTokens(theme),
    );

    it(`paints every code token above ${String(AA_NORMAL)}:1 in the ${theme} theme`, () => {
      const tokens = themeTokens(theme);
      const measured = codeTokenNames.map((name) => {
        const colour = resolve(tokens[name] ?? "", tokens);
        return { name, colour, ratio: contrast(colour, background) };
      });
      // Reported as a table rather than one failed token at a time: a
      // palette is re-derived as a whole, and a reader fixing it wants
      // every number at once.
      const failing = measured.filter((entry) => entry.ratio < AA_NORMAL);
      expect(
        failing.map(
          (entry) => `${entry.name} ${entry.colour} ${String(entry.ratio)}:1`,
        ),
      ).toEqual([]);
    });

    it(`keeps the ${theme} code hues distinguishable from each other`, () => {
      // Contrast alone is satisfiable by six near-identical darks, which
      // would pass the case above and destroy the thing highlighting is for.
      // Two tokens are "the same colour" here only if they were declared as
      // the same colour — `--code-tag` and `--code-constant` deliberately
      // share the palette's red, as do `--code-number` and
      // `--code-attribute` its amber — and every distinct one has to be
      // visibly apart from every other.
      const tokens = themeTokens(theme);
      const distinct = [
        ...new Set(
          codeTokenNames.map((name) => resolve(tokens[name] ?? "", tokens)),
        ),
      ];
      const tooClose: string[] = [];
      for (const [index, first] of distinct.entries())
        for (const second of distinct.slice(index + 1)) {
          const [r1, g1, b1] = channels(first);
          const [r2, g2, b2] = channels(second);
          // A plain sRGB distance: coarse, but the failure it exists to
          // catch — a palette flattened into one dark grey — is coarse too.
          const distance = Math.sqrt(
            (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2,
          );
          if (distance <= 40)
            tooClose.push(
              `${first} vs ${second}: ${String(Math.round(distance))}`,
            );
        }
      expect(tooClose).toEqual([]);
    });
  }

  // J3. These are body words inside a rendered document, not chrome: one
  // real README renders 23 inert links inside running sentences. The muted
  // token they used was 3.44:1 on the panel's own white.
  const documentSurfaces = [
    ".file-markdown .md-inert-link",
    ".file-markdown .md-image-missing",
    ".file-markdown :is(.md-file-link, .md-fragment-link, .md-external-link)",
    ".panel-state",
    ".empty",
  ];

  for (const theme of ["light", "dark"] as const) {
    it(`paints the panel's own prose above ${String(AA_NORMAL)}:1 in the ${theme} theme`, () => {
      const background = resolve(
        declarationsFor(".panel").background ?? "",
        themeTokens(theme),
      );
      const failing = documentSurfaces
        .map((selector) => ({
          selector,
          ratio: contrast(colourOf(selector, theme), background),
        }))
        .filter((entry) => entry.ratio < AA_NORMAL);
      expect(
        failing.map((entry) => `${entry.selector} ${String(entry.ratio)}:1`),
      ).toEqual([]);
    });

    it(`paints the panel's live region above ${String(AA_NORMAL)}:1 in the ${theme} theme`, () => {
      // It is the panel's one `role="status"`, and it is where a copy that
      // worked and a copy that failed both say so (J4). A signal nobody can
      // read is not a signal.
      const background = resolve(
        colourOf(".panel-announcement", theme, "background"),
        themeTokens(theme),
      );
      expect(
        contrast(colourOf(".panel-announcement", theme), background),
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  }

  it("keeps the two dark blocks saying the same thing", () => {
    // `styles.css` writes the dark theme twice — once under
    // `prefers-color-scheme` for the System setting, once under
    // `[data-theme="dark"]` for the pinned one — so a palette edited in one
    // and not the other passes every contrast case above while shipping two
    // different dark themes (CWS-02).
    const pinned = declarationsFor(':root[data-theme="dark"]');
    const followed = declarationsFor(
      ':root:not([data-theme="light"])',
      DARK_MEDIA,
    );
    for (const [name, value] of Object.entries(pinned)) {
      if (!name.startsWith("--")) continue;
      expect(`${name}: ${followed[name] ?? "(missing)"}`).toBe(
        `${name}: ${value}`,
      );
    }
  });
});

// --- J11: the source view's line-number gutter ---------------------------

describe("the File tab's line numbers", () => {
  const gutter = declarationsFor(".file-preview > pre .file-line::before");

  it("draws each number from the line's own attribute, not from its text", () => {
    // The whole of why the numbers cannot be selected into a copy of the
    // file: generated content is not part of the document's text, so a
    // selection cannot reach it and `textContent` does not contain it. A
    // number rendered as a text node would be copied with the code.
    expect(gutter.content).toBe("attr(data-line)");
    expect(gutter["user-select"]).toBe("none");
  });

  it("reserves a width the line count decides", () => {
    // A 12-line file should not pay for a four-digit gutter, and the 2,000
    // line budget means four digits is the most any file can need.
    expect(gutter.width).toContain("--file-gutter");
  });

  it("paints the numbers above the AA bar on the code surface", () => {
    // They are text a reader reads, not decoration.
    for (const theme of ["light", "dark"] as const) {
      const background = resolve(
        declarationsFor(".file-preview pre").background ?? "",
        themeTokens(theme),
      );
      const colour = resolve(gutter.color ?? "", themeTokens(theme));
      expect(
        `${theme} ${String(contrast(colour, background) >= AA_NORMAL)}`,
      ).toBe(`${theme} true`);
    }
  });
});

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

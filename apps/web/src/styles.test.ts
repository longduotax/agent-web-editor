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

/**
 * A `var(--x)` chain followed to the colour at the end of it, and a
 * `color-mix()` around it carried out.
 *
 * The mixing is here rather than left unresolved because of K2, which is the
 * shape of defect this file exists to catch and nearly got away. The Changes
 * tab's `.change-kind` chips paint `color-mix(in srgb, var(--done) 20%,
 * var(--card))`; a reader that stops at `color-mix` measures nothing, and a
 * reader that quietly falls through to the page background measures the
 * wrong thing and reports a pass. Every one of the six chips was below the
 * AA bar in the light theme and two of them in dark, and the first attempt
 * at the case reported four of the six as passing.
 */
function resolve(value: string, tokens: Record<string, string>): string {
  let current = value.trim();
  for (let step = 0; step < 12; step += 1) {
    const mix = /^color-mix\(\s*in\s+srgb\s*,(.+)\)$/is.exec(current);
    if (mix !== null) return mixed(mix[1] ?? "", tokens);
    const reference = /^var\((--[a-z0-9-]+)\)$/i.exec(current);
    if (reference === null) return current;
    const name = reference[1] ?? "";
    const next = tokens[name];
    if (next === undefined) return current;
    current = next.trim();
  }
  return current;
}

/**
 * `color-mix(in srgb, …)`'s two components, mixed as the specification says.
 *
 * `transparent` is refused rather than approximated: a mix with it carries
 * an alpha, and the contrast of a translucent colour is a question about the
 * backdrop behind it, which this reader cannot see. A test that needs one
 * has to name the backdrop itself.
 */
function mixed(components: string, tokens: Record<string, string>): string {
  const parts = splitSelectors(components);
  const read = (part: string): { colour: string; weight: number | null } => {
    const percent = /\s(\d+(?:\.\d+)?)%$/.exec(part.trim());
    const colour =
      percent === null
        ? part.trim()
        : part
            .trim()
            .slice(0, -percent[0].length + 1)
            .trim();
    return {
      colour: resolve(colour, tokens),
      weight: percent === null ? null : Number(percent[1]),
    };
  };
  if (parts.length !== 2)
    throw new Error(
      `Not a two-colour mix this test can measure: ${components}`,
    );
  const first = read(parts[0] ?? "");
  const second = read(parts[1] ?? "");
  // One percentage names its own share and leaves the rest to the other; two
  // are normalized against their sum; none is an even mix.
  const firstShare =
    first.weight ?? (second.weight === null ? 50 : 100 - second.weight);
  const secondShare =
    second.weight ?? (first.weight === null ? 50 : 100 - first.weight);
  const total = firstShare + secondShare;
  const ratio = total === 0 ? 0.5 : firstShare / total;
  const a = channels(first.colour);
  const b = channels(second.colour);
  const blend = [0, 1, 2].map((index) =>
    Math.round((a[index] ?? 0) * ratio + (b[index] ?? 0) * (1 - ratio)),
  );
  return `rgb(${blend.map(String).join(", ")})`;
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
  // What `getComputedStyle` hands back for a `color-mix()` result in Chrome:
  // not `rgb()`, but `color(srgb 0.836863 0.887059 0.984314)`, with the
  // channels as 0–1 fractions. A reader that does not know this shape and
  // falls back to something plausible reports a contrast against a colour
  // that is not on screen — the trap K2 set for whoever fixed it, and the
  // one the reviewer hit first time round. No `color-mix()` arithmetic is
  // needed for it: the browser has already done the mixing.
  const srgb = /^color\(\s*srgb\s+([^)]+)\)$/i.exec(colour.trim());
  if (srgb !== null) {
    const parts = (srgb[1] ?? "").split(/[/\s]+/).filter((part) => part !== "");
    return [0, 1, 2].map((index) =>
      Math.round(Number(parts[index] ?? 0) * 255),
    ) as [number, number, number];
  }
  // Loud rather than plausible. A colour this reader cannot measure has to
  // stop the test, because the alternative is a green tick over an unmeasured
  // value, which is exactly how six failing chips read as four passes.
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

// --- WSP-06: the diff's own palette and its two gutters -------------------

// --- K2: the Changes tab's change-kind chips -----------------------------

describe("the colour reader itself", () => {
  // Two shapes it did not know, and the second is why K2 was nearly closed
  // with four of its six failures still on screen.

  it("carries out a `color-mix()` instead of stopping at it", () => {
    const tokens = { "--done": "#2f9e44", "--card": "#ffffff" };
    expect(
      resolve("color-mix(in srgb, var(--done) 20%, var(--card))", tokens),
    ).toBe("rgb(213, 236, 218)");
    // A share on the second component, and an even mix with none at all.
    expect(resolve("color-mix(in srgb, #000000, #ffffff)", {})).toBe(
      "rgb(128, 128, 128)",
    );
    expect(resolve("color-mix(in srgb, #000000, #ffffff 25%)", {})).toBe(
      "rgb(64, 64, 64)",
    );
  });

  it("reads Chrome's own serialisation of a mixed colour", () => {
    // `getComputedStyle` does not answer with `rgb()` for a `color-mix()`
    // result; it answers with this, and the channels are fractions.
    expect(channels("color(srgb 0.836863 0.887059 0.984314)")).toEqual([
      213, 226, 251,
    ]);
  });

  it("refuses a colour it cannot measure rather than guessing one", () => {
    // The failure mode this whole file exists to avoid: an unmeasured value
    // silently becoming a plausible one, and a table of failures reading as
    // a table of passes.
    expect(() => channels("oklch(0.7 0.1 200)")).toThrow(
      /not a colour this test can measure/i,
    );
    expect(() =>
      resolve("color-mix(in srgb, var(--accent) 55%, transparent)", {
        "--accent": "#2f6feb",
      }),
    ).toThrow(/not a colour this test can measure/i);
  });
});

describe("the Changes tab's change-kind chips", () => {
  // K2. Measured in a real browser against each chip's own resolved
  // background, at the 10.24px/400 the chip actually paints — normal text,
  // so the AA bar is 4.5:1:
  //
  //   untracked `?`  2.76 light / 5.04 dark      deleted `D`  3.44 / 3.79
  //   conflicted `U` 3.44 / 3.79                 modified `M` 3.51 / 4.59
  //   renamed `R`    3.51 / 4.59                 copied `C`   3.51 / 4.59
  //
  // Every chip failed in light and two failed in dark. The letter is
  // `aria-hidden` and each row carries its kind as a word in an `.sr-only`
  // span, so nothing was lost to assistive technology: this is legibility
  // for sighted readers, and WSP-06 asks for the letter precisely so the
  // kind is not in the colour alone — a letter nobody can read does not
  // carry it either.
  //
  // The chips were left out of this file at milestone 6 with the reason
  // recorded ("either the test learns `color-mix`, or the chips become
  // resolved tokens like the diff's"). Both happened: the reader learned it
  // above, and the chips now take the diff's own measured pairs, so a
  // modified file's chip and its diff are one palette.
  const chips = [
    ".change-kind",
    ".change-kind.deleted",
    ".change-kind.conflicted",
    ".change-kind.added",
    ".change-kind.untracked",
  ];

  for (const theme of ["light", "dark"] as const) {
    it(`paints every chip above ${String(AA_NORMAL)}:1 in the ${theme} theme`, () => {
      const tokens = themeTokens(theme);
      const measured = chips.map((selector) => ({
        selector,
        ratio: contrast(
          colourOf(selector, theme),
          resolve(colourOf(selector, theme, "background"), tokens),
        ),
      }));
      const failing = measured.filter((entry) => entry.ratio < AA_NORMAL);
      expect(
        failing.map((entry) => `${entry.selector} ${String(entry.ratio)}:1`),
      ).toEqual([]);
    });

    it(`keeps each chip's own background off the row it sits on in the ${theme} theme`, () => {
      // A chip is a shape as well as a letter, and a wash indistinguishable
      // from the list row behind it would pass the case above while making
      // the chip invisible.
      const tokens = themeTokens(theme);
      const [rowRed, rowGreen, rowBlue] = channels(
        resolve(declarationsFor(".panel").background ?? "", tokens),
      );
      const tooClose = chips
        .map((selector) => ({
          selector,
          wash: resolve(colourOf(selector, theme, "background"), tokens),
        }))
        .filter(({ wash }) => {
          const [r, g, b] = channels(wash);
          return (
            Math.sqrt(
              (r - rowRed) ** 2 + (g - rowGreen) ** 2 + (b - rowBlue) ** 2,
            ) < 15
          );
        });
      expect(tooClose.map((entry) => entry.selector)).toEqual([]);
    });
  }
});

describe("the Diff tab's colours", () => {
  // The diff paints its text on a tinted wash of its own, so the surface its
  // contrast has to clear is that wash and not the code background beside
  // it. These tokens are therefore NOT aliases of `--green` and `--red`,
  // which are chosen against the page's white — the mechanism that put six
  // of nine syntax tokens below the bar (J2).
  const pairs = [
    ["--diff-add-fg", "--diff-add-bg"],
    ["--diff-delete-fg", "--diff-delete-bg"],
    ["--diff-hunk-fg", "--diff-hunk-bg"],
  ] as const;

  for (const theme of ["light", "dark"] as const) {
    it(`paints every diff colour above ${String(AA_NORMAL)}:1 in the ${theme} theme`, () => {
      const tokens = themeTokens(theme);
      const failing = pairs
        .map(([foreground, background]) => {
          const colour = resolve(tokens[foreground] ?? "", tokens);
          const surface = resolve(tokens[background] ?? "", tokens);
          return {
            foreground,
            colour,
            surface,
            ratio: contrast(colour, surface),
          };
        })
        .filter((entry) => entry.ratio < AA_NORMAL);
      expect(
        failing.map(
          (entry) =>
            `${entry.foreground} ${entry.colour} on ${entry.surface} ${String(entry.ratio)}:1`,
        ),
      ).toEqual([]);
    });

    it(`paints the diff's line numbers above ${String(AA_NORMAL)}:1 on every wash in the ${theme} theme`, () => {
      // The gutters are drawn INSIDE the line, so an added line's number is
      // painted on the added line's background. Four surfaces, therefore,
      // not one.
      const tokens = themeTokens(theme);
      const gutter = resolve(tokens["--diff-gutter-colour"] ?? "", tokens);
      const surfaces = [
        resolve(declarationsFor(".file-preview pre").background ?? "", tokens),
        resolve(tokens["--diff-add-bg"] ?? "", tokens),
        resolve(tokens["--diff-delete-bg"] ?? "", tokens),
        resolve(tokens["--diff-hunk-bg"] ?? "", tokens),
      ];
      const failing = surfaces
        .map((surface) => ({ surface, ratio: contrast(gutter, surface) }))
        .filter((entry) => entry.ratio < AA_NORMAL);
      expect(
        failing.map(
          (entry) => `${gutter} on ${entry.surface} ${String(entry.ratio)}:1`,
        ),
      ).toEqual([]);
    });

    it(`paints the header's counts above ${String(AA_NORMAL)}:1 in the ${theme} theme`, () => {
      // They are on the header's surface, not on a wash: the same colour,
      // a different background, and both have to clear the bar.
      const tokens = themeTokens(theme);
      const surface = resolve(
        declarationsFor(".diff-view > header").background ?? "",
        tokens,
      );
      for (const selector of [".diff-count-add", ".diff-count-delete"])
        expect(
          `${selector} ${String(contrast(colourOf(selector, theme), surface) >= AA_NORMAL)}`,
        ).toBe(`${selector} true`);
    });

    it(`keeps each diff wash distinguishable from the code surface in the ${theme} theme`, () => {
      // Contrast alone is satisfiable by three washes indistinguishable from
      // the background, which would pass every case above and leave the
      // reader with no wash at all. The `+`/`-` prefixes still carry the
      // distinction on their own — this is about whether the colour adds
      // anything.
      const tokens = themeTokens(theme);
      const [plainRed, plainGreen, plainBlue] = channels(
        resolve(declarationsFor(".file-preview pre").background ?? "", tokens),
      );
      const tooClose: string[] = [];
      for (const name of [
        "--diff-add-bg",
        "--diff-delete-bg",
        "--diff-hunk-bg",
      ]) {
        const wash = resolve(tokens[name] ?? "", tokens);
        const [r, g, b] = channels(wash);
        const distance = Math.sqrt(
          (r - plainRed) ** 2 + (g - plainGreen) ** 2 + (b - plainBlue) ** 2,
        );
        if (distance < 15)
          tooClose.push(`${name} ${wash}: ${String(Math.round(distance))}`);
      }
      expect(tooClose).toEqual([]);
    });
  }
});

describe("the Diff tab's line numbers", () => {
  const oldSide = declarationsFor(".diff-lines .diff-line::before");
  const newSide = declarationsFor(".diff-lines .diff-line-body::before");
  const prefix = declarationsFor(".diff-lines .diff-line-prefix");
  const cells = declarationsFor(".diff-view .diff-lines");

  it("draws both numbers from attributes, not from the line's text", () => {
    // The same mechanism as the File tab's single gutter (J11), and the same
    // reason: generated content is not part of the document's text, so a
    // selection cannot reach it and a copied diff is the diff. Two gutters
    // need two pseudo-elements, which is why the line's text is wrapped in an
    // element of its own.
    // The trailing zero-width space is load-bearing and is asserted with
    // the attribute it follows; see the case below.
    expect(oldSide.content).toBe('attr(data-old) "\\200b"');
    expect(newSide.content).toBe('attr(data-new) "\\200b"');
    expect(oldSide["user-select"]).toBe("none");
    expect(newSide["user-select"]).toBe("none");
  });

  it("reserves a width the diff's own largest number decides", () => {
    // One step of indirection now, because the same widths are also what
    // `left` pins the next cell at: the cells are named on `.diff-lines` and
    // every one of them is derived from `--diff-gutter`.
    expect(oldSide.width).toBe("var(--diff-old-cell)");
    expect(newSide.width).toBe("var(--diff-new-cell)");
    expect(cells["--diff-old-cell"]).toContain("--diff-gutter");
    expect(cells["--diff-new-cell"]).toContain("--diff-gutter");
    expect(cells["--diff-column"]).toContain("--diff-old-cell");
  });

  // K1. Measured in Chrome at the panel's 280px floor, on a real Python
  // diff: `.diff-body` scrollWidth/clientWidth was 757/259 — 498px of scroll
  // range — with the `+` character at x=50 inside the box. Any scrollLeft
  // past ~58px, 12% of that range, took the prefix and both gutters off
  // screen for the remaining 88% and left the add/remove distinction to the
  // wash alone, which measures 1.04:1 (light) and 1.06:1 (dark) between add
  // and delete. WSP-06 says that distinction is never carried by colour
  // alone, and "unless you scroll" is not a clause it has.
  describe("stay on screen at every scroll offset (K1)", () => {
    it("pins each of the three cells to its own column", () => {
      expect(oldSide.position).toBe("sticky");
      expect(newSide.position).toBe("sticky");
      expect(prefix.position).toBe("sticky");
      // Pinned in order, each one at the sum of the widths before it, so the
      // three of them are one column with no gap and no overlap.
      expect(oldSide.left).toBe("0");
      expect(newSide.left).toBe("var(--diff-old-cell)");
      expect(prefix.left).toBe(
        "calc(var(--diff-old-cell) + var(--diff-new-cell))",
      );
    });

    it("gives every pinned cell an opaque background of the line's own kind", () => {
      // Without one the scrolled code runs UNDER the numbers and the prefix
      // and the column becomes unreadable — a worse failure than the one it
      // is fixing. `--diff-line-bg` is a custom property, so it inherits from
      // the line into both pseudo-elements and the prefix span.
      for (const cell of [oldSide, newSide, prefix])
        expect(cell.background).toBe("var(--diff-line-bg)");
      expect(declarationsFor(".diff-lines .diff-line")["--diff-line-bg"]).toBe(
        "var(--hover)",
      );
      expect(declarationsFor(".diff-add")["--diff-line-bg"]).toBe(
        "var(--diff-add-bg)",
      );
      expect(declarationsFor(".diff-delete")["--diff-line-bg"]).toBe(
        "var(--diff-delete-bg)",
      );
    });

    it("never lets a gutter's generated content be empty", () => {
      // Measured, and the one thing about K1 that is not obvious from the
      // rules: `position: sticky` did NOT apply to a `::before` whose
      // `content` resolved to the empty string, even with an explicit width
      // and a background. An added line has no old-side number and a deleted
      // line no new-side one, so on every changed line one of the two cells
      // was empty — and it was the changed lines the whole fix is for. With
      // `content: "9" attr(data-old)` it pinned; with `attr(data-old)` alone
      // it stayed at its scrolled-away flow position and the code was
      // painted over its column. The zero-width space costs no width, is
      // generated content and so cannot be copied, and makes the box
      // non-empty for every line.
      expect(oldSide.content).toContain('"\\200b"');
      expect(newSide.content).toContain('"\\200b"');
    });

    it("spends the row's left inset inside the pinned cell, not on the `pre`", () => {
      // A padding on the `pre` scrolls away with the content, so the pinned
      // column would jump left by it — 12.8px, measured — the moment the
      // body moved. The rows are full-bleed and the inset is inside the
      // old-side cell, which is pinned and therefore does not move.
      expect(declarationsFor(".diff-view .diff-lines").padding).toBe(
        "0.3rem 0",
      );
      expect(oldSide.padding).toContain("0.7rem");
    });

    it("keeps the prefix a real character rather than generated content", () => {
      // The numbers are `::before` content precisely so a copy cannot reach
      // them. The prefix is the opposite case: it is patch content, a copy
      // MUST carry it, so it is a text node in a box rather than a box that
      // draws it. What this asserts is that nobody "fixed" the prefix the
      // way the gutters were fixed.
      expect(prefix.content).toBeUndefined();
      expect(prefix["user-select"]).toBeUndefined();
    });
  });
});

describe("soft wrap in the Diff tab and the File tab's source view (K5)", () => {
  // A scope addition rather than a defect, recorded as one. Width is what
  // would send a reader back to `git diff`: roughly 40 characters of code at
  // the 400px default once the pinned column has taken its own, and about 25
  // at the 280px floor, against a terminal at 120 columns. Three things have
  // to hold when it is on, and none of them is visible to jsdom.
  const diffText = declarationsFor(".diff-lines.wrap .diff-line-text");
  const fileText = declarationsFor(".file-preview > pre.wrap .file-line-text");

  it("wraps the `pre` and stops it sizing to its longest line", () => {
    // `width: max-content` is what lets an unwrapped diff scroll; left in
    // place it would size the box to the longest UNWRAPPED line and the
    // wrapping would buy nothing.
    expect(declarationsFor(".diff-body pre.wrap")["white-space"]).toBe(
      "pre-wrap",
    );
    expect(declarationsFor(".diff-body pre.wrap").width).toBe("auto");
    expect(declarationsFor(".diff-body pre.wrap")["max-width"]).toBe("100%");
    expect(declarationsFor(".file-preview > pre.wrap")["white-space"]).toBe(
      "pre-wrap",
    );
  });

  it("bounds the code by the width the gutters leave it", () => {
    // This is what makes a continuation row indent under the code rather
    // than start at the panel's left edge: the text is a box narrower than
    // the `pre` by exactly the column beside it, so it wraps inside itself.
    expect(diffText.display).toBe("inline-block");
    expect(diffText["max-width"]).toBe("calc(100% - var(--diff-column))");
    expect(diffText["box-sizing"]).toBe("border-box");
    expect(fileText.display).toBe("inline-block");
    expect(fileText["max-width"]).toContain("--file-gutter");
    expect(fileText["box-sizing"]).toBe("border-box");
  });

  it("marks a continuation row as well as indenting it", () => {
    // "An indent or a marker": a wrapped row that looks like a new line is
    // worse than scrolling. Both, here — the indent above, and a rule down
    // the code's left edge that a new line starts to the LEFT of and a
    // continuation row starts to the right of.
    for (const text of [diffText, fileText])
      expect(text["border-left"]).toBe("1px solid var(--border)");
  });

  it("leaves a line with no spaces in it nowhere to overflow to", () => {
    // A minified line has nothing to break at, and "wrapped" has to mean no
    // horizontal scrolling for that line too.
    for (const text of [diffText, fileText])
      expect(text["overflow-wrap"]).toBe("anywhere");
  });
});

describe("the Diff tab's copyable text", () => {
  // K3. Inside one hunk the copy was already exactly right — clean patch
  // text, prefixes kept, no line numbers. Across a hunk boundary it picked
  // up the disclosure's own chrome:
  //
  //     ▾
  //     @@ -78,11 +82,26 @@ from avm_agent.v4.bracket import (
  //     +15 -0
  //      )
  //
  // and across a section boundary the bare word `Unstaged` as well. A
  // two-hunk copy of a diff will not apply, which is most of what copying a
  // diff is for. Computed `user-select` was `auto` on all four.

  it("leaves the disclosure's chrome out of a selection", () => {
    for (const selector of [
      ".diff-hunk-mark",
      ".diff-hunk-tally",
      // K4's separator, which is the same defect a second time: text added
      // for the accessible name is not text a copy should carry, and a
      // cross-hunk copy picked it up as a bare `,` line the day it was
      // added. Only the end-to-end selection case saw it.
      ".diff-hunk-toggle .sr-only",
      ".diff-section h4",
      ".diff-section > .panel-state",
    ])
      expect(
        `${selector} ${declarationsFor(selector)["user-select"] ?? ""}`,
      ).toBe(`${selector} none`);
  });

  it("keeps the `@@` header itself copyable", () => {
    // It is legitimate patch content — `git apply` needs it — so it is the
    // one part of the disclosure that must stay selectable. The tally and
    // the twisty beside it are the panel's own drawing.
    expect(declarationsFor(".diff-hunk-header")["user-select"]).toBeUndefined();
    expect(declarationsFor(".diff-lines")["user-select"]).toBeUndefined();
  });
});

describe("the Diff tab's header path", () => {
  // J1 again, on the other header that states a path. The declarations are
  // shared with the File tab's rule, so this asserts that the diff's
  // selector is really in that rule rather than that the rule exists.
  it("never wraps, so its ellipsis is a rule the browser can apply", () => {
    const path = declarationsFor(".diff-view > header .file-path");
    expect(path["white-space"]).toBe("nowrap");
    expect(path["min-width"]).toBe("0");
    expect(path.overflow).toBe("hidden");
  });

  it("spends its ellipsis on the directories and keeps the file name whole", () => {
    expect(
      declarationsFor(".diff-view > header .file-path-dir")["text-overflow"],
    ).toBe("ellipsis");
    expect(
      declarationsFor(".diff-view > header .file-path-name")["text-overflow"],
    ).toBe("ellipsis");
  });

  it("lets the header's controls wrap rather than clip or overflow", () => {
    expect(declarationsFor(".diff-view > header")["flex-wrap"]).toBe("wrap");
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

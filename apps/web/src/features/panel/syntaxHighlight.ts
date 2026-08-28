import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import { HIGHLIGHT_MAX_CHARACTERS } from "./fileLanguage.js";
import type { CodeLanguage } from "./fileLanguage.js";

// The File tab's syntax highlighting (WSP-05).
//
// **Nothing may import this module statically.** It is reached through a
// dynamic `import()` in `FileTab`, which is what puts Shiki and its grammars
// in their own chunk instead of in the entry bundle — a static import of even
// one constant from here would pull the whole of it back into first paint.
// That is why the tab's fallback is "keep the plain text" rather than
// anything this module has to be asked about first, and why the character
// bound this file ENFORCES is declared in `fileLanguage.ts`: the tab has to
// know it without loading any of this, both to avoid asking for a file it
// would only decline and to say that it declined (J5).

export { HIGHLIGHT_MAX_CHARACTERS } from "./fileLanguage.js";

export interface CodeToken {
  text: string;
  /**
   * A `var(--code-*)` reference, or `null` for text that takes the preview's
   * own colour. Never a literal colour: see the theme below.
   */
  color: string | null;
  italic: boolean;
  bold: boolean;
}

export type HighlightedLine = CodeToken[];

/** What the theme paints ordinary text, and therefore what needs no span. */
const PLAIN = "var(--code-plain)";

const THEME_NAME = "pi-workspace";

/**
 * The highlighting theme: the stylesheet's own tokens, named as CSS
 * variables rather than resolved to colours.
 *
 * WSP-05 requires highlighting "derived from the active theme's tokens", and
 * this is the whole of how that is met. A bundled Shiki theme carries fixed
 * hex colours chosen against its own background, which would ignore both the
 * light/dark blocks in `styles.css` and any change the user makes to them.
 *
 * Naming variables works because a token's colour is carried through
 * tokenization as an opaque string and reaches the DOM as an inline
 * `color:` — so the cascade resolves it, in whichever theme is active, at
 * paint time. That is also why a theme switch needs no re-highlight and no
 * listener: the same tokens simply resolve to the other block's values. The
 * `--code-*` variables are defined in `styles.css` beside every other theme
 * token.
 *
 * The scope lists are TextMate scopes, matched by longest prefix, and are
 * deliberately coarse. A reader wants comments, strings and keywords to
 * separate from code; a fifty-scope theme buys distinctions this panel is
 * too narrow to show.
 */
const THEME = {
  name: THEME_NAME,
  // Shiki wants to know which side the theme is on for its own defaults. It
  // is never used here — the preview's background is the panel's, and both
  // themes resolve from the same variables.
  type: "dark" as const,
  fg: PLAIN,
  bg: "transparent",
  settings: [
    { settings: { foreground: PLAIN } },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: {
        foreground: "var(--code-comment)",
        fontStyle: "italic",
      },
    },
    {
      scope: [
        "keyword",
        "storage",
        "storage.type",
        "storage.modifier",
        "keyword.control",
        "keyword.operator.new",
        "keyword.operator.expression",
        "variable.language.this",
        "variable.language.super",
      ],
      settings: { foreground: "var(--code-keyword)" },
    },
    {
      scope: [
        "string",
        "punctuation.definition.string",
        "constant.character.escape",
        "string.regexp",
      ],
      settings: { foreground: "var(--code-string)" },
    },
    {
      scope: ["constant.numeric", "constant.other.placeholder"],
      settings: {
        foreground: "var(--code-number)",
      },
    },
    {
      scope: [
        "constant.language",
        "constant.other",
        "support.constant",
        "variable.other.constant",
      ],
      settings: { foreground: "var(--code-constant)" },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call.generic",
        "variable.function",
      ],
      settings: { foreground: "var(--code-function)" },
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.name.namespace",
        "entity.other.inherited-class",
        "support.type",
        "support.class",
      ],
      settings: { foreground: "var(--code-type)" },
    },
    {
      scope: ["entity.name.tag", "punctuation.definition.tag"],
      settings: {
        foreground: "var(--code-tag)",
      },
    },
    {
      scope: [
        "entity.other.attribute-name",
        "support.type.property-name",
        "meta.object-literal.key",
        "variable.other.property",
      ],
      settings: { foreground: "var(--code-attribute)" },
    },
    {
      scope: ["punctuation", "meta.brace", "keyword.operator"],
      settings: {
        foreground: "var(--code-punctuation)",
      },
    },
  ],
};

/**
 * The grammars, by language id.
 *
 * A `Record` over the union `languageForPath` returns, so the compiler
 * refuses a language with no grammar; and a table of literal specifiers, so
 * **no value from a file path ever becomes part of an import**. Each entry is
 * its own dynamic import, so opening a CSS file loads the CSS grammar and
 * nothing else.
 */
const GRAMMARS: Record<CodeLanguage, () => Promise<unknown>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
};

// One highlighter and one load per language for the life of the page. Two
// File tabs opened on two TypeScript files share both; a tab reopened after a
// switch re-runs neither.
let core: Promise<HighlighterCore> | null = null;
const grammarLoads = new Map<CodeLanguage, Promise<void>>();

async function highlighter(): Promise<HighlighterCore> {
  core ??= createHighlighterCore({
    themes: [THEME],
    langs: [],
    // The JavaScript engine rather than the Oniguruma one: it needs no WASM
    // asset, which keeps this to plain modules the bundler can split, and
    // `forgiving` means a grammar rule it cannot compile is dropped instead
    // of failing the whole file. A dropped rule loses colour on part of a
    // line; a thrown error would lose the colour on all of them.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return await core;
}

async function loadGrammar(
  instance: HighlighterCore,
  language: CodeLanguage,
): Promise<void> {
  const pending = grammarLoads.get(language);
  if (pending !== undefined) {
    await pending;
    return;
  }
  const load = (async () => {
    const grammar = await GRAMMARS[language]();
    await instance.loadLanguage(
      grammar as Parameters<HighlighterCore["loadLanguage"]>[0],
    );
  })();
  grammarLoads.set(language, load);
  try {
    await load;
  } catch (error) {
    // A grammar that failed to load must be retryable: the tab keeps its
    // plain text either way, but a network hiccup should not poison the
    // language for the rest of the session.
    grammarLoads.delete(language);
    throw error;
  }
}

/**
 * The file's lines, as coloured tokens, or `null` when it will not be
 * highlighted at all.
 *
 * `null` is not a failure to report. WSP-05 requires the file to stay
 * readable as plain monospace when highlighting is unavailable, so every way
 * this can decline — too large here, an unknown language before the call, a
 * rejected import at the caller — lands the reader in the same place: the
 * text they were already looking at.
 */
export async function highlightCode(
  code: string,
  language: CodeLanguage,
): Promise<HighlightedLine[] | null> {
  if (code.length > HIGHLIGHT_MAX_CHARACTERS) return null;
  const instance = await highlighter();
  await loadGrammar(instance, language);
  const { tokens } = instance.codeToTokens(code, {
    lang: language,
    theme: THEME_NAME,
  });
  return tokens.map((line) =>
    line.map((token) => {
      // Shiki's font-style flags are a bit field — 1 italic, 2 bold, 4
      // underline — except for -1, which means the theme set none.
      const style = token.fontStyle ?? 0;
      const flags = style < 0 ? 0 : style;
      return {
        text: token.content,
        // The theme's own default needs no span at all: the preview already
        // paints body text, and half a file's tokens are body text.
        color:
          token.color === undefined || token.color === PLAIN
            ? null
            : token.color,
        italic: (flags & 1) !== 0,
        bold: (flags & 2) !== 0,
      };
    }),
  );
}

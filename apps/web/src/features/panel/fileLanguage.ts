// Which grammar a File tab highlights a file with, and whether a file is
// markdown at all (WSP-05).
//
// The language is chosen here, from the file's extension, and never from the
// `language` field the file-preview response carries. That field falls back
// to the bare extension for anything the server does not recognise, so it is
// an arbitrary string that arrived over the wire — and the highlighter turns
// a language id into a module import. A value from the wire must never be
// able to name a module, so the set is closed: `CodeLanguage` is a union, the
// loader is a `Record` over it, and anything unlisted is `null`, which is
// plain monospace text and stays readable (WSP-05's "remains readable" is not
// a fallback path, it is the base case).

/**
 * The grammars the File tab can load. Deliberately a short list: every entry
 * is a module the highlighter chunk may pull in, and a language nobody opens
 * is a grammar nobody should pay to have listed.
 */
export const CODE_LANGUAGES = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "css",
  "scss",
  "html",
  "python",
  "rust",
  "go",
  "shellscript",
  "yaml",
  "toml",
  "sql",
  "java",
  "c",
  "cpp",
  "ruby",
  "php",
  "xml",
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/**
 * Extension to grammar.
 *
 * Markdown is absent on purpose. A markdown file's default view is the
 * rendered preview, and its source view stays plain: highlighting it would
 * load the markdown grammar — which embeds a dozen others — for the one view
 * a reader switches to in order to see the raw characters.
 */
const LANGUAGE_BY_EXTENSION: Record<string, CodeLanguage> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  java: "java",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  rb: "ruby",
  php: "php",
  xml: "xml",
  svg: "xml",
};

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

/**
 * The lower-cased extension of the file NAME, or `null` when it has none.
 *
 * The name matters, not the path: a directory may be called `build.rs`, and
 * the file inside it is not Rust. A leading dot is a name and not an
 * extension, so `.gitignore` has none.
 */
function extensionOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return name.slice(dot + 1).toLowerCase();
}

export function languageForPath(path: string): CodeLanguage | null {
  const extension = extensionOf(path);
  if (extension === null) return null;
  return LANGUAGE_BY_EXTENSION[extension] ?? null;
}

export function isMarkdownPath(path: string): boolean {
  const extension = extensionOf(path);
  return extension !== null && MARKDOWN_EXTENSIONS.has(extension);
}

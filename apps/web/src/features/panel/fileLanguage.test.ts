import { describe, expect, it } from "vitest";

import {
  CODE_LANGUAGES,
  isMarkdownPath,
  languageForPath,
} from "./fileLanguage.js";

describe("languageForPath", () => {
  it("selects a grammar from the file's extension", () => {
    expect(languageForPath("src/main.ts")).toBe("typescript");
    expect(languageForPath("src/App.tsx")).toBe("tsx");
    expect(languageForPath("scripts/start.mjs")).toBe("javascript");
    expect(languageForPath("package.json")).toBe("json");
    expect(languageForPath("apps/web/src/styles.css")).toBe("css");
    expect(languageForPath("deploy.sh")).toBe("shellscript");
  });

  it("matches the extension whatever case it is written in", () => {
    expect(languageForPath("READ.PY")).toBe("python");
    expect(languageForPath("Main.Rs")).toBe("rust");
  });

  it("has no language for anything it does not list, which is plain text", () => {
    expect(languageForPath("notes.txt")).toBeNull();
    expect(languageForPath("archive.tar.gz")).toBeNull();
    expect(languageForPath("LICENSE")).toBeNull();
    expect(languageForPath("")).toBeNull();
  });

  it("reads the extension of the file name, never of a directory above it", () => {
    // A directory may be named `foo.ts`; the file inside it is not
    // TypeScript, and a path is not an extension.
    expect(languageForPath("foo.ts/README")).toBeNull();
    expect(languageForPath("build.rs/main.py")).toBe("python");
  });

  it("treats a dotfile as a name rather than as an extension", () => {
    expect(languageForPath(".gitignore")).toBeNull();
    expect(languageForPath("src/.env")).toBeNull();
  });

  it("has no language for markdown, whose preview is its own renderer", () => {
    expect(languageForPath("README.md")).toBeNull();
    expect(languageForPath("docs/spec.markdown")).toBeNull();
  });

  it("returns nothing outside the closed set of languages it declares", () => {
    // The set is closed because the highlighter turns a language id into a
    // module import. Anything that could reach that from a path has to be on
    // this list, and the list is what the loader is typed against.
    const declared = new Set<string>(CODE_LANGUAGES);
    for (const path of [
      "a.ts",
      "a.tsx",
      "a.mjs",
      "a.jsx",
      "a.json",
      "a.css",
      "a.scss",
      "a.html",
      "a.py",
      "a.rs",
      "a.go",
      "a.sh",
      "a.yaml",
      "a.toml",
      "a.sql",
      "a.java",
      "a.c",
      "a.cpp",
      "a.rb",
      "a.php",
      "a.xml",
      "a.unknown-extension",
    ]) {
      const language = languageForPath(path);
      if (language === null) continue;
      expect(declared.has(language)).toBe(true);
    }
  });
});

describe("isMarkdownPath", () => {
  it("recognises the two markdown extensions, in any case", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("docs/design/NOTES.MD")).toBe(true);
    expect(isMarkdownPath("docs/spec.markdown")).toBe(true);
  });

  it("does not treat anything else as markdown", () => {
    expect(isMarkdownPath("notes.txt")).toBe(false);
    expect(isMarkdownPath("component.mdx")).toBe(false);
    expect(isMarkdownPath("md")).toBe(false);
    expect(isMarkdownPath("docs.md/inner.txt")).toBe(false);
  });
});

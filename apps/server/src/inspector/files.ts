import { opendir, open, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  FilePreviewResponseSchema,
  FileTreeResponseSchema,
  RelativePathSchema,
} from "@pi-web/contracts";

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_TREE_ENTRIES = 20_000;

export function parseRelativePath(raw: unknown): string {
  return RelativePathSchema.parse(raw);
}

function isContained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

export async function resolveContained(
  rootPath: string,
  rawRelativePath: unknown,
  allowRoot = false,
): Promise<{ root: string; target: string; relativePath: string }> {
  const root = await realpath(rootPath);
  if (allowRoot && rawRelativePath === "")
    return { root, target: root, relativePath: "" };
  const relativePath = parseRelativePath(rawRelativePath);
  if (isAbsolute(relativePath)) throw new Error("path_escape");
  const lexical = resolve(root, ...relativePath.split("/"));
  if (!isContained(root, lexical)) throw new Error("path_escape");
  const target = await realpath(lexical);
  if (!isContained(root, target)) throw new Error("path_escape");
  return { root, target, relativePath };
}

export async function listProjectFiles(rootPath: string, searchText = "") {
  const root = await realpath(rootPath);
  const search = searchText.trim().toLocaleLowerCase();
  const entries: {
    path: string;
    name: string;
    kind: "file" | "directory" | "symlink";
    size: number | null;
  }[] = [];
  let truncated = false;

  async function visit(directory: string): Promise<void> {
    if (
      entries.length >= MAX_TREE_ENTRIES ||
      (search !== "" && entries.length >= 500)
    ) {
      truncated = true;
      return;
    }
    const handle = await opendir(directory);
    for await (const entry of handle) {
      if (entry.name === ".git") continue;
      const absolute = resolve(directory, entry.name);
      const displayPath = relative(root, absolute).split(sep).join("/");
      const kind = entry.isSymbolicLink()
        ? "symlink"
        : entry.isDirectory()
          ? "directory"
          : "file";
      if (search === "" || displayPath.toLocaleLowerCase().includes(search)) {
        let size: number | null = null;
        if (kind === "file") {
          try {
            size = (await stat(absolute)).size;
          } catch {
            size = null;
          }
        }
        entries.push({ path: displayPath, name: entry.name, kind, size });
      }
      if (entry.isDirectory()) await visit(absolute);
      if (
        entries.length >= MAX_TREE_ENTRIES ||
        (search !== "" && entries.length >= 500)
      ) {
        truncated = true;
        break;
      }
    }
  }

  await visit(root);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return FileTreeResponseSchema.parse({ entries, truncated });
}

function languageFor(path: string): string | null {
  const extension = extname(path).slice(1).toLowerCase();
  const known: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    py: "python",
    rs: "rust",
    go: "go",
    sh: "shell",
    yml: "yaml",
    yaml: "yaml",
  };
  return known[extension] ?? (extension === "" ? null : extension);
}

export async function previewProjectFile(
  rootPath: string,
  rawRelativePath: unknown,
) {
  const resolved = await resolveContained(rootPath, rawRelativePath);
  const info = await stat(resolved.target);
  if (!info.isFile()) throw new Error("file_not_regular");
  const handle = await open(resolved.target, "r");
  try {
    const capacity =
      Math.min(info.size, MAX_PREVIEW_BYTES) +
      (info.size > MAX_PREVIEW_BYTES ? 0 : 1);
    const buffer = Buffer.alloc(capacity);
    const result = await handle.read(buffer, 0, capacity, 0);
    const bytes = buffer.subarray(0, result.bytesRead);
    const binary = bytes.includes(0);
    let content = "";
    if (!binary) {
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return FilePreviewResponseSchema.parse({
          path: resolved.relativePath,
          language: languageFor(resolved.relativePath),
          content: "",
          binary: true,
          truncated: info.size > MAX_PREVIEW_BYTES,
        });
      }
    }
    return FilePreviewResponseSchema.parse({
      path: resolved.relativePath,
      language: languageFor(resolved.relativePath),
      content,
      binary,
      truncated: info.size > MAX_PREVIEW_BYTES,
    });
  } finally {
    await handle.close();
  }
}

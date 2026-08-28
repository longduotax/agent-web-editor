import type { JSX } from "react";

/**
 * The path in a tab header, in two pieces.
 *
 * One piece, and the header wrapped it: `text-overflow: ellipsis` is inert
 * while `white-space` computes to `normal`, so at the panel's 280px floor the
 * path rendered one character per line in a 10px column and the header grew
 * from 24px to 107px — 83px of the file's own reading area, spent on saying
 * nothing (J1). The stylesheet nowraps it; this splits it so the ellipsis
 * falls where it costs least.
 *
 * Which end is kept is a judgement about paths: `docs/product-specs/…` names
 * a hundred files and `…/workspace-panel.md` names one, so the directories
 * are what shrinks and the file name is what survives. The whole path is on
 * the element's tooltip either way, and the two spans read as one string, so
 * neither the accessible name nor a text selection notices the split.
 *
 * Shared by the File and Diff tabs rather than written twice: the Diff tab's
 * header states a path too, and the defect J1 fixed is a property of the
 * markup, so a second copy of the markup is a second place for it to come
 * back. The class names keep the `file-` prefix they were fixed under, and
 * mean "the file this header is about" in both tabs.
 */
export function HeaderPath({ path }: { path: string }): JSX.Element {
  const cut = path.lastIndexOf("/");
  const directories = cut === -1 ? "" : path.slice(0, cut + 1);
  const name = cut === -1 ? path : path.slice(cut + 1);
  return (
    <span className="file-path" title={path}>
      {directories !== "" && (
        <span className="file-path-dir">{directories}</span>
      )}
      <span className="file-path-name">{name}</span>
    </span>
  );
}

/**
 * What a tab may present AS a workspace-relative path when it has no
 * server-normalized answer yet (J10).
 *
 * A tab restored at `../../../etc/hosts` is correctly refused by the read
 * boundary, and containment holds — but the header rendered exactly that
 * spelling in the place that means "the workspace-relative path of what you
 * are looking at", and Copy path was ready to put it on the clipboard. The
 * record is device-local storage, which any script on the origin can write.
 *
 * The caller validates the record against `RelativePathSchema` — the same
 * rule the read boundary parses with, imported rather than restated — and
 * passes null for anything it rejects, which lands here.
 */
export function UnknownPath(): JSX.Element {
  return (
    <span className="file-path">
      <span className="file-path-name">
        This tab&apos;s path is not a workspace path.
      </span>
    </span>
  );
}

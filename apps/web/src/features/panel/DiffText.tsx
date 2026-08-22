import type { JSX } from "react";

import { classifyDiff } from "../../components/diffLines.js";

/**
 * Added / removed / hunk-header lines coloured from theme tokens. The
 * `+`/`-` prefix characters stay in the text, so the distinction is never
 * carried by colour alone (WSP-06).
 */
export function DiffText({ text }: { text: string }): JSX.Element {
  return (
    <pre className="diff-text">
      {classifyDiff(text).map((line, index) => (
        <span
          className={`diff-line diff-${line.kind}`}
          key={`${String(index)}:${line.text}`}
        >
          {line.text}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

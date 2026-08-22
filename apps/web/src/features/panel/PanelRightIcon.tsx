import type { JSX } from "react";

/** The docked-right-column glyph, shared by every control that opens or
 * closes the workspace panel. */
export function PanelRightIcon(): JSX.Element {
  return (
    <svg className="panel-right-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2" />
      <path d="M9.25 2.75v10.5" />
    </svg>
  );
}

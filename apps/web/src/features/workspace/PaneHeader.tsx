import type { JSX, ReactNode } from "react";

import {
  PANE_STATUS_LABEL,
  PANE_STATUS_TOKEN,
  type PaneRunStatus,
} from "./runStatus.js";

export interface PaneHeaderProps {
  status: PaneRunStatus | null; // null on a new-chat/never-run pane -> no status shown
  elapsed: string | null; // elapsed timer text while running, else null
  title: string; // thread title, or "New chat" for a threadless pane
  projectLabel: string; // project/worktree chip text
  focused: boolean;
  // Optional quiet second line (workspace/branch context and the trust
  // notice). This is the pane's ONE header: nothing below it restates the
  // title, the run status, or the trust warning. It is clamped to a single
  // ellipsised line so it can never grow the header past --header-h;
  // `detailTitle` carries the full text as a tooltip so nothing is lost.
  detail?: ReactNode;
  detailTitle?: string | undefined;
  // Splits right (row); the keyboard offers both axes. The new pane is
  // always an empty New chat, never a second view of this thread. The
  // SHORTCUT rows say so now ("Split right into a new chat"); this button
  // still says only "Split" because App.test.tsx and ThreadPane.test.tsx
  // match its accessible name exactly and neither file is this
  // implementer's to edit. See the handoff in
  // .claude/loop/iteration-3/implementer-e2.md.
  onSplit(): void;
  onClose(): void;
}

export function PaneHeader(props: PaneHeaderProps): JSX.Element {
  const { status, elapsed, title, projectLabel, focused, detail, detailTitle } =
    props;

  return (
    <header className={`pane-head ${focused ? "focused" : "dim"}`}>
      <div className="pane-head-row">
        {status !== null && (
          <span className={`status ${PANE_STATUS_TOKEN[status]}`}>
            <span
              className={`sdot ${PANE_STATUS_TOKEN[status]}`}
              aria-hidden="true"
            />
            <span className="status-label">{PANE_STATUS_LABEL[status]}</span>
            {elapsed !== null && (
              <span className="status-elapsed">{`· ${elapsed}`}</span>
            )}
          </span>
        )}
        <h1 className="title">{title}</h1>
        <span className="repo">{projectLabel}</span>
        <span className="acts">
          <button
            type="button"
            className="icon-btn"
            aria-label="Split"
            title="Split"
            onClick={(event) => {
              event.stopPropagation();
              props.onSplit();
            }}
          >
            <svg
              className="ico ico-sm"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M12 3v18" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn danger"
            aria-label="Close"
            title="Close"
            onClick={(event) => {
              event.stopPropagation();
              props.onClose();
            }}
          >
            <svg
              className="ico ico-sm"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </span>
      </div>
      {detail !== undefined && detail !== null && (
        <div className="pane-head-detail" title={detailTitle}>
          {detail}
        </div>
      )}
    </header>
  );
}

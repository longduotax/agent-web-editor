import type { JSX } from "react";

import { PANE_STATUS_LABEL, PANE_STATUS_TOKEN, type PaneRunStatus } from "./runStatus.js";

export interface PaneHeaderProps {
  status: PaneRunStatus | null; // null on a new-chat/never-run pane -> no status shown
  elapsed: string | null; // elapsed timer text while running, else null
  title: string; // thread title, or "New chat" for a threadless pane
  projectLabel: string; // project/worktree chip text
  focused: boolean;
  onSplit(): void; // split right (row); keyboard still offers both axes
  onClose(): void;
}

export function PaneHeader(props: PaneHeaderProps): JSX.Element {
  const { status, elapsed, title, projectLabel, focused } = props;

  return (
    <header className={`pane-head ${focused ? "focused" : "dim"}`}>
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
      <span className="title">{title}</span>
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
    </header>
  );
}

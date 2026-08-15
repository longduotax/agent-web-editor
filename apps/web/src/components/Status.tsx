export function Status({
  state,
  unread,
}: {
  state: string | null;
  unread: boolean;
}) {
  if (state === "running")
    return (
      <span className="status status-running" aria-label="Running">
        <span aria-hidden="true">◌</span> Running
      </span>
    );
  if (state === "failed")
    return (
      <span className="status status-failed" aria-label="Failed">
        <span aria-hidden="true">!</span> Failed
      </span>
    );
  if (state === "interrupted")
    return (
      <span className="status" aria-label="Interrupted">
        <span aria-hidden="true">■</span> Interrupted
      </span>
    );
  if (unread)
    return (
      <span className="status status-unread" aria-label="Unread completion">
        <span aria-hidden="true">●</span> Unread
      </span>
    );
  return null;
}

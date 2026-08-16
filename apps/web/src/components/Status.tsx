export function Status({
  state,
  unread,
}: {
  state: string | null;
  unread: boolean;
}) {
  if (state === "running")
    return (
      <span
        className="status status-running"
        aria-label="Running"
        role="status"
      >
        <span className="status-spinner" aria-hidden="true" />
      </span>
    );
  if (state === "failed")
    return (
      <span className="status status-failed" aria-label="Failed" role="status">
        <span aria-hidden="true">!</span>
      </span>
    );
  if (state === "interrupted")
    return (
      <span className="status" aria-label="Interrupted" role="status">
        <span aria-hidden="true">■</span>
      </span>
    );
  if (unread)
    return (
      <span
        className="status status-unread"
        aria-label="Unread completion"
        role="status"
      >
        <span aria-hidden="true">●</span>
      </span>
    );
  return null;
}

import { ApiClientError } from "../api/client.js";

// The server refuses a request whose Host or Origin is not one of the
// loopback authorities it serves (its DNS-rebinding defence). Those two
// codes name an internal security mechanism, which is useless to the person
// looking at the screen and — worse — Retry can never clear them, so the UI
// used to loop forever on a message nobody could act on.
const ORIGIN_REFUSAL_CODES = new Set(["forbidden_request", "forbidden_host"]);

function isOriginRefusal(error: unknown): boolean {
  return (
    error instanceof ApiClientError && ORIGIN_REFUSAL_CODES.has(error.code)
  );
}

// Same path and port, on the canonical loopback address the server always
// accepts. Reading it from window.location keeps it correct on any port.
function loopbackUrl(): string {
  const port = window.location.port === "" ? "" : `:${window.location.port}`;
  return `http://127.0.0.1${port}${window.location.pathname}${window.location.search}`;
}

export function ErrorNotice({
  error,
  onRetry,
  onDismiss,
  context,
}: {
  error: unknown;
  // Supplied by callers that wrap a retryable request (a react-query
  // `refetch`, or a mutation's `mutate`). Without it the notice stays a
  // plain message, so non-retryable notices are unchanged.
  onRetry?: (() => void) | undefined;
  // Supplied by callers whose failure is not tied to a retryable mutation the
  // user still wants -- an abandoned folder browse, say. Without it a red
  // `role="alert"` block sat permanently in the primary navigation for an
  // action the user had already given up on, clearable only by a reload. A
  // notice that offers Retry needs no dismiss: acting on it clears it.
  onDismiss?: (() => void) | undefined;
  // What the app was doing, e.g. `Could not archive "Nightly build"`. Kept
  // INSIDE the alert so assistive technology announces the subject along with
  // the reason: several of these can be on screen at once (one per failed
  // archive) and a bare "worktree is locked" names nothing.
  context?: string | undefined;
}) {
  const prefix = context === undefined ? "" : `${context}: `;
  const dismiss =
    onDismiss === undefined ? null : (
      <button
        type="button"
        className="error-notice-dismiss"
        aria-label="Dismiss this message"
        onClick={onDismiss}
      >
        <span aria-hidden="true">✕</span>
      </button>
    );
  if (isOriginRefusal(error)) {
    const target = loopbackUrl();
    return (
      <div className="error-notice" role="alert">
        <span className="error-notice-message">
          {`${prefix}The workspace server refused this request because the page is open at ${window.location.host}. It only serves loopback addresses. Open the workspace at `}
          <a className="error-notice-link" href={target}>
            {target}
          </a>
          {" and try again."}
        </span>
        {dismiss}
      </div>
    );
  }
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  return (
    <div className="error-notice" role="alert">
      <span className="error-notice-message">{`${prefix}${message}`}</span>
      {onRetry !== undefined && (
        <button type="button" className="error-notice-retry" onClick={onRetry}>
          Retry
        </button>
      )}
      {dismiss}
    </div>
  );
}

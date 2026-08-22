import { useEffect, useRef, type JSX } from "react";

export interface UndoToastProps {
  message: string;
  onUndo(): void;
  onDismiss(): void; // fired once when timeoutMs elapses without Undo
  timeoutMs?: number; // default 6000
  // Accessible name for the Undo button. Several toasts can be on screen at
  // once (one per staged archive), and "Undo" repeated N times names nothing.
  undoLabel?: string | undefined;
}

const DEFAULT_TIMEOUT_MS = 6000;

export function UndoToast(props: UndoToastProps): JSX.Element {
  const { message, timeoutMs = DEFAULT_TIMEOUT_MS, undoLabel } = props;

  // Always-fresh reference so the timer effect below (which intentionally
  // only depends on timeoutMs, not the callback identity) never fires a
  // stale onDismiss. Read via `props.onDismiss`/`props.onUndo` (not
  // destructured) since the interface declares them with method shorthand.
  const propsRef = useRef(props);
  propsRef.current = props;
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    timerRef.current = window.setTimeout(() => {
      propsRef.current.onDismiss();
    }, timeoutMs);
    return () => {
      window.clearTimeout(timerRef.current);
    };
  }, [timeoutMs]);

  const handleUndo = () => {
    // Stop the pending dismiss so it never fires after Undo, regardless of
    // whether the parent unmounts this toast synchronously in response.
    window.clearTimeout(timerRef.current);
    propsRef.current.onUndo();
  };

  return (
    <div className="undo-toast" role="status">
      <span className="undo-toast-message">{message}</span>
      <button
        type="button"
        className="undo-toast-button"
        aria-label={undoLabel}
        onClick={handleUndo}
      >
        Undo
      </button>
    </div>
  );
}

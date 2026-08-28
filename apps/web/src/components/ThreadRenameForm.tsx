import { useId, useRef, useState } from "react";

export interface ThreadRenameFormProps {
  /** The authoritative title to restore when this edit is abandoned. */
  initialValue: string;
  /** Accessible name for the field, e.g. `Rename Nightly build`. */
  label: string;
  /** Persist a normalized, changed title. The editor stays open on rejection. */
  onCommit(value: string): Promise<void>;
  /** Exit without writing and render the authoritative title again. */
  onRevert(): void;
}

function renameErrorMessage(error: unknown): string {
  const reason =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  return `Could not rename this thread: ${reason}`;
}

/**
 * The shared one-row thread-title editor used by the sidebar and pane header.
 *
 * There is deliberately no accept/cancel action row. Enter or focus leaving
 * the editor commits; Escape or the one trailing Revert control abandons it.
 * Revert remains a real pointer target, and keeping it inside the form makes a
 * focus move from the input to that button an internal move rather than a
 * blur-save. Preventing pointer-down preserves input focus until Revert's click
 * runs on browsers that report no relatedTarget for that transition.
 */
export function ThreadRenameForm(props: ThreadRenameFormProps) {
  const [draft, setDraft] = useState(props.initialValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const selectedInitialValue = useRef(false);
  const errorId = useId();

  const revert = () => {
    if (pendingRef.current) return;
    props.onRevert();
  };

  const commit = async () => {
    if (pendingRef.current) return;
    const title = draft.trim();
    if (title === "") {
      setError("Title cannot be empty.");
      return;
    }
    if (title === props.initialValue) {
      props.onRevert();
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await props.onCommit(title);
    } catch (caught) {
      setError(renameErrorMessage(caught));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <form
      className="thread-rename"
      onSubmit={(event) => {
        event.preventDefault();
        void commit();
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        void commit();
      }}
    >
      <input
        type="text"
        aria-label={props.label}
        aria-invalid={error === null ? undefined : "true"}
        aria-describedby={error === null ? undefined : errorId}
        dir="auto"
        autoFocus
        maxLength={200}
        spellCheck={false}
        readOnly={pending}
        value={draft}
        onFocus={(event) => {
          if (selectedInitialValue.current) return;
          selectedInitialValue.current = true;
          event.currentTarget.select();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            revert();
            return;
          }
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void commit();
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error !== null) setError(null);
        }}
      />
      <button
        type="button"
        className="thread-rename-revert"
        aria-label={pending ? "Saving title" : "Revert title"}
        title={pending ? "Saving title" : "Revert title"}
        disabled={pending}
        onPointerDown={(event) => {
          // Blur fires before click. Do not let it start a save that wins the
          // race against the explicit Revert instruction.
          event.preventDefault();
        }}
        onClick={revert}
      >
        <span
          className={pending ? "thread-rename-spinner" : undefined}
          aria-hidden="true"
        >
          {pending ? "" : "↶"}
        </span>
      </button>
      {error !== null && (
        <span className="thread-rename-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

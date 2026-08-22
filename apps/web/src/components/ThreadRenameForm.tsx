import { ErrorNotice } from "./ErrorNotice.js";
import { useAutoGrow } from "./useAutoGrow.js";

export interface ThreadRenameFormProps {
  /** The title being edited. Owned by the caller. */
  value: string;
  /** Accessible name for the field, e.g. `Rename Nightly build`. */
  label: string;
  pending: boolean;
  error: unknown;
  onChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
}

/**
 * The in-place thread rename field.
 *
 * It was a single-line `<input>` sharing a 227px sidebar row with a Save and
 * a Cancel button: 95px of field for a 52-character title, about twelve
 * characters visible, editing blind through a window narrower than the two
 * buttons beside it. Renaming exists precisely because generated titles are
 * bad, so doing it blind defeats the point.
 *
 * The field is a WRAPPING textarea that grows with its content, and it now
 * owns the whole row -- the buttons moved to a second line under it. That is
 * what makes the whole title visible at once rather than merely making the
 * window wider: a 52-character title occupies two short lines here instead of
 * scrolling through a twelve-character slot. Titles are still single-line
 * values, so Enter submits (it never inserts a newline) and pasted line
 * breaks collapse to spaces.
 *
 * Save and Cancel stay. Enter and Escape already worked and are named in the
 * hint, but a pointer-only user needs a target to hit, and a field that
 * commits on blur would turn every stray click into a rename.
 */
export function ThreadRenameForm(props: ThreadRenameFormProps) {
  const { value, label, pending, error } = props;
  const ref = useAutoGrow<HTMLTextAreaElement>(value);
  return (
    <form
      className="thread-rename"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <textarea
        ref={ref}
        aria-label={label}
        autoFocus
        rows={1}
        maxLength={200}
        spellCheck={false}
        value={value}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            props.onCancel();
            return;
          }
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          // Including Shift+Enter: a thread title has no second line, so
          // there is nothing for a newline to do but break the layout.
          event.preventDefault();
          props.onSubmit();
        }}
        onChange={(event) => {
          props.onChange(event.target.value.replace(/\s*[\r\n]+\s*/gu, " "));
        }}
      />
      <div className="thread-rename-actions">
        <span className="thread-rename-hint" aria-hidden="true">
          Enter saves · Esc cancels
        </span>
        <button type="submit" disabled={pending}>
          Save
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            props.onCancel();
          }}
        >
          Cancel
        </button>
      </div>
      {error !== null && error !== undefined && <ErrorNotice error={error} />}
    </form>
  );
}

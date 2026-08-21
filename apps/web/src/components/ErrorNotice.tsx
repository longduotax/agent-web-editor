export function ErrorNotice({ error }: { error: unknown }) {
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  return (
    <div className="error-notice" role="alert">
      {message}
    </div>
  );
}

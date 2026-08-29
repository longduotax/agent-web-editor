/* global document, localStorage */

// Keep this dependency-free and synchronous: production's CSP permits
// same-origin scripts but not inline scripts, and the theme must be selected
// before CSS paints the page.
try {
  const stored = JSON.parse(
    localStorage.getItem("pi-workspace:theme") || "null",
  );
  if (
    stored !== null &&
    typeof stored === "object" &&
    stored.version === 1 &&
    (stored.choice === "light" || stored.choice === "dark")
  ) {
    document.documentElement.setAttribute("data-theme", stored.choice);
  }
} catch {
  // A missing, malformed, or inaccessible preference falls back to System.
}

// Small DOM helpers shared by every screen.

// Escape a value before interpolating it into an HTML template string.
// Every `${...}` in screen markup must pass through this — it is the app's
// XSS boundary, and XSS is the one thing that could read the stored token.
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

let toastTimer;

/** Transient status message at the bottom of the viewport. */
export function showToast(message, kind = "info") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

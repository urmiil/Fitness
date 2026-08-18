// Motion helpers.
//
// Two rules govern everything here:
//   1. The final value is always in the markup. JS only animates *toward* what
//      is already correct, so a failed script or a reduced-motion preference
//      leaves a fully readable screen.
//   2. Animations start from the value the user was last shown, not from zero.
//      Screens re-render on every store change, and replaying a bar sweep from
//      empty after each logged food reads as a glitch rather than an update.

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");

export function prefersReducedMotion() {
  return REDUCED.matches;
}

// What each animated number last showed, keyed by caller-supplied string.
const lastShown = new Map();

/**
 * Record `value` for `key` and return what was there before (0 the first
 * time). Components call this while building markup so bars and counters can
 * animate from the previous state.
 */
export function trackValue(key, value) {
  const prev = lastShown.has(key) ? lastShown.get(key) : 0;
  lastShown.set(key, value);
  return prev;
}

const EASE = (t) => 1 - Math.pow(1 - t, 3);

/**
 * Roll every `[data-count-to]` element inside `root` from its data-count-from
 * to its data-count-to. Call right after setting innerHTML.
 */
export function countUp(root, { duration = 600 } = {}) {
  for (const el of root.querySelectorAll("[data-count-to]")) {
    const to = Number(el.dataset.countTo) || 0;
    const from = Number(el.dataset.countFrom) || 0;
    if (prefersReducedMotion() || from === to) {
      el.textContent = String(to);
      continue;
    }
    roll(el, from, to, duration);
  }
}

function roll(el, from, to, duration) {
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    el.textContent = String(Math.round(from + (to - from) * EASE(t)));
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

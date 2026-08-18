// Date helpers. Everything works on local-time YYYY-MM-DD strings — using
// toISOString() for "today" would be a bug: it's UTC, so an evening log in
// the US would land on tomorrow's date.

export function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function nowISO() {
  return new Date().toISOString();
}

/** "2026-08-17" -> "2026-08" */
export function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

/** "2026-01" -> "2025-12" */
export function prevMonthOf(ym) {
  let [y, m] = ym.split("-").map(Number);
  m -= 1;
  if (m === 0) { y -= 1; m = 12; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Whole days from a to b (positive when b is later). UTC math, no TZ drift. */
export function daysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

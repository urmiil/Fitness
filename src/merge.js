// Merge rules for reconciling local edits with the remote copy of a file
// when the same month file was edited from two machines. See spec section 5.
//
// - Union entries by `id`
// - On the same `id` in both, keep the one with the later `updatedAt`
// - Deletions are tombstones (`deleted: true` + `updatedAt`), never removed
//   outright, so a delete on one machine can't be undone by a stale copy
// - Weigh-ins are also keyed by `date` (one entry per date)

function newerWins(a, b) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a.updatedAt) >= new Date(b.updatedAt) ? a : b;
}

/**
 * Merge two arrays of records keyed by `id` (and optionally `date`).
 * @param {Array} remote
 * @param {Array} local
 * @param {{dateKeyed?: boolean}} [opts]
 */
export function mergeEntries(remote = [], local = [], opts = {}) {
  const byId = new Map();
  for (const r of remote) byId.set(r.id, r);
  for (const l of local) {
    const existing = byId.get(l.id);
    byId.set(l.id, newerWins(existing, l));
  }

  if (!opts.dateKeyed) {
    return [...byId.values()];
  }

  // Date-keyed: also collapse duplicates that share a date (possible when
  // the same day was logged with different client-generated ids on two
  // machines), keeping the newer one.
  const byDate = new Map();
  for (const entry of byId.values()) {
    const existing = byDate.get(entry.date);
    byDate.set(entry.date, newerWins(existing, entry));
  }
  return [...byDate.values()];
}

/** Filter out tombstoned entries for rendering. */
export function visibleOnly(entries = []) {
  return entries.filter((e) => !e.deleted);
}

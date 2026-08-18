// Sortable, collision-resistant IDs: a base36 timestamp (so IDs sort
// chronologically as strings) plus randomness from crypto.randomUUID(),
// with a short type prefix. IDs are stable and used as the merge key.

export function genId(prefix) {
  const time = Date.now().toString(36).padStart(9, "0");
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${time}${rand}`;
}

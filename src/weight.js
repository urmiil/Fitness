// Weight domain: one entry per date, stored in data/weight/YYYY-MM.json.
// All operations are local-first — they touch the localStorage cache and the
// dirty set; nothing here talks to the network (sync.js does that).

import { getCached, setCached, markDirty } from "./store.js";
import { genId } from "./id.js";
import { mergeEntries, visibleOnly } from "./merge.js";
import { monthOf, prevMonthOf, todayLocalISO, nowISO, daysBetween } from "./dates.js";
import { registerMonth, getManifest } from "./manifest.js";

export const weightPath = (ym) => `data/weight/${ym}.json`;
const skeleton = (ym) => ({ schemaVersion: 1, month: ym, entries: [] });
const byDateAsc = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

const KG_PER_LB = 0.45359237;

export function convertWeight(value, from, to) {
  if (from === to) return value;
  return from === "kg" ? value / KG_PER_LB : value * KG_PER_LB;
}

export function round1(v) {
  return Math.round(v * 10) / 10;
}

export function getWeightMonth(ym) {
  return getCached(weightPath(ym)) || skeleton(ym);
}

/** The live (non-tombstoned) entry for a date, or null. */
export function entryFor(date) {
  return visibleOnly(getWeightMonth(monthOf(date)).entries).find((e) => e.date === date) || null;
}

/** Log or update the weigh-in for a date. One entry per date, spec §4. */
export function upsertWeight({ date, weight, unit, note = "" }) {
  const ym = monthOf(date);
  const file = getWeightMonth(ym);
  const existing = file.entries.find((e) => e.date === date && !e.deleted);
  if (existing) {
    Object.assign(existing, { weight, unit, note, updatedAt: nowISO() });
  } else {
    file.entries.push({ id: genId("wt"), date, weight, unit, note, updatedAt: nowISO() });
  }
  file.entries.sort(byDateAsc);
  setCached(weightPath(ym), file);
  registerMonth("weight", ym);
  markDirty(weightPath(ym));
}

/** Tombstone the entry for a date so the delete survives a two-machine merge. */
export function deleteWeight(date) {
  const ym = monthOf(date);
  const file = getWeightMonth(ym);
  const entry = file.entries.find((e) => e.date === date && !e.deleted);
  if (!entry) return false;
  entry.deleted = true;
  entry.updatedAt = nowISO();
  setCached(weightPath(ym), file);
  markDirty(weightPath(ym));
  return true;
}

/** Visible entries from the last `days` days, newest first. */
export function recentEntries(days = 60) {
  const today = todayLocalISO();
  const months = [monthOf(today), prevMonthOf(monthOf(today))];
  if (days > 40) months.push(prevMonthOf(months[1]));
  const all = [];
  for (const ym of new Set(months)) {
    all.push(...visibleOnly(getWeightMonth(ym).entries));
  }
  return all
    .filter((e) => {
      const age = daysBetween(e.date, today);
      return age >= 0 && age <= days;
    })
    .sort((a, b) => byDateAsc(b, a));
}

/**
 * Every visible entry across every month file in the cache, newest first.
 * The manifest names the months; only ones already pulled contribute — the
 * history screens ask sync.js#ensureHistory to fill gaps, and re-render as
 * each month lands.
 */
export function allEntries() {
  const today = monthOf(todayLocalISO());
  const months = new Set([today, prevMonthOf(today), ...(getManifest().months.weight || [])]);
  const all = [];
  for (const ym of months) all.push(...visibleOnly(getWeightMonth(ym).entries));
  return all.sort((a, b) => byDateAsc(b, a));
}

/** Dashboard stats in the given display unit; null when nothing is logged. */
export function weightStats(displayUnit) {
  const entries = recentEntries(90);
  if (!entries.length) return null;
  const latest = entries[0];
  const latestVal = convertWeight(latest.weight, latest.unit || "lb", displayUnit);
  // Baseline: the most recent entry at least 7 days older than the latest.
  const baseline = entries.find((e) => daysBetween(e.date, latest.date) >= 7);
  const delta7 = baseline
    ? latestVal - convertWeight(baseline.weight, baseline.unit || "lb", displayUnit)
    : null;
  return { latest, latestVal, delta7, todayLogged: Boolean(entryFor(todayLocalISO())) };
}

/** Sync transform: reconcile our local month file with the remote copy. */
export function mergeWeightFile(remote, local) {
  return {
    schemaVersion: 1,
    month: local.month,
    entries: mergeEntries(remote?.entries || [], local.entries || [], { dateKeyed: true }).sort(byDateAsc),
  };
}

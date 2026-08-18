// Nutrition domain: food entries stored in data/nutrition/YYYY-MM.json.
//
// Note the extra nesting — the file holds days[], each with its own entries[].
// That is NOT the flat entries[] shape weight uses, so the merge has to run at
// two levels (see mergeNutritionFile at the bottom).
//
// Local-first, like weight.js: everything here touches the localStorage cache
// and the dirty set. Nothing in this file talks to the network (sync.js does).

import { getCached, setCached, markDirty } from "./store.js";
import { genId } from "./id.js";
import { mergeEntries, visibleOnly } from "./merge.js";
import { monthOf, prevMonthOf, todayLocalISO, nowISO } from "./dates.js";
import { registerMonth } from "./manifest.js";

export const nutritionPath = (ym) => `data/nutrition/${ym}.json`;

export const MEALS = ["breakfast", "lunch", "dinner", "snack"];

const skeleton = (ym) => ({ schemaVersion: 1, month: ym, days: [] });
const byDateAsc = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
// IDs lead with a base36 timestamp, so sorting by id is log order.
const byIdAsc = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Month files can be hand-edited; never trust a stored number's type. */
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** An unknown meal would otherwise render into no group at all. */
export function normalizeMeal(meal) {
  return MEALS.includes(meal) ? meal : "snack";
}

export function getNutritionMonth(ym) {
  return getCached(nutritionPath(ym)) || skeleton(ym);
}

function commit(ym, file) {
  setCached(nutritionPath(ym), file);
  registerMonth("nutrition", ym);
  markDirty(nutritionPath(ym));
}

function dayIn(file, date) {
  let day = file.days.find((d) => d.date === date);
  if (!day) {
    day = { date, entries: [] };
    file.days.push(day);
    file.days.sort(byDateAsc);
  }
  return day;
}

function liveEntry(file, date, id) {
  const day = file.days.find((d) => d.date === date);
  return day?.entries.find((e) => e.id === id && !e.deleted) || null;
}

/** Visible entries for a date, in the order they were logged. */
export function entriesFor(date) {
  const day = getNutritionMonth(monthOf(date)).days.find((d) => d.date === date);
  return day ? visibleOnly(day.entries).sort(byIdAsc) : [];
}

export function addFood({ date, name, meal, calories, protein, carbs, fat }) {
  const ym = monthOf(date);
  const file = getNutritionMonth(ym);
  const entry = {
    id: genId("fd"),
    name,
    meal: normalizeMeal(meal),
    calories: toNum(calories),
    protein: toNum(protein),
    carbs: toNum(carbs),
    fat: toNum(fat),
    updatedAt: nowISO(),
  };
  dayIn(file, date).entries.push(entry);
  commit(ym, file);
  return entry;
}

/** False when the entry is gone — e.g. a sync tombstoned it mid-edit. */
export function updateFood(date, id, { name, meal, calories, protein, carbs, fat }) {
  const ym = monthOf(date);
  const file = getNutritionMonth(ym);
  const entry = liveEntry(file, date, id);
  if (!entry) return false;
  Object.assign(entry, {
    name,
    meal: normalizeMeal(meal),
    calories: toNum(calories),
    protein: toNum(protein),
    carbs: toNum(carbs),
    fat: toNum(fat),
    updatedAt: nowISO(),
  });
  commit(ym, file);
  return true;
}

/** Tombstone, so the delete survives a merge with a stale copy (spec section 5). */
export function deleteFood(date, id) {
  const ym = monthOf(date);
  const file = getNutritionMonth(ym);
  const entry = liveEntry(file, date, id);
  if (!entry) return false;
  entry.deleted = true;
  entry.updatedAt = nowISO();
  commit(ym, file);
  return true;
}

/** Summed at render time. Daily totals are never stored (spec section 4). */
export function totals(entries = []) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of entries) {
    t.calories += toNum(e.calories);
    t.protein += toNum(e.protein);
    t.carbs += toNum(e.carbs);
    t.fat += toNum(e.fat);
  }
  return t;
}

/**
 * The last `limit` distinct foods by name, newest first — the one-tap re-add
 * list. Most days repeat the same foods, so this is the difference between
 * logging a meal in one tap and typing five fields (spec section 6).
 * Distinctness is case-insensitive: "Greek yogurt" and "greek yogurt" are the
 * same food and shouldn't burn two slots.
 */
export function recentFoods(limit = 20) {
  const ym = monthOf(todayLocalISO());
  const all = [];
  for (const m of new Set([ym, prevMonthOf(ym)])) {
    for (const day of getNutritionMonth(m).days) {
      for (const e of visibleOnly(day.entries)) all.push({ ...e, date: day.date });
    }
  }
  all.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return String(a.updatedAt) < String(b.updatedAt) ? 1 : -1;
  });

  const seen = new Map();
  for (const e of all) {
    const key = String(e.name || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.set(key, e);
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

/** Best guess from the clock, so the common case needs no meal tap. */
export function defaultMeal(now = new Date()) {
  const h = now.getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

/**
 * Sync transform: reconcile our local month file with the remote copy.
 * Two levels — union the day list by `date`, then union each day's entries by
 * `id` with the standard newer-wins/tombstone rules. Entries are NOT date-
 * keyed the way weigh-ins are: eating the same food twice in a day is normal.
 */
export function mergeNutritionFile(remote, local) {
  const byDate = new Map();
  for (const day of remote?.days || []) {
    byDate.set(day.date, { date: day.date, entries: [...(day.entries || [])] });
  }
  for (const day of local?.days || []) {
    const existing = byDate.get(day.date);
    byDate.set(day.date, {
      date: day.date,
      entries: mergeEntries(existing?.entries || [], day.entries || []),
    });
  }
  return {
    schemaVersion: 1,
    month: local.month,
    days: [...byDate.values()]
      .map((d) => ({ date: d.date, entries: d.entries.sort(byIdAsc) }))
      .sort(byDateAsc),
  };
}

// The exercise catalog (data/exercises.json) backs autocomplete on the workout
// screen. Its job is to stop one movement fragmenting into "Bench Press",
// "bench press" and "Benchpress": per-exercise history (Phase 5) is keyed by
// name, so a typo there is a silently lost PR.
//
// Unlike the month files this is one shared list, so the merge is a plain
// union by lowercased name — two machines each adding a movement must keep
// both.

import { getCached, setCached, markDirty } from "./store.js";

export const EXERCISES_PATH = "data/exercises.json";

const skeleton = () => ({ schemaVersion: 1, exercises: [] });

const key = (name) => String(name || "").trim().toLowerCase();
const byName = (a, b) => String(a.name).localeCompare(String(b.name));

export function getExerciseCatalog() {
  const cached = getCached(EXERCISES_PATH);
  return cached && Array.isArray(cached.exercises) ? cached : skeleton();
}

/** Catalog names, alphabetical — the datalist source. */
export function exerciseNames() {
  return getExerciseCatalog()
    .exercises.map((e) => String(e?.name || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function isKnownExercise(name) {
  const k = key(name);
  return k !== "" && getExerciseCatalog().exercises.some((e) => key(e?.name) === k);
}

/** Add a movement the user typed. No-op when the name is already known. */
export function addExerciseToCatalog(name, muscleGroup = "") {
  const clean = String(name || "").trim();
  if (!clean || isKnownExercise(clean)) return false;
  const file = getExerciseCatalog();
  file.exercises.push(muscleGroup ? { name: clean, muscleGroup } : { name: clean });
  file.exercises.sort(byName);
  setCached(EXERCISES_PATH, file);
  markDirty(EXERCISES_PATH);
  return true;
}

/**
 * Sync transform: union by lowercased name. Remote wins a tie so a
 * muscleGroup corrected on the other machine isn't reverted by our copy of
 * the seed list — the names themselves are identical either way.
 */
export function mergeExercises(remote, local) {
  const byKey = new Map();
  for (const e of local?.exercises || []) if (key(e?.name)) byKey.set(key(e.name), e);
  for (const e of remote?.exercises || []) if (key(e?.name)) byKey.set(key(e.name), e);
  return { schemaVersion: 1, exercises: [...byKey.values()].sort(byName) };
}

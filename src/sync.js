// Sync orchestration: push everything in the dirty set, pull remote months
// into the cache. The merge always runs inside writeFile's GET-merge-PUT, so
// a two-machine divergence reconciles instead of overwriting (spec section 5).

import { getDirtySet, getCached, setCached, clearDirty } from "./store.js";
import { writeFile, readFile, hasToken, permissionHint } from "./github.js";
import { mergeWeightFile, weightPath } from "./weight.js";
import { mergeNutritionFile, nutritionPath } from "./nutrition.js";
import { mergeWorkoutFile, workoutPath } from "./workouts.js";
import { EXERCISES_PATH, mergeExercises } from "./exercises.js";
import { MANIFEST_PATH, mergeManifest } from "./manifest.js";
import { SETTINGS_PATH } from "./settings.js";

// Every month-file domain: where its files live and how two copies reconcile.
// Adding a domain here is all that dirty-set routing and background refresh
// need — nothing else in this file is domain-aware.
const DOMAINS = {
  weight: { path: weightPath, merge: mergeWeightFile },
  nutrition: { path: nutritionPath, merge: mergeNutritionFile },
  workouts: { path: workoutPath, merge: mergeWorkoutFile },
};

function transformFor(path, local) {
  for (const [domain, { merge }] of Object.entries(DOMAINS)) {
    if (path.startsWith(`data/${domain}/`)) return (remote) => merge(remote, local);
  }
  if (path === MANIFEST_PATH) return (remote) => mergeManifest(remote, local);
  // The exercise catalog is one shared list, not a month file: union it, or a
  // movement added on the other machine disappears on our next push.
  if (path === EXERCISES_PATH) return (remote) => mergeExercises(remote, local);
  return () => local; // settings.json: scalar prefs, last write wins
}

/** Push every dirty file. Stops at the first failure so nothing is skipped silently. */
export async function syncAll() {
  if (!hasToken()) {
    return { ok: false, pushed: 0, message: "No token — add one in Settings to sync" };
  }
  const dirty = [...getDirtySet()];
  if (!dirty.length) return { ok: true, pushed: 0, message: "Nothing to sync" };

  let pushed = 0;
  for (const path of dirty) {
    const local = getCached(path);
    if (local == null) {
      clearDirty(path); // cache was reset out from under a stale dirty flag
      continue;
    }
    try {
      const written = await writeFile(path, transformFor(path, local), `Update ${path}`);
      setCached(path, written);
      clearDirty(path);
      pushed++;
    } catch (err) {
      return {
        ok: false,
        pushed,
        message: `Sync failed at ${path}: ${err.message}${permissionHint(err)}`,
      };
    }
  }
  return { ok: true, pushed, message: `Synced ${pushed} file${pushed === 1 ? "" : "s"}` };
}

/**
 * Pull a domain's month files into the cache, merging rather than replacing so
 * local unsynced edits (and tombstones) survive. No-ops silently when offline.
 */
async function refreshMonths(domain, months) {
  const { path, merge } = DOMAINS[domain];
  for (const ym of months) {
    const file = path(ym);
    try {
      const remote = await readFile(file);
      if (!remote) continue;
      const local = getCached(file);
      const merged = local ? merge(remote, local) : remote;
      if (JSON.stringify(merged) !== JSON.stringify(local)) setCached(file, merged);
    } catch {
      // Offline or unreachable — the cache stands.
    }
  }
}

export const refreshWeightMonths = (months) => refreshMonths("weight", months);
export const refreshNutritionMonths = (months) => refreshMonths("nutrition", months);
export const refreshWorkoutMonths = (months) => refreshMonths("workouts", months);

/**
 * Pull a whole-file singleton (settings, exercise catalog) into the cache.
 * Skipped while a local edit is waiting to be pushed, so a background refresh
 * can never clobber an unsynced change.
 */
async function refreshSingleton(path) {
  if (getDirtySet().has(path)) return;
  try {
    const remote = await readFile(path);
    if (remote && JSON.stringify(remote) !== JSON.stringify(getCached(path))) {
      setCached(path, remote);
    }
  } catch {
    // Offline — cached values stand.
  }
}

export const refreshSettings = () => refreshSingleton(SETTINGS_PATH);
export const refreshExercises = () => refreshSingleton(EXERCISES_PATH);

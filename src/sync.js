// Sync orchestration: push everything in the dirty set, pull remote months
// into the cache. The merge always runs inside writeFile's GET-merge-PUT, so
// a two-machine divergence reconciles instead of overwriting (spec §5).

import { getDirtySet, getCached, setCached, clearDirty } from "./store.js";
import { writeFile, readFile, hasToken } from "./github.js";
import { mergeWeightFile, weightPath } from "./weight.js";
import { MANIFEST_PATH, mergeManifest } from "./manifest.js";

const SETTINGS_PATH = "data/settings.json";

function transformFor(path, local) {
  if (path.startsWith("data/weight/")) return (remote) => mergeWeightFile(remote, local);
  if (path === MANIFEST_PATH) return (remote) => mergeManifest(remote, local);
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
      return { ok: false, pushed, message: `Sync failed at ${path}: ${err.message}` };
    }
  }
  return { ok: true, pushed, message: `Synced ${pushed} file${pushed === 1 ? "" : "s"}` };
}

/**
 * Pull weight months into the cache, merging rather than replacing so local
 * unsynced edits (and tombstones) survive. No-ops silently when offline.
 */
export async function refreshWeightMonths(months) {
  for (const ym of months) {
    const path = weightPath(ym);
    try {
      const remote = await readFile(path);
      if (!remote) continue;
      const local = getCached(path);
      const merged = local ? mergeWeightFile(remote, local) : remote;
      if (JSON.stringify(merged) !== JSON.stringify(local)) setCached(path, merged);
    } catch {
      // Offline or unreachable — the cache stands.
    }
  }
}

/** Pull settings unless a local edit is waiting to be pushed. */
export async function refreshSettings() {
  if (getDirtySet().has(SETTINGS_PATH)) return;
  try {
    const remote = await readFile(SETTINGS_PATH);
    if (remote && JSON.stringify(remote) !== JSON.stringify(getCached(SETTINGS_PATH))) {
      setCached(SETTINGS_PATH, remote);
    }
  } catch {
    // Offline — cached values stand.
  }
}

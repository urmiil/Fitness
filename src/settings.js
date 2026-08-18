// Settings live in the repo (data/settings.json) so units and targets follow
// the user between machines. The token is deliberately NOT in here — it never
// touches a repo file (see github.js).
//
// Read through these helpers rather than reaching for the cache key directly:
// three screens now depend on targets, and a file that hasn't synced yet (or
// was hand-edited) must still yield a complete object.

import { getCached } from "./store.js";

export const SETTINGS_PATH = "data/settings.json";

export const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  weightUnit: "lb",
  liftUnit: "lb",
  targets: { calories: 2400, protein: 180, carbs: 240, fat: 70 },
};

/** Cached settings, with every key guaranteed present. */
export function getSettings() {
  const cached = getCached(SETTINGS_PATH);
  if (!cached) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...cached,
    targets: { ...DEFAULT_SETTINGS.targets, ...(cached.targets || {}) },
  };
}

export function getTargets() {
  return getSettings().targets;
}

export function weightUnit() {
  return getSettings().weightUnit;
}

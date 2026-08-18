// manifest.json is the app's directory listing — the browser can't enumerate
// repo folders, so every month file that exists must be recorded here.

import { getCached, setCached, markDirty } from "./store.js";

export const MANIFEST_PATH = "data/manifest.json";

export function manifestSkeleton() {
  return { schemaVersion: 1, months: { weight: [], nutrition: [], workouts: [] } };
}

export function getManifest() {
  return getCached(MANIFEST_PATH) || manifestSkeleton();
}

/** Record that a month file exists for a domain; dirty only when it changed. */
export function registerMonth(domain, ym) {
  const manifest = getManifest();
  const list = manifest.months[domain] || (manifest.months[domain] = []);
  if (list.includes(ym)) return;
  list.push(ym);
  list.sort();
  setCached(MANIFEST_PATH, manifest);
  markDirty(MANIFEST_PATH);
}

/** Union of both sides' month lists — a month file never stops existing. */
export function mergeManifest(remote, local) {
  const out = manifestSkeleton();
  for (const src of [remote, local]) {
    if (!src?.months) continue;
    for (const [domain, months] of Object.entries(src.months)) {
      out.months[domain] = [...new Set([...(out.months[domain] || []), ...months])].sort();
    }
  }
  return out;
}

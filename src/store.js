// Minimal local-first cache: read-through localStorage, a dirty set of paths
// pending sync, and a plain subscribe/notify pub-sub. Domain-specific stores
// (weight, nutrition, workouts) build on this in later phases.

const CACHE_PREFIX = "fitness.cache.";
const DIRTY_KEY = "fitness.dirty";

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(path) {
  for (const fn of listeners) fn(path);
}

export function getCached(path) {
  const raw = localStorage.getItem(CACHE_PREFIX + path);
  return raw ? JSON.parse(raw) : null;
}

export function setCached(path, data) {
  localStorage.setItem(CACHE_PREFIX + path, JSON.stringify(data));
  notify(path);
}

export function getDirtySet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DIRTY_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveDirtySet(set) {
  localStorage.setItem(DIRTY_KEY, JSON.stringify([...set]));
}

export function markDirty(path) {
  const set = getDirtySet();
  set.add(path);
  saveDirtySet(set);
  notify("__dirty__");
}

export function clearDirty(path) {
  const set = getDirtySet();
  set.delete(path);
  saveDirtySet(set);
  notify("__dirty__");
}

export function dirtyCount() {
  return getDirtySet().size;
}

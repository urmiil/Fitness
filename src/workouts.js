// Workout domain: sessions stored in data/workouts/YYYY-MM.json.
//
// Shape (spec section 4): workouts[] is FLAT and keyed by id, so mergeEntries
// applies directly — this file is closer to weight.js than to nutrition.js.
// Several sessions per date are allowed, so it is deliberately NOT dateKeyed.
//
// Merge granularity: the *session* is the merge unit. Exercises and sets are
// fields inside a session record, not independently merged entries — every
// edit bumps the session's updatedAt and newer-wins picks one whole session.
// That is why dropping a set or an exercise splices instead of tombstoning:
// invariant 4 governs merged entries, and here an entry is a whole session.
// Deleting a session itself still tombstones.
//
// Local-first, like the other domains: nothing here touches the network.

import { getCached, setCached, markDirty } from "./store.js";
import { genId } from "./id.js";
import { mergeEntries, visibleOnly } from "./merge.js";
import { monthOf, prevMonthOf, todayLocalISO, nowISO } from "./dates.js";
import { registerMonth } from "./manifest.js";
import { convertWeight, round1 } from "./weight.js";
import { liftUnit } from "./settings.js";

export const workoutPath = (ym) => `data/workouts/${ym}.json`;

const skeleton = (ym) => ({ schemaVersion: 1, month: ym, workouts: [] });

/** Month files are hand-editable; never trust a stored number's type. */
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const key = (name) => String(name || "").trim().toLowerCase();
const unitOf = (u) => (u === "kg" ? "kg" : "lb");

// IDs lead with a base36 timestamp, so id order is the order things were
// logged.
const byIdAsc = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
const byDateThenId = (a, b) => (a.date === b.date ? byIdAsc(a, b) : a.date < b.date ? -1 : 1);
const byRecency = (a, b) => -byDateThenId(a, b);

export function getWorkoutMonth(ym) {
  const file = getCached(workoutPath(ym));
  return file && Array.isArray(file.workouts) ? file : skeleton(ym);
}

function commit(ym, file) {
  setCached(workoutPath(ym), file);
  registerMonth("workouts", ym);
  markDirty(workoutPath(ym));
}

function liveWorkout(file, id) {
  return file.workouts.find((w) => w.id === id && !w.deleted) || null;
}

/**
 * Run `mutate` against the live session, then stamp and persist it. Every
 * mutation funnels through here so the merge always sees a fresh updatedAt on
 * the record that changed. Returns whatever `mutate` returns, or null when the
 * session is gone (deleted on the other machine mid-edit) or the edit missed.
 */
function editSession(date, id, mutate) {
  const ym = monthOf(date);
  const file = getWorkoutMonth(ym);
  const workout = liveWorkout(file, id);
  if (!workout) return null;
  const result = mutate(workout);
  if (result === false) return null;
  workout.updatedAt = nowISO();
  commit(ym, file);
  return result;
}

/* ── Sessions ──────────────────────────────────────────────────────────── */

/** Visible sessions for a date, in the order they were started. */
export function workoutsFor(date) {
  return visibleOnly(getWorkoutMonth(monthOf(date)).workouts)
    .filter((w) => w.date === date)
    .sort(byIdAsc);
}

export function getWorkout(date, id) {
  return workoutsFor(date).find((w) => w.id === id) || null;
}

/** `exercises` is copied by name only — sets always start empty. */
export function createWorkout({ date, name, note = "", exercises = [] }) {
  const ym = monthOf(date);
  const file = getWorkoutMonth(ym);
  const workout = {
    id: genId("wk"),
    date,
    name: String(name || "").trim() || "Workout",
    note: String(note || ""),
    exercises: exercises
      .map((ex) => String(ex?.name || "").trim())
      .filter(Boolean)
      .map((exName) => ({ id: genId("ex"), name: exName, sets: [] })),
    updatedAt: nowISO(),
  };
  file.workouts.push(workout);
  file.workouts.sort(byDateThenId);
  commit(ym, file);
  return workout;
}

export function updateWorkout(date, id, { name, note }) {
  return Boolean(
    editSession(date, id, (w) => {
      if (name !== undefined) w.name = String(name).trim() || w.name;
      if (note !== undefined) w.note = String(note);
      return true;
    })
  );
}

/** Tombstone, so the delete survives a merge with a stale copy. */
export function deleteWorkout(date, id) {
  const ym = monthOf(date);
  const file = getWorkoutMonth(ym);
  const workout = liveWorkout(file, id);
  if (!workout) return false;
  workout.deleted = true;
  workout.updatedAt = nowISO();
  commit(ym, file);
  return true;
}

/**
 * Repeat last: a new session with the same name and the same exercise list.
 * Only the names carry over — each exercise's starting weight comes back
 * through defaultSet()'s history lookup, so nothing derived is stored
 * (spec section 4).
 */
export function startFromLast(date, name) {
  const prev = lastWorkoutNamed(name);
  return createWorkout({
    date,
    name: prev?.name || name,
    exercises: prev?.exercises || [],
  });
}

/* ── Exercises and sets ────────────────────────────────────────────────── */

export function exerciseIn(workout, exerciseId) {
  return (workout?.exercises || []).find((e) => e.id === exerciseId) || null;
}

export function addExercise(date, workoutId, name) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  return editSession(date, workoutId, (w) => {
    const exercise = { id: genId("ex"), name: clean, sets: [] };
    if (!w.exercises) w.exercises = [];
    w.exercises.push(exercise);
    return exercise;
  });
}

export function removeExercise(date, workoutId, exerciseId) {
  return Boolean(
    editSession(date, workoutId, (w) => {
      const i = (w.exercises || []).findIndex((e) => e.id === exerciseId);
      if (i < 0) return false;
      w.exercises.splice(i, 1);
      return true;
    })
  );
}

/** Normalize one set. `weight: 0` is bodyweight; `rpe` stays optional. */
function cleanSet({ weight, reps, unit, rpe }) {
  const set = {
    weight: Math.max(0, toNum(weight)),
    reps: Math.max(0, Math.round(toNum(reps))),
    unit: unitOf(unit),
  };
  const r = Number(rpe);
  if (Number.isFinite(r) && r > 0) set.rpe = Math.round(r * 10) / 10;
  return set;
}

export function addSet(date, workoutId, exerciseId, set) {
  return editSession(date, workoutId, (w) => {
    const ex = exerciseIn(w, exerciseId);
    if (!ex) return false;
    const made = cleanSet(set);
    if (!ex.sets) ex.sets = [];
    ex.sets.push(made);
    return made;
  });
}

export function updateSet(date, workoutId, exerciseId, index, set) {
  return Boolean(
    editSession(date, workoutId, (w) => {
      const ex = exerciseIn(w, exerciseId);
      if (!ex || !ex.sets || !ex.sets[index]) return false;
      ex.sets[index] = cleanSet(set);
      return true;
    })
  );
}

export function removeSet(date, workoutId, exerciseId, index) {
  return Boolean(
    editSession(date, workoutId, (w) => {
      const ex = exerciseIn(w, exerciseId);
      if (!ex || !ex.sets || !ex.sets[index]) return false;
      ex.sets.splice(index, 1);
      return true;
    })
  );
}

/* ── Derived values — computed here, never stored (spec section 4) ─────── */

export function exerciseVolume(exercise, unit = liftUnit()) {
  let total = 0;
  for (const s of exercise?.sets || []) {
    total += convertWeight(toNum(s.weight), unitOf(s.unit), unit) * toNum(s.reps);
  }
  return total;
}

/** Session volume: the sum of weight x reps across every set. */
export function volume(workout, unit = liftUnit()) {
  let total = 0;
  for (const ex of workout?.exercises || []) total += exerciseVolume(ex, unit);
  return total;
}

export function setCount(workout) {
  let n = 0;
  for (const ex of workout?.exercises || []) n += (ex.sets || []).length;
  return n;
}

/**
 * What the next set should be prefilled with (spec section 6 — five sets
 * should be five taps):
 *   1. the previous set of this exercise in this session
 *   2. otherwise the last session's top set of the same movement, so a
 *      repeated workout opens on working weight rather than at zero
 *   3. otherwise an empty bar at 8 reps
 */
export function defaultSet(workout, exercise, unit = liftUnit()) {
  const sets = exercise?.sets || [];
  const from = sets.length
    ? sets[sets.length - 1]
    : lastSetFor(exercise?.name, { excludeWorkoutId: workout?.id });
  return from ? setIn(from, unit) : { weight: 0, reps: 8, rpe: "", unit };
}

/**
 * A stored set expressed in `unit`. Sets keep the unit they were logged in, so
 * anything that puts one back into the logger has to convert — otherwise
 * switching to kg would prefill a kg field with a pound number.
 */
export function setIn(set, unit = liftUnit()) {
  return {
    weight: round1(convertWeight(toNum(set?.weight), unitOf(set?.unit), unit)),
    reps: toNum(set?.reps),
    rpe: set?.rpe ?? "",
    unit,
  };
}

/**
 * The heaviest set of the most recent session containing `name`. The top set
 * beats literally-the-last set, which is often a back-off or a drop set.
 */
export function lastSetFor(name, { excludeWorkoutId } = {}) {
  const k = key(name);
  if (!k) return null;
  for (const w of recentWorkouts()) {
    if (w.id === excludeWorkoutId) continue;
    for (const ex of w.exercises || []) {
      if (key(ex.name) !== k || !(ex.sets || []).length) continue;
      const top = ex.sets.reduce((best, s) => {
        const bw = toNum(best.weight);
        const sw = toNum(s.weight);
        return sw > bw || (sw === bw && toNum(s.reps) > toNum(best.reps)) ? s : best;
      });
      return { weight: toNum(top.weight), reps: toNum(top.reps), unit: unitOf(top.unit) };
    }
  }
  return null;
}

/* ── History lookups ───────────────────────────────────────────────────── */

function historyMonths(count = 3) {
  const months = [monthOf(todayLocalISO())];
  while (months.length < count) months.push(prevMonthOf(months[months.length - 1]));
  return [...new Set(months)];
}

/** Every visible session in the last `months` month files, newest first. */
export function recentWorkouts(months = 3) {
  const all = [];
  for (const ym of historyMonths(months)) all.push(...visibleOnly(getWorkoutMonth(ym).workouts));
  return all.sort(byRecency);
}

/** Distinct session names, newest first — the "start one of these" list. */
export function recentWorkoutNames(limit = 8) {
  const seen = new Map();
  for (const w of recentWorkouts()) {
    const k = key(w.name);
    if (!k || seen.has(k)) continue;
    seen.set(k, String(w.name).trim());
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

export function lastWorkoutNamed(name, { excludeId } = {}) {
  const k = key(name);
  if (!k) return null;
  return recentWorkouts().find((w) => key(w.name) === k && w.id !== excludeId) || null;
}

/** Sync transform: reconcile our local month file with the remote copy. */
export function mergeWorkoutFile(remote, local) {
  return {
    schemaVersion: 1,
    month: local.month,
    workouts: mergeEntries(remote?.workouts || [], local.workouts || []).sort(byDateThenId),
  };
}

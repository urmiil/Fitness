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
import { registerMonth, getManifest } from "./manifest.js";
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

/**
 * Every visible session across every cached month file, newest first. The
 * manifest names the months; only ones already in the cache contribute —
 * history views ask sync.js#ensureHistory to fill gaps and re-render as each
 * month lands.
 */
export function allWorkouts() {
  const now = monthOf(todayLocalISO());
  const months = new Set([now, prevMonthOf(now), ...(getManifest().months.workouts || [])]);
  const all = [];
  for (const ym of months) all.push(...visibleOnly(getWorkoutMonth(ym).workouts));
  return all.sort(byRecency);
}

/**
 * Epley estimate of a one-rep max — a render-time formula, never stored
 * (spec section 4). Returns 0 for bodyweight or repless sets, which callers
 * treat as "no estimate".
 */
export function est1RM(weight, reps) {
  const w = toNum(weight);
  const r = toNum(reps);
  if (w <= 0 || r <= 0) return 0;
  return r === 1 ? w : w * (1 + r / 30);
}

/** The session's best-scoring set: {name, weight, reps, unit} or null. */
export function topSet(workout, unit = liftUnit()) {
  let best = null;
  let bestScore = 0;
  for (const ex of workout?.exercises || []) {
    for (const s of ex.sets || []) {
      const conv = setIn(s, unit);
      const score = est1RM(conv.weight, conv.reps);
      if (score > bestScore) {
        bestScore = score;
        best = { name: String(ex.name || "").trim(), weight: toNum(s.weight), reps: toNum(s.reps), unit: unitOf(s.unit) };
      }
    }
  }
  return best;
}

/**
 * One ascending pass over every cached session, tracking each movement's best
 * set by estimated 1RM (in `unit`). Returns:
 *   records — one per movement: { name, best:{weight,reps,unit}|null, est,
 *             date, lastDate, sessions }, sorted best-estimate first (then
 *             most recently done, for bodyweight-only movements).
 *   prs     — the moments a movement's previous best was beaten (first-ever
 *             sessions don't count), newest first: { name, best, est, date,
 *             workoutId }.
 * All derived at render, per spec section 4.
 */
export function movementRecords(unit = liftUnit()) {
  const sessions = allWorkouts().slice().reverse(); // oldest -> newest
  const byKey = new Map();
  const prs = [];

  for (const w of sessions) {
    for (const ex of w.exercises || []) {
      const k = key(ex.name);
      if (!k) continue;
      let rec = byKey.get(k);
      if (!rec) {
        rec = { name: "", best: null, est: 0, date: null, lastDate: w.date, sessions: 0 };
        byKey.set(k, rec);
      }
      rec.sessions++;
      if (w.date > rec.lastDate) rec.lastDate = w.date;
      rec.name = String(ex.name).trim() || rec.name;

      // The session's best of this movement — one candidate per session, so a
      // 5x5 that beats history reads as one new best, not five.
      let candidate = null;
      let candidateScore = 0;
      for (const s of ex.sets || []) {
        const conv = setIn(s, unit);
        const score = est1RM(conv.weight, conv.reps);
        if (score > candidateScore) {
          candidateScore = score;
          candidate = { weight: toNum(s.weight), reps: toNum(s.reps), unit: unitOf(s.unit) };
        }
      }
      if (candidate && candidateScore > rec.est) {
        if (rec.est > 0) {
          prs.push({ name: rec.name, best: candidate, est: candidateScore, date: w.date, workoutId: w.id });
        }
        rec.est = candidateScore;
        rec.best = candidate;
        rec.date = w.date;
      }
    }
  }

  const records = [...byKey.values()].sort((a, b) => {
    if (a.est !== b.est) return b.est - a.est;
    return a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0;
  });
  return { records, prs: prs.reverse() };
}

/** Sync transform: reconcile our local month file with the remote copy. */
export function mergeWorkoutFile(remote, local) {
  return {
    schemaVersion: 1,
    month: local.month,
    workouts: mergeEntries(remote?.workouts || [], local.workouts || []).sort(byDateThenId),
  };
}

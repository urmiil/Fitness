// Cross-domain aggregation for the dashboard: the consistency heatmap, the
// last-7-days summary, and the activity feed. Everything here is derived from
// cached month files at render time (spec section 4 — nothing derived is ever
// stored), and nothing touches the network: screens ask sync.js#ensureHistory
// to pull missing months and re-render as each one lands.

import { todayLocalISO, addDays, weekdayOf, monthOf } from "./dates.js";
import { allEntries, convertWeight, round1 } from "./weight.js";
import { entriesByDate, totals, normalizeMeal } from "./nutrition.js";
import { allWorkouts, volume, setCount, movementRecords } from "./workouts.js";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The consistency grid: one cell per day over the last `weeks` ISO weeks
 * (Monday-first columns, current week last). A cell's level counts how many
 * domains were logged that day (0–3); days after today carry level -1.
 * `monthLabels[i]` names week column i when a new month starts there.
 */
export function heatmap(weeks = 16) {
  const today = todayLocalISO();
  const end = addDays(today, 6 - weekdayOf(today)); // Sunday closing this week
  const start = addDays(end, -(weeks * 7 - 1)); // a Monday

  const food = entriesByDate(start, today);
  const weighed = new Set();
  for (const e of allEntries()) {
    if (e.date >= start && e.date <= today) weighed.add(e.date);
  }
  const trained = new Set();
  for (const w of allWorkouts()) {
    if (w.date >= start && w.date <= today) trained.add(w.date);
  }

  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    cells.push({
      date,
      level:
        date > today
          ? -1
          : (weighed.has(date) ? 1 : 0) + (food.has(date) ? 1 : 0) + (trained.has(date) ? 1 : 0),
    });
  }

  const monthLabels = [];
  let lastMonth = "";
  for (let wk = 0; wk < weeks; wk++) {
    const ym = monthOf(addDays(start, wk * 7));
    monthLabels.push(ym === lastMonth ? "" : MONTH_SHORT[Number(ym.slice(5)) - 1]);
    lastMonth = ym;
  }

  return { cells, monthLabels, start };
}

/**
 * Streaks over the heatmap window. A day counts when anything at all was
 * logged; an empty *today* doesn't break the streak yet — the day isn't over.
 */
export function streakStats(cells) {
  const today = todayLocalISO();
  const logged = new Set();
  for (const c of cells) if (c.level > 0) logged.add(c.date);

  let current = 0;
  let d = logged.has(today) ? today : addDays(today, -1);
  while (logged.has(d)) {
    current++;
    d = addDays(d, -1);
  }

  let best = 0;
  let run = 0;
  for (const c of cells) {
    if (c.level > 0) best = Math.max(best, ++run);
    else if (c.level === 0) run = 0; // future cells don't reset a live run
  }

  const ym = monthOf(today);
  let monthLogged = 0;
  for (const c of cells) if (c.level > 0 && monthOf(c.date) === ym) monthLogged++;

  return { current, best: Math.max(best, current), monthLogged, monthDays: Number(today.slice(8)) };
}

/**
 * The last seven days, with the seven before them as the comparison:
 * per-day calories (null when nothing was logged), average intake on logged
 * days, sessions and total volume — each with a delta against the prior week
 * where the prior week has anything to compare against.
 */
export function weekSummary(liftU) {
  const today = todayLocalISO();
  const start = addDays(today, -6);
  const prevStart = addDays(today, -13);
  const food = entriesByDate(prevStart, today);

  const caloriesOn = (date) => {
    const entries = food.get(date);
    return entries ? totals(entries).calories : null;
  };

  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    days.push({ date, calories: caloriesOn(date) });
  }

  const avgOver = (from) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 7; i++) {
      const c = caloriesOn(addDays(from, i));
      if (c !== null) {
        sum += c;
        n++;
      }
    }
    return n ? sum / n : null;
  };
  const avg = avgOver(start);
  const prevAvg = avgOver(prevStart);

  const sessions = [];
  const prevSessions = [];
  for (const w of allWorkouts()) {
    if (w.date >= start && w.date <= today) sessions.push(w);
    else if (w.date >= prevStart && w.date < start) prevSessions.push(w);
  }
  const vol = sessions.reduce((sum, w) => sum + volume(w, liftU), 0);
  const prevVol = prevSessions.reduce((sum, w) => sum + volume(w, liftU), 0);

  return {
    days,
    avg,
    avgDelta: avg !== null && prevAvg !== null ? avg - prevAvg : null,
    workouts: sessions.length,
    workoutsDelta: prevSessions.length ? sessions.length - prevSessions.length : null,
    volume: vol,
    volumeDelta: prevVol > 0 ? vol - prevVol : null,
  };
}

/**
 * The newest happenings across all three domains, one list: weigh-ins, foods,
 * sessions, and the moments a movement's best was beaten. Ordered by
 * updatedAt, so it doubles as "what changed last" — including edits synced in
 * from the other machine.
 */
export function activityFeed(limit = 8, { weightU, liftU } = {}) {
  const events = [];
  const ts = (iso) => {
    const t = Date.parse(iso || "");
    return Number.isFinite(t) ? t : 0;
  };

  const weights = allEntries(); // newest first
  weights.slice(0, limit + 4).forEach((e, i) => {
    const prev = weights[i + 1];
    const val = convertWeight(Number(e.weight) || 0, e.unit || "lb", weightU);
    events.push({
      kind: "weight",
      ts: ts(e.updatedAt),
      date: e.date,
      value: round1(val),
      delta: prev ? round1(val - convertWeight(Number(prev.weight) || 0, prev.unit || "lb", weightU)) : null,
    });
  });

  const today = todayLocalISO();
  for (const [date, entries] of entriesByDate(addDays(today, -13), today)) {
    for (const e of entries) {
      events.push({
        kind: "food",
        ts: ts(e.updatedAt),
        date,
        name: String(e.name || ""),
        meal: normalizeMeal(e.meal),
        calories: Number(e.calories) || 0,
        protein: Number(e.protein) || 0,
      });
    }
  }

  const sessions = allWorkouts().slice(0, limit + 4);
  for (const w of sessions) {
    events.push({
      kind: "workout",
      ts: ts(w.updatedAt),
      date: w.date,
      name: String(w.name || ""),
      volume: volume(w, liftU),
      sets: setCount(w),
      unit: liftU,
    });
  }

  // A new best sorts just above its session, the way it happened.
  const { prs } = movementRecords(liftU);
  const byId = new Map(sessions.map((w) => [w.id, w]));
  for (const pr of prs.slice(0, limit)) {
    const w = byId.get(pr.workoutId);
    if (!w) continue;
    events.push({
      kind: "pr",
      ts: ts(w.updatedAt) + 1,
      date: pr.date,
      name: pr.name,
      best: pr.best,
      est: pr.est,
      unit: liftU,
    });
  }

  return events.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/** "3:41 pm" today, "yesterday" before that, then "Mon" / "Aug 12". */
export function feedWhen(tsMs) {
  if (!tsMs) return "";
  const then = new Date(tsMs);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (then >= dayStart) {
    return then.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase();
  }
  if (then >= new Date(dayStart.getTime() - 86400000)) return "yesterday";
  if (then >= new Date(dayStart.getTime() - 6 * 86400000)) {
    return then.toLocaleDateString(undefined, { weekday: "short" });
  }
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

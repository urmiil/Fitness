import { esc, int } from "../dom.js";
import { subscribe } from "../store.js";
import { weightStats, recentEntries, convertWeight, round1 } from "../weight.js";
import { entriesFor, totals } from "../nutrition.js";
import { workoutsFor, volume, setCount, topSet, movementRecords, est1RM } from "../workouts.js";
import { getTargets, weightUnit, liftUnit, SETTINGS_PATH } from "../settings.js";
import { todayLocalISO, daysBetween, addDays, monthOf } from "../dates.js";
import { MANIFEST_PATH } from "../manifest.js";
import { ensureHistory } from "../sync.js";
import { nutritionSummaryHtml } from "./nutrition-summary.js";
import { sparklineHtml } from "./sparkline.js";
import { countUp, trackValue } from "../anim.js";
import { hasToken } from "../github.js";
import { heatmap, streakStats, weekSummary, activityFeed, feedWhen } from "../insights.js";

const HEATMAP_WEEKS = 16;

/* Card-head icons: tiny stroke glyphs, dim so the mono numerals stay the
   loudest thing on the card. */
const IC = {
  scale: `<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 10a4 4 0 0 1 8 0"/><path d="M12 10l1.8-1.8"/></svg>`,
  food: `<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h16a8 8 0 0 1-16 0z"/><path d="M9 8c0-1.5 1-2 1-3.5"/><path d="M14 8c0-1.5 1-2 1-3.5"/></svg>`,
  lift: `<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7v10"/><path d="M18 7v10"/><path d="M3 9.5v5"/><path d="M21 9.5v5"/><path d="M6 12h12"/></svg>`,
  streak: `<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 9.5h18"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M9 15l2 2 4-4"/></svg>`,
  week: `<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-8"/><path d="M22 20H2"/></svg>`,
  pulse: `<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h4l3-8 4 16 3-8h6"/></svg>`,
  trophy: `<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 3"/><path d="M17 6h3a3 3 0 0 1-3 3"/></svg>`,
};

export function renderDashboard(root) {
  function draw() {
    const unit = weightUnit();
    const liftU = liftUnit();
    const today = todayLocalISO();
    const map = heatmap(HEATMAP_WEEKS);
    const streaks = streakStats(map.cells);
    const records = movementRecords(liftU);

    root.innerHTML = `
      <h1>Today</h1>
      <p class="date-line">${esc(longDate())}</p>

      <div class="grid-cards">
        ${weightCard(weightStats(unit), unit)}
        ${nutritionCard(entriesFor(today))}
        ${workoutCard(today, liftU, records)}
      </div>

      <div class="dash-band">
        ${consistencyCard(map, streaks)}
        ${weekCard(weekSummary(liftU), liftU, unit)}
      </div>

      <div class="dash-band">
        ${feedCard(unit, liftU)}
        ${recordsCard(records, liftU)}
      </div>

      ${
        hasToken()
          ? ""
          : `<p class="hint">No token set, so the app stays local &mdash; entries queue up in the
             badge and push once a token is added in <a href="#/settings">Settings</a>.</p>`
      }
    `;

    countUp(root);
    // Newest weeks in view when the heatmap has to scroll (narrow screens).
    const scroller = root.querySelector(".hm-scroll");
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }

  const unsub = subscribe((path) => {
    if (typeof path !== "string") return;
    if (path === MANIFEST_PATH) {
      // A fresher month index may name history we haven't pulled yet.
      ensureHistory(["weight", "nutrition", "workouts"], historySince());
      draw();
      return;
    }
    if (
      path.startsWith("data/weight/") ||
      path.startsWith("data/nutrition/") ||
      path.startsWith("data/workouts/") ||
      path === SETTINGS_PATH
    ) {
      draw();
    }
  });

  // The heatmap and records read further back than the two months the startup
  // refresh covers — pull whatever the manifest lists for the window.
  ensureHistory(["weight", "nutrition", "workouts"], historySince());
  draw();
  return unsub;
}

function historySince() {
  return monthOf(addDays(todayLocalISO(), -(HEATMAP_WEEKS * 7)));
}

/* ── Band 1: today's three cards ───────────────────────────────────────── */

function weightCard(stats, unit) {
  if (!stats) {
    return `
      <div class="card vcard rise" style="--rise-i:0">
        <div class="card-head"><h2 class="card-title">${IC.scale}Weight</h2></div>
        <div class="empty-state">No weigh-ins yet.</div>
        <div class="btn-row"><a class="btn primary btn-link" href="#/weight">Log weight</a></div>
      </div>`;
  }

  const shown = round1(stats.latestVal);
  const prev = trackValue("dash:weight", shown);
  const delta = stats.delta7;

  return `
    <div class="card vcard rise" style="--rise-i:0">
      <div class="card-head">
        <h2 class="card-title">${IC.scale}Weight</h2>
        <span class="pill${stats.todayLogged ? " hit" : " muted"}">${
          stats.todayLogged ? "&#10003; logged today" : "not logged today"
        }</span>
      </div>
      <div class="hero">
        <div class="hero-figure">
          <span class="hero-value num" data-count-from="${whole(prev)}" data-count-to="${whole(shown)}">${whole(shown)}</span><span class="hero-frac num">${frac(shown)}</span>
          <span class="hero-unit">${esc(unit)}</span>
        </div>
        <div class="hero-meta">
          <span class="delta-pill num${delta === null ? " muted" : ""}">${
            delta === null ? "&mdash;" : `${delta > 0 ? "&#9650;" : delta < 0 ? "&#9660;" : ""} ${Math.abs(round1(delta)).toFixed(1)}`
          }</span>
          <span class="hero-sub">7-day${delta === null ? " &mdash; needs a week of logs" : ` change in ${esc(unit)}`}</span>
        </div>
      </div>
      ${trendHtml(unit)}
      <div class="btn-row"><a class="btn primary btn-link" href="#/weight">Log weight</a></div>
    </div>`;
}

function nutritionCard(food) {
  return `
    <div class="card vcard rise" style="--rise-i:1">
      <div class="card-head">
        <h2 class="card-title">${IC.food}Nutrition</h2>
        <span class="pill${food.length ? "" : " muted"}">${food.length} item${food.length === 1 ? "" : "s"}</span>
      </div>
      ${nutritionSummaryHtml(totals(food), getTargets(), { keyPrefix: "dash" })}
      <div class="btn-row"><a class="btn primary btn-link" href="#/food">Log food</a></div>
    </div>`;
}

/** Spec section 6: whether a workout was logged today, its name and volume —
 *  plus the day's best set, flagged when it beat that movement's history.
 *  Everything is summed at render — nothing derived is stored. */
function workoutCard(today, liftU, records) {
  const sessions = workoutsFor(today);
  if (!sessions.length) {
    return `
      <div class="card vcard rise" style="--rise-i:2">
        <div class="card-head">
          <h2 class="card-title">${IC.lift}Workout</h2>
          <span class="pill muted">not logged today</span>
        </div>
        <div class="empty-state">No session yet today.</div>
        <div class="btn-row"><a class="btn primary btn-link" href="#/workout">Start a workout</a></div>
      </div>`;
  }

  const vol = int(sessions.reduce((sum, w) => sum + volume(w, liftU), 0));
  const prev = trackValue("dash:volume", vol);
  const sets = sessions.reduce((n, w) => n + setCount(w), 0);
  const label = sessions.length === 1 ? sessions[0].name : `${sessions.length} sessions`;

  const score = (s) => est1RM(convertWeight(s.weight, s.unit, liftU), s.reps);
  const best = sessions
    .map((w) => topSet(w, liftU))
    .filter(Boolean)
    .sort((a, b) => score(b) - score(a))[0];
  const isPr = best && records.prs.some((p) => p.date === today && sameName(p.name, best.name));

  return `
    <div class="card vcard rise" style="--rise-i:2">
      <div class="card-head">
        <h2 class="card-title">${IC.lift}Workout</h2>
        <span class="pill hit">&#10003; logged today</span>
      </div>
      <div class="hero compact">
        <div class="hero-figure">
          <span class="hero-value num" data-count-from="${prev}" data-count-to="${vol}">${vol}</span>
          <span class="hero-unit">${esc(liftU)} volume</span>
        </div>
        <div class="hero-meta">
          <span class="delta-pill num${sets ? "" : " muted"}">${sets} set${sets === 1 ? "" : "s"}</span>
          <span class="hero-sub">${esc(label)}</span>
        </div>
      </div>
      ${
        best
          ? `<div class="hero-foot">
              <span class="trend-label">Top set</span>
              <span class="num" style="font-weight:700">${esc(best.name)} ${setText(best)}</span>
              ${isPr ? `<span class="pr-flag">&#9650; new best</span>` : ""}
            </div>`
          : ""
      }
      <div class="btn-row"><a class="btn primary btn-link" href="#/workout">Log sets</a></div>
    </div>`;
}

/* ── Band 2: consistency + the week ────────────────────────────────────── */

function consistencyCard(map, streaks) {
  const prevStreak = trackValue("dash:streak", streaks.current);
  const cells = map.cells
    .map((c) => {
      if (c.level < 0) return `<i class="lx"></i>`;
      const lv = Math.min(3, c.level);
      return `<i${lv ? ` class="l${lv}"` : ""} title="${esc(c.date)} &mdash; ${lv} of 3 logged"></i>`;
    })
    .join("");
  const months = map.monthLabels.map((m) => `<span>${esc(m)}</span>`).join("");

  return `
    <div class="card rise" style="--rise-i:3">
      <div class="card-head">
        <h2 class="card-title">${IC.streak}Consistency</h2>
        <span class="pill${streaks.current > 1 ? " hit" : ""}">${int(streaks.current)}-day streak</span>
      </div>
      <div class="hm-row">
        <div class="hm-cal">
          <div class="hm-scroll">
            <div class="hm-days"><span></span><span>Tue</span><span></span><span>Thu</span><span></span><span>Sat</span><span></span></div>
            <div>
              <div class="hm-grid">${cells}</div>
              <div class="hm-months">${months}</div>
            </div>
          </div>
          <div class="hm-legend"><span>Logged nothing</span><i></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><span>weight + food + workout</span></div>
        </div>
        <div class="hm-stats">
          <div class="hm-stat"><div class="v num"><span data-count-from="${int(prevStreak)}" data-count-to="${int(streaks.current)}">${int(streaks.current)}</span> <small>day${streaks.current === 1 ? "" : "s"}</small></div><div class="k">Current streak</div></div>
          <div class="hm-stat"><div class="v num">${int(streaks.best)} <small>day${streaks.best === 1 ? "" : "s"}</small></div><div class="k">Best streak</div></div>
          <div class="hm-stat"><div class="v num">${int(streaks.monthLogged)} <small>of ${int(streaks.monthDays)}</small></div><div class="k">Days logged in ${esc(monthName())}</div></div>
        </div>
      </div>
    </div>`;
}

function weekCard(week, liftU, unit) {
  const target = int(getTargets().calories);
  const scale = Math.max(target, ...week.days.map((d) => d.calories || 0), 1);
  const H = 104;
  const today = todayLocalISO();

  const bars = week.days
    .map((d) => {
      const none = d.calories === null;
      const h = none ? 2 : Math.max(3, Math.round((d.calories / scale) * H));
      const cls = none ? "wb none" : d.date === today ? "wb today" : "wb";
      return `<div class="${cls}" title="${esc(d.date)}${none ? "" : ` &mdash; ${int(d.calories)} kcal`}"><i style="height:${int(h)}px"></i></div>`;
    })
    .join("");
  const dayLetters = week.days
    .map((d) => `<span>${esc(letterOf(d.date))}</span>`)
    .join("");

  const deltaTxt = (v, fmt) =>
    v === null ? "&mdash;" : v === 0 ? "&plusmn;0" : `${v > 0 ? "&#9650;" : "&#9660;"} ${fmt(Math.abs(v))}`;

  const stats = weightStats(unit);
  const wDelta = stats?.delta7 ?? null;

  return `
    <div class="card rise" style="--rise-i:4">
      <div class="card-head">
        <h2 class="card-title">${IC.week}Last 7 days</h2>
        <span class="pill num">${esc(shortDate(week.days[0].date))} &ndash; ${esc(shortDate(today))}</span>
      </div>
      <div class="week-bars">
        ${target > 0 ? `<div class="wb-target" style="bottom:${int(Math.min(H, (target / scale) * H))}px"><span class="num">target ${target}</span></div>` : ""}
        ${bars}
      </div>
      <div class="wb-days">${dayLetters}</div>
      <div class="wk-lines">
        <div class="wk-line"><span class="k">Avg intake</span><span class="v num">${
          week.avg === null ? "&mdash;" : int(week.avg).toLocaleString()
        }</span><span class="d num">${deltaTxt(week.avgDelta === null ? null : Math.round(week.avgDelta), (n) => int(n))}</span></div>
        <div class="wk-line"><span class="k">Workouts</span><span class="v num">${int(week.workouts)}</span><span class="d num">${deltaTxt(
          week.workoutsDelta,
          (n) => int(n)
        )}</span></div>
        <div class="wk-line"><span class="k">Volume</span><span class="v num">${int(week.volume).toLocaleString()} ${esc(liftU)}</span><span class="d num">${
          week.volumeDelta === null ? "&mdash;" : deltaTxt(week.volumeDelta, (n) => int(n).toLocaleString())
        }</span></div>
        <div class="wk-line"><span class="k">Weight</span><span class="v num">${
          wDelta === null ? "&mdash;" : `${wDelta > 0 ? "&#9650;" : wDelta < 0 ? "&#9660;" : "&plusmn;"} ${Math.abs(round1(wDelta)).toFixed(1)} ${esc(unit)}`
        }</span><span class="d"></span></div>
      </div>
    </div>`;
}

/* ── Band 3: activity + records ────────────────────────────────────────── */

function feedCard(unit, liftU) {
  const events = activityFeed(8, { weightU: unit, liftU });

  const rows = events
    .map((ev) => {
      if (ev.kind === "weight") {
        return feedRow(
          IC.scale,
          `Weigh-in &mdash; <span class="num">${round1(ev.value).toFixed(1)} ${esc(unit)}</span>`,
          ev.delta === null
            ? esc(ev.date)
            : `${ev.delta > 0 ? "&#9650;" : ev.delta < 0 ? "&#9660;" : "&plusmn;"} ${Math.abs(ev.delta).toFixed(1)} vs previous`,
          ev.ts
        );
      }
      if (ev.kind === "food") {
        return feedRow(
          IC.food,
          `${esc(mealName(ev.meal))} &mdash; ${esc(ev.name)}`,
          `${int(ev.calories)} kcal${ev.protein ? ` &middot; ${int(ev.protein)} p` : ""}`,
          ev.ts
        );
      }
      if (ev.kind === "pr") {
        return feedRow(
          IC.trophy,
          `New best &mdash; ${esc(ev.name)} <span class="num">${setText(ev.best)}</span>`,
          `est 1RM ${int(ev.est)} ${esc(ev.unit)}`,
          ev.ts,
          true
        );
      }
      return feedRow(
        IC.lift,
        `${esc(ev.name)} logged`,
        `<span class="num">${int(ev.volume).toLocaleString()} ${esc(ev.unit)} &middot; ${int(ev.sets)} set${ev.sets === 1 ? "" : "s"}</span>`,
        ev.ts
      );
    })
    .join("");

  return `
    <div class="card rise" style="--rise-i:5">
      <div class="card-head"><h2 class="card-title">${IC.pulse}Recent activity</h2></div>
      ${rows || `<div class="empty-state">Nothing logged yet &mdash; the last few entries across weight, food and workouts land here.</div>`}
    </div>`;
}

function feedRow(icon, main, sub, ts, win = false) {
  return `<div class="feed-row">
    <span class="feed-ic${win ? " win" : ""}">${icon}</span>
    <span class="feed-main">${main}<small class="num">${sub}</small></span>
    <span class="feed-time num">${esc(feedWhen(ts))}</span>
  </div>`;
}

function recordsCard(records, liftU) {
  const rows = records.records
    .filter((r) => r.est > 0)
    .slice(0, 5)
    .map(
      (r) => `<div class="pr-row">
        <span class="pr-name">${esc(r.name)}</span>
        <span class="pr-set num">${setText(r.best)} &middot; ${esc(shortDate(r.date))}</span>
        <span class="pr-1rm num">${int(r.est)}<small>${esc(liftU)}</small></span>
      </div>`
    )
    .join("");

  return `
    <div class="card vcard rise" style="--rise-i:6">
      <div class="card-head">
        <h2 class="card-title">${IC.trophy}Records</h2>
        <span class="pill">est 1RM</span>
      </div>
      ${rows || `<div class="empty-state">Records appear once sets are logged &mdash; best set per movement, estimated 1RM.</div>`}
      ${rows ? `<p class="hint">Estimated with Epley from your best logged set per movement.</p>` : ""}
    </div>`;
}

/* ── Shared bits ───────────────────────────────────────────────────────── */

/** Last 30 days of weigh-ins as a sparkline, spaced by real date gaps. */
function trendHtml(unit) {
  const today = todayLocalISO();
  const points = recentEntries(30)
    .map((e) => ({
      t: -daysBetween(e.date, today),
      v: convertWeight(e.weight, e.unit || "lb", unit),
    }))
    .sort((a, b) => a.t - b.t);
  const svg = sparklineHtml(points, { height: 76 });
  if (!svg) return "";
  return `<div class="trend"><span class="trend-label">Last 30 days</span>${svg}</div>`;
}

function setText(set) {
  if (!set) return "";
  const w = Number(set.weight) || 0;
  const u = set.unit === "kg" ? "kg" : "lb";
  return `${w > 0 ? `${round1(w)} ${u}` : "BW"} &times; ${int(set.reps)}`;
}

function sameName(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function mealName(meal) {
  return { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" }[meal] || "Snack";
}

function letterOf(date) {
  const [y, m, d] = date.split("-").map(Number);
  return "MTWTFSS"[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

function shortDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function monthName() {
  return new Date().toLocaleDateString(undefined, { month: "long" });
}

// The hero splits 178.4 into "178" (which counts up) and ".4" (which doesn't),
// so a rolling counter never renders a value the data never held.
function whole(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function frac(value) {
  return `.${Math.round(Math.abs(Number(value) || 0) * 10) % 10}`;
}

function longDate() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

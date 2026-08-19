import { esc, int } from "../dom.js";
import { subscribe } from "../store.js";
import { weightStats, recentEntries, convertWeight, round1 } from "../weight.js";
import { entriesFor, totals } from "../nutrition.js";
import { workoutsFor, volume, setCount } from "../workouts.js";
import { getTargets, weightUnit, liftUnit, SETTINGS_PATH } from "../settings.js";
import { todayLocalISO, daysBetween } from "../dates.js";
import { nutritionSummaryHtml } from "./nutrition-summary.js";
import { sparklineHtml } from "./sparkline.js";
import { countUp, trackValue } from "../anim.js";
import { hasToken } from "../github.js";

export function renderDashboard(root) {
  function draw() {
    const unit = weightUnit();
    const today = todayLocalISO();

    root.innerHTML = `
      <h1>Today</h1>
      <p class="date-line">${esc(longDate())}</p>

      <div class="grid-cards">
        ${weightCard(weightStats(unit), unit)}
        ${nutritionCard(entriesFor(today))}
        ${workoutCard(today)}
      </div>

      ${
        hasToken()
          ? ""
          : `<p class="hint">No token set, so the app stays local &mdash; entries queue up in the
             badge and push once a token is added in <a href="#/settings">Settings</a>.</p>`
      }
    `;

    countUp(root);
  }

  const unsub = subscribe((path) => {
    if (typeof path !== "string") return;
    if (
      path.startsWith("data/weight/") ||
      path.startsWith("data/nutrition/") ||
      path.startsWith("data/workouts/") ||
      path === SETTINGS_PATH
    ) {
      draw();
    }
  });

  draw();
  return unsub;
}

function weightCard(stats, unit) {
  if (!stats) {
    return `
      <div class="card rise" style="--rise-i:0">
        <div class="card-head"><h2 class="card-title">Weight</h2></div>
        <div class="empty-state">No weigh-ins yet.</div>
        <div class="btn-row"><a class="btn primary btn-link" href="#/weight">Log weight</a></div>
      </div>`;
  }

  const shown = round1(stats.latestVal);
  const prev = trackValue("dash:weight", shown);
  const delta = stats.delta7;

  return `
    <div class="card rise" style="--rise-i:0">
      <div class="card-head">
        <h2 class="card-title">Weight</h2>
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
    <div class="card rise" style="--rise-i:1">
      <div class="card-head">
        <h2 class="card-title">Nutrition</h2>
        <span class="pill${food.length ? "" : " muted"}">${food.length} item${food.length === 1 ? "" : "s"}</span>
      </div>
      ${nutritionSummaryHtml(totals(food), getTargets(), { keyPrefix: "dash" })}
      <div class="btn-row"><a class="btn primary btn-link" href="#/food">Log food</a></div>
    </div>`;
}

/** Spec section 6: whether a workout was logged today, and if so its name and
 *  total volume. Both are summed at render — nothing derived is stored. */
function workoutCard(today) {
  const sessions = workoutsFor(today);
  if (!sessions.length) {
    return `
      <div class="card rise" style="--rise-i:2">
        <div class="card-head">
          <h2 class="card-title">Workout</h2>
          <span class="pill muted">not logged today</span>
        </div>
        <div class="empty-state">No session yet today.</div>
        <div class="btn-row"><a class="btn primary btn-link" href="#/workout">Start a workout</a></div>
      </div>`;
  }

  const unit = liftUnit();
  const vol = int(sessions.reduce((sum, w) => sum + volume(w, unit), 0));
  const prev = trackValue("dash:volume", vol);
  const sets = sessions.reduce((n, w) => n + setCount(w), 0);
  const label = sessions.length === 1 ? sessions[0].name : `${sessions.length} sessions`;

  return `
    <div class="card rise" style="--rise-i:2">
      <div class="card-head">
        <h2 class="card-title">Workout</h2>
        <span class="pill hit">&#10003; logged today</span>
      </div>
      <div class="hero compact">
        <div class="hero-figure">
          <span class="hero-value num" data-count-from="${prev}" data-count-to="${vol}">${vol}</span>
          <span class="hero-unit">${esc(unit)} volume</span>
        </div>
        <div class="hero-meta">
          <span class="delta-pill num${sets ? "" : " muted"}">${sets} set${sets === 1 ? "" : "s"}</span>
          <span class="hero-sub">${esc(label)}</span>
        </div>
      </div>
      <div class="btn-row"><a class="btn primary btn-link" href="#/workout">Log sets</a></div>
    </div>`;
}

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

import { esc } from "../dom.js";
import { getCached, subscribe } from "../store.js";
import { weightStats } from "../weight.js";
import { hasToken } from "../github.js";

export function renderDashboard(root) {
  function draw() {
    const unit = getCached("data/settings.json")?.weightUnit || "lb";
    const stats = weightStats(unit);
    const connected = hasToken();

    root.innerHTML = `
      <h1>Today</h1>
      <div class="card">
        <h2 class="card-title">Weight</h2>
        ${
          stats
            ? `
          <div class="stat-grid">
            <div class="stat">
              <span class="stat-label">Current</span>
              <span class="stat-value num">${stats.latestVal.toFixed(1)}<span class="stat-unit"> ${esc(unit)}</span></span>
              <span class="stat-sub num">${esc(stats.latest.date)}</span>
            </div>
            <div class="stat">
              <span class="stat-label">7-day change</span>
              <span class="stat-value num">${stats.delta7 === null ? "—" : (stats.delta7 > 0 ? "+" : "") + stats.delta7.toFixed(1)}</span>
              <span class="stat-sub">${stats.delta7 === null ? "need 7+ days of logs" : esc(unit)}</span>
            </div>
          </div>
          <p class="stat-today ${stats.todayLogged ? "done" : ""}">${stats.todayLogged ? "✓ Logged today" : "Not logged today"}</p>`
            : `<div class="empty-state">No weigh-ins yet.</div>`
        }
        <div class="btn-row"><a class="btn primary btn-link" href="#/weight">Log weight</a></div>
      </div>
      <div class="card">
        <p class="hint">Nutrition and workouts arrive in later phases.${
          connected
            ? ""
            : ` The app is local-only until a token is set in <a href="#/settings">Settings</a> — entries queue up and sync later.`
        }</p>
      </div>
    `;
  }

  const unsub = subscribe((path) => {
    if (typeof path === "string" && (path.startsWith("data/weight/") || path === "data/settings.json")) draw();
  });

  draw();
  return unsub;
}

import { esc } from "../dom.js";
import { subscribe, dirtyCount } from "../store.js";
import { weightUnit } from "../settings.js";
import { todayLocalISO, addDays, weekdayOf, daysBetween, monthOf } from "../dates.js";
import { MANIFEST_PATH } from "../manifest.js";
import { ensureHistory } from "../sync.js";
import { trendChartHtml } from "./sparkline.js";
import {
  upsertWeight,
  deleteWeight,
  entryFor,
  recentEntries,
  allEntries,
  convertWeight,
  round1,
} from "../weight.js";

// Chart ranges in days; 0 means everything the manifest knows about.
const RANGES = [
  { days: 30, label: "30 d" },
  { days: 90, label: "90 d" },
  { days: 365, label: "1 y" },
  { days: 0, label: "All" },
];

export function renderWeight(root) {
  const unit = weightUnit();
  const today = todayLocalISO();
  let range = 30;

  root.innerHTML = `
    <h1>Weight</h1>
    <div class="panes" style="--pane-left: 26rem">
      <section class="pane">
        <div class="card rise" style="--rise-i:0">
          <div class="field">
            <label for="w-date">Date</label>
            <input id="w-date" type="date" value="${today}" max="${today}" />
          </div>
          <div class="field">
            <label for="w-weight">Weight (${esc(unit)})</label>
            <div class="stepper-row">
              <button id="w-minus" class="btn stepper" type="button" aria-label="Decrease weight by 0.1">&minus;</button>
              <input id="w-weight" type="number" class="num big-num" inputmode="decimal" step="0.1" min="0" placeholder="0.0" />
              <button id="w-plus" class="btn stepper" type="button" aria-label="Increase weight by 0.1">&plus;</button>
            </div>
          </div>
          <div class="field">
            <label for="w-note">Note <span class="dim">(optional)</span></label>
            <input id="w-note" type="text" maxlength="200" />
          </div>
          <div class="btn-row">
            <button id="w-save" class="btn primary" type="button">Save</button>
          </div>
          <p id="w-status" class="status-line"></p>
        </div>
      </section>

      <section class="pane">
        <div class="card rise" style="--rise-i:1">
          <div class="card-head wrap">
            <h2 class="card-title">Trend</h2>
            <div class="segmented" id="w-range" role="radiogroup" aria-label="Chart range">
              ${RANGES.map(
                (r) =>
                  `<button type="button" class="seg num" role="radio" aria-checked="${r.days === range}"
                     data-range="${r.days}">${esc(r.label)}</button>`
              ).join("")}
            </div>
          </div>
          <div id="w-chart"></div>
        </div>

        <div class="stat-tiles" id="w-tiles"></div>

        <div class="card rise" style="--rise-i:2">
          <div class="card-head">
            <h2 class="card-title">Last 60 days</h2>
            <span class="pill num" id="w-count"></span>
          </div>
          <div id="w-list"></div>
        </div>
      </section>
    </div>
  `;

  const $ = (sel) => root.querySelector(sel);
  const dateEl = $("#w-date");
  const weightEl = $("#w-weight");
  const noteEl = $("#w-note");
  const saveBtn = $("#w-save");
  const statusEl = $("#w-status");
  const rangeEl = $("#w-range");
  const chartEl = $("#w-chart");
  const tilesEl = $("#w-tiles");
  const countEl = $("#w-count");
  const listEl = $("#w-list");

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = `status-line ${kind}`;
  }

  // Prefill: an existing entry for the chosen date loads for editing;
  // otherwise default to the latest logged weight so steppers do the work.
  function prefill() {
    const existing = entryFor(dateEl.value);
    if (existing) {
      weightEl.value = round1(convertWeight(existing.weight, existing.unit || "lb", unit));
      noteEl.value = existing.note || "";
      saveBtn.textContent = "Update";
    } else {
      const latest = recentEntries(90)[0];
      weightEl.value = latest ? round1(convertWeight(latest.weight, latest.unit || "lb", unit)) : "";
      noteEl.value = "";
      saveBtn.textContent = "Save";
    }
  }

  function step(delta) {
    const v = parseFloat(weightEl.value) || 0;
    weightEl.value = round1(Math.max(0, v + delta)).toFixed(1);
  }

  $("#w-minus").addEventListener("click", () => step(-0.1));
  $("#w-plus").addEventListener("click", () => step(+0.1));
  dateEl.addEventListener("change", prefill);

  saveBtn.addEventListener("click", () => {
    const date = dateEl.value;
    const weight = parseFloat(weightEl.value);
    if (!date) return setStatus("Pick a date.", "err");
    if (!Number.isFinite(weight) || weight <= 0) return setStatus("Enter a weight above 0.", "err");
    upsertWeight({ date, weight: round1(weight), unit, note: noteEl.value.trim() });
    setStatus(`Saved locally — press Sync (${dirtyCount()}) in the header to push.`, "ok");
    prefill();
  });

  /** Every cached entry inside the selected range, in display units, oldest first. */
  function rangeEntries() {
    return allEntries()
      .filter((e) => range === 0 || daysBetween(e.date, today) <= range)
      .map((e) => ({ date: e.date, v: convertWeight(Number(e.weight) || 0, e.unit || "lb", unit) }))
      .reverse();
  }

  function renderChart() {
    const entries = rangeEntries();
    const points = entries.map((e) => ({ t: -daysBetween(e.date, today), v: e.v }));
    const span = points.length > 1 ? points[points.length - 1].t - points[0].t : 0;
    const svg = trendChartHtml(points, {
      labelX: (t) => chartDate(addDays(today, t), span),
      decimals: 1,
    });
    chartEl.innerHTML =
      svg ||
      `<p class="hint">The trend draws once there are two weigh-ins${
        range !== 0 ? " in this range" : ""
      } &mdash; keep logging.</p>`;
  }

  function renderTiles() {
    const entries = rangeEntries(); // oldest first
    if (!entries.length) {
      tilesEl.innerHTML = "";
      tilesEl.hidden = true;
      return;
    }
    tilesEl.hidden = false;

    const latest = entries[entries.length - 1];

    const avgBetween = (from, to) => {
      const vs = entries.filter((e) => e.date >= from && e.date <= to).map((e) => e.v);
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    };
    const avg7 = avgBetween(addDays(today, -6), today);
    const prevAvg7 = avgBetween(addDays(today, -13), addDays(today, -7));
    const avgDelta = avg7 !== null && prevAvg7 !== null ? avg7 - prevAvg7 : null;

    const first = entries[0];
    const change = latest.v - first.v;
    const weeks = Math.max(1, daysBetween(first.date, latest.date)) / 7;
    const lo = Math.min(...entries.map((e) => e.v));
    const hi = Math.max(...entries.map((e) => e.v));
    const rangeName = { 30: "30-day", 90: "90-day", 365: "1-year", 0: "All-time" }[range];

    tilesEl.innerHTML = `
      <div class="tile">
        <div class="tile-label">Current</div>
        <div class="tile-value num">${round1(latest.v).toFixed(1)} <small>${esc(unit)}</small></div>
        <div class="tile-sub">${latest.date === today ? "logged today" : `logged ${esc(shortDate(latest.date))}`}</div>
      </div>
      <div class="tile">
        <div class="tile-label">7-day avg</div>
        <div class="tile-value num">${avg7 === null ? "&mdash;" : `${round1(avg7).toFixed(1)} <small>${esc(unit)}</small>`}</div>
        <div class="tile-sub num">${
          avgDelta === null
            ? "needs last week too"
            : `${avgDelta > 0 ? "&#9650;" : avgDelta < 0 ? "&#9660;" : "&plusmn;"} ${Math.abs(round1(avgDelta)).toFixed(1)} vs prior week`
        }</div>
      </div>
      <div class="tile">
        <div class="tile-label">${esc(rangeName)} change</div>
        <div class="tile-value num">${
          entries.length < 2
            ? "&mdash;"
            : `${change > 0 ? "&#9650;" : change < 0 ? "&#9660;" : "&plusmn;"} ${Math.abs(round1(change)).toFixed(1)} <small>${esc(unit)}</small>`
        }</div>
        <div class="tile-sub num">${entries.length < 2 ? "one entry so far" : `&asymp; ${Math.abs(round1(change / weeks)).toFixed(1)} / week`}</div>
      </div>
      <div class="tile">
        <div class="tile-label">${esc(rangeName)} range</div>
        <div class="tile-value num">${round1(lo).toFixed(1)}<small>&ndash;</small>${round1(hi).toFixed(1)}</div>
        <div class="tile-sub">low &middot; high</div>
      </div>`;
  }

  function renderList() {
    const entries = recentEntries(60);
    countEl.hidden = !entries.length;
    countEl.innerHTML = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
    if (!entries.length) {
      listEl.innerHTML = `<div class="empty-state">No weigh-ins yet. Log the first one on the left.</div>`;
      return;
    }

    let lastWeek = null;
    const rows = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const val = round1(convertWeight(e.weight, e.unit || "lb", unit));
      const prev = entries[i + 1];
      const delta = prev ? round1(val - round1(convertWeight(prev.weight, prev.unit || "lb", unit))) : null;

      const week = addDays(e.date, -weekdayOf(e.date));
      if (week !== lastWeek) {
        lastWeek = week;
        const group = entries.filter((x) => addDays(x.date, -weekdayOf(x.date)) === week);
        const avg = group.reduce((s, x) => s + convertWeight(x.weight, x.unit || "lb", unit), 0) / group.length;
        rows.push(
          `<div class="wk-sep"><b>Week of ${esc(shortDate(week))}</b><span class="num">avg ${round1(avg).toFixed(1)}</span></div>`
        );
      }

      rows.push(`<div class="entry-row">
        <span class="entry-date num">${esc(rowDate(e.date))}</span>
        <span class="entry-main num">${val.toFixed(1)} ${esc(unit)}</span>
        <span class="delta-chip num">${
          delta === null
            ? "&mdash;"
            : `${delta > 0 ? "&#9650;" : delta < 0 ? "&#9660;" : "&plusmn;"} ${Math.abs(delta).toFixed(1)}`
        }</span>
        ${e.note ? `<span class="entry-note-inline">${esc(e.note)}</span>` : ""}
        <span class="entry-actions">
          <button class="btn small" data-edit="${esc(e.date)}" type="button" aria-label="Edit ${esc(e.date)}">Edit</button>
          <button class="btn small danger" data-del="${esc(e.date)}" type="button" aria-label="Delete ${esc(e.date)}">Del</button>
        </span>
      </div>`);
    }
    listEl.innerHTML = rows.join("");
  }

  function renderRight() {
    renderChart();
    renderTiles();
    renderList();
  }

  // Pull whatever the manifest lists for the selected window; the store
  // notifies as each month lands and the pane re-renders itself.
  function pullFor(days) {
    ensureHistory(["weight"], days === 0 ? null : monthOf(addDays(today, -(days + 7))));
  }

  rangeEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-range]");
    if (!btn) return;
    range = Number(btn.dataset.range);
    for (const seg of rangeEl.querySelectorAll(".seg")) {
      const on = Number(seg.dataset.range) === range;
      seg.classList.toggle("active", on);
      seg.setAttribute("aria-checked", String(on));
    }
    pullFor(range);
    renderChart();
    renderTiles();
  });
  rangeEl.querySelector(`[data-range="${range}"]`)?.classList.add("active");

  // One delegated listener; renderList only replaces the rows.
  listEl.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t.dataset?.edit) {
      dateEl.value = t.dataset.edit;
      prefill();
      weightEl.focus();
      window.scrollTo({ top: 0 });
    } else if (t.dataset?.del) {
      deleteWeight(t.dataset.del);
      setStatus(`Deleted ${t.dataset.del} — press Sync (${dirtyCount()}) to push.`, "ok");
      prefill();
    }
  });

  // Re-render when a background refresh (or our own writes) update the cache.
  const unsub = subscribe((path) => {
    if (typeof path !== "string") return;
    if (path.startsWith("data/weight/")) renderRight();
    else if (path === MANIFEST_PATH) pullFor(range);
  });

  pullFor(range);
  prefill();
  renderRight();
  return unsub;
}

function shortDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Tue 08-18" — weekday for scanning, month-day for precision. */
function rowDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" });
  return `${wd} ${date.slice(5)}`;
}

/** Tick labels: dates for short ranges, months once a year is on screen. */
function chartDate(date, spanDays) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (spanDays > 180) {
    return dt.toLocaleDateString(undefined, { month: "short", year: spanDays > 400 ? "2-digit" : undefined });
  }
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Hand-rolled SVG sparkline — no charting library, per spec section 7.
//
// Points carry their own x (t) so gaps in logging show as gaps in spacing
// rather than being evenly distributed, which would flatter a patchy week.

let uid = 0;

/**
 * @param {Array<{t:number, v:number}>} points ascending by t
 * @param {{width?:number, height?:number, pad?:number}} [opts]
 * @returns {string} markup, or "" when there is nothing worth drawing
 */
export function sparklineHtml(points, opts = {}) {
  const pts = (points || []).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
  if (pts.length < 2) return "";

  const w = opts.width || 320;
  const h = opts.height || 72;
  const pad = opts.pad ?? 10;
  const id = `spark${++uid}`;

  const ts = pts.map((p) => p.t);
  const vs = pts.map((p) => p.v);
  const tMin = Math.min(...ts);
  const tSpan = Math.max(...ts) - tMin || 1;
  const vMin = Math.min(...vs);
  const vSpan = Math.max(...vs) - vMin || 1;

  const x = (t) => round2(pad + ((t - tMin) / tSpan) * (w - pad * 2));
  const y = (v) => round2(h - pad - ((v - vMin) / vSpan) * (h - pad * 2));

  const coords = pts.map((p) => `${x(p.t)},${y(p.v)}`);
  const last = pts[pts.length - 1];

  return `
    <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" class="spark-stop-a" />
          <stop offset="100%" class="spark-stop-b" />
        </linearGradient>
      </defs>
      <polygon class="spark-area" fill="url(#${id})"
        points="${coords.join(" ")} ${x(last.t)},${h} ${x(pts[0].t)},${h}" />
      <polyline class="spark-line" pathLength="1" points="${coords.join(" ")}" />
      <line class="spark-dot" x1="${x(last.t)}" y1="${y(last.v)}" x2="${x(last.t)}" y2="${y(last.v)}" />
    </svg>`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/* ── Full trend chart (Phase 5) — the sparkline grown axes ─────────────── */

const NICE_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500];

function niceStep(raw) {
  for (const s of NICE_STEPS) if (s >= raw) return s;
  return NICE_STEPS[NICE_STEPS.length - 1];
}

/**
 * A weight-history chart with gridlines, y labels, ~4 dated x ticks, the
 * high-water mark annotated, and the latest point emphasised. Same rules as
 * the sparkline: hand-rolled SVG (spec section 7), gaps in logging stay gaps
 * on the x axis, and the drawn state is the final state — the entrance
 * animation only draws toward it.
 *
 * @param {Array<{t:number, v:number}>} points ascending by t (days)
 * @param {{labelX:(t:number)=>string, decimals?:number, height?:number}} opts
 * @returns {string} markup, or "" when there is nothing worth drawing
 */
export function trendChartHtml(points, opts) {
  const pts = (points || []).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
  if (pts.length < 2) return "";

  const W = 720;
  const H = opts.height || 250;
  const L = 46;
  const R = 16;
  const T = 20;
  const B = 30;
  const dp = opts.decimals ?? 1;
  const id = `spark${++uid}`;

  const ts = pts.map((p) => p.t);
  const vs = pts.map((p) => p.v);
  const tMin = Math.min(...ts);
  const tSpan = Math.max(...ts) - tMin || 1;
  let vMin = Math.min(...vs);
  let vMax = Math.max(...vs);
  if (vMax - vMin < 0.001) {
    vMin -= 0.5;
    vMax += 0.5;
  }
  const pad = (vMax - vMin) * 0.08;
  vMin -= pad;
  vMax += pad;

  const x = (t) => round2(L + ((t - tMin) / tSpan) * (W - L - R));
  const y = (v) => round2(H - B - ((v - vMin) / (vMax - vMin)) * (H - T - B));

  // Horizontal gridlines on round values.
  const step = niceStep((vMax - vMin) / 3.2);
  const grid = [];
  for (let g = Math.ceil(vMin / step) * step; g <= vMax + 1e-9; g += step) {
    grid.push(round2(g));
  }

  // Dated ticks: about four, evenly spaced in time.
  const tickCount = Math.min(5, Math.max(2, Math.round(tSpan / 6)));
  const ticks = [];
  for (let i = 0; i < tickCount; i++) {
    ticks.push(Math.round(tMin + (tSpan * i) / (tickCount - 1 || 1)));
  }

  const coords = pts.map((p) => `${x(p.t)},${y(p.v)}`);
  const last = pts[pts.length - 1];
  const high = pts.reduce((a, b) => (b.v > a.v ? b : a));
  const fmt = (v) => v.toFixed(dp);
  // Keep annotations inside the frame whichever half their point is in.
  const highAnchor = x(high.t) > W / 2 ? "end" : "start";
  const highDx = highAnchor === "end" ? -8 : 8;

  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" class="spark-stop-a" />
          <stop offset="100%" class="spark-stop-b" />
        </linearGradient>
      </defs>
      ${grid
        .map(
          (g) => `<line class="chart-grid" x1="${L}" y1="${y(g)}" x2="${W - R}" y2="${y(g)}" />
            <text class="chart-lab" x="${L - 8}" y="${y(g) + 3.5}" text-anchor="end">${fmt(g)}</text>`
        )
        .join("")}
      ${ticks
        .map((t) => `<text class="chart-lab" x="${x(t)}" y="${H - 8}" text-anchor="middle">${opts.labelX(t)}</text>`)
        .join("")}
      <polygon class="spark-area" fill="url(#${id})"
        points="${coords.join(" ")} ${x(last.t)},${H - B} ${x(pts[0].t)},${H - B}" />
      <polyline class="spark-line" pathLength="1" points="${coords.join(" ")}" />
      ${
        high.t !== last.t
          ? `<circle class="chart-high" cx="${x(high.t)}" cy="${y(high.v)}" r="3.5" />
             <text class="chart-lab" x="${x(high.t) + highDx}" y="${
              y(high.v) < T + 14 ? y(high.v) + 16 : y(high.v) - 6
            }" text-anchor="${highAnchor}">${fmt(high.v)} &middot; ${opts.labelX(high.t)}</text>`
          : ""
      }
      <line class="spark-dot" x1="${x(last.t)}" y1="${y(last.v)}" x2="${x(last.t)}" y2="${y(last.v)}" />
      <text class="chart-lab strong" x="${x(last.t) - 10}" y="${y(last.v) - 9}" text-anchor="end">${fmt(
        last.v
      )} &middot; ${opts.labelX(last.t)}</text>
    </svg>`;
}

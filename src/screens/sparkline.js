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

// The nutrition module: a calorie ring plus three macro bars, shared by the
// dashboard and the food screen so the same numbers read the same way in both.
//
// Colour rules (spec section 8, one meaning per colour):
//   - A macro's hue identifies *which* macro it is. It never encodes progress.
//   - Hitting a target is signalled the same way everywhere: the fill lights
//     up, gains a soft glow, and the label picks up a check. That treatment
//     means "target met" and nothing else.

import { esc, int } from "../dom.js";
import { DEFAULT_SETTINGS } from "../settings.js";
import { trackValue } from "../anim.js";

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

const MACROS = [
  { key: "protein", label: "Protein" },
  { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" },
];

const pctOf = (value, target) =>
  target <= 0 ? 0 : Math.max(0, Math.min(100, (value / target) * 100));

/** SVG dash offset for a percentage — 0% is a full offset, 100% is none. */
const dashAt = (pct) => (RING_C * (100 - pct)) / 100;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {{calories:number,protein:number,carbs:number,fat:number}} totals
 * @param {object} [targets] from data/settings.json
 * @param {{keyPrefix?: string}} [opts] namespaces the animation memory so two
 *   screens showing different days don't animate from each other's numbers.
 */
export function nutritionSummaryHtml(totals, targets = DEFAULT_SETTINGS.targets, opts = {}) {
  const keyPrefix = opts.keyPrefix || "n";

  const cal = int(totals?.calories);
  const calTarget = int(targets?.calories);
  const prevCal = trackValue(`${keyPrefix}:calories`, cal);
  const calHit = calTarget > 0 && cal >= calTarget;
  const left = calTarget - cal;

  return `
    <div class="nsum">
      <div class="ring-col">
        <div class="ring-wrap${calHit ? " hit" : ""}">
          <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
            <circle class="ring-track" cx="60" cy="60" r="${RING_R}" />
            <circle class="ring-fill" cx="60" cy="60" r="${RING_R}"
              style="--circ:${round2(RING_C)};
                     --dash-from:${round2(dashAt(pctOf(prevCal, calTarget)))};
                     --dash-to:${round2(dashAt(pctOf(cal, calTarget)))}" />
          </svg>
          <div class="ring-center">
            <span class="ring-value num" data-count-from="${prevCal}" data-count-to="${cal}">${cal}</span>
            <span class="ring-sub num">of ${calTarget}</span>
          </div>
        </div>
        <span class="ring-left num">${
          calTarget <= 0 ? "no target" : left >= 0 ? `${left} left` : `${-left} over`
        }</span>
      </div>

      <div class="macro-bars">
        ${MACROS.map(({ key, label }) => {
          const value = int(totals?.[key]);
          const target = int(targets?.[key]);
          const prev = trackValue(`${keyPrefix}:${key}`, value);
          const hit = target > 0 && value >= target;
          return `
          <div class="macro m-${esc(key)}${hit ? " hit" : ""}"
               style="--from:${round2(pctOf(prev, target))}%; --to:${round2(pctOf(value, target))}%">
            <div class="macro-head">
              <span class="macro-label">${hit ? `<span class="tick" aria-hidden="true">&#10003;</span>` : ""}${esc(label)}</span>
              <span class="macro-val num"><span data-count-from="${prev}" data-count-to="${value}">${value}</span><span class="dim"> / ${target} g</span></span>
            </div>
            <div class="bar" role="img" aria-label="${esc(label)} ${value} of ${target} grams">
              <span class="bar-fill"></span>
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>`;
}

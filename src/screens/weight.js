import { esc } from "../dom.js";
import { subscribe, dirtyCount } from "../store.js";
import { weightUnit } from "../settings.js";
import { todayLocalISO } from "../dates.js";
import {
  upsertWeight,
  deleteWeight,
  entryFor,
  recentEntries,
  convertWeight,
  round1,
} from "../weight.js";

export function renderWeight(root) {
  const unit = weightUnit();
  const today = todayLocalISO();

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
        <h2>Last 60 days</h2>
        <div id="w-list"></div>
      </section>
    </div>
  `;

  const $ = (sel) => root.querySelector(sel);
  const dateEl = $("#w-date");
  const weightEl = $("#w-weight");
  const noteEl = $("#w-note");
  const saveBtn = $("#w-save");
  const statusEl = $("#w-status");
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

  function renderList() {
    const entries = recentEntries(60);
    if (!entries.length) {
      listEl.innerHTML = `<div class="empty-state">No weigh-ins yet. Log the first one above.</div>`;
      return;
    }
    listEl.innerHTML = entries
      .map((e, i) => {
        const val = round1(convertWeight(e.weight, e.unit || "lb", unit));
        const prev = entries[i + 1];
        const delta = prev ? round1(val - round1(convertWeight(prev.weight, prev.unit || "lb", unit))) : null;
        return `<div class="entry-row">
          <span class="entry-date num">${esc(e.date)}</span>
          <span class="entry-main num">${val.toFixed(1)} ${esc(unit)}</span>
          <span class="delta num">${delta === null ? "" : (delta > 0 ? "+" : "") + delta.toFixed(1)}</span>
          <span class="entry-actions">
            <button class="btn small" data-edit="${esc(e.date)}" type="button" aria-label="Edit ${esc(e.date)}">Edit</button>
            <button class="btn small danger" data-del="${esc(e.date)}" type="button" aria-label="Delete ${esc(e.date)}">Del</button>
          </span>
          ${e.note ? `<span class="entry-note">${esc(e.note)}</span>` : ""}
        </div>`;
      })
      .join("");
  }

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

  // Re-render the list when a background refresh (or our own writes) update
  // the cache. Returned unsubscribe runs on navigation.
  const unsub = subscribe((path) => {
    if (typeof path === "string" && path.startsWith("data/weight/")) renderList();
  });

  prefill();
  renderList();
  return unsub;
}

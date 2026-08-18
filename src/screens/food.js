import { esc, int, showToast } from "../dom.js";
import { subscribe, dirtyCount } from "../store.js";
import { todayLocalISO } from "../dates.js";
import { getTargets, SETTINGS_PATH } from "../settings.js";
import { nutritionSummaryHtml } from "./nutrition-summary.js";
import { countUp } from "../anim.js";
import {
  MEALS,
  addFood,
  updateFood,
  deleteFood,
  entriesFor,
  totals,
  recentFoods,
  defaultMeal,
  normalizeMeal,
} from "../nutrition.js";

const MEAL_LABELS = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

const PENCIL = `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true">
  <path d="M11.3 2.9l1.8 1.8-7.4 7.4-2.5.7.7-2.5z" /><path d="M9.9 4.3l1.8 1.8" />
</svg>`;

const FIELD_LABELS = {
  calories: "Calories",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
};

export function renderFood(root) {
  const today = todayLocalISO();

  root.innerHTML = `
    <h1>Food</h1>

    <div class="card rise" style="--rise-i:0">
      <div class="field">
        <label for="f-date">Date</label>
        <input id="f-date" type="date" value="${today}" max="${today}" />
      </div>
      <div id="f-totals"></div>
    </div>

    <h2>Add food</h2>
    <div class="card rise" id="f-form" style="--rise-i:1">
      <div class="field">
        <span class="field-label" id="f-meal-label">Meal</span>
        <div class="segmented" id="f-meal" role="radiogroup" aria-labelledby="f-meal-label">
          ${MEALS.map(
            (m) =>
              `<button type="button" class="seg" role="radio" aria-checked="false" data-meal="${esc(m)}">${esc(
                MEAL_LABELS[m]
              )}</button>`
          ).join("")}
        </div>
      </div>

      <div class="field" id="f-recent-wrap" hidden>
        <span class="field-label">Recent <span class="dim">&mdash; tap to add</span></span>
        <div id="f-recent" class="chip-wrap"></div>
      </div>

      <hr class="rule" />

      <div class="field">
        <label for="f-name">Food</label>
        <input id="f-name" type="text" maxlength="120" placeholder="Chicken breast, 8 oz" autocomplete="off" />
      </div>
      <div class="field-row">
        <div class="field">
          <label for="f-calories">Calories</label>
          <input id="f-calories" type="number" class="num" inputmode="numeric" step="1" min="0" placeholder="0" />
        </div>
        <div class="field">
          <label for="f-protein">Protein (g)</label>
          <input id="f-protein" type="number" class="num" inputmode="decimal" step="1" min="0" placeholder="0" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="f-carbs">Carbs (g)</label>
          <input id="f-carbs" type="number" class="num" inputmode="decimal" step="1" min="0" placeholder="0" />
        </div>
        <div class="field">
          <label for="f-fat">Fat (g)</label>
          <input id="f-fat" type="number" class="num" inputmode="decimal" step="1" min="0" placeholder="0" />
        </div>
      </div>
      <div class="btn-row">
        <button id="f-save" class="btn primary" type="button">Add</button>
        <button id="f-cancel" class="btn" type="button" hidden>Cancel</button>
      </div>
      <p id="f-status" class="status-line"></p>
    </div>

    <h2>Logged</h2>
    <div id="f-list"></div>
  `;

  const $ = (sel) => root.querySelector(sel);
  const dateEl = $("#f-date");
  const mealEl = $("#f-meal");
  const recentWrap = $("#f-recent-wrap");
  const recentEl = $("#f-recent");
  const nameEl = $("#f-name");
  const saveBtn = $("#f-save");
  const cancelBtn = $("#f-cancel");
  const statusEl = $("#f-status");
  const totalsEl = $("#f-totals");
  const listEl = $("#f-list");
  const formEl = $("#f-form");

  const macroEls = {
    calories: $("#f-calories"),
    protein: $("#f-protein"),
    carbs: $("#f-carbs"),
    fat: $("#f-fat"),
  };

  // The chip list as last drawn, so a tap can look a food up by index instead
  // of round-tripping its numbers through DOM attributes.
  let recents = [];
  let editingId = null;

  function setStatus(msg, kind = "") {
    statusEl.textContent = msg;
    statusEl.className = `status-line ${kind}`;
  }

  function currentMeal() {
    return mealEl.querySelector('.seg[aria-checked="true"]')?.dataset.meal || defaultMeal();
  }

  function setMeal(meal) {
    const target = normalizeMeal(meal);
    for (const btn of mealEl.querySelectorAll(".seg")) {
      const on = btn.dataset.meal === target;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-checked", String(on));
    }
  }

  function readForm() {
    return {
      name: nameEl.value.trim(),
      meal: currentMeal(),
      calories: numberIn(macroEls.calories),
      protein: numberIn(macroEls.protein),
      carbs: numberIn(macroEls.carbs),
      fat: numberIn(macroEls.fat),
    };
  }

  function fillForm(food) {
    nameEl.value = food.name || "";
    for (const key of Object.keys(macroEls)) macroEls[key].value = int(food[key]);
    setMeal(food.meal || currentMeal());
  }

  function resetForm() {
    editingId = null;
    nameEl.value = "";
    for (const el of Object.values(macroEls)) el.value = "";
    saveBtn.textContent = "Add";
    cancelBtn.hidden = true;
  }

  function renderTotals() {
    totalsEl.innerHTML = nutritionSummaryHtml(totals(entriesFor(dateEl.value)), getTargets(), { keyPrefix: "food" });
    countUp(totalsEl);
  }

  function renderRecent() {
    recents = recentFoods(20);
    recentWrap.hidden = recents.length === 0;
    recentEl.innerHTML = recents
      .map(
        (f, i) => `<span class="chip-group pop" style="--pop-i:${i}">
          <button type="button" class="chip" data-add="${i}">
            <span class="chip-name">${esc(f.name)}</span>
            <span class="chip-cal num">${int(f.calories)}</span>
          </button>
          <button type="button" class="chip-alt" data-fill="${i}" title="Adjust before adding"
                  aria-label="Adjust ${esc(f.name)} before adding">${PENCIL}</button>
        </span>`
      )
      .join("");
  }

  function renderList() {
    const entries = entriesFor(dateEl.value);
    if (!entries.length) {
      listEl.innerHTML = `<div class="empty-state">Nothing logged for this day.</div>`;
      return;
    }
    let row = 0;
    listEl.innerHTML = MEALS.map((meal) => {
      const group = entries.filter((e) => normalizeMeal(e.meal) === meal);
      if (!group.length) return "";
      return `<div class="meal-group rise" style="--rise-i:${row++}">
        <div class="meal-head">
          <span class="meal-name">${esc(MEAL_LABELS[meal])}</span>
          <span class="meal-total num">${int(totals(group).calories)}<span class="dim"> kcal</span></span>
        </div>
        ${group
          .map(
            (e) => `<div class="entry-row food-row">
              <span class="entry-main">${esc(e.name)}</span>
              <span class="entry-actions">
                <button class="btn small" data-edit="${esc(e.id)}" type="button">Edit</button>
                <button class="btn small danger" data-del="${esc(e.id)}" type="button" aria-label="Delete ${esc(
              e.name
            )}">Del</button>
              </span>
              <span class="entry-macros num">
                <span class="pip cal">${int(e.calories)} kcal</span>
                <span class="pip p">${int(e.protein)}p</span>
                <span class="pip c">${int(e.carbs)}c</span>
                <span class="pip f">${int(e.fat)}f</span>
              </span>
            </div>`
          )
          .join("")}
      </div>`;
    }).join("");
  }

  function redraw() {
    renderTotals();
    renderList();
    renderRecent();
  }

  mealEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".seg");
    if (btn) setMeal(btn.dataset.meal);
  });

  dateEl.addEventListener("change", () => {
    resetForm(); // whatever was being edited belongs to the day we just left
    setStatus("");
    redraw();
  });

  // Delegated: renderRecent() replaces the chips on every store change.
  recentEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-add], [data-fill]");
    if (!btn) return;
    const adding = "add" in btn.dataset;
    const food = recents[Number(adding ? btn.dataset.add : btn.dataset.fill)];
    if (!food) return;
    if (adding) {
      const meal = currentMeal();
      addFood({ date: dateEl.value, ...food, meal });
      showToast(`Added ${food.name} to ${MEAL_LABELS[meal].toLowerCase()}`, "ok");
    } else {
      fillForm({ ...food, meal: currentMeal() });
      nameEl.focus();
      setStatus("Loaded — adjust the numbers, then press Add.");
    }
  });

  saveBtn.addEventListener("click", () => {
    const food = readForm();
    if (!food.name) return setStatus("Give the food a name.", "err");
    const bad = ["calories", "protein", "carbs", "fat"].find(
      (k) => !Number.isFinite(food[k]) || food[k] < 0
    );
    if (bad) return setStatus(`${FIELD_LABELS[bad]} must be a number of 0 or more.`, "err");

    if (editingId) {
      if (!updateFood(dateEl.value, editingId, food)) {
        resetForm();
        return setStatus("That entry is gone — it was deleted elsewhere.", "err");
      }
      setStatus(`Updated — press Sync (${dirtyCount()}) in the header to push.`, "ok");
    } else {
      addFood({ date: dateEl.value, ...food });
      setStatus(`Added — press Sync (${dirtyCount()}) in the header to push.`, "ok");
    }
    resetForm();
    nameEl.focus();
  });

  cancelBtn.addEventListener("click", () => {
    resetForm();
    setStatus("");
  });

  listEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-edit], [data-del]");
    if (!btn) return;
    const { edit, del } = btn.dataset;
    if (edit) {
      const entry = entriesFor(dateEl.value).find((e) => e.id === edit);
      if (!entry) return;
      editingId = edit;
      fillForm(entry);
      saveBtn.textContent = "Update";
      cancelBtn.hidden = false;
      setStatus("Editing this entry.");
      formEl.scrollIntoView({ block: "center" });
      nameEl.focus();
    } else if (del) {
      if (editingId === del) resetForm();
      const entry = entriesFor(dateEl.value).find((e) => e.id === del);
      deleteFood(dateEl.value, del);
      setStatus(`Deleted ${entry ? entry.name : "entry"} — press Sync (${dirtyCount()}) to push.`, "ok");
    }
  });

  // Our own writes and background refreshes both land here. The form itself is
  // never touched, only the derived views, so typing can't be clobbered.
  const unsub = subscribe((path) => {
    if (typeof path !== "string") return;
    if (path.startsWith("data/nutrition/")) redraw();
    else if (path === SETTINGS_PATH) renderTotals();
  });

  setMeal(defaultMeal());
  redraw();
  return unsub;
}

function numberIn(el) {
  const raw = el.value.trim();
  return raw === "" ? 0 : Number(raw);
}

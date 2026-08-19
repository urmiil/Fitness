// The set logger. This is the one screen used mid-workout, one-handed, so
// every layout decision here bends toward "five sets should be five taps"
// (spec section 6): the logger opens on the weight you last used, the steppers
// are full touch targets, and adding a set never leaves the card.
//
// Re-render discipline: the store notifies on our own writes as well as on
// background refreshes, so the exercise list is rebuilt often. Anything the
// user can be typing into is either kept in the static shell (the two name
// fields) or round-tripped through `drafts` and refocused by `data-fk`.

import { esc, int, dec, showToast } from "../dom.js";
import { subscribe, dirtyCount } from "../store.js";
import { todayLocalISO, daysBetween } from "../dates.js";
import { liftUnit, SETTINGS_PATH } from "../settings.js";
import { countUp, trackValue } from "../anim.js";
import {
  EXERCISES_PATH,
  exerciseNames,
  isKnownExercise,
  addExerciseToCatalog,
} from "../exercises.js";
import {
  workoutsFor,
  createWorkout,
  startFromLast,
  updateWorkout,
  deleteWorkout,
  addExercise,
  removeExercise,
  addSet,
  updateSet,
  removeSet,
  volume,
  exerciseVolume,
  setCount,
  defaultSet,
  setIn,
  lastSetFor,
  recentWorkoutNames,
  recentWorkouts,
  lastWorkoutNamed,
} from "../workouts.js";

export function renderWorkout(root) {
  const today = todayLocalISO();

  // In-progress logger values, keyed by exercise id, so a re-render mid-entry
  // doesn't reset what has been typed. Cleared for an exercise once its set
  // lands — the next default then comes from that set.
  const drafts = new Map();
  // exercise id -> index of the set being edited.
  const editing = new Map();
  // What has already animated in, so tapping "add set" doesn't replay every
  // card's entrance.
  const seenExercises = new Set();
  const seenSets = new Map();

  let activeId = null;
  let unknown = ""; // an exercise name typed that the catalog doesn't have

  root.innerHTML = `
    <h1>Workout</h1>

    <div class="panes" style="--pane-left: 27rem">
      <section class="pane">
        <div class="card rise" style="--rise-i:0">
          <div class="field">
            <label for="wo-date">Date</label>
            <input id="wo-date" type="date" value="${today}" max="${today}" />
          </div>
          <div id="wo-session" class="session-block"></div>
          <div class="field" id="wo-rename-wrap" hidden>
            <label for="wo-session-name">Session name</label>
            <input id="wo-session-name" type="text" maxlength="80" autocomplete="off" />
          </div>
          <div class="btn-row" id="wo-session-actions" hidden>
            <button id="wo-del" class="btn danger" type="button">Delete session</button>
          </div>
        </div>

        <h2 id="wo-start-head">Start a session</h2>
        <div class="card rise" style="--rise-i:1">
          <div class="field" id="wo-repeat-wrap" hidden>
            <span class="field-label">Repeat <span class="dim">&mdash; one tap, exercises included</span></span>
            <div id="wo-repeat" class="chip-wrap"></div>
          </div>
          <div class="field">
            <label for="wo-name">Name</label>
            <input id="wo-name" type="text" list="wo-names" maxlength="80"
                   placeholder="Push Day" autocomplete="off" />
            <datalist id="wo-names"></datalist>
          </div>
          <div class="btn-row">
            <button id="wo-start" class="btn primary" type="button">Start</button>
          </div>
          <p id="wo-status" class="status-line"></p>
        </div>

        <h2>Sessions on this day</h2>
        <div id="wo-sessions"></div>
      </section>

      <section class="pane">
        <h2>Exercises</h2>
        <div id="wo-body"></div>
        <div class="card" id="wo-add-card">
          <div class="field">
            <label for="wo-ex">Add exercise</label>
            <input id="wo-ex" type="text" list="wo-ex-list" maxlength="80"
                   placeholder="Bench Press" autocomplete="off" />
            <datalist id="wo-ex-list"></datalist>
          </div>
          <div class="btn-row">
            <button id="wo-ex-add" class="btn primary" type="button">Add exercise</button>
          </div>
          <p id="wo-ex-status" class="status-line"></p>
          <div class="btn-row" id="wo-catalog-row" hidden>
            <button id="wo-catalog-add" class="btn small" type="button"></button>
          </div>
        </div>
      </section>
    </div>
  `;

  const $ = (sel) => root.querySelector(sel);
  const dateEl = $("#wo-date");
  const sessionEl = $("#wo-session");
  const renameWrap = $("#wo-rename-wrap");
  const nameInput = $("#wo-session-name");
  const actionsEl = $("#wo-session-actions");
  const delBtn = $("#wo-del");
  const startHead = $("#wo-start-head");
  const repeatWrap = $("#wo-repeat-wrap");
  const repeatEl = $("#wo-repeat");
  const newNameEl = $("#wo-name");
  const namesList = $("#wo-names");
  const startBtn = $("#wo-start");
  const statusEl = $("#wo-status");
  const sessionsEl = $("#wo-sessions");
  const bodyEl = $("#wo-body");
  const exInput = $("#wo-ex");
  const exList = $("#wo-ex-list");
  const exStatus = $("#wo-ex-status");
  const catalogRow = $("#wo-catalog-row");
  const catalogBtn = $("#wo-catalog-add");

  const unit = () => liftUnit();
  const sessions = () => workoutsFor(dateEl.value);

  function setStatus(msg, kind = "") {
    statusEl.textContent = msg;
    statusEl.className = `status-line ${kind}`;
  }

  /**
   * The session being logged into: whatever was selected, else the most
   * recently started one on this date. Falling back here (rather than in the
   * click handler) is what makes a mid-workout reload resume where it left off.
   */
  function active() {
    const list = sessions();
    if (!list.length) return null;
    const chosen = list.find((w) => w.id === activeId);
    if (chosen) return chosen;
    activeId = list[list.length - 1].id;
    return list[list.length - 1];
  }

  /* ── Session card ────────────────────────────────────────────────────── */

  function renderSession(workout) {
    if (!workout) {
      sessionEl.innerHTML = `<div class="empty-state">Nothing logged on this date yet.</div>`;
      renameWrap.hidden = true;
      actionsEl.hidden = true;
      return;
    }
    const u = unit();
    const vol = int(volume(workout, u));
    const prev = trackValue(`wo:vol:${workout.id}`, vol);
    const sets = setCount(workout);
    const exercises = (workout.exercises || []).length;

    sessionEl.innerHTML = `
      <div class="hero compact">
        <div class="hero-figure">
          <span class="hero-value num" data-count-from="${prev}" data-count-to="${vol}">${vol}</span>
          <span class="hero-unit">${esc(u)} volume</span>
        </div>
        <div class="hero-meta">
          <span class="delta-pill num${sets ? "" : " muted"}">${sets} set${sets === 1 ? "" : "s"}</span>
          <span class="hero-sub">${exercises} exercise${exercises === 1 ? "" : "s"}</span>
        </div>
      </div>`;
    countUp(sessionEl);

    renameWrap.hidden = false;
    actionsEl.hidden = false;
    // Never overwrite a rename in progress.
    if (document.activeElement !== nameInput) nameInput.value = workout.name || "";
    delBtn.textContent = "Delete session";
    delBtn.dataset.armed = "";
  }

  /* ── Start card ──────────────────────────────────────────────────────── */

  let repeatKey = null;

  function renderStart(workout) {
    startHead.textContent = workout ? "Start another session" : "Start a session";

    const names = recentWorkoutNames(8);
    // Every logged set notifies the store, and rebuilding these chips each
    // time would replay their pop animation on every tap.
    const key = JSON.stringify(names);
    if (key === repeatKey) return;
    repeatKey = key;

    namesList.innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join("");

    repeatWrap.hidden = names.length === 0;
    repeatEl.innerHTML = names
      .map((name, i) => {
        const last = lastWorkoutNamed(name);
        const age = last ? daysBetween(last.date, today) : null;
        return `<span class="chip-group pop" style="--pop-i:${i}">
          <button type="button" class="chip" data-repeat="${i}">
            <span class="chip-name">${esc(name)}</span>
            <span class="chip-cal num">${age === null ? "" : age <= 0 ? "today" : `${age}d`}</span>
          </button>
        </span>`;
      })
      .join("");
  }

  function renderSessions(workout) {
    const list = sessions();
    if (!list.length) {
      sessionsEl.innerHTML = `<div class="empty-state">No sessions on this date.</div>`;
      return;
    }
    const u = unit();
    sessionsEl.innerHTML = list
      .map(
        (w) => `<div class="entry-row session-row${w.id === workout?.id ? " current" : ""}">
          <button type="button" class="entry-main link-row" data-open="${esc(w.id)}">${esc(w.name)}</button>
          <span class="delta num">${setCount(w)} set${setCount(w) === 1 ? "" : "s"}</span>
          <span class="entry-actions num">${int(volume(w, u))} ${esc(u)}</span>
        </div>`
      )
      .join("");
  }

  /* ── Exercise list and set logger ────────────────────────────────────── */

  function draftFor(workout, exercise) {
    const held = drafts.get(exercise.id);
    if (held) return held;
    const def = defaultSet(workout, exercise, unit());
    return { weight: def.weight, reps: def.reps, rpe: "" };
  }

  function renderBody(workout) {
    // Focus survives the rebuild; selection doesn't (number inputs don't
    // support setSelectionRange), which is fine for stepper-driven fields.
    const focusKey = document.activeElement?.dataset?.fk || "";

    if (!workout) {
      bodyEl.innerHTML = `<div class="empty-state">Start a session to log sets.</div>`;
      return;
    }
    const exercises = workout.exercises || [];
    if (!exercises.length) {
      bodyEl.innerHTML = `<div class="empty-state">No exercises yet &mdash; add one below.</div>`;
      return;
    }

    bodyEl.innerHTML = `<div class="grid-cards">${exercises
      .map((ex, i) => exerciseCard(workout, ex, i))
      .join("")}</div>`;

    if (focusKey) {
      const back = bodyEl.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`);
      if (back) back.focus();
    }
  }

  function exerciseCard(workout, exercise, index) {
    const u = unit();
    const sets = exercise.sets || [];
    const draft = draftFor(workout, exercise);
    const editIndex = editing.get(exercise.id);
    const isEditing = Number.isInteger(editIndex) && sets[editIndex];
    const fresh = !seenExercises.has(exercise.id);
    seenExercises.add(exercise.id);
    const seenCount = seenSets.get(exercise.id) ?? (fresh ? 0 : sets.length);
    seenSets.set(exercise.id, sets.length);

    const hint = sets.length ? null : lastSetFor(exercise.name, { excludeWorkoutId: workout.id });
    const step = u === "kg" ? 2.5 : 5;

    return `
      <div class="card ex-card${fresh ? " rise" : ""}" style="--rise-i:${index}" data-ex="${esc(exercise.id)}">
        <div class="card-head">
          <h3 class="ex-name">${esc(exercise.name)}</h3>
          <span class="ex-vol num">${int(exerciseVolume(exercise, u))}<span class="dim"> ${esc(u)}</span></span>
        </div>

        ${
          sets.length
            ? `<ol class="set-list">${sets
                .map(
                  (s, i) => `<li class="set-row${i >= seenCount ? " pop" : ""}${
                    isEditing && editIndex === i ? " editing" : ""
                  }">
                    <span class="set-n num">${i + 1}</span>
                    <button type="button" class="set-main num" data-set-edit="${i}"
                            aria-label="Edit set ${i + 1}">
                      <span class="set-w">${
                        Number(s.weight) > 0
                          ? `${dec(s.weight)}<span class="set-u">${esc(s.unit === "kg" ? "kg" : "lb")}</span>`
                          : `<span class="set-u">BW</span>`
                      }</span>
                      <span class="set-x">&times;</span>
                      <span class="set-r">${int(s.reps)}</span>
                      ${s.rpe ? `<span class="set-rpe">RPE ${dec(s.rpe)}</span>` : ""}
                    </button>
                    <button type="button" class="btn small danger" data-set-del="${i}"
                            aria-label="Delete set ${i + 1}">Del</button>
                  </li>`
                )
                .join("")}</ol>`
            : `<p class="hint">${
                hint
                  ? `Last time: ${
                      Number(hint.weight) > 0 ? `${dec(hint.weight)} ${esc(hint.unit)}` : "bodyweight"
                    } &times; ${int(hint.reps)}`
                  : `No sets yet.`
              }</p>`
        }

        <div class="logger">
          <div class="log-field">
            <span class="log-label">Weight <span class="dim">${esc(u)}</span></span>
            <div class="stepper-row">
              <button type="button" class="btn stepper" data-step="weight:${-step}"
                      aria-label="Decrease weight">&minus;</button>
              <input class="num" data-in="weight" data-fk="${esc(exercise.id)}:weight" type="number"
                     inputmode="decimal" step="${step}" min="0" value="${dec(draft.weight)}" />
              <button type="button" class="btn stepper" data-step="weight:${step}"
                      aria-label="Increase weight">&plus;</button>
            </div>
          </div>
          <div class="log-field">
            <span class="log-label">Reps</span>
            <div class="stepper-row">
              <button type="button" class="btn stepper" data-step="reps:-1"
                      aria-label="One rep fewer">&minus;</button>
              <input class="num" data-in="reps" data-fk="${esc(exercise.id)}:reps" type="number"
                     inputmode="numeric" step="1" min="0" value="${int(draft.reps)}" />
              <button type="button" class="btn stepper" data-step="reps:1"
                      aria-label="One rep more">&plus;</button>
            </div>
          </div>
          <div class="log-field log-rpe">
            <span class="log-label">RPE <span class="dim">opt.</span></span>
            <input class="num" data-in="rpe" data-fk="${esc(exercise.id)}:rpe" type="number"
                   inputmode="decimal" step="0.5" min="1" max="10"
                   value="${draft.rpe === "" ? "" : dec(draft.rpe)}" placeholder="&ndash;" />
          </div>
        </div>

        <div class="btn-row">
          <button type="button" class="btn primary log-btn" data-add-set
                  data-fk="${esc(exercise.id)}:add">
            ${isEditing ? "Update set" : "Add set"}
            <span class="log-nums num">${dec(draft.weight) === "0" ? "BW" : dec(draft.weight)} &times; ${int(
      draft.reps
    )}</span>
          </button>
          ${isEditing ? `<button type="button" class="btn" data-cancel-edit>Cancel</button>` : ""}
          <button type="button" class="btn small danger ex-remove" data-ex-del
                  aria-label="Remove ${esc(exercise.name)}">Remove</button>
        </div>
      </div>`;
  }

  /* ── Wiring ──────────────────────────────────────────────────────────── */

  function redraw() {
    const workout = active();
    renderSession(workout);
    renderStart(workout);
    renderSessions(workout);
    renderBody(workout);
    exStatus.classList.toggle("dim", !workout);
  }

  dateEl.addEventListener("change", () => {
    activeId = null;
    drafts.clear();
    editing.clear();
    seenExercises.clear();
    seenSets.clear();
    setStatus("");
    hideCatalogOffer();
    redraw();
  });

  startBtn.addEventListener("click", () => {
    const name = newNameEl.value.trim();
    if (!name) {
      newNameEl.focus();
      return setStatus("Name the session first.", "err");
    }
    const made = createWorkout({ date: dateEl.value, name });
    activeId = made.id;
    newNameEl.value = "";
    setStatus(`Started ${name} — add exercises on the right.`, "ok");
    redraw();
    exInput.focus();
  });

  repeatEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-repeat]");
    if (!btn) return;
    const name = recentWorkoutNames(8)[Number(btn.dataset.repeat)];
    if (!name) return;
    const made = startFromLast(dateEl.value, name);
    activeId = made.id;
    setStatus(
      `${name} loaded with ${made.exercises.length} exercise${made.exercises.length === 1 ? "" : "s"}.`,
      "ok"
    );
    redraw();
    showToast(`Repeating ${name}`, "ok");
  });

  nameInput.addEventListener("change", () => {
    const workout = active();
    if (!workout) return;
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.value = workout.name;
      return;
    }
    updateWorkout(dateEl.value, workout.id, { name });
  });

  // Two-step delete: no confirm() — a modal dialog would block the page, and a
  // one-tap delete of a whole session is too easy to hit mid-workout.
  delBtn.addEventListener("click", () => {
    const workout = active();
    if (!workout) return;
    if (delBtn.dataset.armed !== "yes") {
      delBtn.dataset.armed = "yes";
      delBtn.textContent = "Tap again to delete";
      setTimeout(() => {
        if (delBtn.isConnected && delBtn.dataset.armed === "yes") {
          delBtn.dataset.armed = "";
          delBtn.textContent = "Delete session";
        }
      }, 4000);
      return;
    }
    deleteWorkout(dateEl.value, workout.id);
    activeId = null;
    setStatus(`Deleted ${workout.name} — press Sync (${dirtyCount()}) to push.`, "ok");
    redraw();
  });

  sessionsEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-open]");
    if (!btn) return;
    activeId = btn.dataset.open;
    editing.clear();
    redraw();
  });

  exInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") addExerciseFromForm();
  });
  $("#wo-ex-add").addEventListener("click", addExerciseFromForm);

  function addExerciseFromForm() {
    const workout = active();
    const name = exInput.value.trim();
    if (!workout) return setExStatus("Start a session first.", "err");
    if (!name) return setExStatus("Type or pick an exercise.", "err");
    if (!addExercise(dateEl.value, workout.id, name)) {
      return setExStatus("That session is gone — pick another.", "err");
    }
    exInput.value = "";
    setExStatus(`Added ${name}.`, "ok");
    if (isKnownExercise(name)) hideCatalogOffer();
    else showCatalogOffer(name);
    redraw();
  }

  function setExStatus(msg, kind = "") {
    exStatus.textContent = msg;
    exStatus.className = `status-line ${kind}`;
  }

  // Spec section 6: offer to add an unknown movement to the catalog rather
  // than silently forking the naming that per-exercise history depends on.
  function showCatalogOffer(name) {
    unknown = name;
    catalogBtn.textContent = `Add "${name}" to your exercise list`;
    catalogRow.hidden = false;
  }

  function hideCatalogOffer() {
    unknown = "";
    catalogRow.hidden = true;
  }

  catalogBtn.addEventListener("click", () => {
    if (!unknown) return;
    const added = addExerciseToCatalog(unknown);
    showToast(added ? `${unknown} added to your exercises` : `${unknown} is already listed`, "ok");
    hideCatalogOffer();
    refreshExerciseList();
  });

  /** Catalog names plus anything logged before, so a movement typed once
   *  autocompletes next time even if it never made it into the catalog. */
  function refreshExerciseList() {
    const seen = new Map();
    for (const name of exerciseNames()) seen.set(name.toLowerCase(), name);
    for (const w of recentWorkouts()) {
      for (const ex of w.exercises || []) {
        const clean = String(ex.name || "").trim();
        if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
      }
    }
    exList.innerHTML = [...seen.values()]
      .sort((a, b) => a.localeCompare(b))
      .map((n) => `<option value="${esc(n)}"></option>`)
      .join("");
  }

  /* ── Logger interactions (delegated: the list is rebuilt constantly) ──── */

  function cardOf(node) {
    const card = node.closest?.(".ex-card");
    return card ? { card, exId: card.dataset.ex } : null;
  }

  function readLogger(card) {
    const val = (k) => card.querySelector(`[data-in="${k}"]`);
    return {
      weight: Number(val("weight").value),
      reps: Number(val("reps").value),
      rpe: val("rpe").value.trim(),
    };
  }

  /** Keep the button's preview in step with the inputs without a re-render. */
  function syncPreview(card) {
    const { weight, reps } = readLogger(card);
    const nums = card.querySelector(".log-nums");
    if (nums) nums.textContent = `${weight > 0 ? dec(weight) : "BW"} × ${int(reps)}`;
  }

  bodyEl.addEventListener("input", (ev) => {
    const found = cardOf(ev.target);
    if (!found || !ev.target.dataset.in) return;
    drafts.set(found.exId, readLogger(found.card));
    syncPreview(found.card);
  });

  bodyEl.addEventListener("click", (ev) => {
    const found = cardOf(ev.target);
    if (!found) return;
    const { card, exId } = found;
    const workout = active();
    if (!workout) return;

    const stepBtn = ev.target.closest("[data-step]");
    if (stepBtn) {
      const [field, amount] = stepBtn.dataset.step.split(":");
      const input = card.querySelector(`[data-in="${field}"]`);
      const next = (Number(input.value) || 0) + Number(amount);
      input.value = field === "reps" ? Math.max(0, Math.round(next)) : dec(Math.max(0, next));
      drafts.set(exId, readLogger(card));
      syncPreview(card);
      return;
    }

    if (ev.target.closest("[data-add-set]")) {
      const { weight, reps, rpe } = readLogger(card);
      if (!Number.isFinite(weight) || weight < 0) return showToast("Weight can't be negative", "err");
      if (!Number.isFinite(reps) || reps < 1) return showToast("Log at least one rep", "err");
      const at = editing.get(exId);
      const set = { weight, reps, unit: unit(), rpe };
      const ok = Number.isInteger(at)
        ? updateSet(dateEl.value, workout.id, exId, at, set)
        : addSet(dateEl.value, workout.id, exId, set);
      if (!ok) return showToast("That exercise is gone", "err");
      editing.delete(exId);
      drafts.delete(exId); // next set defaults to the one just logged
      redraw();
      return;
    }

    if (ev.target.closest("[data-cancel-edit]")) {
      editing.delete(exId);
      drafts.delete(exId);
      redraw();
      return;
    }

    const editBtn = ev.target.closest("[data-set-edit]");
    if (editBtn) {
      const i = Number(editBtn.dataset.setEdit);
      const ex = (workout.exercises || []).find((e) => e.id === exId);
      const set = ex?.sets?.[i];
      if (!set) return;
      editing.set(exId, i);
      drafts.set(exId, setIn(set, unit())); // stored in whatever unit it was logged in
      redraw();
      return;
    }

    const delBtnSet = ev.target.closest("[data-set-del]");
    if (delBtnSet) {
      removeSet(dateEl.value, workout.id, exId, Number(delBtnSet.dataset.setDel));
      editing.delete(exId);
      drafts.delete(exId);
      seenSets.delete(exId); // re-baseline so the remaining rows don't re-pop
      redraw();
      return;
    }

    const removeBtn = ev.target.closest("[data-ex-del]");
    if (removeBtn) {
      if (removeBtn.dataset.armed !== "yes") {
        removeBtn.dataset.armed = "yes";
        removeBtn.textContent = "Sure?";
        setTimeout(() => {
          if (removeBtn.isConnected && removeBtn.dataset.armed === "yes") {
            removeBtn.dataset.armed = "";
            removeBtn.textContent = "Remove";
          }
        }, 4000);
        return;
      }
      removeExercise(dateEl.value, workout.id, exId);
      drafts.delete(exId);
      editing.delete(exId);
      seenExercises.delete(exId);
      seenSets.delete(exId);
      redraw();
    }
  });

  const unsub = subscribe((path) => {
    if (typeof path !== "string") return;
    if (path.startsWith("data/workouts/") || path === SETTINGS_PATH) redraw();
    else if (path === EXERCISES_PATH) refreshExerciseList();
  });

  refreshExerciseList();
  redraw();
  return unsub;
}

import { renderDashboard } from "./screens/dashboard.js";
import { renderWeight } from "./screens/weight.js";
import { renderFood } from "./screens/food.js";
import { renderWorkout } from "./screens/workout.js";
import { renderSettings } from "./screens/settings.js";
import { dirtyCount, subscribe } from "./store.js";
import {
  syncAll,
  refreshWeightMonths,
  refreshNutritionMonths,
  refreshWorkoutMonths,
  refreshSettings,
  refreshExercises,
} from "./sync.js";
import { todayLocalISO, monthOf, prevMonthOf } from "./dates.js";
import { showToast } from "./dom.js";

const view = document.getElementById("view");
const syncBadge = document.getElementById("sync-badge");
const menuBtn = document.getElementById("menu-btn");
const menu = document.getElementById("menu");

const routes = {
  "/": renderDashboard,
  "/weight": renderWeight,
  "/food": renderFood,
  "/workout": renderWorkout,
  "/settings": renderSettings,
};

let cleanup = null;

function currentPath() {
  const hash = location.hash.slice(1);
  return routes[hash] ? hash : "/";
}

function updateActiveLink(path) {
  for (const a of menu.querySelectorAll("a")) {
    const active = a.dataset.route === path;
    a.classList.toggle("active", active);
    // The menu is closed most of the time, so this is what tells a screen
    // reader which screen it landed on.
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

/* ── Menu ──────────────────────────────────────────────────────────────── */

function setMenu(open) {
  menu.hidden = !open;
  menuBtn.setAttribute("aria-expanded", String(open));
}

menuBtn.addEventListener("click", () => {
  const opening = menu.hidden;
  setMenu(opening);
  if (opening) menu.querySelector("a.active, a")?.focus();
});

// Tapping the link for the screen you're already on fires no hashchange, so
// close on any menu click rather than relying on the route to do it.
menu.addEventListener("click", (ev) => {
  if (ev.target.closest("a")) setMenu(false);
});

document.addEventListener("click", (ev) => {
  if (menu.hidden) return;
  if (!menu.contains(ev.target) && !menuBtn.contains(ev.target)) setMenu(false);
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !menu.hidden) {
    setMenu(false);
    menuBtn.focus();
  }
});

/* ── Routing ───────────────────────────────────────────────────────────── */

function updateSyncBadge() {
  const count = dirtyCount();
  syncBadge.textContent = String(count);
  syncBadge.classList.toggle("pending", count > 0);
  syncBadge.title = count > 0 ? `Sync ${count} pending change${count === 1 ? "" : "s"}` : "Nothing to sync";
}

function route() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  const path = currentPath();
  updateActiveLink(path);
  setMenu(false);
  view.innerHTML = "";
  cleanup = routes[path](view) || null;
  // Restart the entrance animation: the element persists across routes, so
  // the class has to be removed and re-added around a forced reflow.
  view.classList.remove("route-in");
  void view.offsetWidth;
  view.classList.add("route-in");
}

syncBadge.addEventListener("click", async () => {
  syncBadge.disabled = true;
  syncBadge.textContent = "…";
  const result = await syncAll();
  syncBadge.disabled = false;
  updateSyncBadge();
  showToast(result.message, result.ok ? "ok" : "err");
});

window.addEventListener("hashchange", route);
subscribe((path) => {
  if (path === "__dirty__") updateSyncBadge();
});

route();
updateSyncBadge();

// Background pull: settings, the exercise catalog, plus the current and
// previous month for each domain, so entries logged on the other machine
// appear shortly after load. The previous month matters for more than the 1st:
// the food screen's recent list and the workout screen's history both reach
// back across the month boundary. Screens re-render themselves via store
// subscriptions when anything changes.
const months = [monthOf(todayLocalISO())];
months.push(prevMonthOf(months[0]));
refreshSettings();
refreshExercises();
refreshWeightMonths(months);
refreshNutritionMonths(months);
refreshWorkoutMonths(months);

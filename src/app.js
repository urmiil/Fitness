import { renderDashboard } from "./screens/dashboard.js";
import { renderWeight } from "./screens/weight.js";
import { renderFood } from "./screens/food.js";
import { renderSettings } from "./screens/settings.js";
import { dirtyCount, subscribe } from "./store.js";
import { syncAll, refreshWeightMonths, refreshNutritionMonths, refreshSettings } from "./sync.js";
import { todayLocalISO, monthOf, prevMonthOf } from "./dates.js";
import { showToast } from "./dom.js";

const view = document.getElementById("view");
const syncBadge = document.getElementById("sync-badge");

const routes = {
  "/": renderDashboard,
  "/weight": renderWeight,
  "/food": renderFood,
  "/settings": renderSettings,
};

let cleanup = null;

function currentPath() {
  const hash = location.hash.slice(1);
  return routes[hash] ? hash : "/";
}

function updateActiveTab(path) {
  for (const a of document.querySelectorAll(".tabs a")) {
    a.classList.toggle("active", a.dataset.route === path);
  }
}

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
  updateActiveTab(path);
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

// Background pull: settings, plus the current and previous month for each
// domain, so entries logged on the other machine appear shortly after load.
// The previous month matters for more than the 1st: the food screen's recent
// list reaches back across the month boundary. Screens re-render themselves
// via store subscriptions when anything changes.
const months = [monthOf(todayLocalISO())];
months.push(prevMonthOf(months[0]));
refreshSettings();
refreshWeightMonths(months);
refreshNutritionMonths(months);

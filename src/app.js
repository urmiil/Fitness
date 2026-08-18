import { renderDashboard } from "./screens/dashboard.js";
import { renderSettings } from "./screens/settings.js";
import { dirtyCount, subscribe } from "./store.js";

const view = document.getElementById("view");
const syncBadge = document.getElementById("sync-badge");

const routes = {
  "/": renderDashboard,
  "/settings": renderSettings,
};

function currentPath() {
  const hash = location.hash.slice(1);
  return hash && routes[hash] ? hash : "/";
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
}

function route() {
  const path = currentPath();
  updateActiveTab(path);
  view.innerHTML = "";
  routes[path](view);
}

window.addEventListener("hashchange", route);
subscribe((path) => {
  if (path === "__dirty__") updateSyncBadge();
});

route();
updateSyncBadge();

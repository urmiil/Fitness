import { hasToken, getConfig } from "../github.js";

export function renderDashboard(root) {
  const { owner, repo } = getConfig();
  const configured = hasToken() && owner && repo;

  root.innerHTML = `
    <h1>Dashboard</h1>
    ${
      configured
        ? `<div class="empty-state">Weigh-ins, nutrition, and workouts land here in later phases.<br>Data layer is connected to <strong>${owner}/${repo}</strong>.</div>`
        : `<div class="empty-state">Not connected yet.<br><a href="#/settings">Set up your GitHub token in Settings</a> to get started.</div>`
    }
  `;
}

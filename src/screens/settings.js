import {
  getConfig,
  setConfig,
  getToken,
  setToken,
  hasToken,
  testConnection,
  readFile,
  writeFile,
} from "../github.js";
import { setCached, markDirty, clearDirty, getDirtySet } from "../store.js";
import { SETTINGS_PATH, getSettings } from "../settings.js";
import { esc } from "../dom.js";

function maskToken(token) {
  if (!token) return "";
  if (token.length <= 8) return "•".repeat(token.length);
  return token.slice(0, 4) + "•".repeat(token.length - 8) + token.slice(-4);
}

export function renderSettings(root) {
  const config = getConfig();
  const token = getToken();
  const settings = getSettings();

  root.innerHTML = `
    <h1>Settings</h1>

    <h2>GitHub connection</h2>
    <div class="card rise" style="--rise-i:0">
      <div class="field-row">
        <div class="field">
          <label for="owner">Owner</label>
          <input id="owner" value="${esc(config.owner)}" placeholder="urmiil" />
        </div>
        <div class="field">
          <label for="repo">Repo</label>
          <input id="repo" value="${esc(config.repo)}" placeholder="Fitness" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="branch">Branch</label>
          <input id="branch" value="${esc(config.branch)}" placeholder="main" />
        </div>
        <div class="field">
          <label for="visibility">Repo visibility</label>
          <select id="visibility">
            <option value="public" ${config.visibility === "public" ? "selected" : ""}>Public</option>
            <option value="private" ${config.visibility === "private" ? "selected" : ""}>Private</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="token">Personal access token</label>
        <input id="token" type="password" placeholder="${esc(token ? maskToken(token) : "github_pat_...")}" autocomplete="current-password" />
        <p class="hint">Fine-grained token scoped to this repo, Contents: Read and write only. Entered once per machine — it stays in this browser's localStorage until it expires, and is never written to the repo. Your password manager can save it (this is a password field).</p>
      </div>
      <div class="btn-row">
        <button id="test-conn" class="btn primary" type="button">Test connection</button>
        <button id="clear-token" class="btn danger" type="button">Clear token</button>
      </div>
      <p id="conn-status" class="status-line"></p>
    </div>

    <h2>Units &amp; targets</h2>
    <div class="card rise" style="--rise-i:1">
      <div class="field-row">
        <div class="field">
          <label for="weightUnit">Bodyweight unit</label>
          <select id="weightUnit">
            <option value="lb" ${settings.weightUnit === "lb" ? "selected" : ""}>lb</option>
            <option value="kg" ${settings.weightUnit === "kg" ? "selected" : ""}>kg</option>
          </select>
        </div>
        <div class="field">
          <label for="liftUnit">Lift unit</label>
          <select id="liftUnit">
            <option value="lb" ${settings.liftUnit === "lb" ? "selected" : ""}>lb</option>
            <option value="kg" ${settings.liftUnit === "kg" ? "selected" : ""}>kg</option>
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="calories">Calories</label>
          <input id="calories" type="number" class="num" value="${esc(settings.targets.calories)}" />
        </div>
        <div class="field">
          <label for="protein">Protein (g)</label>
          <input id="protein" type="number" class="num" value="${esc(settings.targets.protein)}" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="carbs">Carbs (g)</label>
          <input id="carbs" type="number" class="num" value="${esc(settings.targets.carbs)}" />
        </div>
        <div class="field">
          <label for="fat">Fat (g)</label>
          <input id="fat" type="number" class="num" value="${esc(settings.targets.fat)}" />
        </div>
      </div>
      <div class="btn-row">
        <button id="save-settings" class="btn primary" type="button">Save &amp; sync</button>
        <button id="reset-cache" class="btn danger" type="button">Reset local cache</button>
      </div>
      <p id="settings-status" class="status-line"></p>
    </div>
  `;

  wireConnectionCard(root);
  wireSettingsCard(root);
  refreshSettingsFromRemote(root);
}

function wireConnectionCard(root) {
  const status = root.querySelector("#conn-status");

  root.querySelector("#test-conn").addEventListener("click", async () => {
    setConfig({
      owner: root.querySelector("#owner").value.trim(),
      repo: root.querySelector("#repo").value.trim(),
      branch: root.querySelector("#branch").value.trim() || "main",
      visibility: root.querySelector("#visibility").value,
    });
    const tokenInput = root.querySelector("#token").value.trim();
    if (tokenInput) setToken(tokenInput);

    status.textContent = "Testing…";
    status.className = "status-line pending";
    const result = await testConnection();
    status.textContent = result.ok
      ? `Connected to ${result.data.full_name} (${result.data.private ? "private" : "public"})`
      : `Failed: ${result.message}`;
    status.className = `status-line ${result.ok ? "ok" : "err"}`;
  });

  root.querySelector("#clear-token").addEventListener("click", () => {
    setToken("");
    root.querySelector("#token").value = "";
    root.querySelector("#token").placeholder = "github_pat_...";
    status.textContent = "Token cleared. App is read-only until a new token is set.";
    status.className = "status-line pending";
  });
}

function wireSettingsCard(root) {
  const status = root.querySelector("#settings-status");

  root.querySelector("#save-settings").addEventListener("click", async () => {
    const local = {
      schemaVersion: 1,
      weightUnit: root.querySelector("#weightUnit").value,
      liftUnit: root.querySelector("#liftUnit").value,
      targets: {
        calories: Number(root.querySelector("#calories").value) || 0,
        protein: Number(root.querySelector("#protein").value) || 0,
        carbs: Number(root.querySelector("#carbs").value) || 0,
        fat: Number(root.querySelector("#fat").value) || 0,
      },
    };

    setCached(SETTINGS_PATH, local);

    if (!hasToken()) {
      markDirty(SETTINGS_PATH);
      status.textContent = "Saved locally. Add a token in the connection card to sync.";
      status.className = "status-line pending";
      return;
    }

    status.textContent = "Syncing…";
    status.className = "status-line pending";
    try {
      const written = await writeFile(SETTINGS_PATH, () => local, "Update settings.json");
      setCached(SETTINGS_PATH, written);
      clearDirty(SETTINGS_PATH);

      // Round-trip proof: read the file back and confirm it matches.
      const readBack = await readFile(SETTINGS_PATH);
      const matches = JSON.stringify(readBack) === JSON.stringify(written);
      status.textContent = matches
        ? "Synced — write/read round-trip confirmed."
        : "Synced, but read-back didn't match — check the repo's recent commits.";
      status.className = `status-line ${matches ? "ok" : "err"}`;
    } catch (err) {
      markDirty(SETTINGS_PATH);
      status.textContent = `Sync failed: ${err.message}`;
      status.className = "status-line err";
    }
  });

  root.querySelector("#reset-cache").addEventListener("click", () => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("fitness.cache.")) localStorage.removeItem(key);
    }
    localStorage.removeItem("fitness.dirty");
    status.textContent = "Local cache cleared.";
    status.className = "status-line pending";
  });
}

async function refreshSettingsFromRemote(root) {
  // Never clobber the form with remote values while a local edit is waiting
  // to be pushed.
  if (getDirtySet().has(SETTINGS_PATH)) return;
  try {
    const remote = await readFile(SETTINGS_PATH);
    if (!remote) return;
    setCached(SETTINGS_PATH, remote);
    // Read back through getSettings so a hand-edited file missing a key still
    // fills every input.
    const s = getSettings();
    root.querySelector("#weightUnit").value = s.weightUnit;
    root.querySelector("#liftUnit").value = s.liftUnit;
    root.querySelector("#calories").value = s.targets.calories;
    root.querySelector("#protein").value = s.targets.protein;
    root.querySelector("#carbs").value = s.targets.carbs;
    root.querySelector("#fat").value = s.targets.fat;
  } catch {
    // Offline or unreachable — cached/default values already rendered.
  }
}

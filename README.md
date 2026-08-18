# Fitness Tracker

A single-user fitness tracker. Static site, no backend — data lives as JSON in
this repo and is read/written through the GitHub API straight from the browser.

**Status: Phase 1 of 6.** The data layer and Settings screen work. Weight,
nutrition, and workout logging are not built yet.

---

## Running it

The app must be served over HTTP. Opening `index.html` by double-clicking it
will not work — ES modules are blocked under the `file://` origin.

**Windows:**

```powershell
.\serve.ps1
```

That serves the folder at <http://localhost:8123/> and opens your browser.
Use `.\serve.ps1 -Port 9000` if that port is taken, `-NoBrowser` to skip
launching a tab. Stop it with Ctrl+C. It uses a server built into Windows, so
it works whether or not Python is installed.

**Either platform** (Python 3.13 is installed on the Windows machine):

```bash
python -m http.server 8123
```

On macOS use `python3` instead of `python`. Then open
<http://localhost:8123/>.

> If `python` ever opens the Microsoft Store instead of running, the Store's
> placeholder aliases have taken precedence again. Turn them off under
> Settings → Apps → Advanced app settings → App execution aliases
> (`python.exe` and `python3.exe`), or just use `.\serve.ps1`.

---

## First-time setup

The app needs a GitHub token to write data. It reads without one (this repo is
public), but every logging action needs write access.

1. **Create a fine-grained token** at
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - **Repository access:** Only select repositories → `urmiil/Fitness`
   - **Permissions:** Repository permissions → **Contents: Read and write**
   - Nothing else. That single permission is all the app uses.
   - Set an expiry you're happy with; you'll re-paste it here when it lapses.

2. **Paste it into the app:** Settings → Personal access token.

3. **Click "Test connection."** You should see
   `Connected to urmiil/Fitness (public)`.

4. **Click "Save & sync"** in the Units & targets card. If the round-trip
   works you'll see `Synced — write/read round-trip confirmed`, and a new
   commit will appear in this repo touching `data/settings.json`.

The token is stored in that browser's `localStorage` and **never written to
the repo**. It's per-browser, so you'll repeat this once on each machine.
"Clear token" removes it and drops the app to read-only.

---

## What works right now

- **Settings → GitHub connection.** Owner/repo/branch/visibility, token entry
  with a masked display, connection test, clear token.
- **Settings → Units & targets.** Bodyweight and lift units (independently),
  calorie and macro targets. Saving pushes `data/settings.json` to the repo so
  targets follow you between machines.
- **Dashboard.** A placeholder that reports connection state.

The sync-count badge in the header shows pending unsynced changes. It stays at
zero until there's something to log.

## What doesn't work yet

Weight logging (Phase 2), nutrition (Phase 3), workouts (Phase 4), history and
charts (Phase 5), polish (Phase 6). Build order and full spec are in the local
`fitness-tracker-spec.md`, which is deliberately gitignored — this repo is
public and holds personal data, so the spec stays on your machine.

---

## Layout

```
index.html          app shell + router mount
style.css           dark theme, tabular figures, 48px touch targets
serve.ps1           static file server for Windows
src/
  app.js            hash router, sync badge
  github.js         all network I/O — read/write, 409 retry
  base64.js         unicode-safe base64 (btoa alone breaks on é, emoji…)
  merge.js          union-by-id merge, updatedAt wins, tombstones
  store.js          localStorage cache + dirty set + subscribe/notify
  screens/          dashboard.js, settings.js
data/
  manifest.json     index of which month files exist
  settings.json     units + targets (synced, no secrets)
  exercises.json    ~38 seed movements for autocomplete
  weight/ nutrition/ workouts/     YYYY-MM.json per domain
```

Rendering never calls `fetch` directly; it goes through `store.js` and
`github.js`. Keep it that way.

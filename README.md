# Fitness Tracker

A single-user fitness tracker. Static site, no backend — data lives as JSON in
this repo and is read/written through the GitHub API straight from the browser.

**Status: Phase 2 of 6.** Weight logging works end to end. Nutrition and
workouts are not built yet.

---

## Running it

The app must be served over HTTP. Opening `index.html` by double-clicking it
will not work — ES modules are blocked under the `file://` origin.

**Windows:**

```powershell
.\serve.ps1
```

That serves the folder at <http://localhost:47613/> and opens your browser.
It uses a server built into Windows, so it works whether or not Python is
installed. `-NoBrowser` skips launching a tab; stop it with Ctrl+C.

**macOS** (or anywhere with Python):

```bash
python3 -m http.server 47613
```

Then open <http://localhost:47613/>.

**Always use the same port.** The token and settings are stored per-origin,
and `localhost:47613` and `localhost:8000` are different origins — switch
ports and the app looks signed out. 47613 was chosen because nothing else
will ever squat on it (see Security model below). If you ran an early version
of this app on port 8123 and pasted a token there, that copy is stranded on
the old origin — visit the old port once and press "Clear token", or just let
it expire.

> If `python` opens the Microsoft Store instead of running: Settings → Apps →
> Advanced app settings → App execution aliases, turn off `python.exe` /
> `python3.exe`. Or just use `.\serve.ps1`.

---

## First-time setup (once per machine)

The app reads this public repo without any credentials. Writing — actually
logging anything — needs a token:

1. **Create a fine-grained token** at
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - **Repository access:** Only select repositories → `urmiil/Fitness`
   - **Permissions:** Repository permissions → **Contents: Read and write**
   - Nothing else. Set the longest expiry you're comfortable with.
2. **Paste it into the app:** Settings → Personal access token, then
   **Test connection** → expect `Connected to urmiil/Fitness (public)`.

That's it — the token persists in that browser until it expires. You are
never asked for it again on that machine. The field is a password field, so a
password manager will offer to save it for the eventual re-entry.

---

## Using it

- **Log a weigh-in:** Weight tab → the date defaults to today and the value
  prefills from your last entry, so most days it's two stepper taps and Save.
  Picking a date that already has an entry switches the form to editing it.
- **Everything saves locally first, instantly.** The badge in the header
  counts unsynced files — press it to push them to GitHub. Each sync is a
  commit, so your git history doubles as an audit log.
- **Two machines:** log freely on both, even if you forget to sync. Syncing
  merges by entry (newest edit wins, deletes stick) instead of overwriting.
- **Dashboard** shows current weight, 7-day change, and whether today is
  logged.
- **Units** (lb/kg) and calorie/macro targets live in Settings and sync
  through the repo.

Not built yet: nutrition (Phase 3), workouts (Phase 4), history and charts
(Phase 5), auto-sync polish (Phase 6). The full spec is in the local
`fitness-tracker-spec.md`, deliberately gitignored — this repo is public.

---

## Security model

Worth reading once, since the app handles a GitHub credential in a browser.

**What the token is.** A fine-grained PAT scoped to this one repository with
Contents read/write and nothing else. If it leaked, the holder could push
commits to this repo — vandalism, recoverable from git history. They could
not touch your account, other repos, or settings. Revoke it any time at
github.com → Settings → Developer settings.

**Where it lives.** In `localStorage` for the exact origin
`http://localhost:47613`, on your machine, under your OS user account. It is
never written to a file, never put in a URL, and sent to exactly one place:
the `Authorization` header of requests to `https://api.github.com` over
HTTPS. `src/github.js` enforces that last part mechanically — the only
function that attaches the token refuses any other destination.

**Why the weird port.** `localStorage` is shared by everything ever served on
the same origin. Serve some random project on the same port later and its
code — and its entire npm dependency tree — could read the token. That's the
one real structural risk of this design, and a dedicated obscure port is the
mitigation: nothing else you run will ever be `localhost:47613`. Don't reuse
the port for other projects.

**The repo being public doesn't expose the token.** Public means the *data*
(weights, meals) is world-readable — a deliberate trade for free, fast reads.
The token never enters the repo; `.gitignore` guards the obvious accident
paths too.

**Escaping.** Anything the app renders (notes, names, config) is
HTML-escaped at the template boundary (`esc()` in `src/dom.js`), because XSS
is the one attack that could read the token from inside the origin. Keep
using it for every interpolation.

**Alternatives considered and rejected.** OAuth device flow needs a server
(GitHub's OAuth endpoints don't allow browser-only CORS). A local helper
endpoint shelling out to `git` would expose a localhost API that any website
you visit can probe — strictly worse. Encrypting the token into the repo puts
brute-forceable ciphertext in public. For a zero-backend app, a
narrowly-scoped PAT in a dedicated origin is the sound design.

---

## Layout

```
index.html          app shell + router mount
style.css           dark theme, tabular figures, 48px touch targets
serve.ps1           static file server for Windows (dedicated port 47613)
src/
  app.js            hash router, sync button, background refresh
  github.js         ALL network I/O — token boundary lives here
  base64.js         unicode-safe base64 (btoa alone breaks on é, emoji…)
  merge.js          union-by-id merge, updatedAt wins, tombstones
  store.js          localStorage cache + dirty set + subscribe/notify
  sync.js           push dirty files, pull remote months
  weight.js         weight domain logic (upsert, tombstone, stats, units)
  manifest.js       month-file index handling
  dates.js          local-time date helpers (never toISOString for "today")
  dom.js            esc() XSS boundary + toast
  id.js             sortable collision-resistant IDs
  screens/          dashboard.js, weight.js, settings.js
data/
  manifest.json     index of which month files exist
  settings.json     units + targets (synced, no secrets)
  exercises.json    ~38 seed movements for autocomplete
  weight/ nutrition/ workouts/     YYYY-MM.json per domain
```

Rendering never calls `fetch` directly; it goes through `store.js` and
`github.js`. Keep it that way.

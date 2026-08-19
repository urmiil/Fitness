// Data layer: all GitHub reads/writes go through this module. Rendering code
// must never call fetch directly (see spec section 7).
//
// Read strategy:
//   - token present -> authenticated Contents API. API reads are
//     read-your-writes consistent *provided* the browser HTTP cache is out of
//     the way (see apiFetch); raw.githubusercontent.com sits behind a
//     ~5-minute CDN cache, so raw reads right after a sync would make
//     just-saved data appear to revert.
//   - no token, public repo -> raw.githubusercontent.com (fast, uncounted),
//     falling back to the unauthenticated Contents API (60 req/hr) on error.
//     Note raw also negative-caches 404s for ~5 min, so tokenless reads of a
//     brand-new file can lag; browse-only mode is best-effort by design.
// Writes always go through the authenticated Contents API.
//
// Security invariant: the token is attached by apiFetch() and nowhere else,
// and apiFetch refuses any URL outside https://api.github.com. Keep it that
// way — it is what makes the localStorage token tolerable.

import { utf8ToBase64, base64ToUtf8 } from "./base64.js";

const CONFIG_KEY = "fitness.config";

const DEFAULT_CONFIG = {
  owner: "urmiil",
  repo: "Fitness",
  branch: "main",
  visibility: "public", // "public" | "private"
};

export function getConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    return { ...DEFAULT_CONFIG, ...stored };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function setConfig(partial) {
  const merged = { ...getConfig(), ...partial };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
  return merged;
}

export function getToken() {
  return localStorage.getItem("fitness.token") || "";
}

export function setToken(token) {
  if (token) localStorage.setItem("fitness.token", token);
  else localStorage.removeItem("fitness.token");
}

export function hasToken() {
  return Boolean(getToken());
}

const API_ORIGIN = "https://api.github.com";

function authHeaders(extra = {}) {
  const token = getToken();
  return {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

// The only place the token is attached to a request. Hard-refuses any
// destination other than the GitHub API so a future bug can't leak it.
function apiFetch(url, opts = {}) {
  if (!url.startsWith(API_ORIGIN + "/")) {
    throw new Error(`Refusing to send credentials to non-API URL: ${url}`);
  }
  // cache: "no-store" is load-bearing, not hygiene. GitHub answers API reads
  // with `Cache-Control: private, max-age=60`, so for a minute after a write
  // the browser serves our own GET from its HTTP cache — with the file's
  // pre-write sha. Writing against that sha 409s, and because the 409 retry
  // re-reads through the same cache, it 409s again and the error surfaces.
  // The API is read-your-writes consistent; the cache in front of it isn't.
  return fetch(url, { ...opts, cache: "no-store", headers: authHeaders(opts.headers || {}) });
}

/**
 * GitHub puts the actual reason in the response body — "Resource not accessible
 * by personal access token", "Repository rule violations found", a secondary
 * rate-limit notice. A bare status code sends you guessing, so keep the text
 * and hang the status on the error for callers that want to react to it.
 */
async function apiError(res, what) {
  let detail = "";
  try {
    const body = await res.json();
    if (body?.message) detail = body.message;
    const nested = (body?.errors || [])
      .map((e) => e?.message || e?.code)
      .filter(Boolean)
      .join("; ");
    if (nested) detail += detail ? ` (${nested})` : nested;
  } catch {
    // Non-JSON body — the status has to speak for itself.
  }
  const err = new Error(`${what} failed: ${res.status}${detail ? ` — ${detail}` : ""}`);
  err.status = res.status;
  return err;
}

/**
 * The next step for a failed write, for errors whose message alone doesn't
 * suggest one. A 403 here is almost always the token's Contents permission:
 * reads succeed with read-only access, so nothing goes wrong until the first
 * sync.
 */
export function permissionHint(err) {
  if (err?.status !== 403) return "";
  const text = String(err.message || "").toLowerCase();
  if (text.includes("rule violation") || text.includes("protected branch")) {
    return " — a branch rule on this repo is blocking direct pushes.";
  }
  if (text.includes("rate limit")) return " — GitHub is rate-limiting; wait a minute and sync again.";
  return " — this token can read the repo but not write to it. Set Contents: Read and write on it, then test the connection again.";
}

function contentsUrl(path, { withRef = false } = {}) {
  const { owner, repo, branch } = getConfig();
  const base = `${API_ORIGIN}/repos/${owner}/${repo}/contents/${path}`;
  // GETs need ?ref= to honor a non-default branch; PUTs name it in the body.
  return withRef ? `${base}?ref=${encodeURIComponent(branch)}` : base;
}

function rawUrl(path) {
  const { owner, repo, branch } = getConfig();
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}

/** GET /repos/{owner}/{repo} — used by the Settings "Test connection" button. */
export async function testConnection() {
  const { owner, repo } = getConfig();
  if (!owner || !repo) return { ok: false, status: 0, message: "Owner/repo not set" };
  try {
    const res = await apiFetch(`${API_ORIGIN}/repos/${owner}/${repo}`);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: "Token rejected or insufficient permissions" };
    }
    if (res.status === 404) {
      return { ok: false, status: 404, message: "Repo not found (check owner/repo, or token scope)" };
    }
    if (!res.ok) return { ok: false, status: res.status, message: `Unexpected error (${res.status})` };
    const data = await res.json();
    // NB: data.permissions describes the *account's* rights on the repo, not
    // the token's. A fine-grained PAT with no grant on this repo still reports
    // admin/push true for the owner, and reads of a public repo need no grant
    // at all — which is why a bad token gets all the way to the first sync
    // before anything complains. Ask the write endpoint instead.
    const write = await testWriteAccess();
    return {
      ok: true,
      status: 200,
      message: "Connected",
      data,
      canWrite: write.canWrite,
      writeStatus: write.status,
      writeMessage: write.message,
      archived: Boolean(data?.archived),
    };
  } catch (err) {
    return { ok: false, status: 0, message: err.message };
  }
}

/**
 * Does this token's Contents permission actually cover writing?
 *
 * The request is a PUT with no `content` field — invalid by construction, so it
 * can never create a commit. GitHub authorizes the route before it validates
 * the body, so a token without write access is refused with 403 while one that
 * has it gets as far as 422 "content wasn't supplied". Treat only 403 as proof
 * of the negative; anything else means authorization was passed.
 */
export async function testWriteAccess() {
  if (!hasToken()) return { canWrite: false, status: 0, message: "No token set" };
  try {
    const res = await apiFetch(contentsUrl("data/.write-check"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "write-access probe", branch: getConfig().branch }),
    });
    if (res.status === 403) {
      const err = await apiError(res, "Write check");
      return { canWrite: false, status: 403, message: err.message };
    }
    return { canWrite: true, status: res.status, message: "" };
  } catch (err) {
    return { canWrite: false, status: 0, message: err.message };
  }
}

/**
 * Fetch a file's current content + sha via the authenticated Contents API.
 * Returns { sha: undefined, data: null } if the file doesn't exist yet.
 */
async function getFileWithSha(path) {
  const res = await apiFetch(contentsUrl(path, { withRef: true }));
  if (res.status === 404) return { sha: undefined, data: null };
  if (!res.ok) throw await apiError(res, `GET ${path}`);
  const file = await res.json();
  const data = JSON.parse(base64ToUtf8(file.content));
  return { sha: file.sha, data };
}

/**
 * Read a JSON file. Returns parsed data, or null if the file doesn't exist.
 * Prefers the consistent authenticated API whenever a token exists; the raw
 * CDN is only used for tokenless browsing of a public repo (see header note).
 */
export async function readFile(path) {
  if (hasToken()) {
    const { data } = await getFileWithSha(path);
    return data;
  }

  const { visibility } = getConfig();
  if (visibility === "public") {
    try {
      const res = await fetch(rawUrl(path), { cache: "no-store" });
      if (res.status === 404) return null;
      if (res.ok) return await res.json();
      // Unexpected status — fall through to the unauthenticated API.
    } catch {
      // Network error on raw host — fall through.
    }
  }

  // Unauthenticated Contents API: works for public repos (60 req/hr cap),
  // 404s for private ones, which surfaces as the read-only empty state.
  const { data } = await getFileWithSha(path);
  return data;
}

/**
 * Write a JSON file with GET-merge-PUT semantics and one retry on a 409
 * (stale sha) conflict.
 *
 * @param {string} path
 * @param {(remote: object|null) => object} transform - given the current
 *   remote content (or null if the file doesn't exist), returns the merged
 *   content to write.
 * @param {string} message - commit message
 */
export async function writeFile(path, transform, message) {
  if (!hasToken()) throw new Error("No token set — cannot write");

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * attempt));
    const { sha, data: remote } = await getFileWithSha(path);
    const merged = transform(remote);
    const body = {
      message,
      content: utf8ToBase64(JSON.stringify(merged, null, 2)),
      branch: getConfig().branch,
      ...(sha ? { sha } : {}),
    };
    const res = await apiFetch(contentsUrl(path), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return merged;
    // Stale sha: re-GET (uncached now) and merge against what is really there.
    if (res.status === 409 && attempt < 2) continue;
    throw await apiError(res, `PUT ${path}`);
  }
}

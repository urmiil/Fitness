// Data layer: all GitHub reads/writes go through this module. Rendering code
// must never call fetch directly (see spec section 7).
//
// Read strategy:
//   - token present -> authenticated Contents API. API reads are
//     read-your-writes consistent; raw.githubusercontent.com sits behind a
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
  return fetch(url, { ...opts, headers: authHeaders(opts.headers || {}) });
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
    return { ok: true, status: 200, message: "Connected", data };
  } catch (err) {
    return { ok: false, status: 0, message: err.message };
  }
}

/**
 * Fetch a file's current content + sha via the authenticated Contents API.
 * Returns { sha: undefined, data: null } if the file doesn't exist yet.
 */
async function getFileWithSha(path) {
  const res = await apiFetch(contentsUrl(path, { withRef: true }));
  if (res.status === 404) return { sha: undefined, data: null };
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
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

  for (let attempt = 0; attempt < 2; attempt++) {
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
    if (res.status === 409 && attempt === 0) continue; // stale sha, re-GET and retry once
    throw new Error(`PUT ${path} failed: ${res.status}`);
  }
}

// Data layer: all GitHub reads/writes go through this module. Rendering code
// must never call fetch directly (see spec section 7).
//
// Read strategy is swappable per repo visibility:
//   - "public"  -> unauthenticated raw.githubusercontent.com (fast, doesn't
//                  count against the API rate limit)
//   - "private" -> authenticated Contents API (raw.githubusercontent.com
//                  won't serve private files without auth either way)
// Writes always go through the authenticated Contents API.

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

function authHeaders(extra = {}) {
  const token = getToken();
  return {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

function contentsUrl(path) {
  const { owner, repo } = getConfig();
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
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
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: authHeaders(),
    });
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
  const res = await fetch(contentsUrl(path), { headers: authHeaders() });
  if (res.status === 404) return { sha: undefined, data: null };
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  const file = await res.json();
  const data = JSON.parse(base64ToUtf8(file.content));
  return { sha: file.sha, data };
}

/**
 * Read a JSON file. Returns parsed data, or null if the file doesn't exist.
 * Uses the fast unauthenticated path for public repos, falls back to the
 * authenticated Contents API for private repos or when raw access fails.
 */
export async function readFile(path) {
  const { visibility } = getConfig();

  if (visibility === "public") {
    try {
      const res = await fetch(rawUrl(path), { cache: "no-store" });
      if (res.status === 404) return null;
      if (res.ok) return await res.json();
      // Fall through to authenticated path on unexpected errors.
    } catch {
      // Network error on raw host — fall through.
    }
  }

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
    const res = await fetch(contentsUrl(path), {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (res.ok) return merged;
    if (res.status === 409 && attempt === 0) continue; // stale sha, re-GET and retry once
    throw new Error(`PUT ${path} failed: ${res.status}`);
  }
}

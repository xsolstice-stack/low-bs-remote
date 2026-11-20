// Tiny Spotify Web API client. The token source is supplied by the platform
// (desktop app backend, or browser PKCE login on the phone).

const BASE = 'https://api.spotify.com/v1';
let tokenSource = async () => { throw new Error('Not logged in'); };
const cache = new Map();

export class ApiError extends Error {
  constructor(status, message, reason) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

export function setTokenSource(fn) {
  tokenSource = fn;
}

function buildUrl(path, query) {
  const url = new URL(path.startsWith('http') ? path : BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

export async function api(path, { method = 'GET', query, body } = {}) {
  const token = await tokenSource();
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.status === 429) {
    const wait = res.headers.get('Retry-After');
    throw new ApiError(429, `Spotify is rate-limiting requests. Try again in ${wait || 'a few'} seconds.`);
  }
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, data?.error?.reason);
  }
  return data;
}

// GET with a short in-memory cache, so moving around the app doesn't refetch.
export async function cached(path, query, ttlMs = 5 * 60 * 1000) {
  const key = buildUrl(path, query);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.data;
  const data = await api(path, { query });
  cache.set(key, { t: Date.now(), data });
  return data;
}

export function clearCache() {
  cache.clear();
}

// Pick the smallest image that is at least `min` px wide.
export function pickImage(images, min = 64) {
  if (!images || !images.length) return null;
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 640) >= min) || sorted[sorted.length - 1]).url;
}

export function idFromUri(uri) {
  return uri ? uri.split(':').pop() : '';
}

// Body for PUT /me/player/play from a {context_uri, uris, offset_uri, offset_index} request.
export function playBody(req) {
  const body = {};
  if (req.context_uri) body.context_uri = req.context_uri;
  if (req.uris) body.uris = req.uris;
  if (req.offset_uri) body.offset = { uri: req.offset_uri };
  else if (req.offset_index != null) body.offset = { position: req.offset_index };
  return body;
}

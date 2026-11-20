// Web / phone platform: logs in with Spotify in the browser (PKCE, no server)
// and acts as a remote control for any Spotify Connect device, including the
// desktop app.

import { api, ApiError, pickImage, playBody } from './api.js';
import { toast } from './dom.js';
import { setupScreen } from './setup.js';

const LS_CLIENT = 'lbs.clientId';
const LS_TOKENS = 'lbs.tokens';
const LS_VERIFIER = 'lbs.pkce';
const LS_DEVICE = 'lbs.deviceId';
const SCOPES = [
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-library-read',
  'user-follow-read',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

const redirectUri = location.origin + location.pathname.replace(/index\.html$/, '');

function readJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function tokenRequest(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: localStorage.getItem(LS_CLIENT), ...params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Token request failed');
  const old = readJSON(LS_TOKENS) || {};
  const tokens = {
    access: data.access_token,
    refresh: data.refresh_token || old.refresh,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  localStorage.setItem(LS_TOKENS, JSON.stringify(tokens));
  return tokens;
}

let refreshing = null;
async function getToken() {
  const t = readJSON(LS_TOKENS);
  if (!t) throw new Error('Not logged in');
  if (t.expires_at - Date.now() > 60_000) return t.access;
  refreshing ||= tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh })
    .finally(() => { refreshing = null; });
  return (await refreshing).access;
}

async function startLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  localStorage.setItem(LS_VERIFIER, verifier);
  const url = new URL('https://accounts.spotify.com/authorize');
  url.search = new URLSearchParams({
    client_id: localStorage.getItem(LS_CLIENT),
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
  });
  location.assign(url);
}

// Handles the ?code=... redirect back from Spotify.
async function finishLogin() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return;
  history.replaceState(null, '', redirectUri + location.hash);
  if (error) {
    toast(`Spotify login failed: ${error}`);
    return;
  }
  await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: localStorage.getItem(LS_VERIFIER),
  });
  localStorage.removeItem(LS_VERIFIER);
}

// ---- Remote-control player state (polled from the Web API) ----

let state = { connected: true, active: false, playing: false, position_ms: 0, updated_at: Date.now(), volume: 50, shuffle: false, repeat: 'off', track: null, device: null };
const listeners = new Set();
let pollTimer = null;

function emit() {
  for (const cb of listeners) cb(state);
}

function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

async function poll() {
  try {
    const p = await api('/me/player', { query: { additional_types: 'episode' } });
    if (!p) {
      setState({ active: false, playing: false, track: null, device: null });
      return;
    }
    const item = p.item;
    setState({
      active: true,
      playing: p.is_playing,
      position_ms: p.progress_ms || 0,
      updated_at: Date.now(),
      volume: p.device?.volume_percent ?? state.volume,
      shuffle: p.shuffle_state,
      repeat: p.repeat_state,
      device: p.device?.name || null,
      device_id: p.device?.id || null,
      track: item ? {
        uri: item.uri,
        name: item.name,
        artists: (item.artists || []).map((a) => ({ name: a.name, uri: a.uri })),
        album: item.album?.name || item.show?.name || '',
        album_uri: item.album?.uri,
        image: pickImage(item.album?.images || item.images, 200),
        duration_ms: item.duration_ms,
      } : null,
      context_uri: p.context?.uri || null,
    });
  } catch (e) {
    if (e.status !== 429) console.warn(e);
  }
}

function schedulePoll(delay = 3000) {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = setTimeout(async () => {
    await poll();
    schedulePoll();
  }, delay);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) schedulePoll(0);
});

function deviceQuery() {
  if (state.active) return {};
  const id = localStorage.getItem(LS_DEVICE);
  return id ? { device_id: id } : {};
}

async function withDevice(fn) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      // No active device: ask which one to play on.
      platform.openDevices?.();
      throw new Error('Pick a device to play on.');
    }
    throw e;
  }
  schedulePoll(600);
}

export const platform = {
  kind: 'web',
  searchLimit: 10, // Spotify caps search at 10 results for personal apps
  hasDevicePicker: true,

  async isLoggedIn() {
    await finishLogin();
    return !!readJSON(LS_TOKENS);
  },

  renderLogin(root) {
    setupScreen(root, {
      title: 'Low BS Remote',
      blurb: 'Control your music from your phone. One-time setup:',
      redirectUri,
      clientId: localStorage.getItem(LS_CLIENT),
      async onLogin(id) {
        localStorage.setItem(LS_CLIENT, id);
        await startLogin();
      },
    });
  },

  async logout() {
    localStorage.removeItem(LS_TOKENS);
  },

  getToken,

  async play(req) {
    await withDevice(() => api('/me/player/play', { method: 'PUT', query: deviceQuery(), body: playBody(req) }));
  },

  async queue() {
    const r = await api('/me/player/queue');
    return (r?.queue || []).filter((t) => t && t.type === 'track');
  },

  async control(action, value) {
    const q = deviceQuery();
    switch (action) {
      case 'toggle':
        setState({ playing: !state.playing, position_ms: currentPos(), updated_at: Date.now() });
        return withDevice(() => api(`/me/player/${state.playing ? 'play' : 'pause'}`, { method: 'PUT', query: q }));
      case 'next':
        return withDevice(() => api('/me/player/next', { method: 'POST', query: q }));
      case 'prev':
        return withDevice(() => api('/me/player/previous', { method: 'POST', query: q }));
      case 'seek':
        setState({ position_ms: value, updated_at: Date.now() });
        return withDevice(() => api('/me/player/seek', { method: 'PUT', query: { ...q, position_ms: Math.round(value) } }));
      case 'volume':
        setState({ volume: value });
        return withDevice(() => api('/me/player/volume', { method: 'PUT', query: { ...q, volume_percent: Math.round(value) } }));
      case 'shuffle':
        setState({ shuffle: !!value });
        return withDevice(() => api('/me/player/shuffle', { method: 'PUT', query: { ...q, state: !!value } }));
      case 'repeat': {
        const mode = ['off', 'context', 'track'][value] || 'off';
        setState({ repeat: mode });
        return withDevice(() => api('/me/player/repeat', { method: 'PUT', query: { ...q, state: mode } }));
      }
    }
  },

  onState(cb) {
    listeners.add(cb);
    cb(state);
    schedulePoll(0);
  },

  async devices() {
    const r = await api('/me/player/devices');
    return r?.devices || [];
  },

  async transfer(deviceId) {
    localStorage.setItem(LS_DEVICE, deviceId);
    await api('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: true } });
    schedulePoll(800);
  },
};

function currentPos() {
  return state.position_ms + (state.playing ? Date.now() - state.updated_at : 0);
}

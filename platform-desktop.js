// Desktop (Tauri) platform: audio plays through Spotify Soloist (Spotify's
// official headless player), supervised by the Rust backend. Browsing uses the
// Web API with the user's own Client ID.

import { api, playBody } from './api.js';
import { h, toast } from './dom.js';
import { setupScreen } from './setup.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const DEVICE_NAME = 'Low BS Player';
let eqCallback = null;
let eqListening = false;

window.__lbsLog = (level, msg) => invoke('ui_log', { level, msg: String(msg) }).catch(() => {});
window.addEventListener('error', (e) => window.__lbsLog('error', `${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => window.__lbsLog('error', `unhandled: ${e.reason?.stack || e.reason}`));

// Spotify Connect device id of this computer, for Web API calls that need an
// offset (e.g. "play this playlist starting at song 7").
let deviceCache = { id: null, t: 0 };
async function deviceId() {
  if (deviceCache.id && Date.now() - deviceCache.t < 5 * 60_000) return deviceCache.id;
  const r = await api('/me/player/devices');
  const d = (r?.devices || []).find((x) => x.name === DEVICE_NAME);
  deviceCache = { id: d?.id || null, t: Date.now() };
  return deviceCache.id;
}

const SOLOIST_DOCS = 'https://developer.spotify.com/documentation/soloist';
const SOLOIST_KEYS = 'https://developer.spotify.com/dashboard/soloist';

function link(href, text) {
  return h('a', { href, target: '_blank', rel: 'noopener' }, text);
}

export const platform = {
  kind: 'desktop',
  searchLimit: 10, // Spotify caps search at 10 results for personal apps
  hasDevicePicker: false,

  async isLoggedIn() {
    return invoke('auth_status');
  },

  renderLogin(root, onDone) {
    invoke('get_client_id').then((clientId) => setupScreen(root, {
      title: 'Low BS Player',
      blurb: 'Spotify Premium without the bloat. One-time setup:',
      redirectUri: 'http://127.0.0.1:8898/login',
      clientId,
      async onLogin(id, status) {
        await invoke('set_client_id', { id });
        status('Finish logging in in your browser, then come back here.');
        await invoke('login');
        onDone();
      },
    }));
  },

  logout: () => invoke('logout'),
  getToken: () => invoke('web_token'),

  async play(req) {
    const simple = req.context_uri && !req.offset_uri && req.offset_index == null;
    if (simple) return invoke('play_uri', { uri: req.context_uri });
    // Starting partway through a list needs the Web API, aimed at this computer.
    let id = await deviceId().catch(() => null);
    if (!id) {
      await invoke('control', { action: 'transfer', value: null }).catch(() => {});
      deviceCache.t = 0;
      await new Promise((r) => setTimeout(r, 800));
      id = await deviceId().catch(() => null);
    }
    if (id) {
      try {
        await api('/me/player/play', { method: 'PUT', query: { device_id: id }, body: playBody(req) });
        return;
      } catch (e) {
        if (e.status !== 404) throw e;
        deviceCache.t = 0;
      }
    }
    // Fallback: play just the chosen item locally.
    return invoke('play_uri', { uri: req.offset_uri || req.uris?.[0] || req.context_uri });
  },

  control: (action, value) => invoke('control', { action, value: value ?? null }),

  onState(cb) {
    listen('player-state', (e) => cb(e.payload));
    invoke('player_state').then(cb);
  },

  // Upcoming songs, straight from the player. This is how Release Radar's
  // songs can be seen even though the Web API won't list them.
  async queue() {
    const got = new Promise((resolve) => {
      let unlisten;
      const timer = setTimeout(() => { unlisten?.(); resolve([]); }, 4000);
      listen('queue', (e) => {
        clearTimeout(timer);
        unlisten?.();
        resolve(e.payload.upcoming || []);
      }).then((u) => { unlisten = u; });
    });
    await invoke('request_queue');
    return got;
  },

  // Equalizer (desktop only).
  hasEq: true,
  getEq: () => invoke('get_eq'),
  setEq: (settings) => invoke('set_eq', { settings }),
  // One listener; the EQ screen replaces the callback each time it opens.
  onEq(cb) {
    eqCallback = cb;
    if (!eqListening) {
      eqListening = true;
      listen('eq-state', (e) => eqCallback?.(e.payload));
    }
  },

  // Panel shown until playback is set up (Soloist key, download, pairing).
  setupPanel(state) {
    const s = state.setup;
    if (!s || s === 'ready' || s === 'starting') return null;
    const box = (title, ...body) => h('div', { class: 'setup-panel' }, h('h3', {}, title), ...body);
    const err = state.error ? h('p', { class: 'setup-err' }, state.error) : null;
    const downloadBtn = (label) => {
      const b = h('button', { class: 'primary' }, label);
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = 'Downloading from Spotify…';
        try {
          await invoke('download_soloist');
        } catch (e) {
          toast(String(e));
          b.disabled = false;
          b.textContent = label;
        }
      };
      return b;
    };
    switch (s) {
      case 'need_key': {
        const input = h('input', { type: 'text', placeholder: 'Soloist API key', spellcheck: 'false', autocomplete: 'off' });
        const save = h('button', { class: 'primary' }, 'Save');
        save.onclick = async () => {
          try {
            await invoke('set_soloist_key', { key: input.value });
          } catch (e) {
            toast(String(e));
          }
        };
        return box('Set up playback (1 of 3)',
          h('p', {}, 'Music plays through ', link(SOLOIST_DOCS, 'Spotify Soloist'), ', Spotify’s official lightweight player. It needs a free key tied to your account:'),
          h('ol', { class: 'steps' },
            h('li', {}, 'Open ', link(SOLOIST_KEYS, 'developer.spotify.com/dashboard/soloist'), ' and generate a key.'),
            h('li', {}, 'Paste it here. It’s stored only on this computer.')),
          h('div', { class: 'pinrow' }, input, save), err);
      }
      case 'need_download':
        return box('Set up playback (2 of 3)',
          h('p', {}, 'Download Spotify Soloist straight from Spotify. It’s small, and updates the same way.'),
          downloadBtn('Download from Spotify'), err);
      case 'downloading':
        return box('Set up playback (2 of 3)', h('p', {}, 'Downloading Spotify Soloist from Spotify…'));
      case 'need_pairing':
        return box('Set up playback (3 of 3)',
          h('p', {}, 'Last step, needed only once: on your phone (on the same Wi-Fi), open Spotify, tap the devices icon, and choose “Low BS Player”. After that, this computer plays music on its own.'), err);
      case 'expired':
        return box('Player update needed',
          h('p', {}, 'Spotify’s player builds expire every 90 days. Grab the new one:'),
          downloadBtn('Update from Spotify'));
      case 'unsupported':
        return box('Playback isn’t available on this computer',
          h('p', {}, 'Spotify Soloist only runs on Apple Silicon Macs, Windows (x64) and Linux. You can still browse here and play on another device.'));
      case 'error':
        return box('The player hit a problem', err, h('p', { class: 'muted' }, 'It will retry automatically.'), downloadBtn('Re-download player'));
      default:
        return null;
    }
  },
};

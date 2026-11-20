// Low BS Player UI. One codebase for the desktop app and the phone web app.

import { api, cached, setTokenSource, pickImage, idFromUri, clearCache } from './api.js';
import { h, icon, fmtTime, toast } from './dom.js';
import { EQ_PRESETS, autoPreamp } from './eq-presets.js';

const platform = (window.__TAURI__
  ? await import('./platform-desktop.js')
  : await import('./platform-web.js')).platform;

document.documentElement.dataset.platform = platform.kind;
setTokenSource(platform.getToken);

const root = document.getElementById('app');
const MADE_FOR_YOU = ['Release Radar', 'Discover Weekly'];
const LS_PINS = 'lbs.pins';

let me = null;
let playlists = [];
let player = { playing: false, position_ms: 0, updated_at: Date.now(), track: null, volume: 50 };

// ---------- helpers ----------

function getPins() {
  try {
    return JSON.parse(localStorage.getItem(LS_PINS)) || [];
  } catch {
    return [];
  }
}
function setPins(p) {
  localStorage.setItem(LS_PINS, JSON.stringify(p));
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

async function play(req) {
  try {
    await platform.play(req);
  } catch (e) {
    toast(String(e.message || e));
  }
}

async function control(action, value) {
  try {
    await platform.control(action, value);
  } catch (e) {
    toast(String(e.message || e));
  }
}

function artistLinks(artists) {
  const out = [];
  (artists || []).forEach((a, i) => {
    if (i) out.push(', ');
    const id = idFromUri(a.uri);
    out.push(id ? h('a', { href: `#/artist/${id}`, onclick: (e) => e.stopPropagation() }, a.name) : a.name);
  });
  return out;
}

function cover(url, cls = 'cover') {
  return url
    ? h('img', { class: cls, src: url, alt: '', loading: 'lazy', decoding: 'async' })
    : h('div', { class: `${cls} cover-empty` });
}

function card({ image, title, subtitle, href }) {
  return h('a', { class: 'card', href },
    cover(image, 'card-img'),
    h('div', { class: 'card-title' }, title),
    subtitle ? h('div', { class: 'card-sub' }, subtitle) : null,
  );
}

function section(title, ...children) {
  return h('section', {}, h('h2', {}, title), ...children);
}

function loading() {
  return h('div', { class: 'loading' }, 'Loading…');
}

// Track rows. `onPlay(index)` starts playback at that row.
function trackList(tracks, onPlay, { album = true, art = true } = {}) {
  const list = h('div', { class: 'tracks' });
  appendTracks(list, tracks, 0, onPlay, { album, art });
  return list;
}

function appendTracks(list, tracks, start, onPlay, { album = true, art = true } = {}) {
  tracks.forEach((t, i) => {
    if (!t) return;
    const idx = start + i;
    const row = h('div', {
      class: `track${t.uri === player.track?.uri ? ' current' : ''}${t.is_playable === false ? ' unplayable' : ''}`,
      'data-uri': t.uri,
      role: 'button',
      tabindex: '0',
    },
      h('span', { class: 'num' }, idx + 1),
      art ? cover(pickImage(t.album?.images, 64), 'thumb') : null,
      h('div', { class: 'tmain' },
        h('div', { class: 'tname' }, t.explicit ? h('span', { class: 'e' }, 'E') : null, t.name),
        h('div', { class: 'tsub' }, ...artistLinks(t.artists)),
      ),
      album && t.album ? h('a', { class: 'talbum', href: `#/album/${t.album.id}`, onclick: (e) => e.stopPropagation() }, t.album.name) : h('span', { class: 'talbum' }),
      h('span', { class: 'tdur' }, fmtTime(t.duration_ms)),
    );
    row.addEventListener('click', () => onPlay(idx));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') onPlay(idx); });
    list.append(row);
  });
}

function markCurrent() {
  const uri = player.track?.uri;
  document.querySelectorAll('.track').forEach((r) => r.classList.toggle('current', r.dataset.uri === uri));
}

async function loadPlaylists() {
  const out = [];
  let next = '/me/playlists?limit=50';
  while (next && out.length < 500) {
    const page = await api(next);
    out.push(...page.items.filter(Boolean));
    next = page.next;
  }
  playlists = out;
  renderSidebar();
}

async function madeForYou() {
  const found = playlists.filter((p) => MADE_FOR_YOU.includes(p.name) && p.owner?.id === 'spotify');
  for (const name of MADE_FOR_YOU) {
    if (found.some((p) => p.name === name)) continue;
    try {
      const r = await cached('/search', { q: name, type: 'playlist', limit: 10 });
      const hit = r?.playlists?.items?.find((p) => p && p.name === name && p.owner?.id === 'spotify');
      if (hit) found.push(hit);
    } catch {
      // ignore; user can pin by link
    }
  }
  const pins = getPins().filter((p) => !found.some((f) => f.id === p.id));
  return [...found.map((p) => ({ id: p.id, name: p.name, image: pickImage(p.images, 200) })), ...pins];
}

function parsePlaylistId(text) {
  const m = text.match(/playlist[/:]([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}

// ---------- views ----------

async function viewHome(main) {
  const mfy = h('div', { class: 'grid' }, loading());
  const linkInput = h('input', { type: 'text', placeholder: 'Paste a Spotify playlist link (e.g. your Release Radar)', spellcheck: 'false' });
  const nameInput = h('input', { type: 'text', placeholder: 'Name (optional)', class: 'pin-name' });
  const linkBtn = h('button', { class: 'ghost' }, 'Pin');
  linkBtn.onclick = async () => {
    const id = parsePlaylistId(linkInput.value);
    if (!id) return toast('That isn’t a playlist link.');
    // Spotify hides its personalised playlists (Release Radar, Discover Weekly)
    // from personal apps, so pin them even if details can't be fetched.
    let pin = { id, name: nameInput.value.trim() || 'Pinned playlist', image: null };
    try {
      const p = await api(`/playlists/${id}`, { query: { fields: 'id,name,images' } });
      pin = { id: p.id, name: nameInput.value.trim() || p.name, image: pickImage(p.images, 200) };
    } catch {
      // keep the basic pin
    }
    setPins([...getPins().filter((x) => x.id !== id), pin]);
    linkInput.value = '';
    nameInput.value = '';
    render();
  };
  main.replaceChildren(
    h('h1', {}, greeting()),
    section('Made for you', mfy,
      h('div', { class: 'pinrow' }, linkInput, nameInput, linkBtn),
      h('p', { class: 'hint' }, 'Missing Release Radar? In Spotify, open it and use Share → Copy link, then paste it above.'),
    ),
    section('Your playlists', h('div', { class: 'grid' },
      h('a', { class: 'card', href: '#/liked' }, h('div', { class: 'card-img liked-img' }, icon('heart', 48)), h('div', { class: 'card-title' }, 'Liked Songs')),
      playlists.slice(0, 40).map((p) => card({ image: pickImage(p.images, 200), title: p.name, subtitle: p.owner?.display_name, href: `#/playlist/${p.id}` })),
    )),
  );
  const items = await madeForYou();
  window.__lbsLog?.('info', `home: ${playlists.length} playlists; made-for-you: ${items.map((p) => `${p.name} (${p.id})`).join(', ') || 'none'}`);
  mfy.replaceChildren(...(items.length
    ? items.map((p) => pinCard(p))
    : [h('p', { class: 'muted' }, 'Nothing pinned yet.')]));
}

function pinCard(p) {
  const c = card({ image: p.image, title: p.name, href: `#/playlist/${p.id}` });
  if (getPins().some((x) => x.id === p.id)) {
    const x = h('button', { class: 'unpin', title: 'Unpin', 'aria-label': `Unpin ${p.name}` }, '×');
    x.onclick = (e) => {
      e.preventDefault();
      setPins(getPins().filter((y) => y.id !== p.id));
      render();
    };
    c.append(x);
  }
  return c;
}

function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

async function viewLibrary(main) {
  main.replaceChildren(
    h('h1', {}, 'Library'),
    h('div', { class: 'list' },
      h('a', { class: 'litem', href: '#/liked' }, h('div', { class: 'thumb liked-img' }, icon('heart', 18)), h('div', {}, h('div', { class: 'tname' }, 'Liked Songs'))),
      ...[...getPins(), ...playlists].map((p) => h('a', { class: 'litem', href: `#/playlist/${p.id}` },
        cover(p.image || pickImage(p.images, 64), 'thumb'),
        h('div', {}, h('div', { class: 'tname' }, p.name), h('div', { class: 'tsub' }, p.owner?.display_name || 'Pinned')),
      )),
    ),
  );
}

let searchTimer;
async function viewSearch(main, q) {
  const input = h('input', { type: 'search', placeholder: 'Songs, artists, albums, playlists', value: q, autofocus: true, class: 'searchbox' });
  const results = h('div', {});
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      history.replaceState(null, '', `#/search/${encodeURIComponent(input.value)}`);
      runSearch(input.value, results);
    }, 300);
  });
  main.replaceChildren(input, results);
  input.focus();
  if (q) runSearch(q, results);
}

let searchSeq = 0;
async function runSearch(q, results) {
  const seq = ++searchSeq;
  if (!q.trim()) return results.replaceChildren();
  results.replaceChildren(loading());
  try {
    const r = await cached('/search', { q, type: 'track,artist,album,playlist', limit: platform.searchLimit });
    if (seq !== searchSeq) return;
    const tracks = (r.tracks?.items || []).filter(Boolean);
    const uris = tracks.map((t) => t.uri);
    results.replaceChildren(
      tracks.length ? section('Songs', trackList(tracks, (i) => play({ uris, offset_uri: uris[i] }))) : null,
      r.artists?.items?.length ? section('Artists', h('div', { class: 'grid' }, r.artists.items.filter(Boolean).map((a) => card({ image: pickImage(a.images, 200), title: a.name, subtitle: 'Artist', href: `#/artist/${a.id}` })))) : null,
      r.albums?.items?.length ? section('Albums', h('div', { class: 'grid' }, r.albums.items.filter(Boolean).map((a) => card({ image: pickImage(a.images, 200), title: a.name, subtitle: a.artists?.map((x) => x.name).join(', '), href: `#/album/${a.id}` })))) : null,
      r.playlists?.items?.filter(Boolean).length ? section('Playlists', h('div', { class: 'grid' }, r.playlists.items.filter(Boolean).map((p) => card({ image: pickImage(p.images, 200), title: p.name, subtitle: p.owner?.display_name, href: `#/playlist/${p.id}` })))) : null,
    );
  } catch (e) {
    if (seq === searchSeq) results.replaceChildren(h('p', { class: 'muted' }, e.message));
  }
}

function header({ image, kind, title, sub, onPlay }) {
  return h('header', { class: 'head' },
    cover(image, 'head-img'),
    h('div', { class: 'head-text' },
      h('div', { class: 'kind' }, kind),
      h('h1', {}, title),
      h('div', { class: 'muted' }, ...[sub].flat()),
      onPlay ? h('button', { class: 'primary play-big', onclick: onPlay, 'aria-label': 'Play' }, icon('play', 28)) : null,
    ),
  );
}

async function viewPlaylist(main, id) {
  main.replaceChildren(loading());
  const ctx = `spotify:playlist:${id}`;
  const pin = getPins().find((x) => x.id === id);
  let p = null;
  try {
    p = await api(`/playlists/${id}`);
  } catch (e) {
    if (e.status !== 404 && e.status !== 403) throw e;
  }
  if (!p || (!p.items && !p.tracks)) {
    // Spotify doesn't share the songs in its personalised playlists (Release
    // Radar, Discover Weekly) or in playlists you don't own with personal apps.
    // Playing still works, and the player's queue then shows the songs.
    const list = h('div', {});
    main.replaceChildren(
      header({ image: pickImage(p?.images, 300) || pin?.image, kind: 'Playlist', title: p?.name || pin?.name || 'Playlist', sub: p?.owner?.display_name || '', onPlay: () => play({ context_uri: ctx }) }),
      list,
    );
    const showQueue = async () => {
      if (player.context_uri !== ctx || !platform.queue) {
        list.replaceChildren(h('p', { class: 'muted note' }, 'Spotify doesn’t share this playlist’s song list with personal apps. Press play and the songs will show up here as “Up next”.'));
        return;
      }
      list.replaceChildren(loading());
      const tracks = await platform.queue().catch(() => []);
      list.replaceChildren(
        player.track ? section('Now playing', trackList([apiTrackFromPlayer(player.track)], () => {})) : null,
        section('Up next', tracks.length ? trackList(tracks, () => {}) : h('p', { class: 'muted' }, 'Nothing queued.')),
      );
    };
    viewRefresh = (changedTrack) => { if (changedTrack) showQueue(); };
    await showQueue();
    return;
  }
  const total = p.items?.total ?? p.tracks?.total ?? 0;
  const tracks = [];
  const list = h('div', { class: 'tracks' });
  const more = h('button', { class: 'ghost more' }, 'Load more');
  const onPlay = (i) => play({ context_uri: ctx, offset_uri: tracks[i]?.uri });
  main.replaceChildren(
    header({ image: pickImage(p.images, 300), kind: 'Playlist', title: p.name, sub: [p.owner?.display_name, total ? ` · ${total} songs` : ''], onPlay: () => play({ context_uri: ctx }) }),
    list,
  );
  let offset = 0;
  const loadPage = async () => {
    more.disabled = true;
    const page = await api(`/playlists/${id}/items`, { query: { limit: 100, offset, additional_types: 'track' } });
    const batch = page.items.map((x) => x.item || x.track).filter((t) => t && t.type === 'track');
    appendTracks(list, batch, tracks.length, onPlay);
    tracks.push(...batch);
    offset += page.items.length;
    more.disabled = false;
    if (page.next) list.after(more);
    else more.remove();
  };
  more.onclick = loadPage;
  await loadPage();
}

// Converts the player's track shape into a Web API-like track for trackList().
function apiTrackFromPlayer(t) {
  return {
    uri: t.uri,
    name: t.name,
    artists: t.artists,
    duration_ms: t.duration_ms,
    album: { id: idFromUri(t.album_uri), name: t.album, images: t.image ? [{ url: t.image, width: 300 }] : [] },
  };
}

// ---------- equalizer (desktop) ----------

const BAND_LABELS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

async function viewEq(main) {
  if (!platform.hasEq) return viewHome(main);
  let eq = await platform.getEq();
  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const { enabled, preset, gains, preamp } = eq;
        eq = { ...eq, ...(await platform.setEq({ enabled, preset, gains, preamp })) };
        drawStatus();
      } catch (e) {
        toast(String(e));
      }
    }, 80);
  };

  const toggle = h('button', { class: 'switch', role: 'switch' });
  const presetSel = h('select', { class: 'eq-preset', 'aria-label': 'Preset' },
    ...Object.keys(EQ_PRESETS).map((n) => h('option', { value: n }, n)),
    h('option', { value: 'Custom' }, 'Custom'));
  const status = h('p', { class: 'eq-status muted' });
  const sliders = BAND_LABELS.map((label, i) => {
    const input = h('input', { type: 'range', min: -12, max: 12, step: 0.5, class: 'eq-slider', 'aria-label': `${label} Hz` });
    const val = h('span', { class: 'eq-val' });
    input.addEventListener('input', () => {
      eq.gains[i] = Number(input.value);
      eq.preset = 'Custom';
      draw();
      save();
    });
    return { input, val, el: h('div', { class: 'eq-band' }, val, input, h('span', { class: 'eq-label' }, label)) };
  });
  const preamp = h('input', { type: 'range', min: -12, max: 12, step: 0.5, class: 'eq-slider', 'aria-label': 'Preamp' });
  const preampVal = h('span', { class: 'eq-val' });
  preamp.addEventListener('input', () => {
    eq.preamp = Number(preamp.value);
    draw();
    save();
  });

  toggle.onclick = () => {
    eq.enabled = !eq.enabled;
    draw();
    save();
  };
  presetSel.onchange = () => {
    const g = EQ_PRESETS[presetSel.value];
    if (!g) return;
    eq.preset = presetSel.value;
    eq.gains = [...g];
    eq.preamp = autoPreamp(g);
    draw();
    save();
  };

  const fmt = (v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(1).replace(/\.0$/, '')}`;
  function drawStatus() {
    const msg = {
      off: 'Off. Music plays untouched.',
      waiting: eq.message || 'Starts when music plays.',
      on: 'On. Shaping the music from this app.',
      error: `Couldn't start: ${eq.message || 'unknown error'}`,
      unsupported: 'The equalizer isn’t available on this computer yet.',
    }[eq.status] || '';
    status.textContent = msg;
    status.classList.toggle('setup-err', eq.status === 'error');
  }
  function draw() {
    toggle.classList.toggle('on', !!eq.enabled);
    toggle.setAttribute('aria-checked', String(!!eq.enabled));
    toggle.textContent = eq.enabled ? 'On' : 'Off';
    presetSel.value = EQ_PRESETS[eq.preset] ? eq.preset : 'Custom';
    sliders.forEach((s, i) => {
      s.input.value = eq.gains[i];
      s.val.textContent = fmt(eq.gains[i]);
    });
    preamp.value = eq.preamp;
    preampVal.textContent = fmt(eq.preamp);
    main.querySelector('.eq-board')?.classList.toggle('disabled', !eq.enabled);
    drawStatus();
  }

  main.replaceChildren(
    h('h1', {}, 'Equalizer'),
    h('div', { class: 'eq-top' }, toggle, presetSel,
      h('button', { class: 'ghost small', onclick: () => { presetSel.value = 'Flat'; presetSel.onchange(); } }, 'Reset')),
    status,
    h('div', { class: 'eq-board' },
      h('div', { class: 'eq-band eq-pre' }, preampVal, preamp, h('span', { class: 'eq-label' }, 'Pre')),
      h('div', { class: 'eq-divider' }),
      ...sliders.map((s) => s.el)),
    h('p', { class: 'hint' }, 'Affects only music from this app. Values are in dB; bands are in Hz. Presets set the preamp automatically to leave headroom.'),
  );
  platform.onEq?.((st) => { eq = { ...eq, status: st.status, message: st.message }; drawStatus(); });
  draw();
}

async function viewQueue(main) {
  main.replaceChildren(h('h1', {}, 'Up next'), loading());
  const draw = async () => {
    const tracks = await platform.queue().catch((e) => { toast(e.message || String(e)); return []; });
    main.replaceChildren(
      h('h1', {}, 'Up next'),
      player.track ? section('Now playing', trackList([apiTrackFromPlayer(player.track)], () => {})) : null,
      tracks.length ? trackList(tracks, () => {}) : h('p', { class: 'muted' }, 'Nothing queued.'),
    );
  };
  viewRefresh = (changedTrack) => { if (changedTrack) draw(); };
  await draw();
}

async function viewAlbum(main, id) {
  main.replaceChildren(loading());
  const a = await cached(`/albums/${id}`);
  const tracks = a.tracks.items.map((t) => ({ ...t, album: null }));
  main.replaceChildren(
    header({ image: pickImage(a.images, 300), kind: a.album_type || 'Album', title: a.name, sub: [...artistLinks(a.artists), ` · ${(a.release_date || '').slice(0, 4)} · ${a.total_tracks} songs`], onPlay: () => play({ context_uri: a.uri }) }),
    trackList(tracks, (i) => play({ context_uri: a.uri, offset_uri: tracks[i].uri }), { album: false, art: false }),
  );
}

async function viewArtist(main, id) {
  main.replaceChildren(loading());
  const [a, albums] = await Promise.all([
    cached(`/artists/${id}`),
    cached(`/artists/${id}/albums`, { include_groups: 'album,single', limit: 30 }),
  ]);
  let top = null;
  try {
    top = (await cached(`/artists/${id}/top-tracks`)).tracks; // not available to personal apps
  } catch {
    top = null;
  }
  main.replaceChildren(
    header({ image: pickImage(a.images, 300), kind: 'Artist', title: a.name, sub: (a.genres || []).slice(0, 3).join(', '), onPlay: () => play({ context_uri: a.uri }) }),
    top?.length ? section('Popular', trackList(top.slice(0, 10), (i) => play({ context_uri: a.uri, offset_uri: top[i].uri }))) : null,
    section('Releases', h('div', { class: 'grid' }, albums.items.map((al) => card({ image: pickImage(al.images, 200), title: al.name, subtitle: `${(al.release_date || '').slice(0, 4)} · ${al.album_type}`, href: `#/album/${al.id}` })))),
  );
}

async function viewLiked(main) {
  const tracks = [];
  const list = h('div', { class: 'tracks' });
  const more = h('button', { class: 'ghost more' }, 'Load more');
  const ctx = `spotify:user:${me.id}:collection`;
  const onPlay = (i) => play({ context_uri: ctx, offset_uri: tracks[i].uri });
  main.replaceChildren(
    header({ image: null, kind: 'Playlist', title: 'Liked Songs', sub: '', onPlay: () => play({ context_uri: ctx }) }),
    list,
  );
  main.querySelector('.head-img').replaceChildren(icon('heart', 64));
  main.querySelector('.head-img').classList.add('liked-img');
  let next = '/me/tracks?limit=50';
  const loadPage = async () => {
    more.disabled = true;
    const page = await api(next);
    const batch = page.items.map((x) => x.track).filter(Boolean);
    appendTracks(list, batch, tracks.length, onPlay);
    tracks.push(...batch);
    main.querySelector('.head .muted').textContent = `${page.total} songs`;
    next = page.next;
    more.disabled = false;
    if (next) list.after(more);
    else more.remove();
  };
  more.onclick = loadPage;
  await loadPage();
}

// ---------- shell ----------

let sidebar, main, bar, sheet, setupEl;

function renderSidebar() {
  if (!sidebar) return;
  const route = location.hash || '#/';
  const nav = (href, ic, label) => h('a', { href, class: `nav${route === href || (href !== '#/' && route.startsWith(href)) ? ' active' : ''}` }, icon(ic), label);
  sidebar.replaceChildren(
    h('div', { class: 'brand' }, h('img', { src: 'icon-256.png', alt: '' }), platform.kind === 'web' ? 'Low BS Remote' : 'Low BS Player'),
    nav('#/', 'home', 'Home'),
    nav('#/search', 'search', 'Search'),
    nav('#/liked', 'heart', 'Liked Songs'),
    ...(platform.hasEq ? [nav('#/eq', 'eq', 'Equalizer')] : []),
    h('div', { class: 'side-label' }, 'Playlists'),
    h('div', { class: 'side-list' },
      ...getPins().map((p) => h('a', { href: `#/playlist/${p.id}`, class: `side-item${route === `#/playlist/${p.id}` ? ' active' : ''}` }, p.name)),
      ...playlists.map((p) => h('a', { href: `#/playlist/${p.id}`, class: `side-item${route === `#/playlist/${p.id}` ? ' active' : ''}` }, p.name)),
    ),
    h('button', { class: 'ghost small logout', onclick: logout }, 'Log out'),
  );
}

function renderTabs(tabs) {
  const route = location.hash || '#/';
  const tab = (href, ic, label, match) => h('a', { href, class: `tab${match(route) ? ' active' : ''}` }, icon(ic, 22), h('span', {}, label));
  tabs.replaceChildren(
    tab('#/', 'home', 'Home', (r) => r === '#/'),
    tab('#/search', 'search', 'Search', (r) => r.startsWith('#/search')),
    tab('#/library', 'library', 'Library', (r) => r.startsWith('#/library') || r.startsWith('#/liked') || r.startsWith('#/playlist')),
  );
}

let tabsEl;
let viewRefresh = null; // lets the current view react to track changes
async function render() {
  const [, view, arg = ''] = (location.hash || '#/').match(/^#\/?([^/]*)\/?(.*)$/) || [];
  renderSidebar();
  renderTabs(tabsEl);
  root.classList.remove('expanded');
  viewRefresh = null;
  main.scrollTop = 0;
  try {
    switch (view) {
      case '': return await viewHome(main);
      case 'search': return await viewSearch(main, decodeURIComponent(arg));
      case 'library': return await viewLibrary(main);
      case 'liked': return await viewLiked(main);
      case 'playlist': return await viewPlaylist(main, arg);
      case 'album': return await viewAlbum(main, arg);
      case 'artist': return await viewArtist(main, arg);
      case 'queue': return await viewQueue(main);
      case 'eq': return await viewEq(main);
      default: return await viewHome(main);
    }
  } catch (e) {
    main.replaceChildren(h('p', { class: 'muted note' }, `Something went wrong: ${e.message}`));
  }
}

// ---------- now playing ----------

const repeatModes = ['off', 'context', 'track'];

function buildControls() {
  const btn = (name, action, label, cls = 'ctl') => {
    const b = h('button', { class: cls, 'aria-label': label, title: label, 'data-ctl': name }, icon(name, name === 'play' ? 26 : 20));
    b.onclick = (e) => { e.stopPropagation(); action(); };
    return b;
  };
  return h('div', { class: 'controls' },
    btn('shuffle', () => control('shuffle', !player.shuffle ? 1 : 0), 'Shuffle'),
    btn('prev', () => control('prev'), 'Previous'),
    btn('play', () => control('toggle'), 'Play/Pause', 'ctl playbtn'),
    btn('next', () => control('next'), 'Next'),
    btn('repeat', () => control('repeat', (repeatModes.indexOf(player.repeat) + 1) % 3), 'Repeat'),
  );
}

function buildProgress() {
  const range = h('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'seek', 'aria-label': 'Seek' });
  range.addEventListener('input', () => { range.dataset.dragging = '1'; });
  range.addEventListener('change', () => {
    delete range.dataset.dragging;
    const dur = player.track?.duration_ms || 0;
    control('seek', (range.value / 1000) * dur);
  });
  return h('div', { class: 'progress' }, h('span', { class: 'pos' }, '0:00'), range, h('span', { class: 'dur' }, '0:00'));
}

function buildVolume() {
  const range = h('input', { type: 'range', min: 0, max: 100, value: 50, class: 'vol', 'aria-label': 'Volume' });
  let t;
  range.addEventListener('input', () => {
    range.dataset.dragging = '1';
    clearTimeout(t);
    t = setTimeout(() => control('volume', Number(range.value)), 120);
  });
  range.addEventListener('change', () => { delete range.dataset.dragging; });
  return h('div', { class: 'volume' }, icon('volume', 18), range);
}

function buildDeviceButton() {
  const b = h('button', { class: 'ghost small device', title: 'Devices' }, icon('devices', 16), h('span', { class: 'devname' }, ''));
  b.onclick = (e) => {
    e.stopPropagation();
    if (platform.hasDevicePicker) openDevices();
    else if (!player.active) control('transfer');
  };
  return b;
}

async function openDevices() {
  const dlg = h('div', { class: 'modal', onclick: (e) => { if (e.target === dlg) dlg.remove(); } },
    h('div', { class: 'modal-box' }, h('h2', {}, 'Play on'), loading()));
  document.body.append(dlg);
  try {
    const devices = await platform.devices();
    const box = dlg.firstChild;
    box.replaceChildren(h('h2', {}, 'Play on'),
      devices.length ? h('div', { class: 'list' }, devices.map((d) => {
        const item = h('button', { class: `litem devitem${d.is_active ? ' current' : ''}` },
          icon('devices', 18), h('div', {}, h('div', { class: 'tname' }, d.name), h('div', { class: 'tsub' }, d.type + (d.is_active ? ' · playing' : ''))));
        item.onclick = async () => {
          dlg.remove();
          try {
            await platform.transfer(d.id);
          } catch (e) {
            toast(e.message);
          }
        };
        return item;
      })) : h('p', { class: 'muted' }, 'No devices found. Open the Low BS Player desktop app or Spotify on any device.'),
      h('button', { class: 'ghost', onclick: () => dlg.remove() }, 'Close'));
  } catch (e) {
    dlg.remove();
    toast(e.message);
  }
}
platform.openDevices = openDevices;

function buildNowPlaying(full) {
  const el = h('div', { class: full ? 'np-full' : 'np-bar' },
    full ? h('button', { class: 'ghost close-sheet', 'aria-label': 'Close', onclick: () => root.classList.remove('expanded') }, icon('back')) : null,
    h('div', { class: 'np-info' },
      h('div', { class: 'np-art-wrap' }, cover(null, 'np-art')),
      h('div', { class: 'np-text' }, h('div', { class: 'np-title' }, ''), h('div', { class: 'np-artist' }, '')),
      full ? null : h('button', { class: 'ctl mini-play', 'aria-label': 'Play/Pause', onclick: (e) => { e.stopPropagation(); control('toggle'); } }, icon('play', 24)),
    ),
    h('div', { class: 'np-center' }, buildControls(), buildProgress()),
    h('div', { class: 'np-right' },
      h('a', { class: 'ctl queue-btn', href: '#/queue', title: 'Up next', 'aria-label': 'Up next', onclick: () => root.classList.remove('expanded') }, icon('queue', 18)),
      buildDeviceButton(), buildVolume()),
  );
  if (!full) {
    el.querySelector('.np-info').addEventListener('click', () => {
      if (matchMedia('(max-width: 760px)').matches) root.classList.add('expanded');
    });
  }
  return el;
}

function updateNowPlaying(el) {
  const t = player.track;
  const art = el.querySelector('.np-art');
  const wanted = t?.image || '';
  if ((art.getAttribute('src') || '') !== wanted) {
    const img = cover(wanted || null, 'np-art');
    art.replaceWith(img);
  }
  el.querySelector('.np-title').textContent = t?.name || (player.connected === false ? 'Connecting to Spotify…' : 'Nothing playing');
  el.querySelector('.np-artist').replaceChildren(...(t ? artistLinks(t.artists) : []));
  el.querySelectorAll('[data-ctl="play"], .mini-play').forEach((b) => b.replaceChildren(icon(player.playing ? 'pause' : 'play', b.classList.contains('mini-play') ? 24 : 26)));
  el.querySelector('[data-ctl="shuffle"]').classList.toggle('on', !!player.shuffle);
  const rep = el.querySelector('[data-ctl="repeat"]');
  rep.classList.toggle('on', player.repeat !== 'off');
  rep.classList.toggle('one', player.repeat === 'track');
  const vol = el.querySelector('.vol');
  if (!vol.dataset.dragging) vol.value = player.volume ?? 50;
  const dev = el.querySelector('.devname');
  if (platform.kind === 'desktop') dev.textContent = player.active ? 'This computer' : 'Play here';
  else dev.textContent = player.device || 'Pick device';
  el.querySelector('.device').classList.toggle('on', platform.kind === 'desktop' ? !!player.active : !!player.device);
}

function tickProgress() {
  const dur = player.track?.duration_ms || 0;
  const pos = Math.min(dur, player.position_ms + (player.playing ? Date.now() - player.updated_at : 0));
  for (const el of [bar, sheet]) {
    if (!el) continue;
    const range = el.querySelector('.seek');
    if (!range.dataset.dragging) range.value = dur ? (pos / dur) * 1000 : 0;
    el.querySelector('.pos').textContent = fmtTime(pos);
    el.querySelector('.dur').textContent = fmtTime(dur);
  }
}

let setupKey = '';
function renderSetup() {
  if (!platform.setupPanel) return;
  const key = `${player.setup}|${player.error || ''}`;
  if (key === setupKey) return;
  setupKey = key;
  const panel = platform.setupPanel(player);
  setupEl.replaceChildren(...(panel ? [panel] : []));
}

function onPlayerState(s) {
  const changedTrack = s.track?.uri !== player.track?.uri;
  player = s;
  renderSetup();
  if (viewRefresh) viewRefresh(changedTrack);
  updateNowPlaying(bar);
  updateNowPlaying(sheet);
  tickProgress();
  if (changedTrack) markCurrent();
  if (s.track) document.title = `${s.track.name} · ${s.track.artists?.map((a) => a.name).join(', ')}`;
  if (s.error && !platform.setupPanel) toast(s.error);
}

async function logout() {
  await platform.logout();
  clearCache();
  location.hash = '';
  location.reload();
}

// ---------- boot ----------

async function startApp() {
  try {
    me = await api('/me');
  } catch (e) {
    toast(`Couldn't reach Spotify: ${e.message}`);
  }
  sidebar = h('aside', { id: 'side' });
  main = h('main', { id: 'main' });
  setupEl = h('div', { id: 'setup' });
  bar = buildNowPlaying(false);
  sheet = buildNowPlaying(true);
  tabsEl = h('nav', { id: 'tabs' });
  root.replaceChildren(sidebar, h('div', { id: 'center' }, setupEl, main), h('footer', { id: 'bar' }, bar), tabsEl, sheet);
  platform.onState(onPlayerState);
  setInterval(tickProgress, 500);
  window.addEventListener('hashchange', render);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) {
      e.preventDefault();
      control('toggle');
    }
  });
  try {
    await loadPlaylists();
  } catch (e) {
    toast(`Couldn't load playlists: ${e.message}`);
  }
  render();
}

if (await platform.isLoggedIn()) {
  startApp();
} else {
  platform.renderLogin(root, startApp);
}

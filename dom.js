// Minimal DOM builder. Strings become text nodes, so Spotify data can never
// inject HTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function fmtTime(ms) {
  if (!ms || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let toastTimer;
export function toast(msg) {
  window.__lbsLog?.('info', `toast: ${msg}`);
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

// Inline SVG icons (no icon font, no network).
const PATHS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  next: 'M6 6l8.5 6L6 18zM16 6h2v12h-2z',
  prev: 'M18 6l-8.5 6L18 18zM6 6h2v12H6z',
  shuffle: 'M17 3l4 4-4 4V8h-2.6l-2.2 2.6-1.3-1.5L13.5 6H17zM3 6h4.5l9 10H17v-3l4 4-4 4v-3h-1.4l-9-10H3zm0 10h3.6l1.9-2.2 1.3 1.5L7.5 18H3z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z',
  volume: 'M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z',
  devices: 'M4 6h18V4H4a2 2 0 0 0-2 2v11H0v3h14v-3H4zm19 2h-6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1zm-1 9h-4v-7h4z',
  home: 'M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z',
  search: 'M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  library: 'M4 3h2v18H4zm4 0h2v18H8zm4.5.6l1.9-.6 5.6 17.4-1.9.6z',
  heart: 'M12 21l-1.5-1.3C5 15 2 12.2 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.7-3 6.5-8.5 11.2z',
  back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
  eq: 'M6 3h2v6h2v2H4V9h2zm0 10h2v8H6zm5-10h2v10h2v2H9v-2h2zm0 14h2v4h-2zm5-14h2v2h2v2h-6V5h2zm0 6h2v12h-2z',
  queue: 'M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm15-2v-8h2v8.3A2.5 2.5 0 1 1 18 14z',
};

export function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', PATHS[name]);
  p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
}

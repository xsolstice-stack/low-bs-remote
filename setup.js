// First-run screen: connect your own Spotify developer app, then log in.
import { h, toast } from './dom.js';

export function setupScreen(root, { title, blurb, redirectUri, clientId, onLogin }) {
  const input = h('input', { type: 'text', placeholder: 'Client ID', value: clientId || '', spellcheck: 'false', autocomplete: 'off' });
  const status = h('p', { class: 'muted' });
  const btn = h('button', { class: 'primary big' }, 'Log in with Spotify');
  btn.onclick = async () => {
    const id = input.value.trim();
    if (!/^[0-9a-z]{32}$/i.test(id)) {
      toast('That doesn’t look like a Client ID (32 letters and numbers).');
      return;
    }
    btn.disabled = true;
    try {
      await onLogin(id, (msg) => { status.textContent = msg; });
    } catch (e) {
      status.textContent = `Login failed: ${e.message || e}`;
    }
    btn.disabled = false;
  };
  const copy = h('button', { class: 'ghost small' }, 'Copy');
  copy.onclick = () => navigator.clipboard?.writeText(redirectUri).then(() => toast('Copied'));
  root.replaceChildren(
    h('div', { class: 'login' },
      h('img', { src: 'icon-256.png', alt: '', class: 'login-logo' }),
      h('h1', {}, title),
      h('p', { class: 'muted' }, blurb),
      h('ol', { class: 'steps' },
        h('li', {}, 'Go to ', h('a', { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' }, 'developer.spotify.com/dashboard'),
          ' and click Create app (any name). If you already made one for Low BS, open it and click Edit.'),
        h('li', {}, 'Under Redirect URIs, add exactly this:', h('div', { class: 'copyrow' }, h('code', {}, redirectUri), copy)),
        h('li', {}, 'Tick “Web API” and “Web Playback SDK”, save, then paste the app’s Client ID here:'),
      ),
      input,
      btn,
      status,
      h('p', { class: 'hint' }, 'Your password goes only to Spotify. The same Client ID works for the desktop app and the phone remote.'),
    ),
  );
}

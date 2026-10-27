// Shared helpers for the host and student pages.

// WebSocket with automatic reconnect.
function createSocket({ onOpen, onMessage, onStatus }) {
  let ws, attempt = 0, closedByUs = false;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws`;

  function connect() {
    ws = new WebSocket(url);
    ws.onopen = () => { attempt = 0; onStatus && onStatus(true); onOpen && onOpen(); };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
    ws.onclose = () => {
      onStatus && onStatus(false);
      if (closedByUs) return;
      const delay = Math.min(5000, 500 * 2 ** attempt++);
      setTimeout(connect, delay);
    };
  }
  connect();

  return {
    send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
    close() { closedByUs = true; ws && ws.close(); },
  };
}

// Tiny DOM builder: el('div', {class:'x', onclick: fn}, child, 'text')
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) n.append(k);
  return n;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// A school logo from the server, or a lettered placeholder if none was uploaded.
// size: 'sm' | 'md' | 'lg' | 'xl'
function logoNode(code, id, name, version, size) {
  if (version) {
    return el('img', {
      class: 'logo ' + size,
      src: `/logo/${encodeURIComponent(code)}/${encodeURIComponent(id)}?v=${version}`,
      alt: name + ' logo',
    });
  }
  return el('div', { class: 'logo mono ' + size, 'aria-label': name }, initials(name));
}

// Reads an image file, shrinks it to at most `max` pixels and returns a data URL.
function fileToLogo(file, max = 256) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) {
      return reject(new Error('Please choose a PNG or JPG image.'));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That image could not be opened.'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        let out = c.toDataURL('image/png');
        if (out.length > 250000) {
          // Large or photographic logo: use JPEG on white instead.
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          out = c.toDataURL('image/jpeg', 0.85);
        }
        if (out.length > 290000) return reject(new Error('That image is too large. Try a smaller one.'));
        resolve(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, val) { try { localStorage.setItem(key, val); return true; } catch { return false; } }
function safeDel(key) { try { localStorage.removeItem(key); } catch {} }

// ---------- pictogram sprite (filled, purpose-drawn icons) ----------
const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
<symbol id="i-home" viewBox="0 0 24 24"><path d="M12 2.4 2.4 8v1.6h19.2V8z"/><path d="M4.4 11h2.8v7H4.4zM10.6 11h2.8v7h-2.8zM16.8 11h2.8v7h-2.8z" opacity=".72"/><path d="M2.4 19.2h19.2v2.4H2.4z"/></symbol>
<symbol id="i-buzzer" viewBox="0 0 24 24"><path d="M2.6 17.2c0-1.6 4-2.9 9.4-2.9s9.4 1.3 9.4 2.9v1.1c0 1.8-4.2 3.2-9.4 3.2s-9.4-1.4-9.4-3.2z"/><path d="M5.8 13.6C5.8 8.8 8.6 4.6 12 4.6s6.2 4.2 6.2 9c-1.7-.7-3.8-1-6.2-1s-4.5.3-6.2 1z" opacity=".78"/></symbol>
<symbol id="i-trophy" viewBox="0 0 24 24"><path d="M7 3h10v6.4a5 5 0 0 1-10 0z"/><path d="M7 5H3.4v2.3A3.9 3.9 0 0 0 7.5 11L7 9.2zM17 5h3.6v2.3A3.9 3.9 0 0 1 16.5 11l.5-1.8z" opacity=".68"/><path d="M10.8 14.4h2.4V18h-2.4z"/><path d="M7.4 18.4h9.2v2.6H7.4z"/></symbol>
<symbol id="i-flag" viewBox="0 0 24 24"><path d="M4.6 2.4h2.2v19.2H4.6z"/><path d="M7.4 3.6c3-1.7 5 1.4 8.4 0 1.3-.5 2.6-.6 3.8-.2v9.4c-1.2.5-2.5.5-3.8 0-3.4-1.4-5.4 1.7-8.4 0z" opacity=".86"/></symbol>
<symbol id="i-watch" viewBox="0 0 24 24"><path d="M9.4 1.8h5.2v2.2H9.4z"/><path fill-rule="evenodd" d="M12 5.2a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8zM10.9 9h2.2v4.5l2.9 1.7-1.1 1.9-4-2.4z"/><path d="M18.4 4.4l1.6 1.6-1.4 1.4-1.6-1.6z" opacity=".7"/></symbol>
<symbol id="i-screen" viewBox="0 0 24 24"><rect x="2.4" y="3.6" width="19.2" height="13" rx="2.2"/><path d="M10.7 16.6h2.6v3h-2.6z" opacity=".7"/><path d="M7.4 19.6h9.2v2H7.4z"/><path d="M10 7.2v6l5-3z" fill="#fff" opacity=".9"/></symbol>
<symbol id="i-sliders" viewBox="0 0 24 24"><path d="M3 5.4h8.6v2.2H3zM16.2 5.4H21v2.2h-4.8zM3 16.4h3.6v2.2H3zM11.2 16.4H21v2.2h-9.8z" opacity=".72"/><circle cx="13.9" cy="6.5" r="2.9"/><circle cx="8.9" cy="17.5" r="2.9"/><path d="M3 10.9h5.8v2.2H3zM13.4 10.9H21v2.2h-7.6z" opacity=".72"/></symbol>
<symbol id="i-book" viewBox="0 0 24 24"><path d="M4.6 2.6h12.8a2 2 0 0 1 2 2V19H6.6a2 2 0 0 0-2 2z"/><path d="M6.8 19.4h12.6V21H6.8z" opacity=".7"/><path d="M13.6 2.6v7.2l2-1.5 2 1.5V2.6z" fill="#f4b63d"/></symbol>
<symbol id="i-people" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.4 19.6c0-3.6 2.9-5.7 6.6-5.7s6.6 2.1 6.6 5.7z"/><circle cx="17.2" cy="9" r="2.6" opacity=".66"/><path d="M16.6 14.2c3 0 5 1.8 5 4.9h-4.1c0-2-.5-3.6-1.5-4.7z" opacity=".66"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24"><path d="M6 3.4v17.2L20.4 12z"/></symbol>
<symbol id="i-lock" viewBox="0 0 24 24"><path d="M7 10.4V7.2a5 5 0 0 1 10 0v3.2h-2.3V7.2a2.7 2.7 0 0 0-5.4 0v3.2z"/><rect x="4.4" y="10" width="15.2" height="11.4" rx="2.3"/></symbol>
<symbol id="i-copy" viewBox="0 0 24 24"><rect x="8.6" y="8.6" width="12.2" height="12.2" rx="2.6"/><path d="M5.6 15.4h-.3A2.3 2.3 0 0 1 3 13.1V5.3A2.3 2.3 0 0 1 5.3 3h7.8a2.3 2.3 0 0 1 2.3 2.3v.3H8.6a3 3 0 0 0-3 3z" opacity=".62"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24"><path d="M10.6 4h2.8v6.6H20v2.8h-6.6V20h-2.8v-6.6H4v-2.8h6.6z"/></symbol>
<symbol id="i-minus" viewBox="0 0 24 24"><path d="M4 10.6h16v2.8H4z"/></symbol>
<symbol id="i-star" viewBox="0 0 24 24"><path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"/></symbol>
<symbol id="i-exit" viewBox="0 0 24 24"><path d="M3 3.4h8v2.4H5.4v12.4H11v2.4H3z"/><path d="m15.6 7 5 5-5 5-1.7-1.7 2.1-2.1H9.4v-2.4h6.6l-2.1-2.1z" opacity=".85"/></symbol>
<symbol id="i-upload" viewBox="0 0 24 24"><path d="M10.8 14.6V6.8L8 9.6 6.3 7.9 12 2.2l5.7 5.7L16 9.6l-2.8-2.8v7.8z"/><path d="M3.4 16.6h17.2V21H3.4z" opacity=".75"/></symbol>
<symbol id="i-down" viewBox="0 0 24 24"><path d="M10.8 2.4h2.4v8l2.8-2.8 1.7 1.7L12 15.2 6.3 9.3 8 7.6l2.8 2.8z"/><path d="M3.4 16.6h17.2V21H3.4z" opacity=".75"/></symbol>
<symbol id="i-trash" viewBox="0 0 24 24"><path d="M9 2.6h6l.8 1.8H21v2.2H3V4.4h5.2z"/><path d="M5 8h14l-1 12.2a2 2 0 0 1-2 1.8H8a2 2 0 0 1-2-1.8z" opacity=".85"/></symbol>
<symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13.6 2 4.4 13.4h6L9.4 22l10.2-12.2h-6.2z"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="m9.4 17.6-5-5 2-2 3 3 8.2-8.2 2 2z"/></symbol>
<symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15.4" r="5.6"/><path d="M11.6 11.6 20 3.2l2.2 2.2-2 2 1.8 1.8-2.2 2.2-1.8-1.8-5 5z" opacity=".78"/></symbol>
</svg>`;
function ic(name, cls = '') { return `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`; }
function mountSprite() { if (!document.getElementById('i-home')) document.body.insertAdjacentHTML('afterbegin', SPRITE); }
function applyIcons(root = document) { root.querySelectorAll('[data-ic]').forEach((n) => { n.innerHTML = ic(n.dataset.ic, n.dataset.cls || '') + n.innerHTML; n.removeAttribute('data-ic'); }); }

// Animated arena backdrop layers for .stage containers.
function stageLayers(o = {}) {
  const beams = (o.beams || [[8, -18, .5], [34, -6, .38], [62, 8, .42], [86, 20, .46]]).map(([x, r, op]) => `<div class="beam" style="left:${x}%;--r:${r}deg;--o:${op}"></div>`).join('');
  const orbs = (o.orbs || []).map(([l, t, s, blur]) => `<div class="orb" style="left:${l}%;top:${t}%;width:${s}px;height:${s}px;${blur ? `filter:blur(${blur}px);opacity:.85` : ''}"></div>`).join('');
  const rings = (o.rings || []).map(([l, t, s]) => `<div class="ringx" style="left:${l}%;top:${t}%;width:${s}px;height:${s}px"></div>`).join('');
  const sparks = (o.sparks || []).map(([l, t, s]) => `<div class="spark" style="left:${l}%;top:${t}%;transform:scale(${s || 1})"></div>`).join('');
  return beams + (o.noFloor ? '' : '<div class="floor"></div>') + orbs + rings + sparks;
}
function buzz3d(scale = 1, label = 'BUZZ') {
  return `<div class="buzz3d" style="--s:${scale}"><div class="glow"></div><div class="base2"></div><div class="base"></div><div class="well"></div><div class="side"></div><div class="cap"><span>${label}</span></div></div>`;
}
const SCENE_DEFAULT = { orbs: [[6, 40, 150, 3], [91, 36, 190, 4], [14, 70, 60], [84, 66, 80]], rings: [[2, 14, 460]], sparks: [[20, 18], [30, 40, .8], [70, 22], [80, 44, .7], [12, 70], [88, 72, .8], [50, 10, .6], [60, 60, .8]] };

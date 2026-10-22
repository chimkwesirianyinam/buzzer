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

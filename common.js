// Shared WebSocket helper with automatic reconnect.
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

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const k of kids) n.append(k);
  return n;
}

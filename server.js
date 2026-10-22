'use strict';
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 100;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // idle rooms are removed after 6h
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion

const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.type('text').send('ok'));
// All files sit in one flat folder; only these are served (never server.js etc.).
const PAGES = { '/': 'index.html', '/host': 'host.html', '/play': 'play.html',
  '/style.css': 'style.css', '/common.js': 'common.js' };
for (const [route, file] of Object.entries(PAGES)) {
  app.get(route, (_req, res) => res.sendFile(path.join(__dirname, file)));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

/** @type {Map<string, any>} */
const rooms = new Map();

function makeCode() {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('no free room codes');
}

function createRoom() {
  const room = {
    code: makeCode(),
    hostToken: crypto.randomBytes(16).toString('hex'),
    host: null,
    players: new Map(),
    phase: 'locked', // 'locked' | 'open'
    buzzes: [], // [{ id, at }]
    openedAt: null,
    lockOnFirst: false,
    lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

const send = (ws, msg) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
};

function hostState(room) {
  const first = room.buzzes[0];
  return {
    t: 'state',
    role: 'host',
    code: room.code,
    phase: room.phase,
    lockOnFirst: room.lockOnFirst,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: !!p.ws && p.ws.readyState === 1,
      pos: room.buzzes.findIndex((b) => b.id === p.id) + 1 || null,
    })),
    buzzes: room.buzzes.map((b, i) => ({
      id: b.id,
      name: room.players.get(b.id)?.name ?? '?',
      pos: i + 1,
      sinceOpen: Math.round(b.at - room.openedAt),
      behindFirst: Math.round(b.at - first.at),
    })),
  };
}

function playerState(room, p) {
  const pos = room.buzzes.findIndex((b) => b.id === p.id) + 1 || null;
  const first = room.buzzes[0];
  return {
    t: 'state',
    role: 'player',
    code: room.code,
    phase: room.phase,
    you: { id: p.id, name: p.name, score: p.score, pos },
    winner: first ? room.players.get(first.id)?.name ?? null : null,
    players: room.players.size,
  };
}

function broadcast(room) {
  room.lastActive = Date.now();
  send(room.host, hostState(room));
  for (const p of room.players.values()) send(p.ws, playerState(room, p));
}

const cleanName = (s) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 20);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.ctx = null; // { room, role, playerId }

  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;

    // ---------- pre-auth messages ----------
    if (!ws.ctx) {
      if (m.t === 'host_create') {
        const room = createRoom();
        room.host = ws;
        ws.ctx = { room, role: 'host' };
        send(ws, { t: 'host_ok', code: room.code, token: room.hostToken });
        return broadcast(room);
      }
      if (m.t === 'host_resume') {
        const room = rooms.get(String(m.code || '').toUpperCase());
        if (!room || room.hostToken !== m.token) return send(ws, { t: 'host_fail' });
        if (room.host && room.host !== ws) room.host.close(4000, 'replaced');
        room.host = ws;
        ws.ctx = { room, role: 'host' };
        send(ws, { t: 'host_ok', code: room.code, token: room.hostToken });
        return broadcast(room);
      }
      if (m.t === 'join') {
        const room = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!room) return send(ws, { t: 'join_fail', reason: 'Room not found. Check the code.' });
        let p = m.playerId ? room.players.get(String(m.playerId)) : null;
        if (p) {
          if (p.ws && p.ws !== ws) p.ws.close(4000, 'replaced');
          p.ws = ws;
        } else {
          const name = cleanName(m.name);
          if (!name) return send(ws, { t: 'join_fail', reason: 'Please enter a name.' });
          if (room.players.size >= MAX_PLAYERS)
            return send(ws, { t: 'join_fail', reason: 'Room is full.' });
          const taken = [...room.players.values()].some(
            (x) => x.name.toLowerCase() === name.toLowerCase()
          );
          if (taken) return send(ws, { t: 'join_fail', reason: 'That name is already taken.' });
          p = { id: crypto.randomBytes(8).toString('hex'), name, score: 0, ws };
          room.players.set(p.id, p);
        }
        ws.ctx = { room, role: 'player', playerId: p.id };
        send(ws, { t: 'join_ok', code: room.code, playerId: p.id });
        return broadcast(room);
      }
      return;
    }

    const { room, role } = ws.ctx;

    // ---------- contestant ----------
    if (role === 'player') {
      if (m.t === 'buzz') {
        const p = room.players.get(ws.ctx.playerId);
        if (!p || room.phase !== 'open') return;
        if (room.buzzes.some((b) => b.id === p.id)) return;
        room.buzzes.push({ id: p.id, at: performance.now() });
        if (room.lockOnFirst) room.phase = 'locked';
        broadcast(room);
      }
      return;
    }

    // ---------- host ----------
    if (role === 'host') {
      switch (m.t) {
        case 'open': // new round: clear buzzes, open buzzers
          room.buzzes = [];
          room.phase = 'open';
          room.openedAt = performance.now();
          break;
        case 'lock':
          room.phase = 'locked';
          break;
        case 'reset': // clear buzzes and lock
          room.buzzes = [];
          room.phase = 'locked';
          break;
        case 'lock_on_first':
          room.lockOnFirst = !!m.value;
          break;
        case 'score': {
          const p = room.players.get(String(m.playerId));
          const d = Number(m.delta);
          if (p && Number.isFinite(d)) p.score += Math.max(-100, Math.min(100, Math.trunc(d)));
          break;
        }
        case 'reset_scores':
          for (const p of room.players.values()) p.score = 0;
          break;
        case 'kick': {
          const id = String(m.playerId);
          const p = room.players.get(id);
          if (p) {
            send(p.ws, { t: 'kicked' });
            p.ws?.close(4001, 'kicked');
            room.players.delete(id);
            room.buzzes = room.buzzes.filter((b) => b.id !== id);
          }
          break;
        }
        default:
          return;
      }
      broadcast(room);
    }
  });

  ws.on('close', () => {
    const ctx = ws.ctx;
    if (!ctx) return;
    const { room, role } = ctx;
    if (role === 'host' && room.host === ws) room.host = null;
    if (role === 'player') {
      const p = room.players.get(ctx.playerId);
      if (p && p.ws === ws) p.ws = null;
    }
    if (rooms.has(room.code)) broadcast(room);
  });

  ws.on('error', () => {});
});

// Heartbeat: drops dead sockets and keeps proxies from idling the connection out.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

// Clean up idle rooms.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActive > ROOM_TTL_MS) {
      room.host?.close();
      for (const p of room.players.values()) p.ws?.close();
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log(`Buzzer running on port ${PORT}`));

module.exports = { server };

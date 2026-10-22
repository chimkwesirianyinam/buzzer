'use strict';
// PIC Competition Software - inter-school buzzer server.
// Each school is a team (up to 3 students). The first buzz of each school in a
// round counts for that school. Buzz order is decided by the server clock.
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_SCHOOLS = 8;
const TEAM_SIZE = 3;
const MAX_LOGO_CHARS = 300000; // base64 text length of an uploaded logo
const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // idle rooms are removed after 6h
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion

const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// All app files sit in one flat folder; only these are served (never server.js etc.).
const PAGES = {
  '/': 'index.html',
  '/host': 'host.html',
  '/play': 'play.html',
  '/style.css': 'style.css',
  '/common.js': 'common.js',
  '/pic-logo.png': 'pic-logo.png',
};
for (const [route, file] of Object.entries(PAGES)) {
  app.get(route, (_req, res) => res.sendFile(path.join(__dirname, file)));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 400 * 1024 });

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
    schools: new Map(), // id -> { id, name, score }
    logos: new Map(), // id (school id or '_comp') -> { type, buf, v }
    vc: 0, // logo version counter
    players: new Map(), // id -> { id, name, schoolId, ws }
    phase: 'locked', // 'locked' | 'open'
    buzzes: [], // [{ schoolId, playerId, at }] - one entry per school per round
    openedAt: null,
    lockOnFirst: false,
    lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

// ---------- helpers ----------
const send = (ws, msg) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
};
const cleanText = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const validId = (s) => typeof s === 'string' && /^[a-z0-9]{1,12}$/i.test(s);
const logoV = (room, id) => (room.logos.get(id) ? room.logos.get(id).v : null);
const studentsOf = (room, schoolId) =>
  [...room.players.values()].filter((p) => p.schoolId === schoolId);

function parseLogo(data) {
  if (typeof data !== 'string' || data.length > MAX_LOGO_CHARS) return null;
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!m) return null;
  return { type: 'image/' + m[1], buf: Buffer.from(m[2], 'base64') };
}

function setLogo(room, id, data) {
  if (data === null || data === undefined) return room.logos.delete(id);
  const parsed = parseLogo(data);
  if (!parsed) return false;
  room.logos.set(id, { ...parsed, v: ++room.vc });
  return true;
}

function removeSchool(room, id) {
  for (const p of studentsOf(room, id)) {
    send(p.ws, { t: 'kicked' });
    p.ws?.close(4001, 'kicked');
    room.players.delete(p.id);
  }
  room.buzzes = room.buzzes.filter((b) => b.schoolId !== id);
  room.logos.delete(id);
  room.schools.delete(id);
}

// ---------- public info for the join screen ----------
app.get('/api/room/:code', (req, res) => {
  const room = rooms.get(String(req.params.code || '').toUpperCase());
  res.set('Cache-Control', 'no-store');
  if (!room) return res.status(404).json({ error: 'not_found' });
  res.json({
    code: room.code,
    compV: logoV(room, '_comp'),
    teamSize: TEAM_SIZE,
    schools: [...room.schools.values()].map((s) => ({
      id: s.id,
      name: s.name,
      logoV: logoV(room, s.id),
      count: studentsOf(room, s.id).length,
    })),
  });
});

app.get('/logo/:code/:id', (req, res) => {
  const room = rooms.get(String(req.params.code || '').toUpperCase());
  const logo = room && room.logos.get(String(req.params.id));
  if (!logo) return res.status(404).end();
  res.set('Content-Type', logo.type);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(logo.buf);
});

// ---------- state sent to clients ----------
function hostState(room) {
  const first = room.buzzes[0];
  return {
    t: 'state',
    role: 'host',
    code: room.code,
    phase: room.phase,
    lockOnFirst: room.lockOnFirst,
    compV: logoV(room, '_comp'),
    teamSize: TEAM_SIZE,
    schools: [...room.schools.values()].map((s) => ({
      id: s.id,
      name: s.name,
      logoV: logoV(room, s.id),
      score: s.score,
      pos: room.buzzes.findIndex((b) => b.schoolId === s.id) + 1 || null,
      students: studentsOf(room, s.id).map((p) => ({
        id: p.id,
        name: p.name,
        connected: !!p.ws && p.ws.readyState === 1,
      })),
    })),
    buzzes: room.buzzes.map((b, i) => {
      const s = room.schools.get(b.schoolId);
      const p = room.players.get(b.playerId);
      return {
        pos: i + 1,
        schoolId: b.schoolId,
        school: s ? s.name : '?',
        logoV: s ? logoV(room, s.id) : null,
        student: p ? p.name : '?',
        sinceOpen: Math.round(b.at - room.openedAt),
        behindFirst: Math.round(b.at - first.at),
      };
    }),
  };
}

function playerState(room, p) {
  const s = room.schools.get(p.schoolId);
  const first = room.buzzes[0];
  const mine = room.buzzes.find((b) => b.schoolId === p.schoolId);
  const fs = first && room.schools.get(first.schoolId);
  const fp = first && room.players.get(first.playerId);
  return {
    t: 'state',
    role: 'player',
    code: room.code,
    phase: room.phase,
    compV: logoV(room, '_comp'),
    you: {
      id: p.id,
      name: p.name,
      schoolId: p.schoolId,
      school: s ? s.name : '?',
      logoV: s ? logoV(room, s.id) : null,
      score: s ? s.score : 0,
    },
    teamPos: mine ? room.buzzes.indexOf(mine) + 1 : null,
    byName: mine ? room.players.get(mine.playerId)?.name ?? null : null,
    byYou: !!mine && mine.playerId === p.id,
    winner: first ? { school: fs ? fs.name : '?', student: fp ? fp.name : '?' } : null,
  };
}

function broadcast(room) {
  room.lastActive = Date.now();
  send(room.host, hostState(room));
  for (const p of room.players.values()) send(p.ws, playerState(room, p));
}

// ---------- websocket ----------
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

    // ----- before the socket is identified -----
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
          const school = room.schools.get(String(m.schoolId || ''));
          if (!school) return send(ws, { t: 'join_fail', reason: 'Please choose your school.' });
          const name = cleanText(m.name, 24);
          if (!name) return send(ws, { t: 'join_fail', reason: 'Please enter your name.' });
          const team = studentsOf(room, school.id);
          if (team.length >= TEAM_SIZE)
            return send(ws, {
              t: 'join_fail',
              reason: `${school.name} already has ${TEAM_SIZE} students registered.`,
            });
          if (team.some((x) => x.name.toLowerCase() === name.toLowerCase()))
            return send(ws, { t: 'join_fail', reason: 'That name is already used in your team.' });
          p = { id: crypto.randomBytes(8).toString('hex'), name, schoolId: school.id, ws };
          room.players.set(p.id, p);
        }
        ws.ctx = { room, role: 'player', playerId: p.id };
        send(ws, { t: 'join_ok', code: room.code, playerId: p.id, schoolId: p.schoolId });
        return broadcast(room);
      }
      return;
    }

    const { room, role } = ws.ctx;

    // ----- student -----
    if (role === 'player') {
      if (m.t === 'buzz') {
        const p = room.players.get(ws.ctx.playerId);
        if (!p || room.phase !== 'open') return;
        // One buzz per school per round: the first student to buzz counts for the school.
        if (room.buzzes.some((b) => b.schoolId === p.schoolId)) return;
        room.buzzes.push({ schoolId: p.schoolId, playerId: p.id, at: performance.now() });
        if (room.lockOnFirst) room.phase = 'locked';
        broadcast(room);
      }
      return;
    }

    // ----- host -----
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
        case 'set_schools': {
          const list = Array.isArray(m.schools) ? m.schools.slice(0, MAX_SCHOOLS) : [];
          const next = new Map();
          for (const item of list) {
            if (!item || !validId(item.id) || next.has(item.id)) continue;
            const name = cleanText(item.name, 40);
            if (!name) continue;
            const old = room.schools.get(item.id);
            next.set(item.id, { id: item.id, name, score: old ? old.score : 0 });
          }
          for (const id of [...room.schools.keys()]) if (!next.has(id)) removeSchool(room, id);
          room.schools = next;
          break;
        }
        case 'set_logo': {
          const id = String(m.id || '');
          if (id !== '_comp' && !room.schools.has(id)) return;
          if (setLogo(room, id, m.data) === false) return;
          break;
        }
        case 'score': {
          const s = room.schools.get(String(m.schoolId));
          const d = Number(m.delta);
          if (s && Number.isFinite(d)) s.score += Math.max(-100, Math.min(100, Math.trunc(d)));
          break;
        }
        case 'reset_scores':
          for (const s of room.schools.values()) s.score = 0;
          break;
        case 'kick': {
          const id = String(m.playerId);
          const p = room.players.get(id);
          if (p) {
            send(p.ws, { t: 'kicked' });
            p.ws?.close(4001, 'kicked');
            room.players.delete(id);
            room.buzzes = room.buzzes.filter((b) => b.playerId !== id);
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

server.listen(PORT, () => console.log(`PIC Competition Software running on port ${PORT}`));

module.exports = { server };

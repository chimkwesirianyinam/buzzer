// End-to-end smoke test: starts the server, simulates a host and 3 contestants.
process.env.PORT = process.env.PORT || '3456';
const assert = require('assert');
const WebSocket = require('ws');
const { server } = require('./server');

const url = `ws://localhost:${process.env.PORT}/ws`;
const open = () => new Promise((res) => { const w = new WebSocket(url); w.msgs = []; w.on('message', (d) => w.msgs.push(JSON.parse(d))); w.on('open', () => res(w)); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (w, t) => [...w.msgs].reverse().find((m) => m.t === t);
const tx = (w, m) => w.send(JSON.stringify(m));

(async () => {
  const host = await open();
  tx(host, { t: 'host_create' });
  await wait(100);
  const { code } = last(host, 'host_ok');
  assert.match(code, /^[A-Z]{4}$/);

  const names = ['Ada', 'Bola', 'Chidi'];
  const ps = [];
  for (const n of names) { const p = await open(); tx(p, { t: 'join', code: code.toLowerCase(), name: n }); ps.push(p); }
  const dup = await open(); tx(dup, { t: 'join', code, name: 'ada' });
  await wait(150);
  assert.ok(last(dup, 'join_fail'), 'duplicate name rejected');
  assert.strictEqual(last(host, 'state').players.length, 3);

  // buzz while locked is ignored
  tx(ps[0], { t: 'buzz' }); await wait(100);
  assert.strictEqual(last(host, 'state').buzzes.length, 0);

  tx(host, { t: 'open' }); await wait(100);
  tx(ps[1], { t: 'buzz' }); await wait(20);
  tx(ps[0], { t: 'buzz' }); tx(ps[0], { t: 'buzz' }); await wait(20);
  tx(ps[2], { t: 'buzz' }); await wait(150);
  const hs = last(host, 'state');
  assert.deepStrictEqual(hs.buzzes.map((b) => b.name), ['Bola', 'Ada', 'Chidi']);
  assert.strictEqual(last(ps[0], 'state').winner, 'Bola');
  assert.strictEqual(last(ps[0], 'state').you.pos, 2);

  // scoring, lock-on-first, new round
  tx(host, { t: 'score', playerId: hs.buzzes[0].id, delta: 1 });
  tx(host, { t: 'lock_on_first', value: true });
  tx(host, { t: 'open' }); await wait(100);
  tx(ps[2], { t: 'buzz' }); await wait(20); tx(ps[0], { t: 'buzz' }); await wait(100);
  const hs2 = last(host, 'state');
  assert.deepStrictEqual(hs2.buzzes.map((b) => b.name), ['Chidi']);
  assert.strictEqual(hs2.phase, 'locked');
  assert.strictEqual(hs2.players.find((p) => p.name === 'Bola').score, 1);

  // reconnect: player resumes with id; host resumes with token
  const pid = last(ps[1], 'join_ok').playerId;
  const p2 = await open(); tx(p2, { t: 'join', code, playerId: pid }); await wait(100);
  assert.strictEqual(last(p2, 'join_ok').playerId, pid);
  const { token } = last(host, 'host_ok');
  const host2 = await open(); tx(host2, { t: 'host_resume', code, token }); await wait(100);
  assert.ok(last(host2, 'host_ok'));
  const bad = await open(); tx(bad, { t: 'host_resume', code, token: 'nope' }); await wait(100);
  assert.ok(last(bad, 'host_fail'));

  // kick
  tx(host2, { t: 'kick', playerId: hs.buzzes[0].id }); await wait(100);
  assert.strictEqual(last(host2, 'state').players.length, 2);

  // health + static pages
  const get = (p) => fetch(`http://localhost:${process.env.PORT}${p}`).then((r) => r.status);
  for (const p of ['/healthz', '/', '/host', '/play']) assert.strictEqual(await get(p), 200, p);

  console.log('All tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

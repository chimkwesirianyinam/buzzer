// End-to-end smoke test: starts the server, simulates a host and students from three schools.
process.env.PORT = process.env.PORT || '3456';
const assert = require('assert');
const WebSocket = require('ws');
const { server } = require('./server');

const base = `http://localhost:${process.env.PORT}`;
const url = `ws://localhost:${process.env.PORT}/ws`;
const open = () => new Promise((res) => { const w = new WebSocket(url); w.msgs = []; w.on('message', (d) => w.msgs.push(JSON.parse(d))); w.on('open', () => res(w)); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (w, t) => [...w.msgs].reverse().find((m) => m.t === t);
const tx = (w, m) => w.send(JSON.stringify(m));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  const host = await open();
  tx(host, { t: 'host_create' });
  await wait(100);
  const { code } = last(host, 'host_ok');
  assert.match(code, /^[A-Z]{4}$/);

  // --- setup: schools and logos ---
  tx(host, { t: 'set_schools', schools: [
    { id: 'sa', name: 'Alpha College' }, { id: 'sb', name: 'Bright Academy' }, { id: 'sc', name: 'Crown School' }, { id: 'bad id!', name: 'X' }, { id: 'sd', name: '' },
  ] });
  tx(host, { t: 'set_logo', id: 'sa', data: PNG });
  tx(host, { t: 'set_logo', id: 'sb', data: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }); // svg must be rejected
  tx(host, { t: 'set_logo', id: '_comp', data: PNG });
  await wait(150);
  let hs = last(host, 'state');
  assert.deepStrictEqual(hs.schools.map((s) => s.name), ['Alpha College', 'Bright Academy', 'Crown School']);
  assert.ok(hs.schools[0].logoV, 'logo stored');
  assert.strictEqual(hs.schools[1].logoV, null, 'svg rejected');
  assert.ok(hs.compV, 'competition icon stored');

  const info = await fetch(`${base}/api/room/${code.toLowerCase()}`).then((r) => r.json());
  assert.strictEqual(info.schools.length, 3);
  assert.strictEqual((await fetch(`${base}/api/room/ZZZZ`)).status, 404);
  const logoRes = await fetch(`${base}/logo/${code}/sa`);
  assert.strictEqual(logoRes.status, 200);
  assert.strictEqual(logoRes.headers.get('content-type'), 'image/png');
  assert.strictEqual((await fetch(`${base}/logo/${code}/sb`)).status, 404);

  // --- students join ---
  const join = async (schoolId, name) => { const p = await open(); tx(p, { t: 'join', code: code.toLowerCase(), schoolId, name }); await wait(80); return p; };
  const a1 = await join('sa', 'Ada'), a2 = await join('sa', 'Amaka'), a3 = await join('sa', 'Ayo');
  const a4 = await join('sa', 'Anu');
  assert.ok(last(a4, 'join_fail'), 'team of 3 only');
  const dup = await join('sb', 'Bola'); const dup2 = await join('sb', 'bola');
  assert.ok(last(dup, 'join_ok') && last(dup2, 'join_fail'), 'duplicate name in a team rejected');
  const b1 = dup;
  const c1 = await join('sc', 'Chidi');
  const none = await join('nope', 'Zed');
  assert.ok(last(none, 'join_fail'), 'unknown school rejected');
  hs = last(host, 'state');
  assert.strictEqual(hs.schools[0].students.length, 3);
  assert.strictEqual(hs.schools[1].students.length, 1);

  // --- locked: buzz ignored ---
  tx(a1, { t: 'buzz' }); await wait(100);
  assert.strictEqual(last(host, 'state').buzzes.length, 0);

  // --- a round: one buzz per school, first by server time wins ---
  tx(host, { t: 'open' }); await wait(100);
  tx(b1, { t: 'buzz' }); await wait(20);
  tx(a1, { t: 'buzz' }); await wait(10);
  tx(a2, { t: 'buzz' }); tx(a1, { t: 'buzz' }); await wait(20); // same school again: ignored
  tx(c1, { t: 'buzz' }); await wait(150);
  hs = last(host, 'state');
  assert.deepStrictEqual(hs.buzzes.map((b) => b.school), ['Bright Academy', 'Alpha College', 'Crown School']);
  assert.deepStrictEqual(hs.buzzes.map((b) => b.student), ['Bola', 'Ada', 'Chidi']);
  assert.strictEqual(last(a2, 'state').teamPos, 2);
  assert.strictEqual(last(a2, 'state').byName, 'Ada');
  assert.strictEqual(last(a2, 'state').byYou, false);
  assert.strictEqual(last(a1, 'state').byYou, true);
  assert.strictEqual(last(a3, 'state').winner.school, 'Bright Academy');

  // --- scoring, lock-on-first, new round ---
  tx(host, { t: 'score', schoolId: 'sb', delta: 1 });
  tx(host, { t: 'lock_on_first', value: true });
  tx(host, { t: 'open' }); await wait(100);
  tx(c1, { t: 'buzz' }); await wait(20); tx(a1, { t: 'buzz' }); await wait(100);
  hs = last(host, 'state');
  assert.deepStrictEqual(hs.buzzes.map((b) => b.school), ['Crown School']);
  assert.strictEqual(hs.phase, 'locked');
  assert.strictEqual(hs.schools[1].score, 1);
  assert.strictEqual(last(b1, 'state').you.score, 1);

  // --- reconnects ---
  const pid = last(b1, 'join_ok').playerId;
  const p2 = await open(); tx(p2, { t: 'join', code, playerId: pid }); await wait(100);
  assert.strictEqual(last(p2, 'join_ok').playerId, pid);
  const { token } = last(host, 'host_ok');
  const host2 = await open(); tx(host2, { t: 'host_resume', code, token }); await wait(100);
  assert.ok(last(host2, 'host_ok'));
  const bad = await open(); tx(bad, { t: 'host_resume', code, token: 'nope' }); await wait(100);
  assert.ok(last(bad, 'host_fail'));

  // --- kick a student, then remove a school ---
  tx(host2, { t: 'kick', playerId: last(a3, 'join_ok').playerId }); await wait(100);
  assert.strictEqual(last(host2, 'state').schools[0].students.length, 2);
  tx(host2, { t: 'set_schools', schools: [{ id: 'sa', name: 'Alpha College' }, { id: 'sc', name: 'Crown School' }] }); await wait(120);
  hs = last(host2, 'state');
  assert.deepStrictEqual(hs.schools.map((s) => s.id), ['sa', 'sc']);
  assert.ok(last(p2, 'kicked'), 'students of a removed school are removed');

  // --- pages ---
  for (const p of ['/healthz', '/', '/host', '/play', '/style.css', '/common.js', '/pic-logo.png']) {
    assert.strictEqual((await fetch(base + p)).status, 200, p);
  }
  assert.strictEqual((await fetch(base + '/server.js')).status, 404, 'server.js is not served');

  console.log('All tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

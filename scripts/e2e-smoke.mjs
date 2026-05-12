// Smoke test: simulate a TV + Controller pair against the broker.
// Verifies: join, slot assignment, calibration, ready→match-start, action fan-out, match-end.
// Uses Node's built-in WebSocket (Node 22+).

const URL = process.env.BROKER_URL ?? 'ws://localhost:8787';
const ROOM = 'TESTAB';

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function wrap(ws) {
  // Pub-sub bridge with replay buffer so `until()` doesn't miss messages that
  // arrived between awaits.
  const handlers = new Set();
  const buffer = [];
  ws.addEventListener('message', (e) => {
    const data = typeof e.data === 'string' ? e.data : e.data.toString();
    let msg; try { msg = JSON.parse(data); } catch { return; }
    buffer.push(msg);
    for (const h of handlers) h(msg);
  });
  return {
    socket: ws,
    buffer,
    on: (fn) => handlers.add(fn),
    off: (fn) => handlers.delete(fn),
    send: (m) => ws.send(JSON.stringify(m)),
    close: () => ws.close(),
  };
}

function open(role, preferredSlot) {
  return new Promise((resolve, reject) => {
    const raw = new WebSocket(URL);
    const w = wrap(raw);
    raw.addEventListener('open', () => {
      w.send({ kind: 'join', room: ROOM, role, preferredSlot });
    });
    raw.addEventListener('error', () => reject(new Error('socket error')));
    const first = (msg) => {
      w.off(first);
      if (msg.kind === 'joined') resolve({ w, slot: msg.assignedSlot });
      else if (msg.kind === 'rejected') reject(new Error('rejected: ' + msg.reason));
    };
    w.on(first);
  });
}

function until(w, predicate, timeoutMs = 8000) {
  // First check the replay buffer for matches already received.
  for (const msg of w.buffer) if (predicate(msg)) return Promise.resolve(msg);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { w.off(onMsg); reject(new Error('timeout waiting for: ' + predicate.toString())); }, timeoutMs);
    const onMsg = (msg) => { if (predicate(msg)) { clearTimeout(timer); w.off(onMsg); resolve(msg); } };
    w.on(onMsg);
  });
}

const log = (s) => console.log(`[smoke] ${s}`);

(async () => {
  log(`connecting to ${URL}, room ${ROOM}`);
  const tv = await open('tv');
  log(`tv joined`);
  const ctl = await open('controller');
  log(`controller joined as slot ${ctl.slot}`);
  if (ctl.slot !== 1) throw new Error('expected slot 1');

  await until(tv.w, (m) => m.kind === 'peer-up' && m.role === 'controller');
  log(`tv saw peer-up controller`);

  ctl.w.send({ kind: 'set-calibrated', slot: ctl.slot, calibrated: true });
  ctl.w.send({ kind: 'set-ready', slot: ctl.slot, ready: true });

  const startEv = await until(tv.w, (m) => m.kind === 'game-event' && m.event.type === 'match-start');
  log(`match-start fired: mapId=${startEv.event.mapId} seed=${startEv.event.seed}`);

  const actionTypes = ['JUMP', 'DUCK', 'LEAN_LEFT', 'LEAN_RIGHT', 'PUNCH_LEFT', 'PUNCH_RIGHT'];
  const received = [];
  tv.w.on((m) => { if (m.kind === 'action') received.push(m.event.type); });

  for (const t of actionTypes) {
    ctl.w.send({ kind: 'action', slot: ctl.slot, event: { type: t, timestamp: Date.now(), confidence: 1 } });
    await delay(40);
  }
  await delay(150);
  log(`tv received actions: [${received.join(', ')}]`);
  if (received.length !== actionTypes.length) throw new Error(`expected ${actionTypes.length}, got ${received.length}`);

  tv.w.send({
    kind: 'game-event',
    event: {
      type: 'match-end',
      results: {
        mode: 'solo', mapId: 'phnom-penh-streets', durationMs: 8000,
        perPlayer: [{
          slot: 1, score: 420, coinsCollected: 3, obstaclesAvoided: 5, obstaclesBroken: 0,
          perfectStanceMatches: 0, jumps: 1, ducks: 1, punches: 2, laneChanges: 2, diedAt: 8000,
        }],
        winnerSlot: null,
      },
    },
  });
  await until(ctl.w, (m) => m.kind === 'game-event' && m.event.type === 'match-end');
  log(`controller received match-end`);

  const t0 = Date.now();
  ctl.w.send({ kind: 'ping', ts: t0 });
  await until(ctl.w, (m) => m.kind === 'pong');
  log(`ping RTT: ${Date.now() - t0} ms`);

  tv.w.close(); ctl.w.close();
  await delay(100);
  log('✓ all assertions passed');
  process.exit(0);
})().catch((err) => {
  console.error('[smoke] FAIL:', err.message);
  process.exit(1);
});

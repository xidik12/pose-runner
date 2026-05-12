// packages/broker/src/server.ts
// =============================================================================
// Pose-Runner WebSocket broker.
// - Rooms with up to 4 controllers + N TVs + N spectators
// - Slot assignment with 30 sec reconnect grace
// - Per-room game state (mode, mapId, seed, host)
// - JWT auth (Phase 10+); permissive in dev when JWT_REQUIRED=false
// =============================================================================

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type {
  RoomMessage, RoomState, ControllerSlot, PlayerSlot, ClientRole, GameMode,
} from '@pose-runner/shared';
import { ROOM_CODE_ALPHABET } from '@pose-runner/shared';

// =============================================================================
// CONFIG
// =============================================================================

const PORT = Number(process.env.PORT ?? 8787);
const JWT_REQUIRED = process.env.JWT_REQUIRED === 'true';
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-prod';
const PING_INTERVAL_MS = 10_000;
const RECONNECT_GRACE_MS = 30_000;
const MAX_CONTROLLERS = 4;
const MAX_TVS = 4;
const MAX_SPECTATORS = 16;
const MAX_ROOM_AGE_MS = 4 * 60 * 60 * 1000; // 4h idle GC

// =============================================================================
// TYPES
// =============================================================================

interface Client {
  ws: WebSocket;
  role: ClientRole;
  slot?: PlayerSlot;
  userId?: string;
  displayName?: string;
  isAlive: boolean;
  joinedAt: number;
}

interface ReservedSlot {
  slot: PlayerSlot;
  userId?: string;
  expiresAt: number;
}

interface Room {
  id: string;
  controllers: Map<PlayerSlot, Client>;
  reserved: Map<PlayerSlot, ReservedSlot>;
  tvs: Set<Client>;
  spectators: Set<Client>;
  mode: GameMode;
  mapId: string;
  worldSeed: number;
  hostSlot: PlayerSlot;
  matchStartedAt: number | null;
  createdAt: number;
  lastActivityAt: number;
}

// =============================================================================
// ROOM REGISTRY
// =============================================================================

const rooms = new Map<string, Room>();

function makeRoom(id: string): Room {
  const now = Date.now();
  return {
    id,
    controllers: new Map(),
    reserved: new Map(),
    tvs: new Set(),
    spectators: new Set(),
    mode: 'solo',
    mapId: 'phnom-penh-streets',
    worldSeed: Math.floor(Math.random() * 0xffffffff),
    hostSlot: 1,
    matchStartedAt: null,
    createdAt: now,
    lastActivityAt: now,
  };
}

function getOrCreate(roomId: string): Room {
  let r = rooms.get(roomId);
  if (!r) {
    r = makeRoom(roomId);
    rooms.set(roomId, r);
  }
  return r;
}

function pickFreeSlot(room: Room, preferred?: PlayerSlot): PlayerSlot | null {
  if (preferred) {
    if (!room.controllers.has(preferred) && !room.reserved.has(preferred)) {
      return preferred;
    }
  }
  for (let s = 1 as PlayerSlot; s <= MAX_CONTROLLERS; s = (s + 1) as PlayerSlot) {
    if (!room.controllers.has(s) && !room.reserved.has(s)) return s;
  }
  return null;
}

function snapshotState(room: Room): RoomState {
  const controllers: ControllerSlot[] = [];
  for (const [slot, c] of room.controllers) {
    controllers.push({
      slot,
      ready: (c as any).ready ?? false,
      calibrated: (c as any).calibrated ?? false,
      pingMs: (c as any).pingMs ?? 0,
      userId: c.userId,
      displayName: c.displayName,
    });
  }
  controllers.sort((a, b) => a.slot - b.slot);
  return {
    roomId: room.id,
    controllers,
    tvCount: room.tvs.size,
    spectatorCount: room.spectators.size,
    mode: room.mode,
    mapId: room.mapId,
    worldSeed: room.worldSeed,
    hostSlot: room.hostSlot,
    matchStartedAt: room.matchStartedAt,
  };
}

function broadcast(room: Room, msg: RoomMessage, except?: WebSocket) {
  const json = JSON.stringify(msg);
  const send = (c: Client) => {
    if (c.ws !== except && c.ws.readyState === WebSocket.OPEN) c.ws.send(json);
  };
  for (const c of room.controllers.values()) send(c);
  for (const c of room.tvs) send(c);
  for (const c of room.spectators) send(c);
}

function broadcastState(room: Room) {
  broadcast(room, { kind: 'room-state', state: snapshotState(room) });
}

function send(client: Client, msg: RoomMessage) {
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(msg));
  }
}

// =============================================================================
// AUTH
// =============================================================================

function verifyAuth(token: string | undefined): { userId: string; displayName?: string } | null {
  if (!token) return JWT_REQUIRED ? null : { userId: 'anonymous-' + randomBytes(4).toString('hex') };
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string; name?: string };
    return { userId: decoded.sub, displayName: decoded.name };
  } catch {
    return null;
  }
}

// =============================================================================
// CONNECTION HANDLING
// =============================================================================

function handleJoin(ws: WebSocket, msg: Extract<RoomMessage, { kind: 'join' }>) {
  const auth = verifyAuth(msg.auth?.jwt);
  if (!auth) {
    ws.send(JSON.stringify({ kind: 'rejected', reason: 'auth-failed' } satisfies RoomMessage));
    ws.close();
    return null;
  }

  const roomId = msg.room.toUpperCase();
  // sanity-check room code
  if (!/^[A-Z2-9]{6}$/.test(roomId)) {
    ws.send(JSON.stringify({ kind: 'rejected', reason: 'invalid-slot' } satisfies RoomMessage));
    ws.close();
    return null;
  }

  const room = getOrCreate(roomId);
  const client: Client = {
    ws,
    role: msg.role,
    userId: auth.userId,
    displayName: auth.displayName,
    isAlive: true,
    joinedAt: Date.now(),
  };

  if (msg.role === 'controller') {
    if (room.controllers.size >= MAX_CONTROLLERS) {
      send(client, { kind: 'rejected', reason: 'room-full' });
      ws.close();
      return null;
    }
    const slot = pickFreeSlot(room, msg.preferredSlot);
    if (!slot) {
      send(client, { kind: 'rejected', reason: 'room-full' });
      ws.close();
      return null;
    }
    client.slot = slot;
    room.controllers.set(slot, client);
    if (room.controllers.size === 1) room.hostSlot = slot;
  } else if (msg.role === 'tv') {
    if (room.tvs.size >= MAX_TVS) {
      send(client, { kind: 'rejected', reason: 'room-full' });
      ws.close();
      return null;
    }
    room.tvs.add(client);
  } else {
    if (room.spectators.size >= MAX_SPECTATORS) {
      send(client, { kind: 'rejected', reason: 'room-full' });
      ws.close();
      return null;
    }
    room.spectators.add(client);
  }

  room.lastActivityAt = Date.now();

  send(client, {
    kind: 'joined',
    room: roomId,
    role: msg.role,
    assignedSlot: client.slot,
    state: snapshotState(room),
  });

  broadcast(room, { kind: 'peer-up', role: msg.role, slot: client.slot }, ws);
  broadcastState(room);

  log(`[${roomId}] ${msg.role}${client.slot ? '@' + client.slot : ''} joined (${client.userId})`);
  return { client, room };
}

function handleDisconnect(client: Client, room: Room) {
  if (client.role === 'controller' && client.slot) {
    room.controllers.delete(client.slot);
    // Reserve the slot for reconnect grace
    room.reserved.set(client.slot, {
      slot: client.slot,
      userId: client.userId,
      expiresAt: Date.now() + RECONNECT_GRACE_MS,
    });
    setTimeout(() => {
      const r = room.reserved.get(client.slot!);
      if (r && r.expiresAt <= Date.now()) {
        room.reserved.delete(client.slot!);
        broadcastState(room);
      }
    }, RECONNECT_GRACE_MS + 500);

    // Reassign host if host left
    if (client.slot === room.hostSlot) {
      const next = [...room.controllers.keys()].sort()[0];
      if (next) room.hostSlot = next;
    }
  } else if (client.role === 'tv') {
    room.tvs.delete(client);
  } else {
    room.spectators.delete(client);
  }

  broadcast(room, {
    kind: 'peer-down',
    role: client.role,
    slot: client.slot,
    reconnectGraceMs: RECONNECT_GRACE_MS,
  });
  broadcastState(room);

  log(`[${room.id}] ${client.role}${client.slot ? '@' + client.slot : ''} left`);

  if (room.controllers.size === 0 && room.tvs.size === 0 && room.spectators.size === 0) {
    rooms.delete(room.id);
    log(`[${room.id}] room deleted (empty)`);
  }
}

function handleMessage(client: Client, room: Room, msg: RoomMessage) {
  room.lastActivityAt = Date.now();

  switch (msg.kind) {
    case 'action':
      // Forward only to TVs (and spectators) — controllers don't need other controllers' actions
      if (client.role !== 'controller' || msg.slot !== client.slot) return;
      for (const tv of room.tvs) send(tv, msg);
      for (const sp of room.spectators) send(sp, msg);
      break;

    case 'set-mode':
      if (client.role !== 'controller' || client.slot !== room.hostSlot) return;
      room.mode = msg.mode;
      broadcastState(room);
      break;

    case 'set-map':
      if (client.role !== 'controller' || client.slot !== room.hostSlot) return;
      room.mapId = msg.mapId;
      broadcastState(room);
      break;

    case 'set-ready':
      if (client.role !== 'controller' || msg.slot !== client.slot) return;
      (client as any).ready = msg.ready;
      broadcastState(room);
      maybeStartMatch(room);
      break;

    case 'set-calibrated':
      if (client.role !== 'controller' || msg.slot !== client.slot) return;
      (client as any).calibrated = msg.calibrated;
      broadcastState(room);
      break;

    case 'game-event':
      // TV is the authority on match start/end. Forward to everyone.
      if (client.role !== 'tv') return;
      if (msg.event.type === 'match-start') room.matchStartedAt = Date.now();
      if (msg.event.type === 'match-end') room.matchStartedAt = null;
      broadcast(room, msg);
      break;

    case 'ping':
      send(client, { kind: 'pong', ts: msg.ts, serverTs: Date.now() });
      break;

    case 'pong': {
      const rtt = Date.now() - msg.ts;
      (client as any).pingMs = rtt;
      break;
    }
  }
}

function maybeStartMatch(room: Room) {
  if (room.matchStartedAt !== null) return;
  if (room.controllers.size === 0) return;
  // All currently-connected controllers must be ready AND calibrated
  for (const c of room.controllers.values()) {
    if (!(c as any).ready) return;
    if (!(c as any).calibrated) return;
  }
  // Refresh seed for shared-world modes
  room.worldSeed = Math.floor(Math.random() * 0xffffffff);
  broadcast(room, {
    kind: 'game-event',
    event: {
      type: 'match-start',
      mapId: room.mapId,
      mode: room.mode,
      seed: room.worldSeed,
      durationMs: room.mode === 'score-battle' ? 90_000 : undefined,
    },
  });
  room.matchStartedAt = Date.now();
  broadcastState(room);
}

// =============================================================================
// SERVER + HEARTBEAT
// =============================================================================

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: rooms.size,
      uptime: process.uptime(),
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  let bound: { client: Client; room: Room } | null = null;

  ws.on('message', (data) => {
    let msg: RoomMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ kind: 'error', code: 'bad-json', message: 'invalid JSON' }));
      return;
    }

    if (!bound) {
      if (msg.kind !== 'join') {
        ws.send(JSON.stringify({ kind: 'error', code: 'not-joined', message: 'must join first' }));
        ws.close();
        return;
      }
      bound = handleJoin(ws, msg) ?? null;
      return;
    }

    handleMessage(bound.client, bound.room, msg);
  });

  ws.on('pong', () => {
    if (bound) (bound.client as any).isAlive = true;
  });

  ws.on('close', () => {
    if (bound) handleDisconnect(bound.client, bound.room);
  });

  ws.on('error', (err) => {
    log(`ws error: ${err.message}`);
  });
});

// Heartbeat: every 10s, ping each client; drop those that didn't pong since last cycle.
setInterval(() => {
  for (const room of rooms.values()) {
    const all: Client[] = [
      ...room.controllers.values(),
      ...room.tvs,
      ...room.spectators,
    ];
    for (const c of all) {
      if (!c.isAlive) {
        c.ws.terminate();
        continue;
      }
      c.isAlive = false;
      c.ws.ping();
    }
  }
}, PING_INTERVAL_MS);

// Idle room GC
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.lastActivityAt > MAX_ROOM_AGE_MS) {
      log(`[${id}] room expired (idle)`);
      for (const c of [...room.controllers.values(), ...room.tvs, ...room.spectators]) {
        c.ws.close();
      }
      rooms.delete(id);
    }
  }
}, 60_000);

httpServer.listen(PORT, () => {
  log(`pose-runner broker listening on :${PORT} (auth ${JWT_REQUIRED ? 'required' : 'optional'})`);
});

function log(s: string) {
  console.log(`[${new Date().toISOString()}] ${s}`);
}

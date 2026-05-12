import type { RoomMessage, PlayerSlot, ClientRole, RoomState, MatchResult } from '@pose-runner/shared';

export interface TvBrokerOptions {
  url: string;
  room: string;
  onJoined?: (state: RoomState) => void;
  onState?: (state: RoomState) => void;
  onPeerUp?: (role: ClientRole, slot?: PlayerSlot) => void;
  onPeerDown?: (role: ClientRole, slot?: PlayerSlot) => void;
  onMatchStart?: (seed: number, mapId: string, durationMs?: number) => void;
  onActionEvent?: (msg: Extract<RoomMessage, { kind: 'action' }>) => void;
}

export class TvBrokerClient {
  private ws: WebSocket | null = null;
  private opts: TvBrokerOptions;
  private reconnectAttempts = 0;
  pingMs = 0;

  constructor(opts: TvBrokerOptions) { this.opts = opts; }

  connect() {
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.send({ kind: 'join', room: this.opts.room, role: 'tv' });
      setInterval(() => this.send({ kind: 'ping', ts: Date.now() }), 5000);
    });
    ws.addEventListener('message', (e) => this.handle(e.data));
    ws.addEventListener('close', () => {
      const delay = Math.min(8000, 500 * 2 ** this.reconnectAttempts++);
      setTimeout(() => this.connect(), delay);
    });
    ws.addEventListener('error', () => ws.close());
  }

  send(msg: RoomMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  reportMatchEnd(result: MatchResult) {
    this.send({ kind: 'game-event', event: { type: 'match-end', results: result } });
  }

  private handle(data: string | ArrayBuffer | Blob) {
    if (typeof data !== 'string') return;
    let msg: RoomMessage;
    try { msg = JSON.parse(data); } catch { return; }
    switch (msg.kind) {
      case 'joined':     this.opts.onJoined?.(msg.state); break;
      case 'room-state': this.opts.onState?.(msg.state); break;
      case 'peer-up':    this.opts.onPeerUp?.(msg.role, msg.slot); break;
      case 'peer-down':  this.opts.onPeerDown?.(msg.role, msg.slot); break;
      case 'action':     this.opts.onActionEvent?.(msg); break;
      case 'pong':       this.pingMs = Date.now() - msg.ts; break;
      case 'game-event':
        if (msg.event.type === 'match-start') {
          this.opts.onMatchStart?.(msg.event.seed, msg.event.mapId, msg.event.durationMs);
        }
        break;
    }
  }
}

// Thin reconnecting WebSocket client speaking the RoomMessage protocol.
import type { RoomMessage, PlayerSlot, ClientRole, RoomState } from '@pose-runner/shared';

export interface BrokerClientOptions {
  url: string;
  room: string;
  role: ClientRole;
  preferredSlot?: PlayerSlot;
  jwt?: string;
  onJoined?: (slot: PlayerSlot | undefined, state: RoomState) => void;
  onState?: (state: RoomState) => void;
  onMatchStart?: (payload: Extract<RoomMessage, { kind: 'game-event' }>['event']) => void;
  onMatchEnd?: (payload: Extract<RoomMessage, { kind: 'game-event' }>['event']) => void;
  onPeerUp?: (role: ClientRole, slot?: PlayerSlot) => void;
  onPeerDown?: (role: ClientRole, slot?: PlayerSlot) => void;
  onRejected?: (reason: string) => void;
  onClose?: () => void;
}

export class BrokerClient {
  private ws: WebSocket | null = null;
  private opts: BrokerClientOptions;
  private reconnectAttempts = 0;
  private heartbeat?: number;
  pingMs = 0;

  constructor(opts: BrokerClientOptions) {
    this.opts = opts;
  }

  connect() {
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.send({
        kind: 'join',
        room: this.opts.room,
        role: this.opts.role,
        preferredSlot: this.opts.preferredSlot,
        auth: this.opts.jwt ? { jwt: this.opts.jwt } : undefined,
      });
      this.heartbeat = window.setInterval(() => {
        this.send({ kind: 'ping', ts: Date.now() });
      }, 5000);
    });
    ws.addEventListener('message', (e) => this.onMessage(e.data));
    ws.addEventListener('close', () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.opts.onClose?.();
      // Back-off reconnect
      const delay = Math.min(8000, 500 * 2 ** this.reconnectAttempts++);
      setTimeout(() => this.connect(), delay);
    });
    ws.addEventListener('error', () => ws.close());
  }

  send(msg: RoomMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private onMessage(data: string | ArrayBuffer | Blob) {
    if (typeof data !== 'string') return;
    let msg: RoomMessage;
    try { msg = JSON.parse(data); } catch { return; }
    switch (msg.kind) {
      case 'joined':
        this.opts.onJoined?.(msg.assignedSlot, msg.state);
        break;
      case 'room-state':
        this.opts.onState?.(msg.state);
        break;
      case 'peer-up':
        this.opts.onPeerUp?.(msg.role, msg.slot);
        break;
      case 'peer-down':
        this.opts.onPeerDown?.(msg.role, msg.slot);
        break;
      case 'rejected':
        this.opts.onRejected?.(msg.reason);
        break;
      case 'pong':
        this.pingMs = Date.now() - msg.ts;
        break;
      case 'game-event':
        if (msg.event.type === 'match-start') this.opts.onMatchStart?.(msg.event);
        else if (msg.event.type === 'match-end') this.opts.onMatchEnd?.(msg.event);
        break;
    }
  }
}

// Main-thread companion to poseWorker.ts.
// - Owns the <video> + getUserMedia
// - Pumps frames via requestVideoFrameCallback into the worker (zero-copy ImageBitmap)
// - Forwards snapshots out via a callback
import type { PoseSnapshot } from '@pose-runner/shared';
import type { WorkerInbound, WorkerOutbound } from './poseWorker';
import { POSE_MODEL_URL, POSE_WASM_BASE_URL } from '../config';

export interface PoseClientOptions {
  video: HTMLVideoElement;
  onSnapshot: (snap: PoseSnapshot, inferenceMs: number) => void;
  onNoPose?: () => void;
  onReady?: () => void;
  onError?: (msg: string, fatal: boolean) => void;
}

export class PoseClient {
  private worker: Worker;
  private video: HTMLVideoElement;
  private running = false;
  private opts: PoseClientOptions;

  constructor(opts: PoseClientOptions) {
    this.opts = opts;
    this.video = opts.video;
    this.worker = new Worker(new URL('./poseWorker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (e: MessageEvent<WorkerOutbound>) => {
      const msg = e.data;
      switch (msg.kind) {
        case 'ready':    this.opts.onReady?.(); break;
        case 'snapshot': this.opts.onSnapshot(msg.snapshot, msg.inferenceMs); break;
        case 'no-pose':  this.opts.onNoPose?.(); break;
        case 'error':    this.opts.onError?.(msg.message, msg.fatal); break;
      }
    });
  }

  async start() {
    // 1. Acquire camera
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    this.video.srcObject = stream;
    await new Promise<void>((resolve) => {
      if (this.video.readyState >= 2) return resolve();
      this.video.onloadedmetadata = () => resolve();
    });
    await this.video.play();

    // 2. Init worker
    this.post({ kind: 'init', modelUrl: POSE_MODEL_URL, wasmBaseUrl: POSE_WASM_BASE_URL, useGpu: true });

    // 3. Pump frames as the video produces them
    this.running = true;
    this.pumpLoop();
  }

  stop() {
    this.running = false;
    this.post({ kind: 'shutdown' });
    const stream = this.video.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
  }

  reset() {
    this.post({ kind: 'reset' });
  }

  private pumpLoop = () => {
    if (!this.running) return;
    // requestVideoFrameCallback fires once per decoded frame. Fallback to rAF.
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (typeof v.requestVideoFrameCallback === 'function') {
      v.requestVideoFrameCallback(() => { this.sendFrame(); this.pumpLoop(); });
    } else {
      requestAnimationFrame(() => { this.sendFrame(); this.pumpLoop(); });
    }
  };

  private async sendFrame() {
    if (!this.running || this.video.readyState < 2) return;
    try {
      const bitmap = await createImageBitmap(this.video);
      this.post({ kind: 'frame', bitmap, timestampMs: performance.now() }, [bitmap]);
    } catch {
      /* video not ready yet, or tab backgrounded */
    }
  }

  private post(msg: WorkerInbound, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }
}

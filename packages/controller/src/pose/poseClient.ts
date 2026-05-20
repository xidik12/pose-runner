// Main-thread MediaPipe Pose Landmarker.
// (Worker-based implementation hit "ModuleFactory not set" on Safari due to
// MediaPipe's emscripten loader requiring DOM. Main-thread is simpler + reliable.)
import {
  PoseLandmarker, FilesetResolver,
  type NormalizedLandmark, type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { Landmark, PoseSnapshot } from '@pose-runner/shared';
import { POSE_MODEL_URL, POSE_WASM_BASE_URL } from '../config';

export interface PoseClientOptions {
  video: HTMLVideoElement;
  onSnapshot: (snap: PoseSnapshot, inferenceMs: number) => void;
  onNoPose?: () => void;
  onReady?: () => void;
  onError?: (msg: string, fatal: boolean) => void;
  /** 'environment' = back camera (preferred for tripod-on-back-of-room),
   *  'user' = front camera (selfie). Default 'environment'. */
  facingMode?: 'environment' | 'user';
}

const FRAME_INTERVAL_MS = 33; // ~30 fps target — caps inference rate

export class PoseClient {
  private video: HTMLVideoElement;
  private opts: PoseClientOptions;
  private landmarker: PoseLandmarker | null = null;
  private running = false;
  private lastInferenceTs = 0;
  private lastTimestampMs = -1;
  private inFlight = false;

  constructor(opts: PoseClientOptions) {
    this.opts = opts;
    this.video = opts.video;
  }

  async start() {
    // 1. Acquire camera (back camera by default; tripod faces player)
    const facing = this.opts.facingMode ?? 'environment';
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: false,
      });
    } catch (err) {
      // Some devices reject 'ideal' facingMode; retry with exact, then fall back to any camera.
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
    }
    this.video.srcObject = stream;
    await new Promise<void>((resolve) => {
      if (this.video.readyState >= 2) return resolve();
      this.video.onloadedmetadata = () => resolve();
    });
    await this.video.play();

    // 2. Init MediaPipe (main thread — no worker, no document hacks)
    try {
      const fileset = await FilesetResolver.forVisionTasks(POSE_WASM_BASE_URL);
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: POSE_MODEL_URL,
          // GPU breaks on some Safari builds → use CPU; on phones it's still ~30ms/frame
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      this.opts.onReady?.();
    } catch (err) {
      this.opts.onError?.(errMsg(err), true);
      return;
    }

    // 3. Frame pump loop
    this.running = true;
    this.pumpLoop();
  }

  stop() {
    this.running = false;
    if (this.landmarker) { this.landmarker.close(); this.landmarker = null; }
    const stream = this.video.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
  }

  reset() {
    this.lastTimestampMs = -1;
    this.inFlight = false;
  }

  private pumpLoop = () => {
    if (!this.running) return;
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (typeof v.requestVideoFrameCallback === 'function') {
      v.requestVideoFrameCallback(() => { this.processFrame(); this.pumpLoop(); });
    } else {
      requestAnimationFrame(() => { this.processFrame(); this.pumpLoop(); });
    }
  };

  private processFrame() {
    if (!this.running || !this.landmarker) return;
    if (this.video.readyState < 2) return;
    if (this.inFlight) return;

    const now = performance.now();
    if (now - this.lastInferenceTs < FRAME_INTERVAL_MS) return;
    this.lastInferenceTs = now;

    // MediaPipe requires monotonic timestamps in VIDEO mode
    let ts = Math.floor(now);
    if (ts <= this.lastTimestampMs) ts = this.lastTimestampMs + 1;
    this.lastTimestampMs = ts;

    this.inFlight = true;
    let result: PoseLandmarkerResult;
    try {
      const t0 = performance.now();
      result = this.landmarker.detectForVideo(this.video, ts);
      const inferenceMs = +(performance.now() - t0).toFixed(1);
      this.handleResult(result, ts, inferenceMs);
    } catch (err) {
      this.opts.onError?.(errMsg(err), false);
    } finally {
      this.inFlight = false;
    }
  }

  private handleResult(result: PoseLandmarkerResult, timestampMs: number, inferenceMs: number) {
    if (!result.landmarks?.length || !result.worldLandmarks?.length) {
      this.opts.onNoPose?.();
      return;
    }
    const worldLandmarks = result.worldLandmarks[0];
    const imageLandmarks = result.landmarks[0];

    // y-up flip (MediaPipe is y-down) for downstream detector math
    const flipped: Landmark[] = worldLandmarks.map((p: NormalizedLandmark) => ({
      x: p.x, y: -p.y, z: p.z, visibility: p.visibility ?? 1,
    }));
    const imgLm: Landmark[] = imageLandmarks.map((p: NormalizedLandmark) => ({
      x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 1,
    }));

    const coreIdx = [0, 11, 12, 23, 24];
    let visSum = 0;
    for (const i of coreIdx) visSum += flipped[i].visibility;
    const avgVisibility = visSum / coreIdx.length;

    const snap: PoseSnapshot = {
      timestamp: timestampMs,
      landmarks: flipped,
      imageLandmarks: imgLm,
      avgVisibility,
    };
    this.opts.onSnapshot(snap, inferenceMs);
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

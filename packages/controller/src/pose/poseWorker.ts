// packages/controller/src/pose/poseWorker.ts
// =============================================================================
// MediaPipe Pose Landmarker, run inside a Web Worker so the main thread stays
// free for camera, UI, and WebSocket. Receives ImageBitmaps via postMessage
// (transferable, no copy), runs inference, posts back PoseSnapshot.
//
// The main thread owns:
//   - <video> element + getUserMedia
//   - requestVideoFrameCallback loop → createImageBitmap → postMessage to this worker
//   - DetectorPipeline.tick(snapshot) on the snapshot returned from this worker
//   - WebSocket send of any ActionEvents emitted by tick()
//
// This separation means pose inference (~10-25 ms per frame on a recent phone)
// never blocks input handling or rendering on the controller UI.
// =============================================================================

/// <reference lib="webworker" />

// MediaPipe's Emscripten glue references `document.currentScript` and
// `document.head` to compute base URLs. Workers have no DOM, so this throws
// "Can't find variable: document" on Safari and some Chrome versions.
// Minimal shim — values don't matter, MediaPipe falls back to other paths.
if (typeof (globalThis as { document?: unknown }).document === 'undefined') {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ setAttribute() {}, set src(_v: string) {}, addEventListener() {} }),
    head: { appendChild() {} },
    currentScript: { src: (self as unknown as { location: Location }).location.href },
    location: (self as unknown as { location: Location }).location,
  };
}

import {
  PoseLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { Landmark, PoseSnapshot } from '@pose-runner/shared';

// ---------------------------------------------------------------------------
// Wire protocol (worker ↔ main)
// ---------------------------------------------------------------------------

export type WorkerInbound =
  | { kind: 'init'; modelUrl: string; wasmBaseUrl: string; useGpu: boolean }
  | { kind: 'frame'; bitmap: ImageBitmap; timestampMs: number }
  | { kind: 'reset' }
  | { kind: 'shutdown' };

export type WorkerOutbound =
  | { kind: 'ready' }
  | { kind: 'error'; message: string; fatal: boolean }
  | { kind: 'snapshot'; snapshot: PoseSnapshot; inferenceMs: number; queuedAtMs: number }
  | { kind: 'no-pose'; timestampMs: number };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let landmarker: PoseLandmarker | null = null;
let lastTimestampMs = -1;
let initialized = false;

// Queue depth — drop frames if we're falling behind. Better than UI feeling laggy.
const MAX_QUEUE_DEPTH = 1;
let inFlight = 0;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init(modelUrl: string, wasmBaseUrl: string, useGpu: boolean) {
  try {
    const fileset = await FilesetResolver.forVisionTasks(wasmBaseUrl);
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: modelUrl,
        delegate: useGpu ? 'GPU' : 'CPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
    initialized = true;
    post({ kind: 'ready' });
  } catch (err) {
    post({ kind: 'error', message: errMsg(err), fatal: true });
  }
}

// ---------------------------------------------------------------------------
// Frame processing
// ---------------------------------------------------------------------------

function processFrame(bitmap: ImageBitmap, timestampMs: number) {
  if (!landmarker || !initialized) {
    bitmap.close();
    return;
  }
  if (inFlight >= MAX_QUEUE_DEPTH) {
    // Drop this frame; the prior one is still being processed.
    bitmap.close();
    return;
  }

  // MediaPipe requires monotonically increasing timestamps in VIDEO mode.
  if (timestampMs <= lastTimestampMs) {
    timestampMs = lastTimestampMs + 1;
  }
  lastTimestampMs = timestampMs;

  inFlight++;
  const t0 = performance.now();
  let result: PoseLandmarkerResult;
  try {
    result = landmarker.detectForVideo(bitmap, timestampMs);
  } catch (err) {
    post({ kind: 'error', message: errMsg(err), fatal: false });
    bitmap.close();
    inFlight--;
    return;
  }
  const t1 = performance.now();

  // free the bitmap as soon as inference is done
  bitmap.close();

  if (!result.landmarks?.length || !result.worldLandmarks?.length) {
    post({ kind: 'no-pose', timestampMs });
    inFlight--;
    return;
  }

  const worldLandmarks = result.worldLandmarks[0];
  const imageLandmarks = result.landmarks[0];

  // MediaPipe's world coordinates are y-DOWN positive. Game logic is y-UP.
  // Flip y once at this boundary; everything downstream assumes y-up.
  const flipY = (lm: NormalizedLandmark[]): Landmark[] =>
    lm.map((p) => ({
      x: p.x,
      y: -p.y,
      z: p.z,
      visibility: p.visibility ?? 1,
    }));

  const flippedWorld = flipY(worldLandmarks);

  // Average visibility across the body's "core" landmarks; cheap quality gate.
  const coreIdx = [0, 11, 12, 23, 24]; // nose, shoulders, hips
  let visSum = 0;
  for (const i of coreIdx) visSum += flippedWorld[i].visibility;
  const avgVisibility = visSum / coreIdx.length;

  const snapshot: PoseSnapshot = {
    timestamp: timestampMs,
    landmarks: flippedWorld,
    imageLandmarks: imageLandmarks.map((p) => ({
      x: p.x,
      y: p.y,
      z: p.z,
      visibility: p.visibility ?? 1,
    })),
    avgVisibility,
  };

  post({
    kind: 'snapshot',
    snapshot,
    inferenceMs: +(t1 - t0).toFixed(1),
    queuedAtMs: timestampMs,
  });
  inFlight--;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function reset() {
  lastTimestampMs = -1;
  inFlight = 0;
}

function shutdown() {
  if (landmarker) {
    landmarker.close();
    landmarker = null;
  }
  initialized = false;
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

self.addEventListener('message', (e: MessageEvent<WorkerInbound>) => {
  const msg = e.data;
  switch (msg.kind) {
    case 'init':    init(msg.modelUrl, msg.wasmBaseUrl, msg.useGpu); break;
    case 'frame':   processFrame(msg.bitmap, msg.timestampMs); break;
    case 'reset':   reset(); break;
    case 'shutdown': shutdown(); break;
  }
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function post(msg: WorkerOutbound) {
  (self as unknown as Worker).postMessage(msg);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// =============================================================================
// MAIN-THREAD COMPANION (packages/controller/src/pose/poseClient.ts)
// =============================================================================
// Use the worker like this from the controller app:
//
//   const worker = new Worker(new URL('./poseWorker.ts', import.meta.url), {
//     type: 'module',
//   });
//
//   worker.postMessage({
//     kind: 'init',
//     modelUrl: '/models/pose_landmarker_lite.task',
//     wasmBaseUrl: '/wasm/',  // contains MediaPipe wasm binaries
//     useGpu: true,           // fall back to false on iOS Safari < 17 if needed
//   });
//
//   const video = document.querySelector('video')!;
//   const sendFrame = async () => {
//     // requestVideoFrameCallback fires once per frame the browser actually decoded
//     const bitmap = await createImageBitmap(video);
//     worker.postMessage(
//       { kind: 'frame', bitmap, timestampMs: performance.now() },
//       [bitmap],  // <-- transfer, no copy
//     );
//   };
//
//   const loop = () => {
//     sendFrame();
//     // @ts-ignore — Safari supports it, TS lib types lag
//     video.requestVideoFrameCallback(loop);
//   };
//   // @ts-ignore
//   video.requestVideoFrameCallback(loop);
//
//   worker.addEventListener('message', (e) => {
//     const msg = e.data as WorkerOutbound;
//     if (msg.kind === 'snapshot') {
//       const events = pipeline.tick(msg.snapshot);
//       for (const ev of events) ws.send(JSON.stringify({
//         kind: 'action', slot: mySlot, event: ev,
//       }));
//     } else if (msg.kind === 'error' && msg.fatal) {
//       showError(msg.message);
//     }
//   });
// =============================================================================

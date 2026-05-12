// Tunable knobs that don't belong in detector internals.
// All thresholds for the detectors themselves live in detect/index.ts → defaultConfig.

export const BROKER_URL = (() => {
  const env = (import.meta.env as Record<string, string>).VITE_BROKER_URL;
  if (env) return env;
  // Default: same host the controller is served from, port 8787, ws (not wss — broker has no TLS in dev)
  const host = location.hostname;
  return `ws://${host}:8787`;
})();

export const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export const POSE_WASM_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';

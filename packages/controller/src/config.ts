// Sibling-URL derivation:
//   pose-ctl.example.com → broker: wss://pose-broker.example.com
//   localhost            → broker: ws://localhost:8787
// Override with VITE_BROKER_URL at build time if needed.

const env = (import.meta.env as Record<string, string>);

function brokerDefault(): string {
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return `ws://${host}:8787`;
  }
  const replaced = host.replace(/^pose-[a-z]+/, 'pose-broker');
  return `wss://${replaced}`;
}

export const BROKER_URL = env.VITE_BROKER_URL || brokerDefault();

export const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export const POSE_WASM_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';

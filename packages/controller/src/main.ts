// Controller PWA entry point.
// Orchestrates: camera → worker → detector pipeline → WS → broker.
import type { ActionEvent, PoseSnapshot, PlayerSlot, StanceDefinition } from '@pose-runner/shared';
import { randomRoomCode } from '@pose-runner/shared';
import { tick, newPipeline, CalibrationCapture } from './detect/index';
import { PoseClient } from './pose/poseClient';
import { BrokerClient } from './net/ws';
import { resizeOverlay, drawSkeleton, clearOverlay } from './ui/overlay';
import { BROKER_URL } from './config';
import stancesData from '../../shared/src/data/stances.json';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const video = document.getElementById('video') as HTMLVideoElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const fpsEl = document.getElementById('fps') as HTMLDivElement;
const roomEl = document.getElementById('room') as HTMLSpanElement;
const slotEl = document.getElementById('slot-label') as HTMLDivElement;
const calibMsg = document.getElementById('calib-msg') as HTMLDivElement;
const btnCalibrate = document.getElementById('btn-calibrate') as HTMLButtonElement;
const btnReady = document.getElementById('btn-ready') as HTMLButtonElement;
const lastActionEl = document.getElementById('last-action') as HTMLDivElement;
const toast = document.getElementById('toast') as HTMLDivElement;

// ---------------------------------------------------------------------------
// Room code: read from ?room=... or generate one
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const roomCode = (params.get('room') || randomRoomCode()).toUpperCase();
roomEl.textContent = roomCode;
history.replaceState(null, '', `?room=${roomCode}`);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const stances = (stancesData as { stances: StanceDefinition[] }).stances;
const pipeline = newPipeline(stances);
let calib = new CalibrationCapture();
let calibrating = false;
let calibrated = false;
let ready = false;
let mySlot: PlayerSlot | undefined;
let matchActive = false;

// FPS tracking
let frameCount = 0;
let fpsAccumStart = performance.now();
let lastInferenceMs = 0;

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function setStatus(text: string, kind: 'neutral' | 'ok' | 'warn' | 'err' = 'neutral') {
  statusEl.textContent = text;
  statusEl.className = kind === 'neutral' ? '' : kind;
}

function showToast(msg: string) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2200);
}

// ---------------------------------------------------------------------------
// Broker client
// ---------------------------------------------------------------------------

const broker = new BrokerClient({
  url: BROKER_URL,
  room: roomCode,
  role: 'controller',
  onJoined: (slot, _state) => {
    mySlot = slot;
    slotEl.textContent = `slot: ${slot ?? '-'}`;
    setStatus(`paired · ${roomCode}`, 'ok');
    showToast(`joined as P${slot}`);
  },
  onState: () => {/* later: render other player readiness */},
  onMatchStart: () => {
    matchActive = true;
    showToast('match start');
    setStatus('playing', 'ok');
  },
  onMatchEnd: () => {
    matchActive = false;
    ready = false;
    btnReady.textContent = 'ready';
    btnReady.classList.remove('ready');
    setStatus('match ended', 'neutral');
  },
  onPeerDown: (role) => { if (role === 'tv') showToast('TV disconnected'); },
  onRejected: (reason) => setStatus(`rejected: ${reason}`, 'err'),
  onClose: () => setStatus('reconnecting…', 'warn'),
});
broker.connect();

// ---------------------------------------------------------------------------
// Pose pipeline
// ---------------------------------------------------------------------------

const pose = new PoseClient({
  video,
  onReady: () => setStatus(`paired · ${roomCode}`, 'ok'),
  onError: (msg, fatal) => setStatus(`pose: ${msg}${fatal ? ' (fatal)' : ''}`, 'err'),
  onNoPose: () => clearOverlay(overlay),
  onSnapshot: (snap, infMs) => handleSnapshot(snap, infMs),
});

function handleSnapshot(snap: PoseSnapshot, inferenceMs: number) {
  lastInferenceMs = inferenceMs;
  frameCount++;
  const now = performance.now();
  if (now - fpsAccumStart >= 1000) {
    const fps = (frameCount * 1000) / (now - fpsAccumStart);
    fpsEl.textContent = `${fps.toFixed(0)} fps · ${inferenceMs.toFixed(0)} ms`;
    frameCount = 0;
    fpsAccumStart = now;
  }

  // Debug overlay
  drawSkeleton(overlay, snap.imageLandmarks);

  // Calibration capture phase
  if (calibrating) {
    const done = calib.push(snap);
    if (done) {
      const baseline = calib.finalize();
      calibrating = false;
      if (baseline) {
        pipeline.baseline = baseline;
        calibrated = true;
        calibMsg.textContent = 'calibrated. tap ready when you are.';
        btnCalibrate.textContent = 'recalibrate';
        btnReady.disabled = false;
        broker.send({ kind: 'set-calibrated', slot: mySlot!, calibrated: true });
        showToast('calibrated');
      } else {
        calibMsg.textContent = 'calibration failed — stay still, try again.';
      }
    }
    return;
  }

  // Run detectors
  const events = tick(pipeline, snap);
  for (const ev of events) {
    sendAction(ev);
  }
}

function sendAction(ev: ActionEvent) {
  if (!mySlot) return;
  broker.send({ kind: 'action', slot: mySlot, event: ev });
  if (ev.type !== 'IDLE') {
    const meta = ev.meta ? ' ' + JSON.stringify(ev.meta) : '';
    lastActionEl.textContent = `${ev.type}${meta}`;
  }
}

// ---------------------------------------------------------------------------
// UI handlers
// ---------------------------------------------------------------------------

btnCalibrate.addEventListener('click', async () => {
  if (calibrating) return;
  if (!pipeline.baseline && !pose) return;
  calib = new CalibrationCapture();
  calibrating = true;
  calibrated = false;
  ready = false;
  btnReady.disabled = true;
  // brief 3-2-1 countdown for UX
  for (let i = 3; i > 0; i--) {
    calibMsg.textContent = `hold still… ${i}`;
    await new Promise((r) => setTimeout(r, 600));
  }
  calibMsg.textContent = 'capturing baseline…';
});

btnReady.addEventListener('click', () => {
  if (!mySlot || !calibrated) return;
  ready = !ready;
  btnReady.textContent = ready ? 'cancel' : 'ready';
  btnReady.classList.toggle('ready', ready);
  broker.send({ kind: 'set-ready', slot: mySlot, ready });
});

window.addEventListener('resize', () => resizeOverlay(overlay, video));
video.addEventListener('loadedmetadata', () => resizeOverlay(overlay, video));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async () => {
  setStatus('asking for camera…', 'warn');
  try {
    await pose.start();
    resizeOverlay(overlay, video);
    setStatus(`paired · ${roomCode}`, 'ok');
  } catch (err) {
    setStatus(`camera blocked: ${(err as Error).message}`, 'err');
  }
})();

// silence unused-warning for matchActive (kept for HUD hints later)
void matchActive;
void lastInferenceMs;

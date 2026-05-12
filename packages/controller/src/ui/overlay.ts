// Debug skeleton overlay. Draws MediaPipe's BlazePose connections on top of the video feed.
import type { Landmark } from '@pose-runner/shared';

const CONNECTIONS: [number, number][] = [
  // torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // left arm
  [11, 13], [13, 15],
  // right arm
  [12, 14], [14, 16],
  // left leg
  [23, 25], [25, 27],
  // right leg
  [24, 26], [26, 28],
  // head ring (nose to ears)
  [0, 7], [0, 8],
];

export function resizeOverlay(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = video.clientWidth * dpr;
  canvas.height = video.clientHeight * dpr;
  canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function drawSkeleton(canvas: HTMLCanvasElement, imageLandmarks: Landmark[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(120, 220, 255, 0.85)';
  ctx.beginPath();
  for (const [a, b] of CONNECTIONS) {
    const la = imageLandmarks[a], lb = imageLandmarks[b];
    if (!la || !lb || la.visibility < 0.4 || lb.visibility < 0.4) continue;
    ctx.moveTo(la.x * w, la.y * h);
    ctx.lineTo(lb.x * w, lb.y * h);
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 200, 80, 0.9)';
  for (let i = 0; i < imageLandmarks.length; i++) {
    const lm = imageLandmarks[i];
    if (lm.visibility < 0.4) continue;
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function clearOverlay(canvas: HTMLCanvasElement) {
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
}

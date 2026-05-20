// Compute viewport rectangles for N players. WebGL Y is bottom-up.
import type { ViewportRect } from '../engine/Renderer';

const GUTTER = 4;

export function viewportsFor(n: number, W: number, H: number): ViewportRect[] {
  if (n <= 1) return [{ x: 0, y: 0, w: W, h: H }];
  if (n === 2) return [
    { x: 0,                  y: 0, w: Math.floor(W / 2 - GUTTER), h: H },
    { x: Math.ceil(W / 2 + GUTTER), y: 0, w: Math.floor(W / 2 - GUTTER), h: H },
  ];
  // 3 or 4 → 2x2 quad. Y is bottom-up in WebGL viewports.
  return [
    { x: 0, y: Math.ceil(H / 2 + GUTTER), w: Math.floor(W / 2 - GUTTER), h: Math.floor(H / 2 - GUTTER) },          // top-left
    { x: Math.ceil(W / 2 + GUTTER), y: Math.ceil(H / 2 + GUTTER), w: Math.floor(W / 2 - GUTTER), h: Math.floor(H / 2 - GUTTER) }, // top-right
    { x: 0, y: 0, w: Math.floor(W / 2 - GUTTER), h: Math.floor(H / 2 - GUTTER) },                                  // bottom-left
    { x: Math.ceil(W / 2 + GUTTER), y: 0, w: Math.floor(W / 2 - GUTTER), h: Math.floor(H / 2 - GUTTER) },          // bottom-right
  ].slice(0, n);
}

/** DOM-overlay rectangles: same layout but with top-down Y (CSS). */
export function uiRectsFor(n: number, W: number, H: number): ViewportRect[] {
  if (n <= 1) return [{ x: 0, y: 0, w: W, h: H }];
  if (n === 2) return [
    { x: 0,                  y: 0, w: Math.floor(W / 2 - GUTTER), h: H },
    { x: Math.ceil(W / 2 + GUTTER), y: 0, w: Math.floor(W / 2 - GUTTER), h: H },
  ];
  return [
    { x: 0, y: 0, w: Math.floor(W / 2 - GUTTER), h: Math.floor(H / 2 - GUTTER) },
    { x: Math.ceil(W / 2 + GUTTER), y: 0, w: Math.floor(W / 2 - GUTTER), h: Math.floor(H / 2 - GUTTER) },
    { x: 0, y: Math.ceil(H / 2 + GUTTER), w: Math.floor(W / 2 - GUTTER), h: Math.floor(H / 2 - GUTTER) },
    { x: Math.ceil(W / 2 + GUTTER), y: Math.ceil(H / 2 + GUTTER), w: Math.floor(W / 2 - GUTTER), h: Math.floor(H / 2 - GUTTER) },
  ].slice(0, n);
}

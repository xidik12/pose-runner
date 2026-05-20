// Three.js renderer + scene/camera lifecycle for one PlayerWorld viewport.
// Multi-viewport rendering happens at the Game level via setViewport+setScissor.
import * as THREE from 'three';

export interface ViewportRect {
  x: number; y: number; w: number; h: number;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    Object.assign(this.canvas.style, {
      position: 'fixed', inset: '0', width: '100vw', height: '100vh',
      display: 'block', background: '#0a0d14',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor('#7ec0ff', 1);
    this.renderer.autoClear = false; // we clear once per frame
    this.handleResize();

    window.addEventListener('resize', () => this.handleResize());

    // Recover gracefully on Mi Box GPU thermal context loss
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this._contextLost = true;
      console.warn('[renderer] WebGL context lost — pausing render loop');
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this._contextLost = false;
      console.warn('[renderer] WebGL context restored — resuming');
    });
  }

  private _contextLost = false;
  isContextLost(): boolean { return this._contextLost; }

  size(): { w: number; h: number } {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  handleResize() {
    const { w, h } = this.size();
    this.renderer.setSize(w, h, false);
  }

  /**
   * Render a list of (scene, camera, viewport) tuples into the canvas.
   * Clears the full canvas first, then scissors each viewport.
   */
  renderViewports(views: Array<{ scene: THREE.Scene; camera: THREE.Camera; vp: ViewportRect }>) {
    if (this._contextLost) return;  // skip frame; restored event will resume
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.setScissorTest(true);
    for (const v of views) {
      this.renderer.setViewport(v.vp.x, v.vp.y, v.vp.w, v.vp.h);
      this.renderer.setScissor(v.vp.x, v.vp.y, v.vp.w, v.vp.h);
      this.renderer.render(v.scene, v.camera);
    }
  }

  dispose() {
    this.renderer.dispose();
    this.canvas.remove();
  }
}

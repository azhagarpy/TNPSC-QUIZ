import { useSyncExternalStore } from 'react';
import { getPrefs } from './prefs';

// Device tiers (plan: "Mobile performance, 3D and animation"). Decided once on
// first launch with a short WebGL test render, stored on the device, and
// stepped down automatically if a 3D scene drops below 30 fps.

export type Tier = 'high' | 'medium' | 'low' | 'reduced';

const KEY = 'g4.tier.v1';
const listeners = new Set<() => void>();
let measured: Tier | null = readStored();

function readStored(): Tier | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'high' || v === 'medium' || v === 'low' ? v : null;
  } catch {
    return null;
  }
}

function store(t: Tier) {
  measured = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const saveData = () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
const memory = () => (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

export function currentTier(): Tier {
  if (reducedMotion()) return 'reduced';
  if (getPrefs().batterySaver || saveData()) return 'low';
  return measured ?? 'low'; // until measured, never download 3D
}

export function useTier() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    currentTier,
  );
}

export function notifyTierChange() {
  listeners.forEach((l) => l());
}

export function stepDownTier() {
  const t = currentTier();
  if (t === 'high') store('medium');
  else if (t === 'medium') store('low');
}

/** Short raw-WebGL render test (~0.6 s) so low-end phones never download three.js. */
function benchmarkFps(): Promise<number> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const gl = canvas.getContext('webgl', { antialias: false, powerPreference: 'low-power' });
    if (!gl) return resolve(0);
    const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const fs =
      'precision mediump float;uniform float t;void main(){vec2 u=gl_FragCoord.xy/320.;float v=0.;' +
      'for(int i=0;i<24;i++){v+=sin(u.x*float(i)*3.1+t)*cos(u.y*float(i)*2.7-t);}gl_FragColor=vec4(v,u,1.);}';
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tLoc = gl.getUniformLocation(prog, 't');
    let frames = 0;
    const start = performance.now();
    const loop = (now: number) => {
      gl.uniform1f(tLoc, now / 1000);
      for (let k = 0; k < 6; k++) gl.drawArrays(gl.TRIANGLES, 0, 3);
      frames++;
      if (now - start < 600) requestAnimationFrame(loop);
      else {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        resolve((frames * 1000) / (now - start));
      }
    };
    requestAnimationFrame(loop);
  });
}

export async function measureTierOnce() {
  if (measured || reducedMotion()) return;
  const mem = memory();
  if (mem !== undefined && mem < 4) return store('low');
  const fps = await benchmarkFps();
  const cores = navigator.hardwareConcurrency ?? 4;
  if (fps < 35) store('low');
  else if ((mem ?? 4) >= 6 && cores >= 8 && fps > 55) store('high');
  else store('medium');
}

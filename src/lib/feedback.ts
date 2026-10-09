import { getPrefs } from './prefs';

// Sound effects are synthesised with Web Audio (no audio files to download).
let ctx: AudioContext | null = null;

function audio() {
  if (!getPrefs().sound) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.12) {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = a.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function vibrate(pattern: number | number[]) {
  if (getPrefs().haptics && 'vibrate' in navigator) navigator.vibrate(pattern);
}

export const fx = {
  click: () => tone(520, 0, 0.035, 'triangle', 0.03),
  tap: () => tone(660, 0, 0.05, 'triangle', 0.05),
  tick: () => tone(880, 0, 0.04, 'square', 0.03),
  correct: () => {
    tone(660, 0, 0.12);
    tone(990, 0.1, 0.18);
    vibrate(30);
  },
  wrong: () => {
    tone(196, 0, 0.25, 'sawtooth', 0.06);
    vibrate([60, 40, 60]);
  },
  coin: () => {
    tone(1318, 0, 0.08, 'triangle', 0.08);
    tone(1760, 0.07, 0.12, 'triangle', 0.08);
  },
  start: () => {
    tone(523, 0, 0.1);
    tone(659, 0.12, 0.1);
    tone(784, 0.24, 0.16);
  },
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.11, 0.18));
    vibrate([30, 30, 30]);
  },
};

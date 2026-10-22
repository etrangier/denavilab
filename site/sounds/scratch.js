// Scratch «horneado»: mueve el punto de lectura de la toma hacia adelante y atrás como una aguja sobre un vinilo (el tono sube y baja con la
// velocidad, y al ir hacia atrás suena invertido) y cierra el volumen como un crossfader. El resultado es un sample normal.
import { cosFade } from './dsp.js';

export const SCRATCH_KINDS = [['baby', 'Baby scratch'], ['chirp', 'Chirp'], ['tape', 'Tape stop'], ['stutter', 'Stutter']];

/** Lectura con interpolación cúbica (Catmull-Rom) en la posición fraccionaria `p`; 0 fuera de la toma. */
function readAt(x, p) {
  const len = x.length; if (p < 0 || p > len - 1) return 0;
  const i0 = Math.floor(p), t = p - i0, at = i => x[i < 0 ? 0 : i >= len ? len - 1 : i], a = at(i0 - 1), b = at(i0), c = at(i0 + 1), d = at(i0 + 2);
  return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}

/**
 * Scratch del tramo [a, b) de `x`. Dura `beats` tiempos a `bpm`.
 * - baby: ida y vuelta suave sobre el tramo, un ciclo por tiempo (el tono sube, se frena y baja al volver).
 * - chirp: avanza con el volumen abierto y vuelve con el volumen cerrado, un ciclo por tiempo.
 * - tape: un solo frenado de plato: arranca a velocidad normal y se detiene (el tono cae).
 * - stutter: repite un trocito (una semicorchea) con el volumen abriéndose y cerrándose.
 * `depth` (0–1) es cuánto del tramo recorre la aguja. Devuelve vacío si el tramo dura menos de 50 ms.
 */
export function scratch(x, a, b, rate, { kind = 'baby', bpm = 100, beats = 4, depth = 0.6 } = {}) {
  const src = x.slice(Math.max(0, a), Math.min(x.length, b)), L = src.length;
  if (L < rate * 0.05 || !(bpm > 0)) return new Float32Array(0);
  const beat = Math.round(60 * rate / bpm), N = beat * Math.max(1, Math.round(beats)), out = new Float32Array(N);
  const W = Math.max(1, Math.min(1, depth) * L), p0 = kind === 'tape' || kind === 'stutter' ? 0 : (L - W) / 2, ramp = Math.max(1, Math.round(rate * 0.003));
  const step = Math.max(1, Math.round(beat / 4));
  for (let i = 0; i < N; i++) {
    let pos, g = 1;
    if (kind === 'chirp') {
      const u = (i % beat) / beat, r = ramp / beat;
      pos = p0 + W * Math.min(u, 0.5) / 0.5; g = u < 0.5 ? Math.min(1, u / r) * Math.min(1, (0.5 - u) / r) : 0;
    } else if (kind === 'tape') {
      const t = i / N; pos = p0 + (N / 3) * (1 - (1 - t) ** 3); g = Math.min(1, (1 - t) / 0.08);
    } else if (kind === 'stutter') {
      const k = i % step; pos = p0 + k; g = Math.min(1, k / ramp) * Math.min(1, (step * 0.75 - k) / ramp); g = Math.max(0, g);
    } else {
      const u = (i % beat) / beat; pos = p0 + W * (0.5 - 0.5 * Math.cos(2 * Math.PI * u));
    }
    out[i] = readAt(src, pos) * g;
  }
  return cosFade(out, ramp, ramp);
}

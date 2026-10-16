// Armonía: pulso, compases, acordes y loop sugerido de una toma. Todo es aproximado (acordes mayores y menores, compás de 4 tiempos).
import { fftInPlace, estimateBPM, cosFade } from './dsp.js';

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CH_N = 4096, CH_HOP = 2048;
const hann = new Float64Array(CH_N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / CH_N));

/** Plantillas de acordes: 12 mayores y 12 menores, normalizadas. */
const TEMPLATES = (() => {
  const out = [];
  for (const [suffix, third] of [['', 4], ['m', 3]]) for (let r = 0; r < 12; r++) {
    const v = new Float64Array(12); v[r] = 1; v[(r + third) % 12] = 0.9; v[(r + 7) % 12] = 0.8;
    const n = Math.hypot(...v); out.push({ name: NOTES[r] + suffix, v: v.map(a => a / n) });
  }
  return out;
})();

const cos12 = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < 12; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na > 1e-12 && nb > 1e-12 ? d / Math.sqrt(na * nb) : 0; };

/** Chroma (12 notas) por ventana de 4096 muestras, de 110 a 1760 Hz, con compresión logarítmica. */
export function chromaFrames(x, rate) {
  const kLo = Math.ceil(110 * CH_N / rate), kHi = Math.floor(1760 * CH_N / rate), pc = new Int8Array(kHi + 1);
  for (let k = kLo; k <= kHi; k++) pc[k] = ((Math.round(69 + 12 * Math.log2(k * rate / CH_N / 440)) % 12) + 12) % 12;
  const re = new Float64Array(CH_N), im = new Float64Array(CH_N), out = [];
  for (let s = 0; s + CH_N <= x.length; s += CH_HOP) {
    for (let i = 0; i < CH_N; i++) { re[i] = x[s + i] * hann[i]; im[i] = 0; }
    fftInPlace(re, im, false);
    const c = new Float64Array(12);
    for (let k = kLo; k <= kHi; k++) c[pc[k]] += Math.log1p(50 * Math.hypot(re[k], im[k]) / (CH_N / 4));
    out.push({ center: s + CH_N / 2, chroma: c });
  }
  return out;
}

const sumChroma = (frames, a, b) => {
  const c = new Float64Array(12); let n = 0;
  for (const f of frames) if (f.center >= a && f.center < b) { for (let i = 0; i < 12; i++) c[i] += f.chroma[i]; n++; }
  if (!n && frames.length) { let best = frames[0]; for (const f of frames) if (Math.abs(f.center - (a + b) / 2) < Math.abs(best.center - (a + b) / 2)) best = f; for (let i = 0; i < 12; i++) c[i] = best.chroma[i]; }
  return c;
};

/** Mejor acorde para un chroma, o null si no se parece a ninguno (ruido, percusión sola). */
export function matchChord(chroma) {
  let best = null, bestS = 0;
  for (const t of TEMPLATES) { const s = cos12(chroma, t.v); if (s > bestS) { bestS = s; best = t.name; } }
  return bestS >= 0.6 ? { name: best, score: bestS } : null;
}

/** Subida de energía con paso de 256 muestras (más fina que la del tempo). */
function onsetFlux(x, hop = 256) {
  const n = Math.floor(x.length / hop), e = new Float32Array(n), f = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * hop; j < (i + 1) * hop; j++) s += x[j] * x[j]; e[i] = Math.sqrt(s / hop); }
  for (let i = 1; i < n; i++) f[i] = Math.max(0, e[i] - e[i - 1]);
  return { flux: f, hop };
}

/** Ajusta el periodo y la fase del pulso para que los tiempos caigan sobre los golpes. */
function fitBeats(flux, hop, period) {
  let best = { score: -1, T: period, first: 0 };
  for (let sc = -0.012; sc <= 0.0121; sc += 0.0006) {
    const T = period * (1 + sc);
    for (let p = 0; p < T; p += hop) {
      let s = 0;
      for (let t = p; t / hop < flux.length - 1; t += T) { const i = Math.round(t / hop); s += Math.max(flux[i], flux[i - 1] || 0, flux[i + 1] || 0); }
      if (s > best.score) best = { score: s, T, first: p };
    }
  }
  return best;
}

/**
 * Analiza una toma: pulso (con `bpm` o el detectado), tiempo 1 del compás, acordes por medio compás y un loop sugerido.
 * Devuelve null si no hay un pulso claro o la toma es muy corta (menos de 2 compases).
 */
export function analyze(x, rate, bpm = null) {
  bpm = bpm || (estimateBPM(x, rate) || {}).bpm; if (!bpm) return null;
  const { flux, hop } = onsetFlux(x), fit = fitBeats(flux, hop, rate * 60 / bpm), T = fit.T;
  const beats = []; for (let t = fit.first; t + T <= x.length; t += T) beats.push(t);
  if (beats.length < 8) return null;
  const frames = chromaFrames(x, rate);
  const beatChroma = beats.map(t => sumChroma(frames, t, t + T)), beatRMS = beats.map(t => { let e = 0; const a = Math.round(t), b = Math.min(x.length, Math.round(t + T)); for (let i = a; i < b; i++) e += x[i] * x[i]; return Math.sqrt(e / Math.max(1, b - a)); });
  // tiempo 1: el de los cuatro que más golpe lleva y donde más cambia la armonía
  const hit = [0, 0, 0, 0], change = [0, 0, 0, 0], cnt = [0, 0, 0, 0];
  beats.forEach((t, j) => {
    const i = Math.round(t / hop); hit[j % 4] += Math.max(flux[i], flux[i - 1] || 0, flux[i + 1] || 0); cnt[j % 4]++;
    if (j > 0) change[j % 4] += 1 - cos12(beatChroma[j], beatChroma[j - 1]);
  });
  const norm = v => { const s = v.reduce((a, b) => a + b, 0) || 1; return v.map(a => a / s); }, nh = norm(hit.map((v, i) => v / cnt[i])), nc = norm(change.map((v, i) => v / cnt[i]));
  const score = nh.map((v, i) => v + nc[i]); let downbeat = 0; score.forEach((v, i) => { if (v > score[downbeat]) downbeat = i; });
  const confidence = Math.min(1, Math.max(0, (score[downbeat] - [...score].sort((a, b) => b - a)[1]) * 2 + 0.3));
  const an = { bpm: 60 * rate / T, rate, period: T, first: fit.first, beats, beatChroma, beatRMS, length: x.length, confidence, downbeat };
  return layout(an, downbeat);
}

/** Compases, acordes y loop sugerido para un tiempo 1 dado (0–3 tiempos desde el primero detectado). No vuelve a analizar el audio. */
export function layout(an, downbeat) {
  const d = ((downbeat % 4) + 4) % 4, T = an.period, bars = [];
  for (let j = d; j + 4 <= an.beats.length; j += 4) {
    const a = j, h1 = new Float64Array(12), h2 = new Float64Array(12);
    for (let i = 0; i < 12; i++) { h1[i] = an.beatChroma[a][i] + an.beatChroma[a + 1][i]; h2[i] = an.beatChroma[a + 2][i] + an.beatChroma[a + 3][i]; }
    const c1 = matchChord(h1), c2 = matchChord(h2);
    bars.push({ beat: a, start: Math.round(an.beats[a]), end: Math.round(an.beats[a] + 4 * T), chords: [c1 && c1.name, c2 && c2.name] });
  }
  const label = b => { const [x, y] = b.chords; return !x && !y ? '—' : (x || '—') === (y || '—') ? (x || '—') : `${x || '—'} ${y || '—'}`; };
  bars.forEach(b => { b.label = label(b); });
  return { ...an, downbeat: d, bars, loop: suggestLoop(an, bars) };
}

/** El tramo de 4, 2 o 1 compases que mejor se repite: empieza y acaba en armonías parecidas y con volumen parejo. */
function suggestLoop(an, bars) {
  let best = null;
  for (const L of [4, 2, 1]) {
    if (bars.length < L) continue;
    for (let m = 0; m + L <= bars.length; m++) {
      const j0 = bars[m].beat, jN = j0 + 4 * L, next = jN < an.beatChroma.length ? an.beatChroma[jN] : null;
      let s = next ? cos12(an.beatChroma[j0], next) : 0.5;
      if (L >= 2) { const half = (L / 2) * 4, a = new Float64Array(12), b = new Float64Array(12); for (let k = 0; k < half; k++) for (let i = 0; i < 12; i++) { a[i] += an.beatChroma[j0 + k][i]; b[i] += an.beatChroma[j0 + half + k][i]; } s += 0.5 * cos12(a, b); }
      const r0 = an.beatRMS[j0], r1 = an.beatRMS[jN - 1] || r0; if (r0 > 1e-6 && r1 > 1e-6 && Math.abs(20 * Math.log10(r0 / r1)) > 6) s -= 0.3;
      s += (L === 4 ? 0.25 : L === 2 ? 0.12 : 0) - 0.01 * m;      // a igualdad, el que empieza antes
      if (!best || s > best.score) best = { score: s, bar: m, bars: L };
    }
  }
  if (!best) return null;
  return { bar: best.bar, bars: best.bars, start: bars[best.bar].start, end: bars[best.bar + best.bars - 1].end, chords: bars.slice(best.bar, best.bar + best.bars).map(b => b.label) };
}

/** Audio del loop: si hay sonido después del final, se funde por potencia constante con el principio (el salto de vuelta no se oye). */
export function makeLoop(x, start, end, rate, fadeMs = 15) {
  const len = end - start, F = Math.min(Math.round(fadeMs / 1000 * rate), len >> 2, Math.max(0, x.length - end));
  if (len <= 0) return new Float32Array(0);
  const out = x.slice(start, end);
  if (F < 8) return cosFade(out, Math.round(rate * 0.003), Math.round(rate * 0.003));
  for (let i = 0; i < F; i++) { const th = Math.PI / 2 * (i + 0.5) / F; out[i] = x[start + i] * Math.sin(th) + x[end + i] * Math.cos(th); }
  return out;
}

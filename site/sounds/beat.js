// Pulso, compás y tiempo fuerte. Sirve para que los loops arranquen en el primer tiempo de un compás y duren compases enteros.
// Método (estándar en la literatura de seguimiento de pulso): novedad espectral por bandas → autocorrelación con refuerzo armónico y
// preferencia suave por tempos habituales → fase del pulso → compás (3, 4, 5, 6, 7 tiempos) y tiempo fuerte por el acento de graves.
import { fftInPlace, estimateBPM } from './dsp.js';

const N = 1024;
const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
const EDGES = [40, 80, 130, 200, 320, 500, 800, 1300, 2000, 3200, 5000, 8000];        // 11 bandas

/** Novedad espectral: cuánto «sube» cada banda entre cuadros (log). Devuelve {env, low, mid, fs}: total, graves (<200 Hz) y medios/agudos (>800 Hz). */
export function novelty(x, rate) {
  const hop = Math.max(64, Math.round(rate / 200)), nf = Math.max(0, Math.floor((x.length - N) / hop)), fs = rate / hop;
  const re = new Float64Array(N), im = new Float64Array(N), nb = EDGES.length - 1, bins = EDGES.map(f => Math.min(N / 2 - 1, Math.round(f * N / rate)));
  let prev = new Float64Array(nb); const env = new Float32Array(nf), low = new Float32Array(nf), mid = new Float32Array(nf);
  for (let t = 0; t < nf; t++) {
    const o = t * hop; for (let i = 0; i < N; i++) { re[i] = x[o + i] * HANN[i]; im[i] = 0; }
    fftInPlace(re, im, false);
    const cur = new Float64Array(nb);
    for (let b = 0; b < nb; b++) { let e = 0; for (let k = bins[b]; k < Math.max(bins[b] + 1, bins[b + 1]); k++) e += re[k] * re[k] + im[k] * im[k]; cur[b] = Math.log1p(1000 * e / N); }
    if (t > 0) for (let b = 0; b < nb; b++) { const d = Math.max(0, cur[b] - prev[b]); env[t] += d; if (b <= 3) low[t] += d; else if (b >= 7) mid[t] += d; }
    prev = cur;
  }
  let raw = 0; for (let i = 0; i < nf; i++) raw += env[i]; raw /= Math.max(1, nf);
  const d = detrend(env, fs); let m4 = 0, m2 = 0; for (let i = 0; i < d.length; i++) { m2 += d[i] * d[i]; m4 += d[i] ** 4; } const kurt = d.length ? (m4 / d.length) / ((m2 / d.length) ** 2 || 1) : 0;
  return { env: d, low: detrend(low, fs), mid: detrend(mid, fs), lf: lowEnv(x, rate, hop, nf), fs, raw, kurt };
}
/** Energía de graves (kicks, bajos) por cuadro: paso bajo de 4 polos a 150 Hz, valor absoluto suavizado 12 ms, luego sin el nivel local. */
function lowEnv(x, rate, hop, nf) {
  const w0 = 2 * Math.PI * 150 / rate, al = Math.sin(w0) / (2 * 0.707), c = Math.cos(w0), a0 = 1 + al, b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, b2 = b0, a1 = -2 * c / a0, a2 = (1 - al) / a0;
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, v1 = 0, v2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; const o = b0 * v + b1 * u1 + b2 * u2 - a1 * v1 - a2 * v2; u2 = u1; u1 = v; v2 = v1; v1 = o; y[i] = Math.abs(o); }
  const sm = Math.max(1, Math.round(rate * 0.012)), out = new Float32Array(nf); let acc = 0, cnt = 0;
  for (let t = 0; t < nf; t++) { const c0 = t * hop + N / 2; let s0 = 0, n0 = 0; for (let i = Math.max(0, c0 - sm); i < Math.min(y.length, c0 + sm); i += 4) { s0 += y[i]; n0++; } out[t] = n0 ? s0 / n0 : 0; }
  return detrend(out, rate / hop);
}
/** Quita el nivel local (media móvil de ~0,6 s), recorta lo negativo y normaliza. */
function detrend(a, fs) {
  const n = a.length, w = Math.max(3, Math.round(fs * 0.3)), out = new Float32Array(n), cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + a[i];
  let sq = 0;
  for (let i = 0; i < n; i++) { const lo = Math.max(0, i - w), hi = Math.min(n, i + w + 1), m = (cs[hi] - cs[lo]) / (hi - lo); out[i] = Math.max(0, a[i] - m); sq += out[i] * out[i]; }
  const sd = Math.sqrt(sq / Math.max(1, n)) || 1; for (let i = 0; i < n; i++) out[i] /= sd;
  return out;
}

const ac = (a, l) => { let s = 0; const n = a.length - l; for (let i = 0; i < n; i++) s += a[i] * a[i + l]; return s / Math.max(1, n); };
const prior = (bpm, center = 95, sigma = 0.6) => Math.exp(-0.5 * (Math.log2(bpm / center) / sigma) ** 2);

/** Tempo: devuelve candidatos {bpm, score} ordenados. Refuerza el periodo con sus múltiplos (compás) y prefiere tempos habituales. */
export function tempoCandidates(env, fs, lo = 55, hi = 200) {
  const out = [], n = env.length, r0 = ac(env, 0) || 1;
  const minLag = Math.max(2, Math.floor(fs * 60 / hi)), maxLag = Math.min(Math.floor(fs * 60 / lo), Math.floor(n / 2.5));
  if (maxLag <= minLag) return out;
  const A = new Float64Array(maxLag * 4 + 8); for (let l = 1; l < A.length && l < n - 4; l++) A[l] = ac(env, l) / r0;
  const at = l => { const i = Math.floor(l), f = l - i; return (A[i] || 0) * (1 - f) + (A[i + 1] || 0) * f; };
  for (let l = minLag; l <= maxLag; l++) {
    const bpm = 60 * fs / l, v = at(l) + 0.5 * at(2 * l) + 0.25 * at(3 * l) + 0.25 * at(4 * l);
    out.push({ lag: l, bpm, raw: v, score: v * (0.55 + 0.45 * prior(bpm)) });
  }
  // máximos locales
  const peaks = out.filter((p, i) => i > 0 && i < out.length - 1 && p.score >= out[i - 1].score && p.score >= out[i + 1].score && p.score > 0).sort((a, b) => b.score - a.score);
  const picked = []; for (const p of peaks) { if (picked.every(q => Math.abs(Math.log2(p.bpm / q.bpm)) > 0.06)) picked.push(p); if (picked.length >= 5) break; }
  return picked;
}

/** Afina tempo y fase: prueba tempos cercanos y todas las fases de un pulso y se queda con la que más novedad junta en los tiempos. */
export function fitBeats(env, fs, bpm0) {
  const n = env.length; let best = { bpm: bpm0, phase: 0, score: -1 };
  for (let k = -12; k <= 12; k++) {
    const bpm = bpm0 * (1 + k * 0.0025), P = fs * 60 / bpm, np = Math.ceil(P);
    for (let ph = 0; ph < np; ph++) {
      let s = 0, c = 0;
      for (let t = ph; t < n - 1; t += P) { const i = Math.round(t); let m = env[i]; if (i > 0 && env[i - 1] > m) m = env[i - 1] * 0.9; if (i + 1 < n && env[i + 1] > m) m = env[i + 1] * 0.9; s += m; c++; }
      const v = s / Math.max(1, c) - 0.0; if (c >= 4 && v > best.score) best = { bpm, phase: ph, score: v, P };
    }
  }
  return best;
}

/** Tiempo fuerte: elige 3, 4, 5, 6 o 7 tiempos por compás y cuál de los tiempos es el primero (acento de graves y de ataque). */
export function findMeter(beatAcc, beatLow) {
  const nb = beatAcc.length; if (nb < 8) return { beats: 4, offset: 0, confidence: 0 };
  const mean = beatAcc.reduce((a, b) => a + b, 0) / nb, z = Array.from(beatAcc, v => v - mean);
  const A = {}; let a0 = 0; for (let k = 0; k < nb; k++) a0 += z[k] * z[k]; a0 = a0 / nb || 1;
  for (const m of [2, 3, 4, 5, 6, 7, 8]) { let s = 0, c = 0; for (let k = 0; k + m < nb; k++) { s += z[k] * z[k + m]; c++; } A[m] = c ? s / c / a0 : 0; }
  const amax = Math.max(...Object.values(A));
  let m = [2, 3, 4, 5, 6, 7, 8].find(k => A[k] >= 0.8 * amax && A[k] > 0.05) || 4;        // el periodo más corto que repite el acento
  if (m === 2 || m === 8) m = 4;                      // el acento cada 2 tiempos casi siempre es un compás de 4
  if (m === 6) m = A[3] >= 0.7 * A[6] ? 3 : 6;
  // tiempo fuerte: el desfase cuyo acento (graves, luego total) sobresale más del resto
  const accOf = (arr, o) => { let s = 0, c = 0; for (let k = o; k < nb; k += m) { s += arr[k]; c++; } return c ? s / c : 0; };
  const sc = []; for (let o = 0; o < m; o++) sc.push(accOf(beatLow, o) * 0.7 + accOf(beatAcc, o) * 0.3);
  let o = 0; for (let i = 1; i < m; i++) if (sc[i] > sc[o] * 1.04) o = i;
  const sorted = [...sc].sort((a, b) => b - a), conf = sorted[0] > 0 ? Math.max(0, Math.min(1, (sorted[0] - sorted[1]) / sorted[0])) : 0;
  return { beats: m, offset: o, confidence: conf, A };
}

/** Análisis completo: {bpm, confidence, beatSec, meter, barSec, firstBeat, firstDownbeat, downbeats[], alternatives[]} o null si no hay pulso claro. */
/** ¿Cuánta de la novedad total cae sobre la rejilla de tiempos? Una rejilla más densa que el pulso real capta más, pero falla en golpes (hitRate). */
function coverage(env, fs, f) {
  const P = f.P || fs * 60 / f.bpm, w = Math.max(1, Math.round(fs * 0.03)); let on = 0, tot = 0; for (let i = 0; i < env.length; i++) tot += env[i];
  for (let t = f.phase; t < env.length - 1; t += P) { let m = 0; for (let i = Math.max(0, Math.round(t) - w); i <= Math.min(env.length - 1, Math.round(t) + w); i++) m += env[i]; on += m; }
  return tot > 0 ? Math.min(1, on / tot) : 0;
}
/** ¿Qué fracción de los tiempos cae sobre un golpe de verdad (novedad por encima de la media)? */
function hitRate(env, fs, f) {
  const P = f.P || fs * 60 / f.bpm, w = Math.max(1, Math.round(fs * 0.03)); let hit = 0, c = 0;
  for (let t = f.phase; t < env.length - 1; t += P) { let m = 0; for (let i = Math.max(0, Math.round(t) - w); i <= Math.min(env.length - 1, Math.round(t) + w); i++) if (env[i] > m) m = env[i]; if (m >= 0.4) hit++; c++; }
  return c ? hit / c : 0;
}

/** Análisis completo: {bpm, confidence, beatSec, meter, barSec, firstBeat, firstDownbeat, downbeats[], alternatives[]} o null si no hay pulso claro. */
export function analyzeBeats(x, rate, { lo = 60, hi = 165 } = {}) {
  if (!x || x.length < rate * 3) return null;
  const { env, low, mid, lf, fs, raw, kurt } = novelty(x, rate); if (env.length < fs * 2.5) return null;
  if (kurt < 14 || raw < 0.3) return null;                       // sin golpes claros (pad, ambiente): no hay pulso que seguir
  const cands = tempoCandidates(env, fs, lo, hi); if (!cands.length) return null;
  const pool = new Map(); for (const c of cands.slice(0, 4)) pool.set(Math.round(c.bpm), c.bpm);
  for (const r of [2, 0.5]) { const b = cands[0].bpm * r; if (b >= lo && b <= hi) pool.set(Math.round(b), b); }
  let fit = null, bestSc = -1;
  for (const bpm of pool.values()) { const f = fitBeats(env, fs, bpm), h = hitRate(env, fs, f), cv = coverage(env, fs, f), sc = (0.3 * Math.min(1, f.score / 3) + 0.7 * cv) * h * h * (0.6 + 0.4 * prior(f.bpm)); if (sc > bestSc) { bestSc = sc; fit = { ...f, hit: h, cover: cv }; } }
  const top = cands[0], r0 = ac(env, 0) || 1, rawStrength = Math.max(0, Math.min(1, ac(env, Math.round(fs * 60 / fit.bpm)) / r0));
  const P = fit.P || fs * 60 / fit.bpm, beatsT = [];
  for (let t = fit.phase; t < env.length - 1; t += P) beatsT.push(t);
  const win = Math.max(1, Math.round(fs * 0.04)), peakAt = (arr, t) => { let m = 0; for (let i = Math.max(0, Math.round(t) - win); i <= Math.min(arr.length - 1, Math.round(t) + win); i++) if (arr[i] > m) m = arr[i]; return m; };
  const beatTot = beatsT.map(t => peakAt(env, t)), beatLow = beatsT.map(t => peakAt(lf, t + 0.02 * fs)), blend = beatLow;
  const meter = findMeter(blend, beatLow), beatSec = 60 / fit.bpm, barSec = meter.beats * beatSec;
  const firstBeat = beatsT[0] / fs, downbeats = []; for (let k = meter.offset; k < beatsT.length; k += meter.beats) downbeats.push(beatsT[k] / fs);
  const confidence = Math.max(0, Math.min(1, 0.4 * Math.min(1, fit.score / 2.5) + 0.3 * fit.hit + 0.3 * Math.min(1, rawStrength * 2.5)));
  return { kurt, bpm: fit.bpm, confidence, beatSec, meter: meter.beats, meterConfidence: meter.confidence, barSec, firstBeat, firstDownbeat: downbeats[0] ?? firstBeat, downbeats,
    beatTimes: beatsT.map(t => t / fs), alternatives: cands.slice(1, 4).map(c => ({ bpm: c.bpm, score: c.score })), env: Array.from(env) };
}

/** Tempo para el resto de la app: el análisis de pulso si lo hay; si no, el método simple de antes. {bpm, confidence, meter?, barSec?, half, double}. */
export function estimateTempo(x, rate) {
  let a = null; try { a = analyzeBeats(x, rate); } catch (e) {}
  if (a) return { bpm: a.bpm, confidence: a.confidence, meter: a.meter, barSec: a.barSec, half: a.bpm / 2 >= 40 ? a.bpm / 2 : null, double: a.bpm * 2 <= 240 ? a.bpm * 2 : null, analysis: a };
  const r = estimateBPM(x, rate); return r ? { bpm: r.bpm, confidence: r.confidence, half: r.bpm / 2, double: r.bpm * 2 } : null;
}

/** Candidatos de loop que arrancan en un primer tiempo y duran compases enteros: [{a, b, bars}] (en segundos), del más a menos recomendable. */
export function barLoops(an, { startSec = 0, endSec = Infinity, prefBars = 0, max = 6 } = {}) {
  if (!an || !an.downbeats || !an.downbeats.length) return [];
  const sizes = [4, 2, 8, 1, 16], out = [], bar = an.barSec;
  const downs = an.downbeats.filter(d => d >= startSec - 0.5 * an.beatSec && d < endSec);
  downs.forEach((d, di) => { for (const L of sizes) { const b = d + L * bar; if (b > endSec + 0.03) continue;
    const prior = (L === prefBars ? 1 : L === 4 ? 0.9 : L === 2 ? 0.8 : L === 8 ? 0.7 : L === 1 ? 0.5 : 0.4) - 0.04 * di; out.push({ a: d, b, bars: L, prior }); } });
  return out.sort((p, q) => q.prior - p.prior).slice(0, max);
}

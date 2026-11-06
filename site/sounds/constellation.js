// «Escucha» por constelación: la idea de Avery Wang (Shazam, ISMIR 2003) aplicada a recortes y loops.
//  · Mapa de constelación: del espectrograma se guardan sólo los picos (máximos locales) con una densidad pareja; se pierde la amplitud
//    y por eso el mapa casi no cambia con el volumen ni con la ecualización.
//  · Hashes combinatorios: cada pico «ancla» se une con picos de su zona objetivo (hasta F por ancla) → (f1, f2, Δt).
//  · Coincidencia por histograma de desfases: si dos trozos son el mismo sonido, sus hashes iguales se separan siempre el mismo tiempo; se cuenta
//    ese desfase y el pico del histograma es la coincidencia. Wang lo usa entre una muestra y una canción; aquí se usa el sonido contra sí mismo
//    (periodo en que se repite → largo del loop) y entre dos puntos del sonido (continuidad del empalme).
//  · Cambio de notas: los cortes se ponen donde el conjunto de picos cambia, aunque el volumen no suba (acordes, pads, voz).
import { fftInPlace } from './dsp.js';

const FMAX_HZ = 6000, PEAK_DB = 45, FRAME_DB = 40;
const FAN_OUT = 5, ZONE_MIN = 2, ZONE_MAX = 64, ZONE_BINS = 64;

/** Constelación: lista de picos {t (cuadro), f (casilla de frecuencia), a (dB)} y los datos para convertir cuadros en segundos. */
export function constellation(x, rate, { maxPerFrame = 5, dt: dtN = 3, df: dfN = 8, winSec = 0.04 } = {}) {
  let N = 1024; while (N < rate * winSec) N <<= 1;
  const hop = N >> 2, kmax = Math.min(N / 2 - 1, Math.round(FMAX_HZ / (rate / N))), T = Math.floor((x.length - N) / hop) + 1;
  if (T < 8) return { peaks: [], hop, N, T: Math.max(0, T), rate, kmax };
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const S = new Float32Array(T * (kmax + 1)); let gmax = -Infinity;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < N; i++) { re[i] = x[t * hop + i] * win[i]; im[i] = 0; }
    fftInPlace(re, im, false);
    for (let k = 0; k <= kmax; k++) { const v = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-12); S[t * (kmax + 1) + k] = v; if (v > gmax) gmax = v; }
  }
  const K = kmax + 1, dt = dtN, df = dfN, peaks = [];
  for (let t = 0; t < T; t++) {
    let fm = -Infinity; for (let k = 0; k < K; k++) if (S[t * K + k] > fm) fm = S[t * K + k];
    const cand = [];
    for (let k = 2; k <= kmax - 1; k++) {
      const v = S[t * K + k]; if (v < gmax - PEAK_DB || v < fm - FRAME_DB) continue;
      let ok = true;
      for (let tt = Math.max(0, t - dt); tt <= Math.min(T - 1, t + dt) && ok; tt++) for (let kk = Math.max(0, k - df); kk <= Math.min(kmax, k + df); kk++) if ((tt !== t || kk !== k) && S[tt * K + kk] >= v) { ok = false; break; }
      if (ok) cand.push({ t, f: k, a: v });
    }
    cand.sort((p, q) => q.a - p.a); for (const c of cand.slice(0, maxPerFrame)) peaks.push(c);        // densidad pareja: como mucho `maxPerFrame` por cuadro
  }
  return { peaks, hop, N, T, rate, kmax };
}
const frameSec = c => c.hop / c.rate;

/** Hashes combinatorios: cada ancla con hasta FAN_OUT picos de su zona objetivo. Devuelve [{key, t}] (t = cuadro del ancla). */
export function hashes(c) {
  const byT = new Map(); for (const p of c.peaks) { if (!byT.has(p.t)) byT.set(p.t, []); byT.get(p.t).push(p); }
  const out = [];
  for (const p of c.peaks) {
    let n = 0;
    for (let d = ZONE_MIN; d <= ZONE_MAX && n < FAN_OUT; d++) {
      const l = byT.get(p.t + d); if (!l) continue;
      for (const q of l) { if (Math.abs(q.f - p.f) > ZONE_BINS) continue; out.push({ key: (p.f * 512 + q.f) * 128 + d, t: p.t }); if (++n >= FAN_OUT) break; }
    }
  }
  return out;
}

/**
 * Periodo en que se repite el sonido: histograma de desfases entre hashes iguales del propio audio (la técnica de Wang, sonido contra sí mismo).
 * Devuelve candidatos [{sec, score, z}] de más a menos significativo; vacío si no hay repetición clara.
 */
export function repetition(x, rate, { minSec = 0.25, maxSec = 20, maxCands = 4 } = {}) {
  const c = constellation(x, rate), fs = frameSec(c), H = hashes(c);
  if (H.length < 30) return [];
  const minLag = Math.max(2, Math.round(minSec / fs)), maxLag = Math.min(c.T - 1, Math.round(maxSec / fs));
  const groups = new Map(); for (const h of H) { const g = groups.get(h.key); if (g) g.push(h.t); else groups.set(h.key, [h.t]); }
  const hist = new Float64Array(maxLag + 2);
  for (const ts of groups.values()) {
    if (ts.length < 2 || ts.length > 40) continue;                                 // las claves que aparecen en todas partes no informan
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) { const lag = ts[j] - ts[i]; if (lag >= minLag && lag <= maxLag) hist[lag] += 1 / Math.sqrt(ts.length); }
  }
  const sm = new Float64Array(hist.length); for (let i = 1; i < hist.length - 1; i++) sm[i] = hist[i - 1] * 0.5 + hist[i] + hist[i + 1] * 0.5;
  let mean = 0, cnt = 0; for (let i = minLag; i <= maxLag; i++) { mean += sm[i]; cnt++; } mean /= Math.max(1, cnt);
  let sd = 0; for (let i = minLag; i <= maxLag; i++) sd += (sm[i] - mean) ** 2; sd = Math.sqrt(sd / Math.max(1, cnt)) + 1e-9;
  const picks = [];
  for (let i = minLag + 1; i < maxLag; i++) if (sm[i] >= sm[i - 1] && sm[i] > sm[i + 1]) { const z = (sm[i] - mean) / sd; if (z > 4 && sm[i] >= 6) picks.push({ i, score: sm[i], z }); }
  picks.sort((a, b) => b.score - a.score);
  const out = [];
  for (const p of picks) {
    const lag = p.i + (sm[p.i - 1] - sm[p.i + 1]) / (2 * (sm[p.i - 1] - 2 * sm[p.i] + sm[p.i + 1]) || 1e9);
    if (out.every(o => Math.abs(o.sec - lag * fs) > 0.05)) out.push({ sec: lag * fs, score: p.score, z: p.z });
    if (out.length >= maxCands) break;
  }
  return out;
}

/** Cuánto se parecen los picos de dos ventanas (0–1): coinciden en casilla de frecuencia (±1) y en el mismo desfase relativo (±1 cuadro). */
function windowMatch(c, A, B, W) {
  const pa = c.peaks.filter(p => p.t >= A && p.t < A + W), pb = c.peaks.filter(p => p.t >= B && p.t < B + W);
  if (pa.length < 3 || pb.length < 3) return null;
  const set = new Set(); for (const p of pb) set.add((p.f) * 1024 + (p.t - B));
  let hit = 0; for (const p of pa) { const r = p.t - A; let ok = false; for (let df = -1; df <= 1 && !ok; df++) for (let dt = -1; dt <= 1 && !ok; dt++) if (set.has((p.f + df) * 1024 + (r + dt))) ok = true; if (ok) hit++; }
  return hit / Math.min(pa.length, pb.length);
}
/** Continuidad espectral de un empalme a→b: lo que sonaría después de b (si siguiera) frente a lo que suena después de a, y lo que precede a ambos. 0–1. */
export function seamScore(c, a, b, winSec = 0.3) {
  const fs = frameSec(c), W = Math.max(4, Math.round(winSec / fs)), fa = Math.round(a / c.hop), fb = Math.round(b / c.hop), r = [];
  const after = windowMatch(c, fa, fb, W), before = windowMatch(c, fa - W, fb - W, W);
  if (after != null) r.push(after); if (before != null) r.push(before);
  return r.length ? r.reduce((s, v) => s + v, 0) / r.length : null;
}
/** Mejor punto final para un loop que arranca en `a`: busca cerca de `b` el de mayor continuidad espectral. Devuelve {b, score} (muestras). */
export function refineLoopEnd(c, a, b, rangeSec = 0.12) {
  const step = c.hop, R = Math.round(rangeSec * c.rate / step); let best = { b, score: seamScore(c, a, b) ?? -1 };
  let bestAdj = best.score;
  for (let i = -R; i <= R; i++) { const bb = b + i * step, s = seamScore(c, a, bb); if (s == null) continue; const adj = s - 0.05 * Math.abs(i) / Math.max(1, R); if (adj > bestAdj + 0.002) { bestAdj = adj; best = { b: bb, score: s }; } }          // a igual continuidad, el más cercano al punto pedido
  return best;
}

/** Cortes donde cambian las notas (el conjunto de picos), para sonidos sin golpes claros. sensitivity 0–1. Devuelve inicios en muestras (cruces por cero a cargo del llamador). */
export function noteChanges(x, rate, sensitivity = 0.5, minGapSec = 0.25, maxCount = 11) {
  const c = constellation(x, rate, { maxPerFrame: 8, dt: 0, df: 2, winSec: 0.08 }), fs = frameSec(c), W = Math.max(3, Math.round(0.12 / fs));
  if (c.T < W * 4) return [];
  const byT = Array.from({ length: c.T }, () => []); for (const p of c.peaks) byT[p.t].push(p.f);
  const nov = new Float64Array(c.T);
  for (let t = W; t < c.T - W; t++) {
    const A = new Set(), B = []; for (let i = t - W; i < t; i++) for (const f of byT[i]) A.add(f);
    let nb = 0, hit = 0; for (let i = t; i < t + W; i++) for (const f of byT[i]) { nb++; if (A.has(f) || A.has(f - 1) || A.has(f + 1)) hit++; }
    let na = 0; for (let i = t - W; i < t; i++) na += byT[i].length;
    nov[t] = na < 2 || nb < 2 ? 0 : 1 - hit / nb;                              // qué parte de lo que viene es nuevo respecto a lo que había
  }
  const thr = 0.2 + 0.4 * (1 - Math.min(1, Math.max(0, sensitivity))), gap = Math.max(2, Math.round(minGapSec / fs)), picks = [];
  for (let t = W + 1; t < c.T - W - 1; t++) if (nov[t] >= thr && nov[t] >= nov[t - 1] && nov[t] > nov[t + 1]) picks.push([t, nov[t]]);
  const chosen = []; for (const [t] of picks.sort((a, b) => b[1] - a[1])) if (chosen.every(u => Math.abs(u - t) >= gap)) chosen.push(t);
  return chosen.slice(0, maxCount).sort((a, b) => a - b).map(t => Math.max(0, t * c.hop + (c.N >> 1)));          // el centro del cuadro, no su inicio
}

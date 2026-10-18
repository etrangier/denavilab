// Armonía: pulso, compases, acordes y loop sugerido de una toma. Todo es aproximado (acordes mayores y menores, compás de 4 tiempos).
import { fftInPlace, estimateBPM, cosFade, joinPieces } from './dsp.js';

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
const chromaCache = new WeakMap();      // el análisis de la misma toma (Tempo ÷ 2, × 2, mover el tiempo 1…) no recalcula el cromagrama
export function chromaFrames(x, rate) {
  const c = chromaCache.get(x); if (c && c.rate === rate) return c.frames;
  const frames = computeChroma(x, rate); chromaCache.set(x, { rate, frames }); return frames;
}
function computeChroma(x, rate) {
  const kLo = Math.ceil(110 * CH_N / rate), kHi = Math.floor(1760 * CH_N / rate), pc = new Int8Array(kHi + 1);
  for (let k = kLo; k <= kHi; k++) pc[k] = ((Math.round(69 + 12 * Math.log2(k * rate / CH_N / 440)) % 12) + 12) % 12;
  const bLo = Math.ceil(40 * CH_N / rate), bMid = Math.ceil(200 * CH_N / rate), bHigh = Math.ceil(2000 * CH_N / rate), bHi = Math.min(CH_N / 2 - 1, Math.floor(8000 * CH_N / rate));
  const re = new Float64Array(CH_N), im = new Float64Array(CH_N), out = [];
  for (let s = 0; s + CH_N <= x.length; s += CH_HOP) {
    for (let i = 0; i < CH_N; i++) { re[i] = x[s + i] * hann[i]; im[i] = 0; }
    fftInPlace(re, im, false);
    const c = new Float64Array(12), bands = new Float64Array(3);
    for (let k = kLo; k <= kHi; k++) c[pc[k]] += Math.log1p(50 * Math.hypot(re[k], im[k]) / (CH_N / 4));
    for (let k = bLo; k <= bHi; k++) bands[k < bMid ? 0 : k < bHigh ? 1 : 2] += re[k] * re[k] + im[k] * im[k];   // energía grave / media / aguda
    out.push({ center: s + CH_N / 2, chroma: c, bands });
  }
  return out;
}

const sumChroma = (frames, a, b) => {
  const c = new Float64Array(12); let n = 0;
  for (const f of frames) if (f.center >= a && f.center < b) { for (let i = 0; i < 12; i++) c[i] += f.chroma[i]; n++; }
  if (!n && frames.length) { let best = frames[0]; for (const f of frames) if (Math.abs(f.center - (a + b) / 2) < Math.abs(best.center - (a + b) / 2)) best = f; for (let i = 0; i < 12; i++) c[i] = best.chroma[i]; }
  return c;
};

/** Energía grave / media / aguda de un tramo (suma de las ventanas que caen dentro; si no cae ninguna, la más cercana). */
const sumBands = (frames, a, b) => {
  const v = new Float64Array(3); let n = 0;
  for (const f of frames) if (f.center >= a && f.center < b) { for (let i = 0; i < 3; i++) v[i] += f.bands[i]; n++; }
  if (!n && frames.length) { let best = frames[0]; for (const f of frames) if (Math.abs(f.center - (a + b) / 2) < Math.abs(best.center - (a + b) / 2)) best = f; for (let i = 0; i < 3; i++) v[i] = best.bands[i]; }
  return v;
};

/** Reparto (suma 1) de la energía entre grave, medio y agudo. */
const fractions = v => { const t = v[0] + v[1] + v[2]; return t > 1e-12 ? [v[0] / t, v[1] / t, v[2] / t] : [1 / 3, 1 / 3, 1 / 3]; };

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
  const beatBands = beats.map(t => sumBands(frames, t, t + T));
  const maxFlux = Math.max(1e-9, ...flux), at = t => { const i = Math.round(t / hop); return Math.max(flux[i] || 0, flux[i - 1] || 0, flux[i + 1] || 0) / maxFlux; };
  const beatPulse = beats.map(t => [0, 1, 2, 3].map(k => at(t + k * T / 4)));          // golpes en las 4 semicorcheas de cada tiempo (0–1)
  const beatHit = beats.map(t => { const i = Math.round(t / hop); return Math.max(flux[i], flux[i - 1] || 0, flux[i + 1] || 0); });
  const an = { bpm: 60 * rate / T, rate, period: T, first: fit.first, beats, beatChroma, beatRMS, beatHit, beatBands, beatPulse, length: x.length, confidence, downbeat };
  return layout(an, downbeat);
}

/** Compases, acordes y loop sugerido para un tiempo 1 dado (0–3 tiempos desde el primero detectado). No vuelve a analizar el audio. */
export function layout(an, downbeat, want = 4) {
  const d = ((downbeat % 4) + 4) % 4, T = an.period, bars = [];
  for (let j = d; j + 4 <= an.beats.length; j += 4) {
    const a = j, h1 = new Float64Array(12), h2 = new Float64Array(12);
    for (let i = 0; i < 12; i++) { h1[i] = an.beatChroma[a][i] + an.beatChroma[a + 1][i]; h2[i] = an.beatChroma[a + 2][i] + an.beatChroma[a + 3][i]; }
    const c1 = matchChord(h1), c2 = matchChord(h2);
    const vec = new Float64Array(12); for (let k = 0; k < 4; k++) for (let i = 0; i < 12; i++) vec[i] += an.beatChroma[a + k][i];
    const bal = fractions([0, 1, 2, 3].reduce((v, k) => v.map((q, i) => q + an.beatBands[a + k][i]), [0, 0, 0])), rhy = [0, 1, 2, 3].flatMap(k => an.beatPulse[a + k]);
    bars.push({ beat: a, vec, bal, rhy, start: Math.round(an.beats[a]), end: Math.round(an.beats[a] + 4 * T), chords: [c1 && c1.name, c2 && c2.name] });
  }
  const label = b => { const [x, y] = b.chords; return !x && !y ? '—' : (x || '—') === (y || '—') ? (x || '—') : `${x || '—'} ${y || '—'}`; };
  bars.forEach(b => { b.label = label(b); });
  return { ...an, downbeat: d, bars, loop: suggestLoop(an, bars, want), loops: suggestLoops(an, bars, want, 3), combos: suggestCombos(an, bars, want, 3) };
}

/**
 * El tramo de `want` compases (por defecto 4) que mejor se repite como loop. Si la toma no llega a esa cantidad, el mayor de 4, 2 o 1 que quepa.
 * Puntúa cuánto se parece el final al principio (armonía), que las dos mitades suenen igual, que empiece sobre un golpe claro
 * del tiempo 1 y que el volumen no caiga entre el principio y el final; a igualdad, el que empieza antes.
 */
function suggestLoop(an, bars, want = 4) { return suggestLoops(an, bars, want, 1)[0] || null; }

/** Los `n` mejores tramos distintos (sin solaparse) de `want` compases, de mejor a peor: alternativas para elegir si el primero no convence. */
export function suggestLoops(an, bars, want = 4, n = 3) {
  const L = [want, 4, 2, 1].find(k => bars.length >= k); if (!L) return [];
  const maxHit = Math.max(1e-9, ...(an.beatHit || [0])), cands = [];
  for (let m = 0; m + L <= bars.length; m++) {
    const j0 = bars[m].beat, jN = j0 + 4 * L, next = jN < an.beatChroma.length ? an.beatChroma[jN] : null;
    let s = next ? cos12(an.beatChroma[j0], next) : 0.5;
    if (L >= 2) { const half = (L / 2) * 4, a = new Float64Array(12), b = new Float64Array(12); for (let k = 0; k < half; k++) for (let i = 0; i < 12; i++) { a[i] += an.beatChroma[j0 + k][i]; b[i] += an.beatChroma[j0 + half + k][i]; } s += 0.5 * cos12(a, b); }
    const r0 = an.beatRMS[j0], r1 = an.beatRMS[jN - 1] || r0; if (r0 > 1e-6 && r1 > 1e-6 && Math.abs(20 * Math.log10(r0 / r1)) > 6) s -= 0.3;
    if (an.beatHit) s += 0.25 * an.beatHit[j0] / maxHit;
    s -= 0.01 * m;
    cands.push({ score: s, bar: m });
  }
  cands.sort((p, q) => q.score - p.score);
  const out = [];
  for (const c of cands) {
    if (out.length >= n) break;
    if (out.some(o => Math.abs(o.bar - c.bar) < L)) continue;        // que no se solapen
    out.push({ bar: c.bar, bars: L, want, score: c.score, start: bars[c.bar].start, end: bars[c.bar + L - 1].end, chords: bars.slice(c.bar, c.bar + L).map(b => b.label) });
  }
  return out;
}

/**
 * Loops combinados: `want` compases (por defecto 4) elegidos entre todos los de la toma, en su orden original pero no necesariamente seguidos
 * (por ejemplo los compases 1, 3, 5 y 8). Es una selección de unidades con costo de concatenación (como en la síntesis concatenativa) más un
 * costo de objetivo (que la secuencia sea una progresión de la toma y que cada compás sea representativo de su acorde).
 * El empalme entre dos compases cuesta según cuánto se parecen: armonía del final de uno y el principio del otro, volumen, reparto de graves,
 * medios y agudos en ese punto y dibujo rítmico de los dos compases. A todo el loop se le suma que los compases mantengan el mismo groove y
 * el mismo balance espectral, que haya movimiento armónico, que empiece sobre golpe y que el volumen sea parejo.
 * La parte aditiva se resuelve de forma exacta (programación dinámica, un camino óptimo por cada primer y último compás) y se completa con una
 * búsqueda en haz; las candidatas se puntúan con todos los términos. Los tramos seguidos se dejan a `suggestLoops`.
 */
function comboModel(an, bars, L) {
  const N = bars.length;
  const maxHit = Math.max(1e-9, ...(an.beatHit || [0])), db = v => 20 * Math.log10(Math.max(v, 1e-6));
  const tv = (p, q) => 0.5 * (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]));      // distancia entre repartos grave/medio/agudo (0–1)
  const cosv = (p, q) => { let d = 0, a = 0, b = 0; for (let i = 0; i < p.length; i++) { d += p[i] * q[i]; a += p[i] * p[i]; b += q[i] * q[i]; } return a < 1e-4 && b < 1e-4 ? 1 : a < 1e-12 || b < 1e-12 ? 0 : d / Math.sqrt(a * b); };
  const f = bars.map(b => ({ vec: b.vec, first: an.beatChroma[b.beat], last: an.beatChroma[b.beat + 3], r0: an.beatRMS[b.beat], r3: an.beatRMS[b.beat + 3],
    avg: (an.beatRMS[b.beat] + an.beatRMS[b.beat + 1] + an.beatRMS[b.beat + 2] + an.beatRMS[b.beat + 3]) / 4, hit: an.beatHit ? an.beatHit[b.beat] / maxHit : 0,
    bal: b.bal, rhy: b.rhy, firstBal: fractions(an.beatBands[b.beat]), lastBal: fractions(an.beatBands[b.beat + 3]) }));
  // acordes de la toma: se agrupan los compases con armonía casi igual
  const cls = [], reps = [], cen = [];
  f.forEach((b, i) => { let c = reps.findIndex(r => cos12(r, b.vec) >= 0.9); if (c < 0) { c = reps.length; reps.push(b.vec); cen.push(new Float64Array(12)); } cls[i] = c; for (let k = 0; k < 12; k++) cen[c][k] += b.vec[k]; });
  const repr = f.map((b, i) => cos12(b.vec, cen[cls[i]]));
  // costo de concatenación: 1 = empalma como si fueran compases seguidos
  const J = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => {
    const lv = 1 - Math.min(1, Math.abs(db(f[i].r3) - db(f[j].r0)) / 12);
    return 0.4 * cos12(f[i].last, f[j].first) + 0.2 * lv + 0.2 * (1 - tv(f[i].lastBal, f[j].firstBal)) + 0.2 * cosv(f[i].rhy, f[j].rhy);
  }));
  const unary = i => 0.2 * (f[i].hit + repr[i]) / L;
  const occurrences = seq => { let c = 0; for (let i = 0; i + seq.length <= N; i++) if (seq.every((v, k) => cls[i + k] === v)) { c++; i += seq.length - 1; } return c; };
  const fullScore = p => {
    let mj = 0; for (let k = 1; k < L; k++) mj += J[p[k - 1]][p[k]]; mj /= L - 1;
    const seq = p.map(i => cls[i]), occ = occurrences(seq), distinct = new Set(seq).size;
    const lv = p.map(i => db(f[i].avg)), mean = lv.reduce((a, b) => a + b, 0) / L, sd = Math.sqrt(lv.reduce((a, b) => a + (b - mean) ** 2, 0) / L);
    let groove = 0, balance = 0, pairs = 0; for (let a = 0; a < L; a++) for (let b = a + 1; b < L; b++) { groove += cosv(f[p[a]].rhy, f[p[b]].rhy); balance += 1 - tv(f[p[a]].bal, f[p[b]].bal); pairs++; }
    return 0.9 * mj + 0.6 * J[p[L - 1]][p[0]] + 0.6 * Math.min(1, (occ - 1) / 2) + 0.15 * (distinct - 1) / (L - 1) + 0.2 * p.reduce((a, i) => a + f[i].hit, 0) / L + 0.2 * p.reduce((a, i) => a + repr[i], 0) / L
      + 0.6 * groove / pairs + 0.4 * balance / pairs - (sd > 6 ? 0.3 : 0) + (cls[p[0]] === cls[0] ? 0.15 : 0) - 0.01 * p[0] / N;      // a igualdad, que empiece como la toma
  };
  return { N, J, unary, repr, cls, fullScore };
}

/** Puntuación de un loop combinado concreto (índices de compás en orden): la misma que usa la búsqueda. Sirve para comparar y para pruebas. */
export function scoreCombo(an, bars, picks) { return comboModel(an, bars, picks.length).fullScore(picks); }

export function suggestCombos(an, bars, want = 4, n = 3) {
  const N = bars.length, L = [want, 4, 2].find(k => k >= 2 && N >= k + 1); if (!L || N > 48) return [];
  const { J, unary, repr, cls, fullScore } = comboModel(an, bars, L), f = bars;
  const cands = new Map(), add = p => { if (p[L - 1] - p[0] !== L - 1) cands.set(p.join(','), p); };
  // parte aditiva exacta: para cada primer compás, el mejor camino hasta cada último compás
  for (let first = 0; first <= N - L; first++) {
    const best = Array.from({ length: L }, () => new Float64Array(N).fill(-Infinity)), from = Array.from({ length: L }, () => new Int16Array(N).fill(-1));
    best[0][first] = unary(first);
    for (let k = 1; k < L; k++) for (let j = first + k; j <= N - (L - k); j++) for (let i = first + k - 1; i < j; i++) {
      if (best[k - 1][i] === -Infinity) continue;
      const s = best[k - 1][i] + 0.9 / (L - 1) * J[i][j] + unary(j); if (s > best[k][j]) { best[k][j] = s; from[k][j] = i; }
    }
    for (let last = first + L - 1; last < N; last++) {
      if (best[L - 1][last] === -Infinity) continue;
      const p = [last]; for (let k = L - 1; k > 0; k--) p.unshift(from[k][p[0]]); add(p);
    }
  }
  // búsqueda en haz: variedad de candidatas
  let beam = f.map((_, i) => ({ idx: [i], s: repr[i] * 0.2 }));
  for (let k = 1; k < L; k++) {
    const next = [];
    for (const st of beam) { const last = st.idx[st.idx.length - 1]; for (let j = last + 1; j <= N - (L - k); j++) next.push({ idx: [...st.idx, j], s: st.s + J[last][j] + repr[j] * 0.2 }); }
    next.sort((a, b) => b.s - a.s); beam = next.slice(0, 300);
  }
  beam.forEach(st => add(st.idx));
  const scored = [...cands.values()].map(p => ({ picks: p, score: fullScore(p), key: p.map(i => cls[i]).join('>') })).sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of scored) {
    if (out.length >= n) break;
    if (out.some(o => o.key === c.key || o.picks.filter(i => c.picks.includes(i)).length >= L - 1)) continue;      // otra progresión, no la misma con otros compases
    const ranges = c.picks.map(i => [bars[i].start, bars[i].end]);
    out.push({ kind: 'combo', key: c.key, picks: c.picks, bars: L, want, score: c.score, ranges, start: ranges[0][0], end: ranges[L - 1][1], len: ranges.reduce((a, r) => a + r[1] - r[0], 0), chords: c.picks.map(i => bars[i].label) });
  }
  return out;
}

/** Audio de un loop combinado: los tramos `ranges` ([inicio, fin] en muestras) pegados en orden, con el volumen igualado y fundidos cortos; `fix` fija su duración como en `makeLoop`. */
export function makeCombo(x, ranges, rate, fix = null) {
  const joined = joinPieces(ranges.map(r => x.slice(r[0], r[1])), rate); if (!joined.length) return joined;
  const out = cosFade(joined, Math.round(rate * 0.003), Math.round(rate * 0.003));
  if (!(fix && fix.bpm && fix.bars)) return out;
  const target = loopLength(rate, fix.bpm, fix.bars);
  return Math.abs(stretchPct(out.length, target)) > MAX_STRETCH_PCT ? out : fitTempo(out, target, rate);
}

/** Más allá de este ajuste (en %) el BPM fijo se descarta: el estiramiento ya sería audible como artefacto, no una corrección. */
export const MAX_STRETCH_PCT = 8;

/** BPM fijo para el loop: el detectado, redondeado a un entero (así el loop dura justo `compases × 4 × 60 / BPM` segundos). */
export function fixedBpm(bpm) { return Math.max(1, Math.round(bpm)); }

/** Muestras que debe durar un loop de `bars` compases de 4 tiempos a `bpm`. */
export function loopLength(rate, bpm, bars) { return Math.round(bars * 4 * 60 * rate / bpm); }

/** Cuánto hay que estirar o acortar (en %) un tramo de `len` muestras para que dure `target`. Positivo = se alarga. */
export function stretchPct(len, target) { return len > 0 ? 100 * (target - len) / len : 0; }

/**
 * Estira o acorta `x` a exactamente `n` muestras SIN cambiar el tono (WSOLA: superposición y suma con búsqueda de la mejor alineación de onda).
 * Ventanas de 40 ms con 50 % de solape; cada ventana se toma de donde mejor continúa a la anterior (±10 ms), así no se doblan ni se cortan
 * los períodos de la onda. Ver Driedger y Müller, «A Review of Time-Scale Modification of Music Signals» (2016).
 */
export function wsolaStretch(x, n, rate) {
  const len = x.length; if (n <= 0 || !len) return new Float32Array(0);
  if (n === len) return x.slice();
  const N = Math.max(256, Math.round(0.040 * rate / 2) * 2); if (len < 2 * N) return fitLength(x, n);
  const Hs = N / 2, Ha = Hs * len / n, delta = Math.round(0.010 * rate);
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)), out = new Float32Array(n + N), wsum = new Float32Array(n + N), top = len - N;
  let prev = 0;
  for (let k = 0; k * Hs < n; k++) {
    let pos = 0;
    if (k > 0) {
      const nominal = Math.min(top, Math.round(k * Ha)), tgt = Math.min(top, prev + Hs), lo = Math.max(0, nominal - delta), hi = Math.min(top, nominal + delta);
      const corr = (c, dec, m) => { let d = 0, e = 1e-9; for (let i = 0; i < m; i++) { const a = x[c + i * dec]; d += a * x[tgt + i * dec]; e += a * a; } return d / Math.sqrt(e); };
      let best = -Infinity; pos = nominal;
      for (let c = lo; c <= hi; c += 4) { const sc = corr(c, 8, N >> 3); if (sc > best) { best = sc; pos = c; } }      // búsqueda gruesa (cada 4 muestras, 1 de cada 8)
      const mid = pos; best = -Infinity;
      for (let c = Math.max(lo, mid - 4); c <= Math.min(hi, mid + 4); c++) { const sc = corr(c, 2, N >> 1); if (sc > best) { best = sc; pos = c; } }   // y afinada alrededor
    }
    const o = k * Hs; for (let i = 0; i < N; i++) { out[o + i] += x[pos + i] * win[i]; wsum[o + i] += win[i]; }
    prev = pos;
  }
  const res = new Float32Array(n); for (let i = 0; i < n; i++) res[i] = out[i] / Math.max(wsum[i], 1e-6);
  return res;
}

/** Ajuste de duración de un loop: hasta ±0,5 % basta remuestrear (el tono cambia menos de 9 centésimas de semitono); más, con WSOLA para no tocar el tono. */
export function fitTempo(x, n, rate) { return Math.abs(stretchPct(x.length, n)) <= 0.5 ? fitLength(x, n) : wsolaStretch(x, n, rate); }

/** Remuestrea `x` a exactamente `n` muestras (interpolación cúbica Catmull-Rom): cambios de duración de ±1 % no se oyen como tono. */
export function fitLength(x, n) {
  const len = x.length; if (n <= 0 || len === 0) return new Float32Array(0);
  if (n === len) return x.slice();
  const out = new Float32Array(n), k = len / n, at = i => x[i < 0 ? 0 : i >= len ? len - 1 : i];
  for (let i = 0; i < n; i++) {
    const p = i * k, i0 = Math.floor(p), t = p - i0, a = at(i0 - 1), b = at(i0), c = at(i0 + 1), d = at(i0 + 2);
    out[i] = b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
  }
  return out;
}

/**
 * Audio del loop: si hay sonido después del final, se funde por potencia constante con el principio (el salto de vuelta no se oye).
 * Con `fix = { bpm, bars }` el loop se ajusta a durar exactamente esos compases a ese BPM (para que encaje en una secuencia), sin cambiar el tono.
 */
export function makeLoop(x, start, end, rate, fadeMs = 15, fix = null) {
  const out = rawLoop(x, start, end, rate, fadeMs);
  if (!(fix && fix.bpm && fix.bars && out.length)) return out;
  const target = loopLength(rate, fix.bpm, fix.bars);
  return Math.abs(stretchPct(out.length, target)) > MAX_STRETCH_PCT ? out : fitTempo(out, target, rate);
}

function rawLoop(x, start, end, rate, fadeMs) {
  const len = end - start, F = Math.min(Math.round(fadeMs / 1000 * rate), len >> 2, Math.max(0, x.length - end));
  if (len <= 0) return new Float32Array(0);
  const out = x.slice(start, end);
  if (F < 8) return cosFade(out, Math.round(rate * 0.003), Math.round(rate * 0.003));
  for (let i = 0; i < F; i++) { const th = Math.PI / 2 * (i + 0.5) / F; out[i] = x[start + i] * Math.sin(th) + x[end + i] * Math.cos(th); }
  return out;
}

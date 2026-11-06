// Efectos de carácter inspirados en los de la Roland SP-404MKII (manual de referencia, lista «MFX»):
// 303 VinylSim, 404 VinylSim, Cassette Sim, Chorus y Auto Pitch. Se aplican al sonido antes de compartirlo o llevarlo a un sampler.
// Todo es determinista (mismo sonido y mismos ajustes, mismo resultado) y deja la toma con el mismo largo.
// Los rangos y nombres de parámetros son los del manual; cómo suena cada uno por dentro es una interpretación propia (por confirmar contra el aparato).
const TAU = 2 * Math.PI, dB = v => Math.pow(10, v / 20), clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Aleatorio con semilla (LCG): [0,1). */
export function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const whiteNoise = (n, r) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = r() * 2 - 1; return o; };

/** Biquad RBJ. type: lp, hp, lowshelf, highshelf. */
export function biquad(x, type, fc, rate, gainDB = 0, Q = Math.SQRT1_2) {
  const w = TAU * clamp(fc, 10, rate * 0.45) / rate, c = Math.cos(w), s = Math.sin(w), al = s / (2 * Q), A = dB(gainDB / 2);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'lowshelf') { const k = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * c + k); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - k); a0 = (A + 1) + (A - 1) * c + k; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - k; }
  else { const k = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * c + k); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - k); a0 = (A + 1) - (A - 1) * c + k; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - k; }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const xi = x[i], yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi; }
  return y;
}

/** Lee `x` en la posición i − d[i] (d en muestras, con decimales): un retardo variable. Es lo que produce wow, flutter, chorus y desafinación. */
export function varDelay(x, d) {
  const n = x.length, y = new Float32Array(n), at = k => x[k < 0 ? 0 : k >= n ? n - 1 : k];
  for (let i = 0; i < n; i++) {
    const p = i - d[i], k = Math.floor(p), f = p - k, a = at(k - 1), b = at(k), c = at(k + 1), e = at(k + 2);
    y[i] = b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - e + f * (3 * (b - c) + e - a)));     // Catmull-Rom
  }
  return y;
}

/** Nivel típico de las partes activas (RMS de los bloques que están a menos de ~12 dB del más fuerte). Sirve de referencia para el ruido y para igualar volumen. */
export function activeLevel(x, rate) {
  const blk = Math.max(64, Math.round(rate * 0.05)), r = [];
  for (let i = 0; i + blk <= x.length; i += blk) { let s = 0; for (let j = i; j < i + blk; j++) s += x[j] * x[j]; r.push(s / blk); }
  if (!r.length) return 0;
  const m = Math.max(...r); if (m < 1e-12) return 0;
  let s = 0, c = 0; for (const v of r) if (v > m * 0.06) { s += v; c++; }
  return Math.sqrt(s / c);
}
const matchLevel = (y, x, rate) => { const a = activeLevel(y, rate), b = activeLevel(x, rate); if (a < 1e-9 || b < 1e-9) return y; const g = b / a; for (let i = 0; i < y.length; i++) y[i] *= g; return y; };

/** Curva de retardo (en muestras) que mueve el tono como un disco o una cinta irregulares.
 *  Cada componente se da como desviación de tono (fracción, 0,004 = 0,4 %): para un seno de frecuencia f, retardo D → desviación máxima 2π·f·D/rate. */
export function wobbleDelay(n, rate, { wow = 0, wowHz = 0.555, flutter = 0, flutHz = 7, drift = 0, driftHz = 0.22 }, seed = 7) {
  const r = rng(seed), d = new Float64Array(n);
  const comps = [];
  if (wow > 0) comps.push([wow * rate / (TAU * wowHz), wowHz, r() * TAU], [wow * 0.35 * rate / (TAU * wowHz * 2.1), wowHz * 2.1, r() * TAU]);
  if (flutter > 0) comps.push([flutter * rate / (TAU * flutHz), flutHz, r() * TAU], [flutter * 0.5 * rate / (TAU * flutHz * 1.37), flutHz * 1.37, r() * TAU]);
  if (drift > 0) for (const [w, m] of [[1, 1], [0.61, 0.6], [0.37, 0.45]]) comps.push([drift * m * rate / (TAU * driftHz * w), driftHz * w, r() * TAU]);
  for (const [D, f, ph] of comps) for (let i = 0; i < n; i++) d[i] += D * Math.sin(TAU * f * i / rate + ph);
  return d;
}

/** Compresor sencillo (seguidor de nivel con ataque y relajación). */
export function compress(x, rate, thDB, ratio, atkMs, relMs) {
  const a = Math.exp(-1 / (atkMs / 1000 * rate)), r = Math.exp(-1 / (relMs / 1000 * rate)), y = new Float32Array(x.length); let env = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]); env = v > env ? a * env + (1 - a) * v : r * env + (1 - r) * v;
    const lv = 20 * Math.log10(Math.max(env, 1e-6)), g = lv > thDB ? -(lv - thDB) * (1 - 1 / ratio) : 0;
    y[i] = x[i] * dB(g);
  }
  return y;
}
/** Pico «típico» (percentil 99,5 de |x|): la saturación y la compresión se miden contra él, no contra el fondo de escala, para que suenen igual en un sonido bajo o alto. */
export function peakRef(x) {
  const step = Math.max(1, Math.floor(x.length / 20000)), a = [];
  for (let i = 0; i < x.length; i += step) a.push(Math.abs(x[i]));
  a.sort((p, q) => p - q); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.995))] : 0;
}
/** Saturación suave (tanh) relativa al pico del propio sonido. drive 0–1: 0 = nada, 1 = muy saturado. */
export function saturate(x, drive) {
  const ref = peakRef(x); if (ref < 1e-6 || drive <= 0) return x;
  const k = 1 + 6 * drive, t = Math.tanh(k), y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = ref * Math.tanh(k * x[i] / ref) / t;
  return y;
}

/** Ruido de superficie de disco: siseo de banda ancha, rumor grave y chasquidos (Poisson, de amplitud muy desigual). `ref` = nivel de la señal. */
export function vinylNoise(n, rate, amt, ref, seed, clicksPerSec = 12) {
  const out = new Float32Array(n); if (amt <= 0 || ref <= 0) return out;
  const r = rng(seed), hiss = biquad(biquad(whiteNoise(n, r), 'hp', 400, rate), 'lp', 9000, rate), rumble = biquad(whiteNoise(n, r), 'lp', 55, rate);
  const hg = ref * dB(-40 + 28 * amt) * 1.7, rg = ref * dB(-50 + 22 * amt) * 6;
  for (let i = 0; i < n; i++) out[i] = hiss[i] * hg + rumble[i] * rg;
  const lam = clicksPerSec * Math.pow(amt, 1.4) / rate;
  for (let i = 0; i < n; i++) {
    if (r() >= lam) continue;
    const u = r(), pop = r() < 0.06, amp = ref * dB(-14 + 10 * amt) * (0.25 + 2.2 * u * u * u) * (pop ? 2.5 : 1) * (r() < 0.5 ? -1 : 1), tau = rate * (pop ? 0.0022 : 0.0004);
    for (let k = 0, m = Math.min(n - i, Math.round(tau * 6)); k < m; k++) out[i + k] += amp * Math.exp(-k / tau);
  }
  return out;
}

const finish = (y, ref) => {   // protege del recorte sin tocar lo que ya cabe
  let p = 0; for (let i = 0; i < y.length; i++) p = Math.max(p, Math.abs(y[i]));
  if (p > 0.98) { const g = 0.98 / p; for (let i = 0; i < y.length; i++) y[i] *= g; }
  return y;
};
const add = (a, b) => { for (let i = 0; i < a.length; i++) a[i] += b[i]; return a; };
const levelGain = lv => dB(-40 * (1 - lv / 100));

// ---------------------------------------------------------------------------------------------------- efectos
function vinyl303(x, rate, p) {
  const c = p.comp / 100, w = p.wow / 100, n = p.noise / 100;
  let y = varDelay(x, wobbleDelay(x.length, rate, { wow: 0.012 * w, wowHz: 0.555, flutter: 0.003 * w, flutHz: 7.3 }, 11));   // 33⅓ rpm = 0,555 vueltas por segundo
  if (c > 0) { const pk = 20 * Math.log10(Math.max(peakRef(y), 1e-6)); y = compress(y, rate, pk - (4 + 20 * c), 2 + 6 * c, 5, 140); y = saturate(y, 0.6 * c); y = matchLevel(y, x, rate); }
  add(y, vinylNoise(x.length, rate, n, activeLevel(x, rate), 21, 14));
  const g = levelGain(p.level); for (let i = 0; i < y.length; i++) y[i] *= g;
  return finish(y);
}
function vinyl404(x, rate, p) {
  const f = p.frequency / 100, w = p.wow / 100, n = p.noise / 100;
  let y = varDelay(x, wobbleDelay(x.length, rate, { wow: 0.010 * w, wowHz: 0.555, flutter: 0.004 * w, flutHz: 6.1 }, 12));
  const Q = 0.7 + 0.5 * f;                                                                              // más resonancia al cerrar: color «de radio»
  y = biquad(biquad(y, 'hp', 60 * Math.pow(6.7, f), rate, 0, Q), 'lp', 12000 * Math.pow(0.183, f), rate, 0, Q);     // respuesta del tocadiscos: de amplia a «de radio»
  add(y, vinylNoise(x.length, rate, n, activeLevel(x, rate), 22, 11));
  return finish(y);
}
function cassette(x, rate, p) {
  const tone = p.tone / 100, hiss = p.hiss / 100, a = p.age / 60, drive = p.drive / 100, wf = p.wow / 100, catchv = p.catch / 100, n = x.length, r = rng(33), ref = activeLevel(x, rate);
  let y = varDelay(x, wobbleDelay(n, rate, { wow: 0.015 * wf * (1 + a), wowHz: 1.6, flutter: 0.004 * wf * (1 + a), flutHz: 9, drift: 0.03 * catchv, driftHz: 0.22 }, 13));
  if (drive > 0) { y = saturate(y, drive); y = matchLevel(y, x, rate); }
  y = biquad(biquad(y, 'lp', 2500 * Math.pow(14000 / 2500, tone) * (1 - 0.65 * a), rate), 'hp', 30 + 60 * a, rate);
  y = biquad(y, 'lowshelf', 120, rate, 2.5);                              // «joroba» de la cabeza de cinta: calidez en el grave
  if (a > 0) {   // caídas de señal: cinta gastada
    const g = new Float32Array(n).fill(1), lam = a * 0.6 / rate;
    for (let i = 0; i < n; i++) if (r() < lam) { const len = Math.round(rate * (0.02 + 0.07 * r())), depth = dB(-(3 + 7 * r()) * (0.5 + 0.5 * a)); for (let k = 0; k < len && i + k < n; k++) g[i + k] *= 1 - (1 - depth) * (0.5 - 0.5 * Math.cos(TAU * k / len)); }
    for (let i = 0; i < n; i++) y[i] *= g[i];
  }
  if (hiss > 0 && ref > 0) {
    const h = biquad(biquad(whiteNoise(n, r), 'hp', 2000, rate), 'lp', 12000, rate), gn = ref * dB(Math.min(-12, -42 + 30 * hiss + 8 * a)) * 2.2;
    for (let i = 0; i < n; i++) y[i] += h[i] * gn * (1 + 0.15 * Math.sin(TAU * 0.3 * i / rate));
  }
  return finish(y);
}
function chorus(x, rate, p) {
  const n = x.length, depth = p.depth / 100, period = p.rate, b = p.balance / 100, d1 = new Float64Array(n), d2 = new Float64Array(n), d3 = new Float64Array(n);
  const base = [0.0075 * rate, 0.0115 * rate, 0.0155 * rate], mod = depth * 0.006 * rate;      // tres voces desfasadas 120°: más ancho que dos
  for (let i = 0; i < n; i++) { const ph = TAU * i / (period * rate); d1[i] = base[0] + mod * Math.sin(ph); d2[i] = base[1] + mod * Math.sin(ph + TAU / 3); d3[i] = base[2] + mod * Math.sin(ph + 2 * TAU / 3); }
  const t1 = varDelay(x, d1), t2 = varDelay(x, d2), t3 = varDelay(x, d3);
  let wet = new Float32Array(n); for (let i = 0; i < n; i++) wet[i] = (t1[i] + t2[i] + t3[i]) / 3;
  const mix = w => { const y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = x[i] * (1 - b) + w[i] * b; return y; };
  // mezclar copias desfasadas con el original resta un poco de volumen: se compensa (antes del EQ, para que éste sí suba o baje el nivel)
  const a = activeLevel(x, rate), m0 = activeLevel(mix(wet), rate), comp = a > 1e-9 && m0 > 1e-9 && b > 0 ? a / m0 : 1;
  if (p.eqLow) wet = biquad(wet, 'lowshelf', 200, rate, p.eqLow); if (p.eqHigh) wet = biquad(wet, 'highshelf', 4000, rate, p.eqHigh);
  const y = mix(wet), g = levelGain(p.level) * comp; for (let i = 0; i < n; i++) y[i] *= g;
  return finish(y);
}

// Auto Pitch: afinador y cambio de voz monofónico (TD-PSOLA). Sólo para una voz o un instrumento solo; no sirve en acordes.
const KEYS = ['Cromática', 'La', 'Si♭', 'Si', 'Do', 'Re♭', 'Re', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭'];
const KEY_ROOT = [null, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8];      // nota (0 = Do) de cada tonalidad
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/** Frecuencia fundamental por tramos (YIN simplificado sobre una copia a ~12 kHz). Devuelve {f0 por hop, hop}; f0 = 0 si no hay voz. */
export function trackPitch(x, rate, fmin = 70, fmax = 800) {
  const dec = Math.max(1, Math.round(rate / 12000)), r = rate / dec, n = Math.floor(x.length / dec), s = new Float32Array(n);
  for (let i = 0; i < n; i++) { let a = 0; for (let k = 0; k < dec; k++) a += x[i * dec + k]; s[i] = a / dec; }
  const win = Math.round(r * 0.032), hop = Math.round(r * 0.008), lmin = Math.floor(r / fmax), lmax = Math.floor(r / fmin), out = [];
  const peak = s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  for (let t = 0; t + win + lmax < n; t += hop) {
    const dfn = new Float64Array(lmax + 1);
    for (let l = 1; l <= lmax; l++) { let a = 0; for (let i = 0; i < win; i++) { const q = s[t + i] - s[t + i + l]; a += q * q; } dfn[l] = a; }
    let run = 0, best = 0, bv = 1;
    const cm = new Float64Array(lmax + 1); cm[0] = 1;
    for (let l = 1; l <= lmax; l++) { run += dfn[l]; cm[l] = dfn[l] * l / (run || 1); }
    for (let l = lmin; l < lmax; l++) { if (cm[l] < 0.15) { while (l + 1 < lmax && cm[l + 1] < cm[l]) l++; best = l; bv = cm[l]; break; } if (cm[l] < bv) { bv = cm[l]; best = l; } }
    let e = 0; for (let i = 0; i < win; i++) e += s[t + i] * s[t + i];
    const voiced = best > 0 && bv < 0.3 && Math.sqrt(e / win) > peak * 0.03;
    let lag = best; if (voiced && best > lmin && best < lmax - 1) { const a = cm[best - 1], b = cm[best], c = cm[best + 1], den = a - 2 * b + c; if (Math.abs(den) > 1e-12) lag += 0.5 * (a - c) / den; }
    out.push(voiced ? r / lag : 0);
  }
  return { f0: out, hop: hop * dec };
}
const snap = (semi, key) => {   // semitono (MIDI, decimal) → nota de la escala más cercana
  const root = KEY_ROOT[key]; if (root == null) return Math.round(semi);
  let best = Math.round(semi), bd = 1e9;
  for (let o = Math.floor(semi / 12) - 1; o <= Math.floor(semi / 12) + 1; o++) for (const m of MAJOR) { const v = o * 12 + (m + root) % 12 + (m + root >= 12 ? 0 : 0); const dd = Math.abs(v - semi); if (dd < bd) { bd = dd; best = v; } }
  return best;
};
function autoPitch(x, rate, p) {
  const n = x.length, { f0, hop } = trackPitch(x, rate), shift = p.pitch / 100 * 12, strength = p.atPitch / 100, key = p.key | 0, robot = !!p.robot;
  const rho = Math.pow(2, p.formant / 100 * 0.5);              // formante: ±½ octava de cambio del timbre
  const voicedF = f0.filter(v => v > 0).sort((a, b) => a - b), median = voicedF.length ? voicedF[voicedF.length >> 1] : 0;
  if (!voicedF.length) return Float32Array.from(x);
  const midi = f => 69 + 12 * Math.log2(f / 440), freq = m => 440 * Math.pow(2, (m - 69) / 12);
  const target = f => {        // f0 de entrada → f0 de salida
    let m = midi(robot ? median : f) + shift;
    const q = snap(m, key); m = m + (q - m) * (robot ? 1 : strength);
    return freq(m);
  };
  const at = i => Math.min(f0.length - 1, Math.max(0, Math.round(i / hop))), per = i => { const v = f0[at(i)]; return v > 0 ? rate / v : 0; };
  // marcas de análisis: un pico por período en los tramos con voz, y cada 8 ms sin voz
  let top = 0, bot = 0; for (let k = 0; k < n; k++) { if (x[k] > top) top = x[k]; if (-x[k] > bot) bot = -x[k]; }
  const sgn = top >= bot ? 1 : -1;                                   // siempre el mismo tipo de pico (positivo o negativo): si no, las marcas saltan de un pico al otro y los granos se anulan
  const marks = []; let i = 0;
  while (i < n) {
    const T = per(i);
    if (T > 0) { const a = Math.max(0, Math.round(i - T * 0.3)), b = Math.min(n - 1, Math.round(i + T * 0.3)); let m = a, mv = -1; for (let k = a; k <= b; k++) if (sgn * x[k] > mv) { mv = sgn * x[k]; m = k; } marks.push([m, T]); i = m + Math.round(T); }
    else { marks.push([i, rate * 0.008]); i += Math.round(rate * 0.008); }
  }
  const out = new Float32Array(n), dry = x;
  let ts = 0, mi = 0;
  while (ts < n) {
    while (mi + 1 < marks.length && Math.abs(marks[mi + 1][0] - ts) < Math.abs(marks[mi][0] - ts)) mi++;
    const [m, Ta] = marks[mi], f = f0[at(ts)], Ps = f > 0 ? rate / target(f) : Ta, L = Math.max(8, Math.round(Ta));
    const g = Ps / Ta;                                         // compensa el solape
    for (let k = -L; k <= L; k++) {
      const src = m + k * (rho > 0 ? 1 / rho : 1) * 1;         // formante: la «lectura» del grano se estira o se encoge
      const j = Math.floor(src), fr = src - j, v = (j >= 0 && j + 1 < n ? x[j] * (1 - fr) + x[j + 1] * fr : 0), w = 0.5 + 0.5 * Math.cos(Math.PI * k / L), o = Math.round(ts + k);
      if (o >= 0 && o < n) out[o] += v * w * g;
    }
    ts += Math.max(8, Ps);
  }
  matchLevel(out, x, rate);                                        // el solape de granos cambia el volumen al subir o bajar el tono: se iguala
  const b = p.balance / 100, y = new Float32Array(n); for (let q = 0; q < n; q++) y[q] = dry[q] * (1 - b) + out[q] * b;
  return finish(y);
}

// ---------------------------------------------------------------------------------------------------- catálogo (para la interfaz)
const R = (k, label, min, max, def, unit = '', step = 1) => ({ k, label, kind: 'range', min, max, def, unit, step });
export const FX = {
  vinyl303: { name: '303 VinylSim', about: 'El disco de vinilo de la SP-303: compresión «de prensado», ruido de superficie y bamboleo de la vuelta del plato.',
    how: 'Un retardo que se mueve con la vuelta del plato (33⅓ rpm = 0,55 Hz) mueve el tono unos centésimos de semitono (wow) y un temblor rápido (flutter). Un compresor suave y una saturación redondean los picos como un corte de vinilo. El ruido es siseo de banda ancha + rumor grave + chasquidos al azar.',
    uso: 'Para ese sabor de disco gastado de soul y trip-hop; úsalo suave en pads y cuerdas.',
    params: [R('comp', 'Compresión', 0, 100, 55), R('noise', 'Ruido', 0, 100, 45), R('wow', 'Wow/flutter', 0, 100, 50), R('level', 'Nivel', 0, 100, 100)],
    presets: [['Sutil', { comp: 30, noise: 20, wow: 25, level: 100 }], ['Disco gastado', { comp: 55, noise: 45, wow: 50, level: 100 }], ['Extremo', { comp: 80, noise: 75, wow: 85, level: 100 }]], run: vinyl303 },
  vinyl404: { name: '404 VinylSim', about: 'El vinilo de la SP-404SX: menos compresión, más «caja de tocadiscos» (ancho de banda recortado), ruido y bamboleo.',
    how: 'Un filtro pasa-altos y uno pasa-bajos estrechan el espectro como el sistema de reproducción de un tocadiscos viejo (cuanto más FREQUENCY, más cerrado y «de radio»), con wow/flutter y ruido de superficie.',
    uso: 'Para texturas lo-fi y bases de hip hop: baja el brillo y el grave sin ensuciar el medio, donde viven las voces y las teclas.',
    params: [R('frequency', 'Frecuencia', 0, 100, 55), R('noise', 'Ruido', 0, 100, 45), R('wow', 'Wow/flutter', 0, 100, 45)],
    presets: [['Sutil', { frequency: 30, noise: 25, wow: 20 }], ['Tocadiscos de sala', { frequency: 55, noise: 45, wow: 45 }], ['Radio vieja', { frequency: 90, noise: 60, wow: 60 }]], run: vinyl404 },
  cassette: { name: 'Cassette Sim', about: 'Un casete reproduciéndose: tono, siseo, años de desgaste, saturación de cinta, bamboleo y cinta estirada.',
    how: 'La cinta pierde agudos con la edad (filtro pasa-bajos que baja), satura de forma suave y redonda (tanh), suma siseo y tiene caídas de señal. El wow/flutter viene del cabrestante y el rodillo; «cinta estirada» agrega una deriva lenta e irregular de la velocidad.',
    uso: 'El más útil para pads y ambientes: los vuelve cálidos, oscuros y un poco inestables, como una grabación de los 80 (Camel, Cerati).',
    params: [R('tone', 'Tono', 0, 100, 40), R('hiss', 'Siseo', 0, 100, 40), R('age', 'Edad', 0, 60, 25, ' años'), R('drive', 'Saturación', 0, 100, 45), R('wow', 'Wow/flutter', 0, 100, 45), R('catch', 'Cinta estirada', 0, 100, 30)],
    presets: [['Sutil', { tone: 55, hiss: 20, age: 10, drive: 25, wow: 25, catch: 10 }], ['Casete de los 80', { tone: 40, hiss: 40, age: 25, drive: 45, wow: 45, catch: 30 }], ['Cinta vieja del cajón', { tone: 25, hiss: 60, age: 50, drive: 70, wow: 70, catch: 60 }]], run: cassette },
  chorus: { name: 'Chorus', about: 'Amplitud y riqueza: duplica el sonido con una copia ligeramente desafinada que se mueve.',
    how: 'Dos copias con retardo de 7–12 ms que oscila lentamente cambian su tono un poquito (efecto Doppler); al sumarlas con el original aparece un batido que se oye como «varias fuentes». En mono, además, produce un filtro peine que da color. El periodo va de 0,33 a 2,30 s.',
    uso: 'Para ensanchar pads, teclas y guitarras limpias antes de compartirlos (los samplers suelen traer poco procesamiento propio).',
    params: [R('depth', 'Profundidad', 0, 100, 60), R('rate', 'Periodo', 0.33, 2.3, 1.4, ' s', 0.01), R('balance', 'Mezcla (seco → efecto)', 0, 100, 55, ' %'), R('eqLow', 'EQ grave', -15, 15, 0, ' dB'), R('eqHigh', 'EQ agudo', -15, 15, 0, ' dB'), R('level', 'Nivel', 0, 100, 100)],
    presets: [['Sutil', { depth: 35, rate: 1.1, balance: 35, eqLow: -3, eqHigh: 2, level: 100 }], ['Pad ancho', { depth: 65, rate: 1.8, balance: 55, eqLow: 0, eqHigh: 0, level: 100 }], ['Mareo', { depth: 95, rate: 0.7, balance: 75, eqLow: 0, eqHigh: 0, level: 100 }]], run: chorus },
  autopitch: { name: 'Auto Pitch', about: 'Procesa una voz: la afina a una tonalidad, cambia su tono y su timbre (formante) y puede dejarla «robótica».',
    how: 'Se mide la altura de la voz cada 8 ms (YIN) y se re-sintetiza con TD-PSOLA: se copian granos de un período de la voz original y se colocan más juntos o más separados para cambiar el tono; al leer cada grano más rápido o más lento cambia el formante. ROBOT fija todo a una sola nota.',
    uso: 'Para trozos de voz (Sade, Cerati) que quieras afinar a tu tonalidad o volver instrumentos. Sólo funciona con una voz o un instrumento solo: en acordes o mezclas sale mal.',
    params: [R('pitch', 'Tono', -100, 100, 0), R('formant', 'Formante', -100, 100, 0), R('balance', 'Mezcla (seco → efecto)', 0, 100, 100, ' %'), R('atPitch', 'Fuerza de corrección', 0, 100, 70),
      { k: 'key', label: 'Tonalidad', kind: 'choice', options: KEYS, def: 0 }, { k: 'robot', label: 'Robot', kind: 'bool', def: false }],
    presets: [['Afinar (cromático)', { pitch: 0, formant: 0, balance: 100, atPitch: 100, key: 0, robot: false }], ['Voz robótica', { pitch: 0, formant: 0, balance: 100, atPitch: 100, key: 0, robot: true }]], run: autoPitch },
};
export const FX_ORDER = ['cassette', 'vinyl404', 'vinyl303', 'chorus', 'autopitch'];
export const fxDefaults = id => Object.fromEntries(FX[id].params.map(q => [q.k, q.def]));
/** Completa y acota unos ajustes (por ejemplo los guardados): lo que falte toma su valor por defecto. */
export function fxParams(id, given = {}) {
  const o = {};
  for (const q of FX[id].params) {
    const v = given[q.k];
    o[q.k] = q.kind === 'range' ? (Number.isFinite(+v) && v !== null && v !== '' ? clamp(+v, q.min, q.max) : q.def) : q.kind === 'bool' ? (v === undefined ? q.def : v === true) : (Number.isInteger(+v) && +v >= 0 && +v < q.options.length ? +v : q.def);
  }
  return o;
}
/** Aplica un efecto. Devuelve un audio nuevo del mismo largo. */
export function applyFx(id, x, rate, params) {
  if (!FX[id]) throw new Error('efecto desconocido: ' + id);
  if (!x.length) return x;
  return FX[id].run(Float32Array.from(x), rate, fxParams(id, params));
}
/** Texto corto de los ajustes, para anotar en el sonido. */
export function describeFx(id, params) {
  const p = fxParams(id, params), parts = FX[id].params.map(q => q.kind === 'range' ? `${q.label} ${String(Math.round(p[q.k] * 100) / 100).replace('.', ',')}${q.unit || ''}` : q.kind === 'bool' ? (p[q.k] ? q.label : null) : `${q.label} ${q.options[p[q.k]]}`).filter(Boolean);
  return `${FX[id].name} (${parts.join(', ')})`;
}
export { KEYS };

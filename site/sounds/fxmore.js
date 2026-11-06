// Más efectos para convertir un sonido en otro: granular, destrucción y distorsión, delay y reverb, y efectos rítmicos.
// No son de la SP-404MKII (salvo por su nombre de familia: Crusher, Overdrive, Distortion, Ring Mod, Filter+Drive, Tape Echo, Reverb, Slicer, Tremolo, Stopper):
// son interpretaciones propias, por confirmar de oído contra el aparato. Mismo estilo que fx404.js: deterministas y con rangos acotados.
import { TAU, dB, clamp, rng, biquad, varDelay, activeLevel, matchLevel, finish, levelGain, peakRef, whiteNoise } from './fx404.js';

const R = (k, label, min, max, def, unit = '', step = 1) => ({ k, label, kind: 'range', min, max, def, unit, step });
const C = (k, label, options, def = 0) => ({ k, label, kind: 'choice', options, def });
const B = (k, label, def = false, hint = '') => ({ k, label, kind: 'bool', def, hint });
const grow = (x, n) => { if (n <= x.length) return Float32Array.from(x); const y = new Float32Array(n); y.set(x); return y; };

// ------------------------------------------------------------------------------------------------ GRANULAR
export const STRETCHES = [1, 2, 4, 8];
export function grainWindow(G, shape) {
  const w = new Float32Array(G);
  for (let k = 0; k < G; k++) {
    const t = (k + 0.5) / G;
    w[k] = shape === 1 ? 1 - Math.abs(2 * t - 1) : shape === 2 ? Math.min(1, Math.min(t, 1 - t) / 0.2) : 0.5 - 0.5 * Math.cos(TAU * t);     // Hann, triangular, plana con bordes cortos
  }
  return w;
}
function granular(x, rate, p) {
  const N = x.length, stretch = STRETCHES[p.stretch | 0] || 1, M = Math.round(N * stretch), r = rng(77), out = new Float64Array(M + rate);
  const G = Math.max(16, Math.round(p.size / 1000 * rate)), step = rate / p.density, win = grainWindow(G, p.shape | 0);
  for (let t = 0; t < M; t += step * (0.85 + 0.3 * r())) {
    const base = p.freeze ? p.position / 100 * N : (t / M) * N, pos = base + (r() * 2 - 1) * p.spray * 0.005 * rate;
    const g = Math.pow(2, (p.pitch + (r() * 2 - 1) * p.jitter / 100) / 12), rev = r() * 100 < p.reverse, start = Math.round(t - G / 2);
    for (let k = 0; k < G; k++) {
      const o = start + k; if (o < 0 || o >= M) continue;
      const src = pos + ((rev ? G - 1 - k : k) - G / 2) * g, j = Math.floor(src); if (j < 0 || j + 1 >= N) continue;
      const f = src - j; out[o] += (x[j] * (1 - f) + x[j + 1] * f) * win[k];
    }
  }
  const wet = matchLevel(Float32Array.from(out.subarray(0, M)), x, rate), b = p.balance / 100, dry = grow(x, M), y = new Float32Array(M);
  for (let i = 0; i < M; i++) y[i] = dry[i] * (1 - b) + wet[i] * b;
  return finish(y);
}

// ------------------------------------------------------------------------------------------------ DESTRUCCIÓN Y DISTORSIÓN
function crusher(x, rate, p) {
  const bits = Math.round(p.bits), div = Math.max(1, Math.round(p.rateDiv)), L = Math.pow(2, bits) - 1, y = new Float32Array(x.length), b = p.balance / 100;
  let held = 0;
  for (let i = 0; i < x.length; i++) { if (i % div === 0) held = Math.round((x[i] * 0.5 + 0.5) * L) / L * 2 - 1; y[i] = x[i] * (1 - b) + held * b; }
  return finish(matchLevel(y, x, rate));
}
function drive(x, rate, p, hard) {
  const ref = Math.max(peakRef(x), 1e-6), k = 1 + (hard ? 24 : 14) * p.drive / 100, bias = 0.3 * (p.asym || 0) / 100, y = new Float32Array(x.length);
  const fold = hard && p.mode === 1, pre = hard ? biquad(x, 'hp', 90, rate) : x;
  for (let i = 0; i < x.length; i++) {
    const v = pre[i] / ref;
    if (hard) { let q = k * v; if (fold) { q = ((q + 1) % 4 + 4) % 4; q = q > 2 ? 3 - q : q - 1; y[i] = q; } else y[i] = clamp(q, -1, 1); }
    else y[i] = Math.tanh(k * (v + bias)) - Math.tanh(k * bias);
  }
  let o = matchLevel(biquad(y, 'lp', 1200 * Math.pow(10, p.tone / 100), rate), x, rate);
  const g = levelGain(p.level); for (let i = 0; i < o.length; i++) o[i] *= g;
  return finish(o);
}
const overdrive = (x, rate, p) => drive(x, rate, p, false), distortion = (x, rate, p) => drive(x, rate, p, true);
function ringmod(x, rate, p) {
  const f = p.freq, m = p.mix / 100, y = new Float32Array(x.length), sq = p.shape === 1;
  for (let i = 0; i < x.length; i++) { const s = Math.sin(TAU * f * i / rate), c = sq ? Math.tanh(6 * s) : s; y[i] = c; }
  const ring = matchLevel(Float32Array.from(x, (v, i) => v * y[i]), x, rate);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * (1 - m) + ring[i] * m;
  return finish(y);
}
/** Filtro de variables de estado TPT (estable aunque se mueva el corte). Tipos: 0 pasa-bajos, 1 pasa-altos, 2 pasa-banda. */
export function svfSweep(x, rate, type, cutoffAt, Q) {
  const y = new Float32Array(x.length), k = 1 / Q; let ic1 = 0, ic2 = 0, g = 0, a1 = 0, a2 = 0, a3 = 0;
  for (let i = 0; i < x.length; i++) {
    if (i % 16 === 0) { g = Math.tan(Math.PI * clamp(cutoffAt(i), 20, rate * 0.45) / rate); a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; }
    const v3 = x[i] - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3; ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    y[i] = type === 0 ? v2 : type === 1 ? x[i] - k * v1 - v2 : v1;
  }
  return y;
}
function filterDrive(x, rate, p) {
  const fc0 = 40 * Math.pow(400, p.cutoff / 100), Q = 0.7 + 13 * Math.pow(p.resonance / 100, 2), sw = p.sweep / 100, hz = p.sweepRate, type = p.type | 0;
  let sat = x;
  if (p.drive > 0) { const ref = Math.max(peakRef(x), 1e-6), k = 1 + 8 * p.drive / 100; sat = Float32Array.from(x, v => ref * Math.tanh(k * v / ref) / Math.tanh(k)); }
  const y = svfSweep(sat, rate, type, i => fc0 * Math.pow(2, sw * 2 * Math.sin(TAU * hz * i / rate)), Q);
  return finish(matchLevel(y, x, rate));
}

// ------------------------------------------------------------------------------------------------ DELAY Y REVERB (con cola)
function tapeEcho(x, rate, p) {
  const N = x.length, time = p.time / 1000 * rate, fb = p.feedback / 100, tail = fb > 0.02 ? Math.min(Math.round(rate * 4), Math.round(time * Math.min(24, Math.ceil(Math.log(0.01) / Math.log(Math.max(fb, 0.05))) + 1))) : 0, M = N + tail;
  const buf = new Float32Array(M), y = new Float32Array(M), mix = p.mix / 100, a = Math.exp(-TAU * (1500 * Math.pow(6, p.tone / 100)) / rate), wow = p.wow / 100 * 0.004;
  let lp = 0;
  for (let i = 0; i < M; i++) {
    const d = time * (1 + wow * Math.sin(TAU * 0.6 * i / rate) + wow * 0.4 * Math.sin(TAU * 5.3 * i / rate)), pos = i - d, k = Math.floor(pos), f = pos - k;
    const del = pos >= 0 ? buf[k] * (1 - f) + buf[k + 1] * f : 0;
    lp = lp * a + del * (1 - a);                                     // el eco se oscurece en cada vuelta, como en una cinta
    const inp = i < N ? x[i] : 0;
    buf[i] = Math.tanh(inp + fb * lp * 1.05);
    y[i] = inp * (1 - mix * 0.5) + del * mix * 1.2;
  }
  return finish(y);
}
export function reverbTail(x, rate, size, damp, preMs, mix, tailSec) {
  const N = x.length, M = N + Math.round(rate * tailSec), inp = grow(x, M), decay = 0.4 + 7.6 * size / 100, pre = Math.round(preMs / 1000 * rate), wet = new Float32Array(M);
  const d = damp / 100;
  for (const dl of [0.0297, 0.0371, 0.0411, 0.0437, 0.0533, 0.0617]) {
    const n = Math.max(1, Math.round(dl * rate)), g = Math.pow(10, -3 * dl / decay), buf = new Float32Array(n); let idx = 0, lp = 0;
    for (let i = 0; i < M; i++) { const o = buf[idx]; lp = o * (1 - 0.15 - 0.6 * d) + lp * (0.15 + 0.6 * d); buf[idx] = (i >= pre ? inp[i - pre] : 0) + lp * g; if (++idx === n) idx = 0; wet[i] += o; }
  }
  for (const [dl, g] of [[0.005, 0.7], [0.0017, 0.7]]) { const n = Math.max(1, Math.round(dl * rate)), buf = new Float32Array(n); let idx = 0; for (let i = 0; i < M; i++) { const v = wet[i], bo = buf[idx], o = -g * v + bo; buf[idx] = v + g * o; if (++idx === n) idx = 0; wet[i] = o; } }
  const m = mix / 100, y = new Float32Array(M), gw = m * 1.2 / 3;
  for (let i = 0; i < M; i++) y[i] = inp[i] * (1 - m * 0.5) + wet[i] * gw;
  return y;
}
const reverb = (x, rate, p) => finish(reverbTail(x, rate, p.size, p.damping, p.predelay, p.mix, Math.min(6, 0.4 + 7.6 * p.size / 100 * 0.7)));

// ------------------------------------------------------------------------------------------------ RÍTMICOS
export const DIVISIONS = ['1/4', '1/8', '1/16', '1/32'], DIV_BEATS = [1, 0.5, 0.25, 0.125];
export const PATTERNS = ['Alterno', 'Síncopa', 'Galope', 'Golpes', 'Aleatorio A', 'Aleatorio B', 'Charleston', 'Respiración'];
export function patternSteps(i) {
  const fixed = [[1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0], [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1], [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1]];
  if (i < 4) return fixed[i];
  if (i === 6) return [1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1];
  if (i === 7) return [1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0];
  const r = rng(i === 4 ? 4242 : 9191); return Array.from({ length: 16 }, () => (r() < 0.55 ? 1 : 0));
}
function slicer(x, rate, p) {
  const step = Math.max(8, Math.round(60 / p.bpm * DIV_BEATS[p.division | 0] * rate)), pat = patternSteps(p.pattern | 0), depth = p.depth / 100;
  const ramp = Math.max(2, Math.round(rate * (0.001 + 0.02 * p.smooth / 100))), k = Math.min(1, 3 / ramp), y = new Float32Array(x.length);
  let cur = 1;
  for (let i = 0; i < x.length; i++) { const tgt = pat[Math.floor(i / step) % 16] ? 1 : 1 - depth; cur += (tgt - cur) * k; y[i] = x[i] * cur; }
  return finish(y);
}
function tremolo(x, rate, p) {
  const d = p.depth / 100, y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const ph = (p.rate * i / rate) % 1, lfo = p.shape === 1 ? (ph < 0.5 ? 2 * ph : 2 - 2 * ph) : p.shape === 2 ? 0.5 + 0.5 * Math.tanh(4 * Math.sin(TAU * ph)) : 0.5 + 0.5 * Math.sin(TAU * ph);
    y[i] = x[i] * (1 - d * (1 - lfo));
  }
  return finish(y);
}
function stutter(x, rate, p) {
  const S = Math.max(64, Math.round(60 / p.bpm * DIV_BEATS[p.division | 0] * rate)), r = rng(555), y = Float32Array.from(x), fade = Math.round(rate * 0.003);
  for (let a = 0; a + S <= x.length; a += S) {
    if (r() * 100 >= p.chance) continue;
    const reps = [2, 3, 4, 6, 8][Math.floor(r() * 5)], L = Math.max(32, Math.floor(S / reps));
    for (let k = 0; k < S; k++) { const j = a + (k % L), e = Math.min(1, (k % L) / fade, (L - 1 - (k % L)) / fade); y[a + k] = x[j] * (e < 1 ? Math.max(0, e) : 1); }
  }
  return finish(y);
}
function tapeStop(x, rate, p) {
  const N = x.length, T = Math.max(1, Math.min(N, Math.round(p.time * rate))), depth = p.depth / 100, where = p.where | 0, t0 = where === 0 ? N - T : where === 1 ? 0 : Math.round(N / 2 - T / 2);
  const pos = new Float64Array(N); let c = 0;
  for (let i = 0; i < N; i++) {
    const u = clamp((i - t0) / T, 0, 1);
    const sp = where === 0 ? 1 - depth * (1 - Math.pow(1 - u, 2)) : where === 1 ? (i < T ? 1 - depth * Math.pow(1 - i / T, 2) : 1) : 1 - depth * Math.sin(Math.PI * u);
    pos[i] = c; c += sp;
  }
  const y = new Float32Array(N);
  for (let i = 0; i < N; i++) { const q = pos[i], j = Math.floor(q), f = q - j; y[i] = j + 1 < N ? x[j] * (1 - f) + x[j + 1] * f : (j < N ? x[j] : 0); }
  return finish(y);
}

// ------------------------------------------------------------------------------------------------ catálogo
export const MORE = {
  granular: { name: 'Granular', family: 'Textura', about: 'Corta el sonido en granos de milésimas de segundo y los vuelve a lanzar en nube: sirve para congelar un instante, alargar un golpe hasta hacerlo pad o convertir una frase en una niebla.',
    how: 'Cada grano es un trocito de 10–300 ms con una ventana (Hann) que evita clics. Densidad = granos por segundo; la posición decide de dónde se toman (fija = congelar; avanzando = recorrido); la dispersión mueve esa posición al azar; el tono de cada grano se cambia leyéndolo más rápido o más lento.',
    uso: 'La herramienta más fuerte para volver un sonido en otro: un golpe de teclas se vuelve un pad; una voz, una niebla.',
    params: [R('size', 'Tamaño del grano', 10, 300, 90, ' ms'), R('density', 'Densidad', 4, 80, 24, ' granos/s'), C('stretch', 'Duración', ['×1', '×2', '×4', '×8'], 1), B('freeze', 'Congelar en una posición'), R('position', 'Posición (al congelar)', 0, 100, 50, ' %'),
      R('spray', 'Dispersión', 0, 100, 30), R('pitch', 'Tono', -24, 24, 0, ' st'), R('jitter', 'Variación de tono', 0, 1200, 15, ' cent', 5), R('reverse', 'Granos al revés', 0, 100, 0, ' %'), C('shape', 'Ventana', ['Suave', 'Triangular', 'Plana']), R('balance', 'Mezcla (seco → efecto)', 0, 100, 100, ' %')],
    presets: [['Pad desde un golpe', { size: 140, density: 30, stretch: 2, freeze: true, position: 25, spray: 25, pitch: 0, jitter: 12, reverse: 0, shape: 0, balance: 100 }], ['Niebla', { size: 220, density: 50, stretch: 1, freeze: false, position: 50, spray: 70, pitch: 0, jitter: 40, reverse: 10, shape: 0, balance: 100 }], ['Polvo de estrellas', { size: 30, density: 60, stretch: 1, freeze: false, position: 50, spray: 90, pitch: 12, jitter: 300, reverse: 25, shape: 1, balance: 70 }]], run: granular },
  crusher: { name: 'Crusher', family: 'Destruir', about: 'Baja los bits y la frecuencia de muestreo: sonido de sampler antiguo, áspero y digital.', how: 'Se redondea cada muestra a pocos niveles (menos bits = más ruido de cuantización) y se repite el valor cada N muestras (menos frecuencia = aliasing metálico).', uso: 'Para ensuciar baterías y teclas hasta el sabor de un sampler de los 90.',
    params: [R('bits', 'Bits', 1, 16, 8), R('rateDiv', 'Reducción de frecuencia', 1, 50, 6, ' ×'), R('balance', 'Mezcla (seco → efecto)', 0, 100, 100, ' %')],
    presets: [['Sampler de 12 bits', { bits: 12, rateDiv: 3, balance: 100 }], ['Radio rota', { bits: 5, rateDiv: 14, balance: 100 }]], run: crusher },
  overdrive: { name: 'Overdrive', family: 'Destruir', about: 'Saturación cálida de válvula: engorda y comprime los picos.', how: 'Una curva tanh asimétrica añade armónicos (también los pares, más musicales) y un filtro suaviza los agudos.', uso: 'Para dar cuerpo a pads y bajos sin romperlos.',
    params: [R('drive', 'Ganancia', 0, 100, 50), R('tone', 'Tono', 0, 100, 60), R('asym', 'Asimetría', 0, 100, 20), R('level', 'Nivel', 0, 100, 100)],
    presets: [['Calidez', { drive: 30, tone: 55, asym: 25, level: 100 }], ['Cálido sucio', { drive: 75, tone: 50, asym: 45, level: 100 }]], run: overdrive },
  distortion: { name: 'Distortion', family: 'Destruir', about: 'Distorsión dura: recorta o dobla la onda hasta volverla agresiva.', how: 'Se amplifica mucho la señal y se recorta de golpe (duro) o se dobla de vuelta (doblado, el «wavefolder»), lo que crea armónicos muy brillantes.', uso: 'Para texturas industriales y golpes que cortan la mezcla.',
    params: [R('drive', 'Ganancia', 0, 100, 60), C('mode', 'Modo', ['Duro', 'Doblado']), R('tone', 'Tono', 0, 100, 55), R('level', 'Nivel', 0, 100, 100)],
    presets: [['Fuzz', { drive: 70, mode: 0, tone: 45, level: 100 }], ['Metal fundido', { drive: 90, mode: 1, tone: 60, level: 100 }]], run: distortion },
  ringmod: { name: 'Ring Mod', family: 'Destruir', about: 'Multiplica el sonido por un tono: crea campanas y timbres metálicos que no estaban.', how: 'Al multiplicar por una onda de frecuencia f, cada componente f₀ se reemplaza por f₀+f y f₀−f; el resultado es inarmónico (como una campana).', uso: 'Para convertir un pad cálido en algo extraterrestre.',
    params: [R('freq', 'Frecuencia', 20, 2000, 220, ' Hz'), C('shape', 'Onda', ['Seno', 'Cuadrada']), R('mix', 'Mezcla', 0, 100, 50, ' %')],
    presets: [['Campana', { freq: 440, shape: 0, mix: 60 }], ['Robot', { freq: 90, shape: 1, mix: 80 }]], run: ringmod },
  filterdrive: { name: 'Filter+Drive', family: 'Destruir', about: 'Filtro con resonancia, saturación y movimiento: pasa-bajos, pasa-altos o pasa-banda que se desplazan solos.', how: 'Un filtro de variables de estado que se puede resonar mucho; el barrido mueve el corte con una onda lenta (hasta ±2 octavas) y la saturación previa le da mordida.', uso: 'Para oscurecer, abrir o «hacer hablar» una textura.',
    params: [C('type', 'Tipo', ['Pasa-bajos', 'Pasa-altos', 'Pasa-banda']), R('cutoff', 'Corte', 0, 100, 55), R('resonance', 'Resonancia', 0, 100, 40), R('drive', 'Saturación', 0, 100, 30), R('sweep', 'Barrido', 0, 100, 0), R('sweepRate', 'Velocidad del barrido', 0.1, 4, 0.5, ' Hz', 0.05)],
    presets: [['Oscurecer', { type: 0, cutoff: 35, resonance: 25, drive: 20, sweep: 0, sweepRate: 0.5 }], ['Wah lento', { type: 2, cutoff: 50, resonance: 60, drive: 30, sweep: 60, sweepRate: 0.4 }]], run: filterDrive },
  tapeecho: { name: 'Tape Echo', family: 'Espacio', about: 'Eco de cinta que se oscurece en cada repetición, con la cola que se extiende más allá del final.', how: 'El sonido vuelve a entrar con un retardo; en cada vuelta pasa por un filtro y una saturación suave, y el tiempo tiembla un poco (wow).', uso: 'Para dar profundidad y rastro a golpes y teclas.',
    params: [R('time', 'Tiempo', 40, 900, 320, ' ms'), R('feedback', 'Repeticiones', 0, 95, 45, ' %'), R('tone', 'Tono', 0, 100, 50), R('wow', 'Wow', 0, 100, 30), R('mix', 'Mezcla', 0, 100, 40, ' %')],
    presets: [['Eco corto', { time: 140, feedback: 30, tone: 60, wow: 15, mix: 35 }], ['Eco largo oscuro', { time: 520, feedback: 65, tone: 25, wow: 40, mix: 50 }]], run: tapeEcho },
  reverb: { name: 'Reverb', family: 'Espacio', about: 'Reverberación larga con cola: de un cuarto pequeño a una catedral.', how: 'Seis filtros peine con distintos retardos, con amortiguación de agudos, más dos difusores: es el diseño clásico de Schroeder. El tamaño decide cuánto dura la cola (0,4 a 8 s).', uso: 'Para convertir un golpe seco en una nota que se prolonga.',
    params: [R('size', 'Tamaño', 0, 100, 50), R('damping', 'Amortiguación', 0, 100, 50), R('predelay', 'Pre-retardo', 0, 120, 20, ' ms'), R('mix', 'Mezcla', 0, 100, 30, ' %')],
    presets: [['Cuarto', { size: 15, damping: 40, predelay: 5, mix: 25 }], ['Catedral', { size: 95, damping: 55, predelay: 40, mix: 55 }]], run: reverb },
  slicer: { name: 'Slicer', family: 'Ritmo', about: 'Corta el sonido con un patrón de pasos: lo vuelve rítmico.', how: 'Un patrón de 16 pasos abre y cierra el volumen al ritmo del tempo, con rampas cortas para no hacer clics.', uso: 'Para convertir una textura continua en un patrón.',
    params: [R('bpm', 'Tempo', 40, 240, 100, ' BPM'), C('division', 'Paso', DIVISIONS, 2), C('pattern', 'Patrón', PATTERNS), R('depth', 'Profundidad', 0, 100, 100), R('smooth', 'Suavidad', 0, 100, 30)],
    presets: [['Galope', { bpm: 100, division: 2, pattern: 2, depth: 100, smooth: 30 }], ['Puntos', { bpm: 100, division: 1, pattern: 3, depth: 90, smooth: 50 }]], run: slicer },
  tremolo: { name: 'Tremolo', family: 'Ritmo', about: 'Sube y baja el volumen de forma periódica.', how: 'Una onda lenta (seno, triángulo o cuadrada suave) multiplica el volumen.', uso: 'Para dar pulso a un pad sin cortarlo.',
    params: [R('rate', 'Velocidad', 0.2, 20, 4, ' Hz', 0.1), R('depth', 'Profundidad', 0, 100, 60), C('shape', 'Onda', ['Seno', 'Triángulo', 'Cuadrada suave'])],
    presets: [['Suave', { rate: 3, depth: 40, shape: 0 }], ['Helicóptero', { rate: 12, depth: 90, shape: 2 }]], run: tremolo },
  stutter: { name: 'Tartamudeo', family: 'Ritmo', about: 'Repite al azar el inicio de algunos pasos: el clásico «tartamudeo» de DJ.', how: 'Cada paso tiene una probabilidad de repetir su primer trozo 2, 3, 4, 6 u 8 veces, con fundidos de 3 ms.', uso: 'Para romper un patrón con repeticiones nerviosas.',
    params: [R('bpm', 'Tempo', 40, 240, 100, ' BPM'), C('division', 'Paso', DIVISIONS, 1), R('chance', 'Probabilidad', 0, 100, 40, ' %')],
    presets: [['Sutil', { bpm: 100, division: 1, chance: 20 }], ['Nervioso', { bpm: 100, division: 2, chance: 70 }]], run: stutter },
  tapestop: { name: 'Parada de cinta', family: 'Ritmo', about: 'La cinta se frena (o arranca): el tono y la velocidad caen en picada.', how: 'La posición de lectura avanza a una velocidad que decrece (o crece); como baja la velocidad, baja también el tono, igual que un plato al que se le quita la corriente.', uso: 'Para cerrar una frase o abrir una textura con un gesto.',
    params: [C('where', 'Dónde', ['Al final', 'Arranque', 'En el medio']), R('time', 'Duración', 0.1, 2, 0.6, ' s', 0.05), R('depth', 'Profundidad', 0, 100, 100)],
    presets: [['Freno corto', { where: 0, time: 0.4, depth: 100 }], ['Arranque lento', { where: 1, time: 1.2, depth: 90 }]], run: tapeStop },
};
export const MORE_ORDER = ['granular', 'tapeecho', 'reverb', 'filterdrive', 'overdrive', 'distortion', 'crusher', 'ringmod', 'slicer', 'stutter', 'tremolo', 'tapestop'];

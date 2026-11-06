// Catálogo completo de efectos (los 5 estilo SP-404 y los nuevos), cadenas de efectos y variaciones al azar.
import { FX, FX_ORDER, fxParams as fxParams5, rng, dB, finish } from './fx404.js';
import { MORE, MORE_ORDER } from './fxmore.js';

export const ALL = { ...FX, ...MORE };
export const ALL_ORDER = [...FX_ORDER, ...MORE_ORDER];
FX_ORDER.forEach(id => { ALL[id].family = ALL[id].family || (id === 'chorus' ? 'Espacio' : id === 'autopitch' ? 'Voz' : 'Carácter'); });
export const FAMILIES = ['Carácter', 'Espacio', 'Textura', 'Destruir', 'Ritmo', 'Voz'];
export const MAX_SLOTS = 8;

/** Completa y acota los ajustes de un efecto cualquiera (lo que falte o no sirva toma su valor por defecto). */
export function paramsOf(id, given = {}) {
  const o = {};
  for (const q of ALL[id].params) {
    const v = given[q.k];
    o[q.k] = q.kind === 'range' ? (Number.isFinite(+v) && v !== null && v !== '' && v !== undefined ? Math.max(q.min, Math.min(q.max, +v)) : q.def)
      : q.kind === 'bool' ? (v === undefined ? q.def : v === true || v === 1) : (Number.isInteger(+v) && v !== null && +v >= 0 && +v < q.options.length ? +v : q.def);
  }
  return o;
}
export const defaultsOf = id => Object.fromEntries(ALL[id].params.map(q => [q.k, q.def]));
export function applyOne(id, x, rate, params) {
  if (!ALL[id]) throw new Error('efecto desconocido: ' + id);
  return x.length ? ALL[id].run(Float32Array.from(x), rate, paramsOf(id, params)) : x;
}
export function describeOne(id, params) {
  const p = paramsOf(id, params), parts = ALL[id].params.map(q => q.kind === 'range' ? `${q.label} ${String(Math.round(p[q.k] * 100) / 100).replace('.', ',')}${q.unit || ''}` : q.kind === 'bool' ? (p[q.k] ? q.label : null) : `${q.label} ${q.options[p[q.k]]}`).filter(Boolean);
  return `${ALL[id].name} (${parts.join(', ')})`;
}

// ------------------------------------------------------------------------------------------------ cadenas
// Una cadena es una lista (hasta 8) de casillas {id, params, bypass} aplicadas en orden. La casilla especial {id:'layer', ref, gain} mezcla otro sonido de la biblioteca.
export const newSlot = (id, params = {}, extra = {}) => ({ id, params: paramsOf(id, params), bypass: false, ...extra });
export function cleanChain(chain) {
  return (Array.isArray(chain) ? chain : []).filter(s => s && (ALL[s.id] || s.id === 'layer')).slice(0, MAX_SLOTS).map(s => s.id === 'layer'
    ? { id: 'layer', ref: String(s.ref || ''), name: String(s.name || ''), gain: Math.max(0, Math.min(100, Number.isFinite(+s.gain) ? +s.gain : 70)), bypass: !!s.bypass }
    : { id: s.id, params: paramsOf(s.id, s.params || {}), bypass: !!s.bypass });
}
/** Mezcla otro sonido (repetido hasta cubrir la toma) por debajo o por encima del actual. `layers[ref] = {audio, rate}`. */
export function layerIn(x, rate, other, gain) {
  if (!other || !other.audio || !other.audio.length) return x;
  const r = other.rate / rate, y = Float32Array.from(x), n = x.length, m = other.audio.length, g = gain / 100;
  for (let i = 0; i < n; i++) { const p = (i * r) % m, k = Math.floor(p), f = p - k, a = other.audio[k], b = other.audio[(k + 1) % m]; y[i] += (a * (1 - f) + b * f) * g; }
  return finish(y);
}
export const MAX_SECONDS = 60;      // ninguna cadena produce más de un minuto (la cola de un delay o un granular ×8 podrían crecer sin fin)
export function applyChain(chain, x, rate, layers = {}) {
  let y = x;
  for (const s of cleanChain(chain)) {
    if (s.bypass) continue;
    y = s.id === 'layer' ? layerIn(y, rate, layers[s.ref], s.gain) : applyOne(s.id, y, rate, s.params);
    const cap = Math.round(MAX_SECONDS * rate);
    if (y.length > cap) { y = y.slice(0, cap); const f = Math.round(rate * 0.2); for (let i = 0; i < f; i++) y[cap - 1 - i] *= i / f; }
  }
  return y;
}
export const describeChain = chain => cleanChain(chain).filter(s => !s.bypass).map(s => s.id === 'layer' ? `Mezcla con «${s.name || 'otro sonido'}» (nivel ${Math.round(s.gain)} %)` : describeOne(s.id, s.params));

export const CHAIN_PRESETS = [
  ['Casete ancho', [newSlot('cassette', { tone: 55, hiss: 20, age: 10, drive: 25, wow: 25, catch: 10 }), newSlot('chorus', { depth: 65, rate: 1.8, balance: 55 })]],
  ['Disco polvoriento', [newSlot('vinyl303', { comp: 55, noise: 45, wow: 50 }), newSlot('cassette', { tone: 45, hiss: 20, age: 15, drive: 30, wow: 20, catch: 10 }), newSlot('reverb', { size: 25, damping: 55, predelay: 10, mix: 20 })]],
  ['Nube etérea', [newSlot('granular', { size: 160, density: 36, stretch: 1, freeze: false, spray: 50, jitter: 25 }), newSlot('chorus', { depth: 60, rate: 1.5, balance: 50 }), newSlot('reverb', { size: 80, damping: 55, predelay: 30, mix: 45 })]],
  ['Sucio y oscuro', [newSlot('overdrive', { drive: 55, tone: 45, asym: 35 }), newSlot('filterdrive', { type: 0, cutoff: 40, resonance: 35, drive: 20 }), newSlot('cassette', { tone: 30, hiss: 40, age: 35, drive: 40, wow: 40, catch: 30 })]],
  ['Pulso con eco', [newSlot('slicer', { division: 2, pattern: 2, depth: 90 }), newSlot('tapeecho', { time: 300, feedback: 45, tone: 40, wow: 25, mix: 40 })]],
];

// ------------------------------------------------------------------------------------------------ variaciones al azar
export const STYLES = {
  libre: { name: 'Libre', pool: null, count: [2, 4] },
  oscuro: { name: 'Oscuro', pool: ['cassette', 'filterdrive', 'overdrive', 'reverb', 'vinyl404'], count: [2, 3] },
  sucio: { name: 'Sucio', pool: ['crusher', 'overdrive', 'distortion', 'vinyl303', 'ringmod', 'cassette'], count: [2, 3] },
  eterero: { name: 'Etéreo', pool: ['granular', 'chorus', 'phaser', 'flanger', 'reverb', 'tapeecho', 'filterdrive'], count: [2, 3] },
  ritmico: { name: 'Rítmico', pool: ['slicer', 'stutter', 'tapeecho', 'tremolo', 'tapestop'], count: [2, 3] },
};
/** Ajustes al azar alrededor de los de fábrica; `intensity` 0–1 = cuánto se alejan. Determinista según la semilla. */
export function randomParams(id, r, intensity = 0.5) {
  const o = {};
  for (const q of ALL[id].params) {
    if (q.kind === 'range') { const span = (q.max - q.min) * 0.5 * intensity, v = q.def + (r() * 2 - 1) * span; o[q.k] = Math.round(Math.max(q.min, Math.min(q.max, v)) / (q.step || 1)) * (q.step || 1); }
    else if (q.kind === 'bool') o[q.k] = r() < 0.3 * intensity;
    else o[q.k] = r() < 0.4 + 0.5 * intensity ? Math.floor(r() * q.options.length) : q.def;
  }
  return paramsOf(id, o);
}
export function randomChain(seed, { style = 'libre', intensity = 0.5, bpm = null } = {}) {
  const r = rng(seed), st = STYLES[style] || STYLES.libre, pool = st.pool || ALL_ORDER, n = st.count[0] + Math.floor(r() * (st.count[1] - st.count[0] + 1)), chosen = [];
  while (chosen.length < Math.min(n, pool.length)) { const id = pool[Math.floor(r() * pool.length)]; if (!chosen.includes(id) && id !== 'autopitch') chosen.push(id); }
  return chosen.map(id => { const p = randomParams(id, r, intensity); if (bpm && 'bpm' in p) p.bpm = Math.max(40, Math.min(240, Math.round(bpm))); return newSlot(id, p); });
}

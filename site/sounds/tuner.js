// Afinador en vivo: dice qué nota suena y cuántas centésimas de semitono está de ella (La = 440 Hz). Con ukelele o guitarra, además
// la cuerda más cercana y cuánto le falta. Detecta el tono con YIN sobre el último tercio de segundo del micrófono.
import { trackPitch } from './fx404.js';

const NAMES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
export const noteLabel = midi => NAMES[((Math.round(midi) % 12) + 12) % 12] + (Math.floor(Math.round(midi) / 12) - 1);
export const midiOf = f => 69 + 12 * Math.log2(f / 440);
export const hzOf = m => 440 * Math.pow(2, (m - 69) / 12);

/** Cuerdas al aire (notas MIDI). El ukelele estándar es GCEA con la G aguda (re-entrante). */
export const PRESETS = {
  cromatico: { label: 'Cromático', strings: null },
  ukelele: { label: 'Ukelele', strings: [['G4', 67], ['C4', 60], ['E4', 64], ['A4', 69]] },
  guitarra: { label: 'Guitarra', strings: [['E2', 40], ['A2', 45], ['D3', 50], ['G3', 55], ['B3', 59], ['E4', 64]] },
};
const STR_NAMES = { G4: 'Sol4', C4: 'Do4', E4: 'Mi4', A4: 'La4', E2: 'Mi2', A2: 'La2', D3: 'Re3', G3: 'Sol3', B3: 'Si3' };

/** Tono del último tramo de audio, o null si es silencio o no hay un tono claro. {f0, midi, note, cents, string?, stringCents?}. */
export function detect(x, rate, preset = 'cromatico') {
  if (!x || x.length < rate * 0.12) return null;
  let e = 0; for (let i = 0; i < x.length; i += 4) e += x[i] * x[i]; if (Math.sqrt(e / Math.ceil(x.length / 4)) < 0.004) return null;       // casi silencio
  const tp = trackPitch(x, rate, 55, 1100), v = tp.f0.filter(f => f > 0).sort((a, b) => a - b);
  if (v.length < 3 || v.length < tp.f0.length * 0.4) return null;
  const f0 = v[v.length >> 1], m = midiOf(f0), r = Math.round(m), out = { f0, midi: m, note: noteLabel(r), cents: (m - r) * 100 };
  const strs = PRESETS[preset] && PRESETS[preset].strings;
  if (strs) { let best = null; for (const [nm, mi] of strs) { const d = (m - mi) * 100; if (!best || Math.abs(d) < Math.abs(best.d)) best = { nm, d }; } if (best && Math.abs(best.d) <= 350) { out.string = STR_NAMES[best.nm] || best.nm; out.stringCents = best.d; } }
  return out;
}

/** Suaviza lo que se muestra: mediana de las últimas lecturas y se mantiene un momento al callar, para que la aguja no salte. */
export function smoother(size = 3, holdMs = 600) {
  const hist = []; let last = null, lastAt = 0;
  return {
    push(r, now = Date.now()) {
      if (r) { hist.push(r); if (hist.length > size) hist.shift(); lastAt = now; const c = hist.map(h => h.cents).sort((a, b) => a - b), mid = hist[hist.length - 1]; last = { ...mid, cents: c[c.length >> 1] }; }
      else if (now - lastAt > holdMs) { hist.length = 0; last = null; }
      return last;
    },
    reset() { hist.length = 0; last = null; },
  };
}

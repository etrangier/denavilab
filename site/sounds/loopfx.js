// Gestos de loop del estilo «french house» (Daft Punk): barrido de filtro, tartamudeo en el primer tiempo y compresión de pegamento.
// Se aplican sobre el loop ya armado en Chop. Las fuentes consultadas (Mixmag, Equipboard, MusicRadar, Village Voice, Soundation) hablan de trozos
// cortos y tartamudeados, de filtros pasa-bajos que se abren y de un compresor/limitador como pieza central; la receta de cada gesto es nuestra interpretación.
import { compress, peakRef, matchLevel, finish } from './fx404.js';
import { svfSweep } from './fxmore.js';

/** Barrido de filtro pasa-bajos a lo largo de todo el loop. mode 1 = se abre (250 Hz → 14 kHz), 2 = se cierra. Q suave: sin pitido de resonancia. */
export function filterSweep(x, rate, mode = 1) {
  if (!mode || x.length < 2) return x;
  const lo = 250, hi = 14000, n = x.length, k = Math.log(hi / lo);
  const at = i => { const t = i / n, u = mode === 2 ? 1 - t : t; return lo * Math.exp(k * u); };
  return finish(svfSweep(x, rate, 0, at, 0.9));
}

/** Tartamudeo del primer tiempo: un trocito del arranque (1/16 de compás) se repite hasta llenar el tiempo, con fundidos de 3 ms; el resto queda intacto. */
export function stutterIntro(x, rate, bpm, { sixteenths = 1, span = 1 } = {}) {
  if (!(bpm > 0)) return x;
  const beat = Math.round(60 / bpm * rate), len = Math.min(x.length, Math.round(beat * span)), piece = Math.max(64, Math.round(beat / 4 * sixteenths));
  if (len < piece * 2) return x;
  const y = Float32Array.from(x), f = Math.max(2, Math.round(rate * 0.003));
  for (let i = 0; i < len; i++) {
    const p = i % piece, e = Math.min(1, p / f, (piece - 1 - p) / f);
    y[i] = x[p] * (e < 1 ? Math.max(0, e) : 1);
  }
  return y;
}

/** Compresión de pegamento (a la manera de un compresor/limitador de estudio): ratio 3:1, umbral 9 dB bajo el pico típico, nivel igualado. */
export function glue(x, rate) {
  const pk = 20 * Math.log10(Math.max(peakRef(x), 1e-6));
  return finish(matchLevel(compress(x, rate, pk - 9, 3, 8, 120), x, rate));
}

/** Aplica los gestos en orden: tartamudeo → compresión → barrido de filtro. */
export function applyGestures(x, rate, bpm, { stutter = false, glueOn = false, sweep = 0 } = {}) {
  let y = x;
  if (stutter) y = stutterIntro(y, rate, bpm);
  if (glueOn) y = glue(y, rate);
  if (sweep) y = filterSweep(y, rate, sweep);
  return y;
}

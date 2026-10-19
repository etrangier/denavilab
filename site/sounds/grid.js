// Grilla de chops: cada casilla lleva un corte; se copian, cortan y pegan casillas y se renderiza a un loop de duración exacta a un BPM fijo.
import { loopLength } from './harmony.js';

export const GRID_STEPS = [4, 8, 16];          // casillas por compás

/** Casillas vacías (null) para `bars` compases con `steps` casillas cada uno. */
export const emptyCells = (bars, steps) => Array(bars * steps).fill(null);

/** Cambia el tamaño de la grilla conservando lo que cabe (al cambiar de compases o de casillas por compás se reubica por posición en el tiempo). */
export function resizeCells(cells, bars, steps, oldBars, oldSteps) {
  const out = emptyCells(bars, steps);
  cells.forEach((v, i) => {
    if (v === null || v === undefined) return;
    const t = i / (oldBars * oldSteps), j = Math.round(t * bars * steps);
    if (j >= 0 && j < out.length) out[j] = v;
  });
  return out;
}

/**
 * Audio de la grilla: `chops[i]` es el audio del corte i, `cells[k]` el corte que suena en la casilla k (o null).
 * Cada corte suena desde su casilla hasta la siguiente casilla con corte (como un pad que corta al anterior) o hasta el final; el loop dura
 * exactamente `bars` compases a `bpm`.
 */
export function renderGrid(chops, cells, { bars, steps, bpm, rate }) {
  const total = loopLength(rate, bpm, bars), out = new Float32Array(total), n = cells.length;
  const at = k => Math.round(k * total / n), used = cells.map((v, k) => (v === null || v === undefined ? -1 : k)).filter(k => k >= 0);
  used.forEach((k, u) => {
    const c = chops[cells[k]]; if (!c || !c.length) return;
    const a = at(k), end = u + 1 < used.length ? at(used[u + 1]) : total, len = Math.min(c.length, end - a), cut = len < c.length;
    const fi = Math.min(Math.round(rate * 0.001), len >> 2), fo = Math.min(Math.round(rate * (cut ? 0.004 : 0.002)), len >> 2);
    for (let i = 0; i < len; i++) {
      let g = 1; if (i < fi) g = i / fi; else if (i >= len - fo) g = (len - 1 - i) / fo;
      out[a + i] += c[i] * g;
    }
  });
  return out;
}

/** Copia las casillas elegidas: posiciones relativas a la primera (las vacías dentro de la selección también cuentan: el ritmo se conserva). */
export function copyCells(cells, sel) {
  const ids = [...sel].sort((a, b) => a - b); if (!ids.length) return null;
  return { items: ids.map(i => [i - ids[0], cells[i] ?? null]) };
}

/** Pega `clip` empezando en la casilla `at`, pisando lo que haya; lo que se sale de la grilla se descarta. Devuelve una grilla nueva. */
export function pasteCells(cells, clip, at) {
  const out = cells.slice(); if (!clip) return out;
  for (const [off, v] of clip.items) { const k = at + off; if (k >= 0 && k < out.length) out[k] = v; }
  return out;
}

/** Vacía las casillas elegidas. */
export function clearCells(cells, sel) { const out = cells.slice(); for (const i of sel) if (i >= 0 && i < out.length) out[i] = null; return out; }

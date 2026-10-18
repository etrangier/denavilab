// Hilo aparte para los cálculos largos (quitar ruido, colchón, loop continuo): así la pantalla no se congela mientras trabajan.
import * as dsp from './dsp.js';
import { OPS } from './work-ops.js';

self.onmessage = ({ data: { id, op, args } }) => {
  try { const r = OPS[op](dsp, ...args); self.postMessage({ id, r }); }
  catch (e) { self.postMessage({ id, err: String((e && e.message) || e) }); }
};

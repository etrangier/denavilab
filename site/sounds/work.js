// Ejecuta un cálculo largo en un hilo aparte y devuelve una promesa con el resultado.
// Sin soporte de hilos (o si falla al arrancar) se hace en el hilo principal: mismo resultado, sólo que la pantalla se queda quieta mientras tanto.
import { OPS } from './work-ops.js';

let worker = null, nextId = 1, broken = false;
const pending = new Map();

function start() {
  if (worker || broken || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./dsp-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: { id, r, err } }) => { const p = pending.get(id); if (!p) return; pending.delete(id); err ? p.reject(new Error(err)) : p.resolve(r); };
    worker.onerror = () => { broken = true; worker = null; for (const p of pending.values()) p.fallback(); pending.clear(); };
  } catch (e) { broken = true; worker = null; }
  return worker;
}

async function inline(op, args) { const dsp = await import('./dsp.js'); return OPS[op](dsp, ...args); }

/** `compute('cleanNoise', [audio, rate, 'strong'])`. Los datos se copian al hilo aparte: el audio original no se toca. */
export function compute(op, args) {
  const w = start();
  if (!w) return inline(op, args);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, fallback: () => inline(op, args).then(resolve, reject) });
    try { w.postMessage({ id, op, args }); } catch (e) { pending.delete(id); inline(op, args).then(resolve, reject); }
  });
}

/** Sólo para las pruebas: ¿el último cálculo salió por el hilo aparte? */
export const usesWorker = () => !!worker && !broken;

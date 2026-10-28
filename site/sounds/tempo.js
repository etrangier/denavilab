// Escuchar tempo: oye unos segundos por el micrófono (lo que toques en el K.O. II, sin grabar) y estima el BPM.
import { estimateBPM, peakDB } from './dsp.js';

export const LISTEN_SECONDS = 10, BPM_RANGE = [40, 240];

/** Etiqueta de qué tan seguro está el cálculo. */
export const confidenceLabel = c => c >= 0.3 ? 'buena' : c >= 0.15 ? 'regular' : 'dudosa';
/** Mismo pulso leído a la mitad o al doble, dentro de un rango musical. */
export const bpmAlternatives = bpm => [bpm / 2, bpm * 2].filter(v => v >= BPM_RANGE[0] && v <= BPM_RANGE[1]).map(v => Math.round(v * 10) / 10);

/** Analiza audio ya capturado. Devuelve {bpm, confidence} o {error}. */
export function analyzeTempo(x, rate) {
  if (!x || x.length < rate * 4) return { error: 'Todavía no hay audio suficiente. Vuelve a intentarlo.' };
  if (peakDB(x) < -50) return { error: 'No oigo nada. Acerca el micrófono al aparato o sube su volumen.' };
  const r = estimateBPM(x, rate);
  return r ? { bpm: r.bpm, confidence: r.confidence } : { error: 'No encuentro un pulso claro. Prueba con un patrón más marcado (bombo y caja) o escucha unos segundos más.' };
}

/** Escucha `seconds` y analiza. `onTick(segundosRestantes)` para la cuenta atrás; `cancel.stop` cancela. Con `engine` ya encendido o apagado. */
export async function listenTempo(engine, { seconds = LISTEN_SECONDS, onTick = () => {}, cancel = { stop: false }, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (engine.state === 'idle') { await engine.start(); if (engine.state === 'idle') return { error: engine.micDenied ? 'Sin acceso al micrófono. Actívalo en los ajustes del navegador.' : (engine.error || 'No se pudo encender el micrófono.') }; }
  const step = 250; let left = seconds;
  while (left > 0) { onTick(Math.ceil(left)); await wait(Math.min(step, left * 1000)); left -= step / 1000; if (cancel.stop) return { cancelled: true }; }
  onTick(0);
  return analyzeTempo(engine.lastSamples(Math.round(seconds * engine.rate)), engine.rate);
}

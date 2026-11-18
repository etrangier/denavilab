// Diagnóstico: un resumen en texto (sin audio ni nombres) de lo que la app «entendió» de un sonido y de lo que sugirió, para poder
// compararlo con lo que tú hiciste y ajustar los algoritmos con datos reales.
import * as learn from './learn.js';
import * as dsp from './dsp.js';
import { analyzeBeats } from './beat.js';
import { BUILD } from './state.js';

const r = (v, d = 3) => v == null || !Number.isFinite(v) ? null : +v.toFixed(d);
export function buildDiagnostic({ audio, rate, sample = {}, selection = null, notes = '' }) {
  const out = { v: 1, build: BUILD, seg: r(audio.length / rate, 2), hz: rate, tipo: sample.kind || null, estado: sample.status || null, etiquetas: sample.tags || [], nota: notes || undefined };
  try { const f = learn.features(audio, rate); out.rasgos = f && Object.fromEntries(Object.entries(f).map(([k, v]) => [k, r(v, 2)])); } catch (e) { out.rasgos = 'error: ' + e.message; }
  let an = null; try { an = audio.length > rate * 3 ? analyzeBeats(audio, rate) : null; } catch (e) { out.pulso = 'error: ' + e.message; }
  const viejo = (() => { try { return dsp.estimateBPM(audio, rate); } catch (e) { return null; } })();
  out.tempo = { guardado: r(sample.bpm, 1), antes: viejo && { bpm: r(viejo.bpm, 1), conf: r(viejo.confidence, 2) },
    ahora: an && { bpm: r(an.bpm, 1), conf: r(an.confidence, 2), compas: an.meter, confCompas: r(an.meterConfidence, 2), compasSeg: r(an.barSec, 3), primerTiempoFuerteSeg: r(an.firstDownbeat, 3),
      tiemposFuertes: an.downbeats.slice(0, 8).map(d => r(d, 2)), alternativas: an.alternatives.map(a => r(a.bpm, 1)) } };
  const sec = x => x == null ? null : r(x / rate, 3);
  try { const t = learn.suggestTrim(audio, rate); out.sugerencia = { recorte: t && { a: sec(t.a), b: sec(t.b), fundidoMs: r(t.fadeMs, 0) } }; } catch (e) { out.sugerencia = { recorte: 'error: ' + e.message }; }
  try { const l = learn.suggestLoop(audio, rate, { bpm: an ? an.bpm : null, bpmConfidence: an ? an.confidence : 0 }); out.sugerencia.loop = l && { a: sec(l.a), b: sec(l.b), compases: l.bars || null, continuidad: r(l.seam, 2), porque: l.why, otras: (l.alt || []).map(c => ({ a: r(c.a, 3), compases: c.bars })) }; } catch (e) { out.sugerencia.loop = 'error: ' + e.message; }
  if (selection) out.mi_seleccion = { a: sec(selection.a), b: sec(selection.b), seg: sec(selection.b - selection.a) };
  if (an) { const e = an.env, step = Math.max(1, Math.floor(e.length / 160)), mx = Math.max(...e) || 1; let s = ''; for (let i = 0; i < e.length; i += step) { let m = 0; for (let j = i; j < Math.min(e.length, i + step); j++) m = Math.max(m, e[j]); s += Math.min(9, Math.round(9 * m / mx)); } out.golpes = s; out.golpesPorSeg = r(200 / step, 1); }
  return out;
}
export const diagnosticText = d => JSON.stringify(d);

/** Copia al portapapeles; si el navegador no deja, muestra el texto en un cuadro para copiarlo a mano. */
export async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) {}
  try { const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0'; document.body.append(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch (e) { return false; }
}

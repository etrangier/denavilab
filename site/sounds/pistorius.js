// Pistorius: el asistente de sampling. Pregunta qué se grabó y qué se quiere hacer con ello, analiza el sonido (tramo estable, afinación, tempo, ruido)
// y aplica una receta hecha con las herramientas de la app. Cada receta devuelve el audio, la lista de lo que hizo y datos para guardarlo.
import * as dsp from './dsp.js';
import * as learn from './learn.js';
import { trackPitch } from './fx404.js';
import { noteChanges, repetition } from './constellation.js';

// ---------------------------------------------------------------------------------------------------- catálogo
export const SOURCES = [
  { id: 'musica', label: 'Música (disco o canción)', icon: 'musica' },
  { id: 'instrumento', label: 'Un instrumento', icon: 'instrumento' },
  { id: 'dialogo', label: 'Diálogo de cine o serie', icon: 'cine' },
  { id: 'voz', label: 'Voz o canto', icon: 'voz' },
  { id: 'naturaleza', label: 'Naturaleza', icon: 'naturaleza' },
  { id: 'ambiente', label: 'Sonido ambiente cualquiera', icon: 'ambiente' },
  { id: 'otro', label: 'Otra cosa', icon: 'otro' },
];
export const GOALS = [
  { id: 'pad', label: 'Pad para teclado', hint: 'Una textura que se sostiene: tramo parejo, colchón y loop sin clics', icon: 'teclado', kind: 'textura' },
  { id: 'loopRitmico', label: 'Loop rítmico', hint: 'Para percusión: detecta el tempo y abre Chop para armar el loop', icon: 'bateria', kind: 'bateria' },
  { id: 'golpe', label: 'Golpe suelto', hint: 'Un bombo, una caja o un hi-hat: ataque limpio y caída corta', icon: 'golpe', kind: 'bateria' },
  { id: 'acorde', label: 'Acorde', hint: 'Guitarra o teclas: arranque limpio, final natural y afinación', icon: 'acorde', kind: 'textura' },
  { id: 'bajo', label: 'Bajo', hint: 'Una nota grave: sin rumble, afinada y con ataque', icon: 'bajo', kind: 'bajo' },
  { id: 'nota', label: 'Una nota', hint: 'Una nota de un instrumento, afinada y lista para tocar', icon: 'nota', kind: 'libre' },
  { id: 'frase', label: 'Frase hablada o cantada', hint: 'Recorte limpio de una frase, con bordes suaves', icon: 'frase', kind: 'libre' },
  { id: 'ambiente', label: 'Loop de ambiente', hint: 'Un fondo que se repite sin que se note el empalme', icon: 'ambiente', kind: 'textura' },
  { id: 'limpiar', label: 'Solo limpiar', hint: 'Quitar ruido y silencios, poner fundidos y nivelar', icon: 'limpiar', kind: 'libre' },
];
/** Qué se sugiere primero según lo que se grabó (el resto sigue disponible). */
export const SUGGEST = {
  musica: ['pad', 'loopRitmico', 'acorde', 'bajo', 'nota', 'golpe', 'ambiente', 'frase', 'limpiar'],
  instrumento: ['nota', 'acorde', 'bajo', 'pad', 'golpe', 'loopRitmico', 'ambiente', 'frase', 'limpiar'],
  dialogo: ['frase', 'golpe', 'ambiente', 'pad', 'limpiar', 'nota', 'acorde', 'bajo', 'loopRitmico'],
  voz: ['frase', 'pad', 'nota', 'ambiente', 'limpiar', 'acorde', 'golpe', 'bajo', 'loopRitmico'],
  naturaleza: ['ambiente', 'pad', 'golpe', 'limpiar', 'frase', 'nota', 'acorde', 'bajo', 'loopRitmico'],
  ambiente: ['pad', 'ambiente', 'golpe', 'limpiar', 'frase', 'nota', 'acorde', 'bajo', 'loopRitmico'],
  otro: ['pad', 'nota', 'golpe', 'loopRitmico', 'acorde', 'bajo', 'ambiente', 'frase', 'limpiar'],
};
export const goalsFor = source => (SUGGEST[source] || SUGGEST.otro).map(id => GOALS.find(g => g.id === id));

// ---------------------------------------------------------------------------------------------------- análisis
const NOTE_NAMES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
export const noteName = midi => NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12] + (Math.floor(Math.round(midi) / 12) - 1);
const midiOf = f => 69 + 12 * Math.log2(f / 440);

/** Tramo más parejo de `sec` segundos: el de menos cambio espectral, menos golpes y menos saltos de volumen. Devuelve {a, b, score} en muestras. */
export function stableWindow(x, rate, sec) {
  const W = Math.round(sec * rate);
  if (x.length <= W * 1.05 || x.length < rate * 0.5) return { a: 0, b: x.length, score: 0 };
  const N = 2048, hop = 1024, T = Math.floor((x.length - N) / hop) + 1, K = Math.min(N / 2 - 1, Math.round(6000 / (rate / N)));
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const re = new Float64Array(N), im = new Float64Array(N), S = new Float32Array(T * K), lv = new Float32Array(T);
  for (let t = 0; t < T; t++) {
    let e = 0; for (let i = 0; i < N; i++) { re[i] = x[t * hop + i] * win[i]; im[i] = 0; e += re[i] * re[i]; }
    dsp.fftInPlace(re, im, false);
    for (let k = 0; k < K; k++) S[t * K + k] = 10 * Math.log10(re[k + 1] * re[k + 1] + im[k + 1] * im[k + 1] + 1e-10);
    lv[t] = 10 * Math.log10(e / N + 1e-12);
  }
  const flux = new Float32Array(T), rise = new Float32Array(T);
  for (let t = 1; t < T; t++) { let a = 0; for (let k = 0; k < K; k++) a += Math.abs(S[t * K + k] - S[(t - 1) * K + k]); flux[t] = a / K; rise[t] = Math.max(0, lv[t] - lv[t - 1]); }
  const Wf = Math.max(4, Math.round(W / hop)); let best = { t: 0, score: Infinity };
  for (let t0 = 1; t0 + Wf <= T; t0++) {
    let mf = 0, mr = 0, mu = 0; for (let t = t0; t < t0 + Wf; t++) { mf += flux[t]; mu += lv[t]; if (rise[t] > mr) mr = rise[t]; }
    mf /= Wf; mu /= Wf; let sd = 0; for (let t = t0; t < t0 + Wf; t++) sd += (lv[t] - mu) ** 2; sd = Math.sqrt(sd / Wf);
    const score = mf + 0.6 * sd + 1.5 * mr;
    if (score < best.score) best = { t: t0, score };
  }
  const a = Math.max(0, Math.min(x.length - W, best.t * hop));
  return { a: dsp.nearestZeroCross(x, a, 256), b: Math.min(x.length, dsp.nearestZeroCross(x, a, 256) + W), score: best.score };
}

/** Afinación respecto a La = 440 Hz. Una nota sola se mide con su tono; un acorde, con sus picos graves. Devuelve {mode, cents, note?, confidence} o null. */
export function estimateTuning(x, rate) {
  if (!x || x.length < rate * 0.3) return null;
  const tp = trackPitch(x, rate, 40, 1000), voiced = tp.f0.filter(f => f > 0);
  if (voiced.length >= Math.max(5, tp.f0.length * 0.5)) {
    voiced.sort((a, b) => a - b); const f = voiced[voiced.length >> 1], m = midiOf(f), r = Math.round(m);
    return { mode: 'nota', cents: (m - r) * 100, note: noteName(r), midi: r, f0: f, confidence: Math.min(1, voiced.length / tp.f0.length + 0.2) };
  }
  const N = 16384; if (x.length < N) return null;
  const mag = new Float64Array(N / 2), frames = Math.min(6, Math.floor(x.length / N)), win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f++) { const o = Math.floor((x.length - N) * (frames === 1 ? 0 : f / (frames - 1))); for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; } dsp.fftInPlace(re, im, false); for (let k = 0; k < N / 2; k++) mag[k] += Math.hypot(re[k], im[k]); }
  const lo = Math.round(55 * N / rate), hi = Math.round(1200 * N / rate); let mx = 0; for (let k = lo; k <= hi; k++) if (mag[k] > mx) mx = mag[k];
  const peaks = []; for (let k = lo + 1; k < hi; k++) if (mag[k] > mx * 0.1 && mag[k] >= mag[k - 1] && mag[k] > mag[k + 1]) {
    const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(mag[k] + 1e-12), c = Math.log(mag[k + 1] + 1e-12), d = a - 2 * b + c, off = Math.abs(d) > 1e-12 ? 0.5 * (a - c) / d : 0;
    peaks.push({ f: (k + off) * rate / N, w: mag[k] });
  }
  peaks.sort((p, q) => q.w - p.w); const top = peaks.slice(0, 6); if (top.length < 2) return null;
  let sx = 0, sy = 0, sw = 0; for (const p of top) { const dev = (midiOf(p.f) - Math.round(midiOf(p.f))), ang = dev * 2 * Math.PI; sx += p.w * Math.cos(ang); sy += p.w * Math.sin(ang); sw += p.w; }
  return { mode: 'acorde', cents: Math.atan2(sy, sx) / (2 * Math.PI) * 100, confidence: Math.hypot(sx, sy) / sw };
}
/** Corrige la afinación cambiando la velocidad de lectura (el largo cambia una fracción de %). */
export function applyTuning(x, cents) { return Math.abs(cents) < 0.5 ? x : dsp.resample(x, 1000000, Math.round(1000000 * Math.pow(2, cents / 1200))); }

/** Lo que se sabe del sonido antes de elegir receta. */
export function analyze(x, rate) {
  const f = learn.features(x, rate), est = x.length > rate * 2 ? dsp.estimateBPM(x, rate) : null, tun = estimateTuning(x, rate);
  return { sec: x.length / rate, levelDB: dsp.levelDB(x, rate), noiseDB: x.length > rate * 0.3 ? dsp.noiseFloorDB(x, rate) : -120, feat: f, bpm: est, tuning: tun };
}

// ---------------------------------------------------------------------------------------------------- recetas
const r1 = v => String(Math.round(v * 10) / 10).replace('.', ',');
const clamp01 = (x, a, b) => x.slice(Math.max(0, a), Math.max(0, Math.min(x.length, b)));
const finish = x => dsp.removeDC(x);
const leveled = (x, rate, notes) => { const r = dsp.levelTo(x, rate); notes.push(`Volumen nivelado (${Math.round(r.beforeDB)} → ${Math.round(r.afterDB)} dB)`); return r.audio; };
/** Si la afinación se desvía más de 8 centésimas de semitono, se corrige. */
function tune(x, tun, notes) {
  if (!tun || Math.abs(tun.cents) < 8 || tun.confidence < 0.5) return x;
  notes.push(`Afinado: ${tun.cents > 0 ? '+' : '−'}${Math.round(Math.abs(tun.cents))} centésimas corregidas`);
  return applyTuning(x, tun.cents);
}
function denoiseIfNoisy(x, rate, a, notes) {
  if (a.noiseDB - a.levelDB > -38 && a.noiseDB > -75) { notes.push('Ruido reducido (suave)'); return dsp.cleanNoise(x, rate, 'soft'); }
  return x;
}
/** Recorta desde justo antes del ataque hasta el final audible (con un tope). */
function oneShot(x, rate, a, { lead = 8, tail = 80, maxSec = 4 } = {}) {
  const f = a.feat; if (!f) return x;
  const s = Math.max(0, Math.round((f.onsetMs - lead) / 1000 * rate)), e = Math.min(x.length, s + Math.round(maxSec * rate), Math.round((f.endMs + tail) / 1000 * rate));
  return clamp01(x, dsp.nearestZeroCross(x, s, 256), e);
}

const RECIPES = {
  pad(x, rate, a, ctx, notes) {
    let y = denoiseIfNoisy(x, rate, a, notes);
    const total = y.length / rate, sec = total >= 3 ? 3 : total, w = stableWindow(y, rate, sec), seg = y.slice(w.a, w.b);
    notes.push(`Tramo más parejo: de ${r1(w.a / rate)} a ${r1(w.b / rate)} s`);
    const segSec = seg.length / rate, f = segSec >= 3 ? 2 : segSec * 2 >= 4 ? 2 : segSec * 4 >= 4 ? 4 : 8;
    let z = dsp.padStretch(seg, f, rate, true); notes.push(`Colchón ×${f}: se difumina en un sonido continuo`);
    const cross = Math.min(1.5, z.length / rate / 4); z = dsp.loopSeamless(z, 0, z.length, rate, cross, true); notes.push(`Loop sin clics (empalme de ${r1(cross)} s, sin fundidos para que el loop no se corte)`);
    return finish(leveled(z, rate, notes));
  },
  ambiente(x, rate, a, ctx, notes) {
    let y = denoiseIfNoisy(x, rate, a, notes);
    const sec = Math.min(6, y.length / rate), w = stableWindow(y, rate, sec), seg = y.slice(w.a, w.b);
    notes.push(`Tramo más parejo: de ${r1(w.a / rate)} a ${r1(w.b / rate)} s`);
    const cross = Math.min(2, seg.length / rate / 3); const z = dsp.loopSeamless(seg, 0, seg.length, rate, cross, true); notes.push(`Loop sin clics (empalme de ${r1(cross)} s)`);
    return finish(leveled(z, rate, notes));
  },
  loopRitmico(x, rate, a, ctx, notes) {
    let y = dsp.trimSilence(x, -45, Math.round(rate * 0.01)); notes.push('Silencios de los bordes recortados');
    if (a.bpm && a.bpm.confidence > 0.2) notes.push(`Tempo ≈ ${Math.round(a.bpm.bpm)} BPM (confianza ${Math.round(a.bpm.confidence * 100)} %)`); else notes.push('No encontré un pulso claro: en Chop podrás cortar por golpes');
    return finish(leveled(y, rate, notes));
  },
  golpe(x, rate, a, ctx, notes) {
    let y = oneShot(x, rate, a, { lead: 3, tail: 40, maxSec: 2 }); notes.push('Recortado desde el ataque hasta que la caída se apaga');
    y = dsp.cosFade(dsp.highpass(y, rate, 30), 0, Math.round(rate * 0.012)); notes.push('Rumble bajo 30 Hz fuera y fundido de salida de 12 ms');
    return finish(leveled(y, rate, notes));
  },
  acorde(x, rate, a, ctx, notes) {
    let y = denoiseIfNoisy(x, rate, a, notes);
    y = oneShot(y, rate, a, { lead: 10, tail: 120, maxSec: 5 }); notes.push('Recortado desde justo antes del ataque hasta el final audible');
    y = tune(y, a.tuning, notes); y = dsp.highpass(y, rate, 50); notes.push('Rumble bajo 50 Hz fuera');
    y = dsp.cosFade(y, 0, Math.round(rate * 0.25)); notes.push('Fundido de salida de 250 ms: el final muere solo');
    return finish(leveled(y, rate, notes));
  },
  bajo(x, rate, a, ctx, notes) {
    let y = denoiseIfNoisy(x, rate, a, notes);
    y = oneShot(y, rate, a, { lead: 5, tail: 60, maxSec: 3 }); notes.push('Recortado desde el ataque hasta el final audible');
    y = tune(y, a.tuning, notes); y = dsp.highpass(y, rate, 28); notes.push('Rumble bajo 28 Hz fuera');
    y = dsp.cosFade(y, 0, Math.round(rate * 0.08)); notes.push('Fundido de salida de 80 ms');
    return finish(leveled(y, rate, notes));
  },
  nota(x, rate, a, ctx, notes) {
    let y = denoiseIfNoisy(x, rate, a, notes);
    y = oneShot(y, rate, a, { lead: 8, tail: 100, maxSec: 4 }); notes.push('Recortada desde el ataque hasta el final audible');
    y = tune(y, a.tuning, notes); y = dsp.cosFade(y, 0, Math.round(rate * 0.12)); notes.push('Fundido de salida de 120 ms');
    return finish(leveled(y, rate, notes));
  },
  frase(x, rate, a, ctx, notes) {
    let y = denoiseIfNoisy(x, rate, a, notes);
    y = dsp.trimSilence(y, -42, Math.round(rate * 0.04)); notes.push('Silencios de los bordes recortados (deja 40 ms de aire)');
    y = dsp.cosFade(dsp.highpass(y, rate, 80), Math.round(rate * 0.01), Math.round(rate * 0.04)); notes.push('Graves bajo 80 Hz fuera; fundidos de 10 ms y 40 ms');
    return finish(leveled(y, rate, notes));
  },
  limpiar(x, rate, a, ctx, notes) {
    let y = dsp.cleanNoise(x, rate, 'soft'); notes.push('Ruido reducido (suave)');
    y = dsp.trimSilence(y, -48, Math.round(rate * 0.02)); notes.push('Silencios de los bordes recortados');
    y = dsp.cosFade(y, Math.round(rate * 0.01), Math.round(rate * 0.06)); notes.push('Fundidos de 10 ms y 60 ms');
    return finish(leveled(y, rate, notes));
  },
};

/** Aplica la receta de una meta. Devuelve {audio, rate, notes, name, kind, tags, bpm?, note?, openChop}. */
export function run(goalId, x, rate, ctx = {}) {
  const goal = GOALS.find(g => g.id === goalId), fn = RECIPES[goalId]; if (!goal || !fn) throw new Error('meta desconocida: ' + goalId);
  const a = ctx.analysis || analyze(x, rate), notes = [], base = ctx.base || 'grabación', src = SOURCES.find(s => s.id === ctx.source);
  const audio = fn(x, rate, a, ctx, notes), tun = a.tuning, tag = goal.label.toLowerCase();
  const nm = (goalId === 'bajo' || goalId === 'nota') && tun && tun.note ? `${base} · ${tun.note} ${goalId === 'bajo' ? 'bajo' : ''}`.trim() : `${base} · ${tag}`;
  return { audio, rate, notes, name: nm, kind: goal.kind, goal: goalId, tags: [], bpm: a.bpm && a.bpm.confidence > 0.2 ? a.bpm.bpm : null, note: tun && tun.note ? tun.note : null, openChop: goalId === 'loopRitmico', source: src ? src.id : null,
    process: [`Pistorius: ${goal.label}${src ? ' · ' + src.label.toLowerCase() : ''}`, ...notes] };
}

// ---------------------------------------------------------------------------------------------------- guía de corte y chop
// Reglas basadas en la literatura de sampling que has compartido: Martin Russ (Sound Synthesis and Sampling: empezar el sonido en el ataque, cortes en cruces por
// cero, loops sólo en la parte sostenida y con crossfade), Avery Wang (picos del espectrograma: aguantan el ruido; periodo de repetición) y lo reunido sobre Daft Punk
// (trozos cortos y tartamudeados, loops con variación). Las reglas son nuestra interpretación de esas ideas.
export const REFS = {
  russ: 'Russ: el sonido debe empezar en el ataque, sin silencio antes; los cortes van en cruces por cero y los loops sólo en la parte sostenida, con crossfade',
  wang: 'Wang (Shazam): los picos del espectrograma aguantan el ruido, y el periodo de repetición sale del histograma de desfases',
  daft: 'Daft Punk: trozos cortos y tartamudeados, repetidos en loop, a veces con una variación al final',
};
const secs = n => (Math.round(n * 10) / 10).toString().replace('.', ',') + ' s';

/** Cuenta golpes y cambios de nota, busca repetición y propone: cortar un fragmento, chopear (por golpes, notas o compases) o hacer loop por el periodo detectado. */
export function advise(x, rate, a, goalId) {
  const w30 = Math.round(rate * 0.03), seg = (i, j) => { let q = 0, n = 0; for (let k = Math.max(0, i); k < Math.min(x.length, j); k++) { q += x[k] * x[k]; n++; } return Math.sqrt(q / Math.max(1, n)); };
  const hits = dsp.transients(x, 0.5, Math.floor(rate / 10), 11).filter(i => seg(i, i + w30) > 2 * seg(i - w30, i) + 1e-5), notes = noteChanges(x, rate, 0.5), rep = repetition(x, rate, { minSec: 0.4, maxSec: Math.min(20, x.length / rate * 0.6) }).find(r => r.z >= 8) || null;
  const bpmOk = a.bpm && a.bpm.confidence > 0.2, f = a.feat, total = x.length / rate;
  const facts = [`${hits.length + (hits.length ? 1 : 0)} golpe${hits.length ? 's' : ''}`.replace(/^0 golpes?$/, 'sin golpes marcados'), `${notes.length} cambio${notes.length === 1 ? '' : 's'} de nota`];
  if (bpmOk) facts.push(`tempo ≈ ${Math.round(a.bpm.bpm)} BPM`);
  if (rep) facts.push(`se repite cada ${secs(rep.sec)}`);
  const out = { action: 'cortar', chopMode: null, title: '', why: [], refs: [], markers: [], facts, counts: { hits: hits.length, notes: notes.length }, periodo: rep ? rep.sec : null };
  const mark = arr => arr.map(i => i / x.length);
  const region = () => { if (!f) return []; const s0 = Math.max(0, f.onsetMs / 1000 * rate), e0 = Math.min(x.length, f.endMs / 1000 * rate); return [s0 / x.length, e0 / x.length]; };
  const several = hits.length >= 3 || notes.length >= 2;
  switch (goalId) {
    case 'golpe':
      Object.assign(out, { action: 'cortar', title: 'Un solo corte: del ataque al final de la caída', markers: region() });
      out.why.push(several ? `Hay ${hits.length + 1} golpes en la toma: me quedo con el primero. Si quieres todos, elige Chopear.` : 'Un golpe suelto no necesita chop: un corte desde justo antes del ataque hasta que la caída se apaga.');
      out.refs.push(REFS.russ); if (several) out.alt = { action: 'chop', chopMode: 0 };
      break;
    case 'loopRitmico':
      if (several || bpmOk) { Object.assign(out, { action: 'chop', chopMode: hits.length >= 3 ? 0 : 8, title: hits.length >= 3 ? 'Chopear por golpes' : 'Chopear en partes iguales', markers: mark(hits) }); out.why.push(`Para armar un loop rítmico conviene tener cada golpe por separado${bpmOk ? ', y ya tengo el tempo para ajustarlos a la cuadrícula' : ''}.`); out.refs.push(REFS.daft); }
      else { Object.assign(out, { action: 'cortar', title: 'Recortar y probar en Chop', markers: region() }); out.why.push('No encuentro golpes ni tempo claros: recorto los bordes y en Chop pruebas cortes iguales.'); out.refs.push(REFS.russ); }
      break;
    case 'acorde':
    case 'bajo':
    case 'nota':
      if (notes.length >= 2 || hits.length >= 3) { Object.assign(out, { action: 'chop', chopMode: notes.length >= 2 ? -2 : 0, title: notes.length >= 2 ? 'Chopear por cambio de nota' : 'Chopear por golpes', markers: mark(notes.length >= 2 ? notes : hits) });
        out.why.push(goalId === 'nota' || goalId === 'bajo' ? 'Hay varias notas en la toma. Cada nota en su propio sample se toca mejor en el teclado.' : 'Hay más de un acorde en la toma: un corte por acorde, y los eliges después.'); out.refs.push(REFS.wang, REFS.russ); }
      else { Object.assign(out, { action: 'cortar', title: 'Un solo corte: del ataque al final audible', markers: region() }); out.why.push('Es una sola nota o un solo acorde: se corta en el ataque y se deja morir la cola.'); out.refs.push(REFS.russ); }
      break;
    case 'pad':
    case 'ambiente':
      if (rep) { Object.assign(out, { action: 'loop', title: `Loop de ${secs(rep.sec)}: el periodo en que se repite`, markers: [] }); out.why.push(`El sonido se repite cada ${secs(rep.sec)}: un loop de ese largo empalma casi sin que se note.`); out.refs.push(REFS.wang, REFS.russ); }
      else { const w = stableWindow(x, rate, Math.min(goalId === 'pad' ? 3 : 6, total)); Object.assign(out, { action: 'cortar', title: 'Un corte del tramo más parejo, sin chop', markers: [w.a / x.length, w.b / x.length] }); out.why.push('Una textura no se chopea: se toma el tramo más estable (sin golpes ni cambios) y se hace loop con crossfade.'); out.refs.push(REFS.russ); }
      break;
    case 'frase':
      if (total > 6 && hits.length >= 3) { Object.assign(out, { action: 'chop', chopMode: 0, title: 'Chopear por sílabas o palabras', markers: mark(hits) }); out.why.push('La toma es larga y tiene varios golpes de voz: un corte por palabra te deja frases cortas para usar.'); out.refs.push(REFS.daft); }
      else { Object.assign(out, { action: 'cortar', title: 'Un corte de la frase, con bordes suaves', markers: [0, 1] }); out.why.push('Una frase corta se deja entera: se recortan los silencios y se suavizan los bordes.'); out.refs.push(REFS.russ); }
      break;
    default:
      Object.assign(out, { action: 'cortar', title: 'Solo limpiar, sin cortar', markers: [] }); out.why.push('Quito ruido y silencios y dejo los fundidos; el corte lo decides tú después.'); out.refs.push(REFS.russ);
  }
  return out;
}

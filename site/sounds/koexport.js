// Exportación por lotes para el K.O. II: WAV mono de 16 bit, pico a −1 dBFS, silencio inicial fuera, fundidos cortos y nombres seguros.
import * as dsp from './dsp.js';
import { encodeWav } from './dsp.js';

/** 46 875 Hz es la frecuencia que se cree nativa del K.O. II (por confirmar); 44,1 kHz es la alternativa segura. */
export const KO_RATES = [46875, 44100];
export const KO_DEFAULTS = { rate: 46875, thresholdDB: -48, fadeIn: 10, fadeOut: 30, longFade: false, hp: false, hpHz: 90, even: false };
export const LONG_FADE_MS = 200;
const NAME_MAX = 16;

export const koOpts = o => {
  const x = { ...KO_DEFAULTS, ...(o || {}) };
  x.rate = KO_RATES.includes(x.rate) ? x.rate : KO_DEFAULTS.rate;
  x.thresholdDB = Math.max(-80, Math.min(-20, Number.isFinite(+x.thresholdDB) ? +x.thresholdDB : -48));
  x.fadeIn = Math.max(0, Math.min(100, Number.isFinite(+x.fadeIn) ? +x.fadeIn : 10));
  x.fadeOut = Math.max(0, Math.min(500, Number.isFinite(+x.fadeOut) ? +x.fadeOut : 30));
  x.longFade = x.longFade === true; x.hp = x.hp === true; x.even = x.even === true;
  return x;
};

/** Procesa un sonido para el aparato. Devuelve {audio, rate, trimmedMs, silent}. */
export function processForKO(x, rate, optsIn) {
  const o = koOpts(optsIn);
  let y = Float32Array.from(x);
  if (o.hp) y = dsp.highpass(y, rate, o.hpHz, 1);                     // suave: 12 dB por octava
  const th = Math.pow(10, o.thresholdDB / 20);
  let a = 0; while (a < y.length && Math.abs(y[a]) <= th) a++;        // sólo se recorta el silencio del inicio; la cola se respeta
  const silent = a >= y.length;
  if (!silent && a > 0) y = y.slice(a);
  y = dsp.resample(y, rate, o.rate);
  y = o.even ? dsp.levelTo(y, o.rate) : dsp.normalize(y, Math.pow(10, -1 / 20));   // pico a −1 dBFS (no compresión); «parejo» usa el nivel típico
  const outMs = o.longFade ? Math.max(o.fadeOut, LONG_FADE_MS) : o.fadeOut;
  y = dsp.cosFade(y, Math.round(o.fadeIn / 1000 * o.rate), Math.round(outMs / 1000 * o.rate));
  return { audio: y, rate: o.rate, trimmedMs: Math.round(a / rate * 1000), silent };
}

/** Texto seguro para el aparato: sin tildes, espacios ni símbolos; minúsculas. */
export const slug = (t, max = NAME_MAX) => (String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/gi, 'n').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase().slice(0, max).replace(/_+$/g, '')) || 'sonido';
/** Tonalidad apta para nombre de archivo: «C#m» → «Csm», «Bb» → «Bb». Vacío si no hay nada utilizable. */
export const keyTag = k => String(k || '').trim().replace(/#/g, 's').replace(/[^A-Za-z0-9]/g, '').slice(0, 5);
export const bpmTag = b => Number.isFinite(+b) && b >= 30 && b <= 300 ? Math.round(b) + 'bpm' : '';

/** NNN_nombre[_tonalidad][_NNNbpm].wav, con NNN consecutivo desde `start`. */
export function koFileName(s, n) {
  let base = slug(s.name); const tags = [keyTag(s.key), bpmTag(s.bpm)].filter(Boolean);
  const k = tags[0] && !tags[0].endsWith('bpm') ? tags[0] : null;
  if (k && base.endsWith('_' + k.toLowerCase())) tags.shift();         // ya viene en el nombre
  return String(n).padStart(3, '0') + '_' + [base, ...tags].join('_') + '.wav';
}
export const koPlan = (samples, start = 1) => samples.map((s, i) => ({ sample: s, file: koFileName(s, start + i) }));

/** Procesa todo el lote y arma los archivos del zip (sin la lista de WAV: `samples` va en el orden de salida). `getAudio(id)` entrega el audio original. */
export async function buildKoBatch(samples, getAudio, optsIn, onProgress, start = 1) {
  const files = [], skipped = [], lines = ['Lista de exportación · Archivo ← sonido | origen y datos', ''];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i], file = koFileName(s, start + files.length);      // los vacíos o en silencio no dejan huecos en la numeración
    try {
      const x = await getAudio(s.id);
      if (!x.length) { skipped.push(s.name + ' (sin audio)'); continue; }
      const r = processForKO(x, s.rate, optsIn);
      if (r.silent) { skipped.push(s.name + ' (silencio)'); continue; }
      files.push({ name: file, data: encodeWav(r.audio, r.rate) });
      const extra = [s.origin ? 'origen: ' + s.origin : 'origen: (sin anotar)', s.replaced ? 'reemplazado por versión propia' : null, s.key ? 'tonalidad: ' + s.key : null, s.bpm ? 'BPM: ' + Math.round(s.bpm) : null, s.process && s.process.length ? 'procesos: ' + s.process.join(' → ') : null].filter(Boolean);
      lines.push(`${file} ← ${s.name} | ${extra.join(' | ')}`);
    } catch (e) { skipped.push(s.name + ' (error)'); }
    if (onProgress) onProgress(i + 1, samples.length);
    if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));          // deja respirar a la pantalla
  }
  if (files.length) files.push({ name: 'lista.txt', data: new TextEncoder().encode(lines.join('\n') + '\n') });
  return { files, skipped };
}

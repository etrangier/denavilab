// DenaviLab: Sounds · procesado de audio puro (sin DOM). Se prueba en el navegador y en Node.
// Es la misma lógica de la app de iPhone, portada a JavaScript.

/** Búfer circular mono en memoria para la captura retroactiva. */
export class RingBuffer {
  constructor(capacity) {
    this.capacity = Math.max(1, capacity | 0);
    this.buf = new Float32Array(this.capacity);
    this.head = 0; this.count = 0;
  }
  write(x) {
    for (let i = Math.max(0, x.length - this.capacity); i < x.length; i++) {
      this.buf[this.head] = x[i];
      this.head = (this.head + 1) % this.capacity;
      if (this.count < this.capacity) this.count++;
    }
  }
  /** Últimas n muestras, de la más antigua a la más reciente. */
  last(n) {
    n = Math.min(n | 0, this.count);
    const out = new Float32Array(n);
    let i = (this.head - n + this.capacity) % this.capacity;
    for (let k = 0; k < n; k++) { out[k] = this.buf[i]; i = (i + 1) % this.capacity; }
    return out;
  }
  clear() { this.head = 0; this.count = 0; }
}

// ---------- WAV ----------

/** WAV PCM mono 16 bit little-endian. */
export function encodeWav(x, rate) {
  const n = x.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const tag = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), true);
  return new Uint8Array(buf);
}

/** Lee el WAV que produce encodeWav (PCM 16 bit mono). */
export function decodeWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 44 || v.getUint32(0) !== 0x52494646) return null;
  const rate = v.getUint32(24, true), n = (bytes.length - 44) >> 1, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = v.getInt16(44 + i * 2, true) / 32767;
  return { samples: out, rate };
}

/** Remuestreo lineal. Objetivo del K.O. II: 46 875 Hz (por confirmar). */
export function resample(x, from, to) {
  if (from === to || x.length < 2) return x;
  const n = Math.floor(x.length * to / from), r = from / to, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * r, k = Math.min(Math.floor(p), x.length - 2), f = p - k;
    out[i] = x[k] * (1 - f) + x[k + 1] * f;
  }
  return out;
}

// ---------- edición ----------

/** Cruce por cero más cercano a `index` (evita clics en los cortes). */
export function nearestZeroCross(x, index, win = 2048) {
  if (x.length < 2) return 0;
  const c = Math.min(Math.max(index, 0), x.length - 2);
  for (let d = 0; d <= win; d++) {
    for (const i of [c - d, c + d]) {
      if (i >= 0 && i < x.length - 1 && (x[i] === 0 || (x[i] < 0) !== (x[i + 1] < 0))) return i;
    }
  }
  return c;
}

export function trim(x, a, b, snap = true) {
  if (!x.length) return x;
  let s = Math.min(Math.max(a, 0), x.length - 1), e = Math.min(Math.max(b, 0), x.length);
  if (snap) { s = nearestZeroCross(x, s); e = nearestZeroCross(x, e) + 1; }
  return e > s ? x.slice(s, Math.min(e, x.length)) : new Float32Array(0);
}

export function fade(x, inS, outS) {
  const y = x.slice(), fi = Math.min(inS, y.length), fo = Math.min(outS, y.length);
  for (let i = 0; i < fi; i++) y[i] *= i / fi;
  for (let i = 0; i < fo; i++) y[y.length - 1 - i] *= i / fo;
  return y;
}

/** Normaliza a un pico objetivo (por defecto −1 dBFS). */
export function normalize(x, peak = 0.891) {
  let p = 0; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  if (p === 0) return x;
  const g = peak / p, y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
  return y;
}

/** Picos por bloque para dibujar la onda. */
export function peaks(x, buckets) {
  if (!x.length || buckets <= 0) return [];
  const size = Math.max(1, Math.floor(x.length / buckets)), out = [];
  for (let i = 0; i < x.length; i += size) {
    let m = 0; for (let j = i; j < Math.min(i + size, x.length); j++) m = Math.max(m, Math.abs(x[j]));
    out.push(m);
  }
  return out;
}

export function peakDB(x) {
  let p = 0; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p > 0 ? 20 * Math.log10(p) : -120;
}

/** Quita el silencio del principio y del final. Si todo es silencio, no toca nada. */
export function trimSilence(x, thresholdDB = -48, pad = 0) {
  const th = Math.pow(10, thresholdDB / 20);
  let a = -1, b = -1;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > th) { a = i; break; }
  if (a < 0) return x;
  for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > th) { b = i; break; }
  return x.slice(Math.max(0, a - pad), Math.min(x.length, b + 1 + pad));
}

/** Guardado rápido: recorte relativo al nivel, fundidos cortos y normalizado. */
export const QUICK_DEFAULTS = { enabled: false, trim: true, fades: true, normalize: true, thresholdDB: -48 };
export function quickProcess(x, rate, s = QUICK_DEFAULTS) {
  let y = x;
  if (s.trim) {
    // El umbral nunca queda por encima de 30 dB bajo el pico de la propia toma: una grabación baja
    // (p. ej. un ambiente de exterior) no debe quedar casi vacía por un umbral absoluto.
    const th = Math.max(-90, Math.min(s.thresholdDB, peakDB(y) - 30));
    const t = trimSilence(y, th, Math.floor(rate / 200));
    if (t.length >= rate / 10) y = t;   // si quedara menos de 0,1 s, no se recorta
  }
  if (s.fades) { const f = Math.floor(rate * 5 / 1000); y = fade(y, f, f); }
  if (s.normalize) y = normalize(y);
  return y;
}

export const autoName = count => 'grabacion_' + String(count + 1).padStart(3, '0');

/** Nombres para un cambio de nombre: uno solo tal cual; varios, numerados («nombre 01», «nombre 02»…). */
export function names(base, count) {
  if (count < 1) return [];
  if (count === 1) return [base];
  const w = Math.max(2, String(count).length);
  return Array.from({ length: count }, (_, i) => base + ' ' + String(i + 1).padStart(w, '0'));
}

/** Ventana de `width` muestras centrada en `center`, sin salirse del audio. */
export function windowRange(count, width, center) {
  if (count <= 0) return [0, 0];
  const w = Math.min(Math.max(width, 2), count);
  const lo = Math.min(Math.max(center - (w >> 1), 0), count - w);
  return [lo, lo + w];
}

/** Posición final de un marcador: dentro del audio y, si se pide, en el cruce por cero más cercano. */
export function snapMarker(x, i, zeroCross) {
  const c = Math.min(Math.max(i, 0), Math.max(x.length - 1, 0));
  return zeroCross ? nearestZeroCross(x, c, 2048) : c;
}

// ---------- tempo ----------

/** Tempo estimado por autocorrelación de la subida de energía. null si hay menos de 2 s o no hay pulso claro. */
export function estimateBPM(x, rate, lo = 70, hi = 160) {
  const hop = 512;
  if (x.length <= rate * 2) return null;
  const n = Math.floor(x.length / hop), e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0; for (let j = i * hop; j < (i + 1) * hop; j++) s += x[j] * x[j];
    e[i] = Math.sqrt(s / hop);
  }
  const flux = new Float32Array(n); let mean = 0;
  for (let i = 1; i < n; i++) { flux[i] = Math.max(0, e[i] - e[i - 1]); mean += flux[i]; }
  mean /= n;
  for (let i = 0; i < n; i++) flux[i] -= mean;
  const hopRate = rate / hop, minLag = Math.max(2, Math.floor(hopRate * 60 / hi)), maxLag = Math.floor(hopRate * 60 / lo);
  if (n <= maxLag * 2) return null;
  const r = l => { let s = 0; for (let i = 0; i < n - l; i++) s += flux[i] * flux[i + l]; return s / (n - l); };
  const r0 = r(0);
  if (r0 < 1e-12) return null;
  let best = minLag, bestV = -Infinity;
  for (let l = minLag; l <= maxLag; l++) { const v = r(l); if (v > bestV) { bestV = v; best = l; } }
  let lag = best;
  if (best > minLag && best < maxLag) {
    const y0 = r(best - 1), y2 = r(best + 1), den = y0 - 2 * bestV + y2;
    if (Math.abs(den) > 1e-15) lag += 0.5 * (y0 - y2) / den;
  }
  const confidence = Math.min(1, Math.max(0, bestV / r0));
  return confidence > 0.05 ? { bpm: 60 * hopRate / lag, confidence } : null;
}

/** Tap tempo: media de los últimos intervalos (segundos); reinicia si pasan más de 2 s. */
export function tapTempo(taps, t, maxTaps = 6) {
  if (taps.length && t - taps[taps.length - 1] > 2) taps.length = 0;
  taps.push(t);
  if (taps.length > maxTaps) taps.shift();
  if (taps.length < 2) return null;
  let sum = 0; for (let i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1];
  return Math.min(300, Math.max(30, 60 / (sum / (taps.length - 1))));
}

/** Un compás de metrónomo: `beats` clics, el primero más agudo y fuerte. */
export function barSamples(bpm, beats, rate) {
  const beatLen = Math.round(rate * 60 / bpm), out = new Float32Array(beatLen * Math.max(beats, 1)), clickLen = Math.min(beatLen, Math.floor(rate * 0.02));
  for (let b = 0; b < Math.max(beats, 1); b++) {
    const [freq, amp] = b === 0 ? [1800, 0.9] : (beats === 6 && b === 3 ? [1500, 0.75] : [1200, 0.6]);
    for (let i = 0; i < clickLen; i++) out[b * beatLen + i] = Math.sin(2 * Math.PI * freq * i / rate) * (1 - i / clickLen) * amp;
  }
  return out;
}

/** Muestras de una toma de `bars` compases; null si no hay límite. */
export const takeSamples = (bars, beats, bpm, rate) => bars > 0 ? Math.round(bars * beats * 60 / bpm * rate) : null;

/** mm:ss.cc */
export function stamp(seconds) {
  const c = Math.round(seconds * 100);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return p(Math.floor(c / 6000)) + ':' + p(Math.floor(c / 100) % 60) + '.' + p(c % 100);
}

// ---------- chop ----------

/** Inicios de golpes por subida de energía. `sensitivity` 0..1: más alta, más cortes. */
export function transients(x, sensitivity, minGapSamples, maxCount = 12) {
  const hop = 512;
  if (x.length <= hop * 4) return [];
  const n = Math.floor(x.length / hop), e = new Float32Array(n), flux = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * hop; j < (i + 1) * hop; j++) s += x[j] * x[j]; e[i] = Math.sqrt(s / hop); }
  let mean = 0;
  for (let i = 1; i < n; i++) { flux[i] = Math.max(0, e[i] - e[i - 1]); mean += flux[i]; }
  mean /= n;
  let v = 0; for (let i = 0; i < n; i++) v += (flux[i] - mean) ** 2;
  const sd = Math.sqrt(v / n), k = 4 - 3.5 * Math.min(Math.max(sensitivity, 0), 1), thr = mean + k * sd;
  const picks = [];
  for (let i = 1; i < n; i++) if (flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] >= (i + 1 < n ? flux[i + 1] : 0)) picks.push([i, flux[i]]);
  const gap = Math.max(1, Math.floor(minGapSamples / hop)), chosen = [];
  for (const [i] of picks.sort((a, b) => b[1] - a[1])) if (chosen.every(c => Math.abs(c - i) >= gap)) chosen.push(i);
  return chosen.slice(0, maxCount).sort((a, b) => a - b).map(i => nearestZeroCross(x, Math.max(0, i * hop - hop), 256));
}

/** `count` inicios repartidos por igual, ajustados a cruce por cero. */
export function evenSlices(x, count) {
  if (!x.length || count < 1) return [];
  return Array.from({ length: count }, (_, i) => i === 0 ? 0 : nearestZeroCross(x, Math.floor(x.length * i / count), 256));
}

/** Tramos [inicio, fin) entre inicios; descarta los de menos de 64 muestras. */
export function slices(starts, total) {
  const s = [...new Set([0, ...starts.filter(v => v > 0 && v < total)])].sort((a, b) => a - b), out = [];
  for (let i = 0; i < s.length; i++) { const a = s[i], b = i + 1 < s.length ? s[i + 1] : total; if (b - a >= 64) out.push([a, b]); }
  return out;
}

/** Ajusta cada inicio a la rejilla (`step` muestras desde `origin`); sin repetidos. */
export function snapToGrid(starts, step, origin = 0) {
  if (step < 1) return starts;
  const m = Math.round(step);
  return [...new Set(starts.map(s => Math.max(0, origin + Math.round((s - origin) / step) * m)))].sort((a, b) => a - b);
}

/** Nombre de un corte: conserva su número original aunque se dejen huecos («corte01_x», «corte03_x»). */
export const pieceName = (i, base) => 'corte' + String(i + 1).padStart(2, '0') + '_' + base;

/** Tramos elegidos como fracciones de la toma, para resaltarlos en la onda. */
export function highlightRanges(ranges, total, selected) {
  if (total <= 0) return [];
  return [...selected].sort((a, b) => a - b).filter(i => i >= 0 && i < ranges.length).map(i => [ranges[i][0] / total, ranges[i][1] / total]);
}

/** Línea de tiempo de «Escuchar selección»: cada corte elegido, en su orden original, separado por un hueco corto.
 *  Devuelve [{i, start, end}] en muestras de la secuencia (sin hueco al final). */
export function previewSegments(ranges, selected, rate, gap = 0.15) {
  const g = Math.round(gap * rate), out = [];
  let pos = 0;
  for (const i of [...selected].sort((a, b) => a - b).filter(i => i >= 0 && i < ranges.length)) {
    const len = ranges[i][1] - ranges[i][0];
    out.push({ i, start: pos, end: pos + len }); pos += len + g;
  }
  return out;
}

/** El audio de esa secuencia (con 2 ms de fundido en cada corte para que no haya clics al saltar entre cortes lejanos). */
export function previewAudio(audio, ranges, selected, rate, gap = 0.15) {
  const seg = previewSegments(ranges, selected, rate, gap);
  if (!seg.length) return new Float32Array(0);
  const out = new Float32Array(seg[seg.length - 1].end), f = Math.round(rate * 0.002);
  for (const s of seg) out.set(fade(audio.slice(ranges[s.i][0], ranges[s.i][1]), f, f), s.start);
  return out;
}

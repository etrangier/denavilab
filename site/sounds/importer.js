// Importar sonidos de fuera (Archivos, Drive…): WAV de cualquier tipo común y, con la ayuda del navegador, MP3, M4A, FLAC u OGG.
export const MAX_SECONDS = 300;

/** Nombre del sonido a partir del nombre del archivo (sin extensión, sin guiones bajos de más). */
export const baseName = n => String(n || '').replace(/\.[^./\\]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Sonido importado';

/**
 * Lee un WAV: recorre los bloques (fmt, data, y se salta LIST u otros), acepta PCM de 8, 16, 24 y 32 bits y flotante de 32,
 * con cualquier número de canales (se mezclan a mono). Devuelve { samples, rate, channels } o null si no es un WAV que se entienda.
 */
export function parseWav(bytes) {
  if (!bytes || bytes.length < 44) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), tag = o => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmt = null, data = null;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = tag(o), size = v.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ' && body + 16 <= bytes.length) {
      let format = v.getUint16(body, true); const channels = v.getUint16(body + 2, true), rate = v.getUint32(body + 4, true), bits = v.getUint16(body + 14, true);
      if (format === 0xFFFE && size >= 26 && body + 26 <= bytes.length) format = v.getUint16(body + 24, true);          // WAVE_FORMAT_EXTENSIBLE: el formato real va dentro
      fmt = { format, channels, rate, bits };
    } else if (id === 'data') { data = { start: body, len: Math.min(size, bytes.length - body) }; break; }
    o = body + size + (size & 1);
  }
  if (!fmt || !data || !fmt.channels || !fmt.rate) return null;
  const { format, channels, rate, bits } = fmt, bps = bits >> 3, ok = (format === 1 && [1, 2, 3, 4].includes(bps)) || (format === 3 && bps === 4);
  if (!ok) return null;
  const frames = Math.floor(data.len / (bps * channels)), out = new Float32Array(frames);
  const get = o => format === 3 ? v.getFloat32(o, true)
    : bps === 1 ? (bytes[o] - 128) / 128
    : bps === 2 ? v.getInt16(o, true) / 32768
    : bps === 3 ? ((bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16)) << 8 >> 8) / 8388608
    : v.getInt32(o, true) / 2147483648;
  for (let i = 0; i < frames; i++) { let s = 0; for (let c = 0; c < channels; c++) s += get(data.start + (i * channels + c) * bps); out[i] = s / channels; }
  return { samples: out, rate, channels };
}

/** Decodifica un archivo de audio: WAV propio y, si no, el decodificador del navegador (MP3, M4A, FLAC, OGG…), que remuestrea a la frecuencia del dispositivo. */
export async function decodeFile(file, makeCtx = () => new (window.AudioContext || window.webkitAudioContext)()) {
  const bytes = new Uint8Array(await file.arrayBuffer()), w = parseWav(bytes);
  if (w) return w;
  const ctx = makeCtx();
  try {
    const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), n = buf.length, out = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += ch[i] / buf.numberOfChannels; }
    return { samples: out, rate: buf.sampleRate, channels: buf.numberOfChannels };
  } finally { try { ctx.close && ctx.close(); } catch (e) {} }
}

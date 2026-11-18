// Restauración de material viejo: crujidos de vinilo (clics cortos) y zumbido de corriente (50/60 Hz y sus armónicos).
// Pensado para tomas hechas con el micrófono del teléfono frente a un disco o un parlante.
import { fftInPlace } from './dsp.js';

const median5 = (a, b, c, d, e) => { const v = [a, b, c, d, e].sort((p, q) => p - q); return v[2]; };

/** Marca los clics: muestras que se alejan mucho de la mediana de sus vecinas, medido contra el ruido local. Devuelve máscara y cuenta de clics. */
function findClicks(x, rate, sens) {
  const n = x.length, r = new Float32Array(n);
  for (let i = 2; i < n - 2; i++) r[i] = x[i] - median5(x[i - 2], x[i - 1], x[i], x[i + 1], x[i + 2]);
  const win = Math.max(256, Math.round(rate * 0.05)), mask = new Uint8Array(n), k = sens === 'strong' ? 5 : 7;
  let clicks = 0;
  for (let s = 0; s < n; s += win) {
    const e = Math.min(n, s + win), a = []; for (let i = s; i < e; i++) a.push(Math.abs(r[i]));
    const med = a.slice().sort((p, q) => p - q)[a.length >> 1], thr = Math.max(k * 1.4826 * med, 0.004);
    for (let i = s; i < e; i++) if (Math.abs(r[i]) > thr) { const g = 3; for (let j = Math.max(0, i - g); j <= Math.min(n - 1, i + g); j++) mask[j] = 1; }
  }
  const maxGap = Math.round(rate * 0.003);                       // un hueco más largo no es un clic: es música, no se toca
  for (let i = 0; i < n;) { if (!mask[i]) { i++; continue; } let j = i; while (j < n && mask[j]) j++; if (j - i > maxGap) mask.fill(0, i, j); else clicks++; i = j; }
  return { mask, clicks };
}

/** Quita crujidos: cada clic se reemplaza por una recta entre las muestras sanas de sus bordes. Devuelve {audio, clicks}. */
export function declick(x, rate, sens = 'soft') {
  const y = Float32Array.from(x); let total = 0;
  for (let pass = 0; pass < 2; pass++) {
    const { mask, clicks } = findClicks(y, rate, sens); if (!clicks) break; total += clicks;
    for (let i = 0; i < y.length;) {
      if (!mask[i]) { i++; continue; } let j = i; while (j < y.length && mask[j]) j++;
      const L = j - i, y0 = i > 0 ? y[i - 1] : (j < y.length ? y[j] : 0), y1 = j < y.length ? y[j] : y0;
      const m0 = i > 1 ? (y[i - 1] - y[i - 2]) * (L + 1) : y1 - y0, m1 = j + 1 < y.length ? (y[j + 1] - y[j]) * (L + 1) : y1 - y0;   // pendientes de los bordes: la curva sigue la música, no una recta
      for (let t = i; t < j; t++) { const u = (t - i + 1) / (L + 1), u2 = u * u, u3 = u2 * u; y[t] = (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * m1; }
      i = j;
    }
  }
  return { audio: y, clicks: total };
}

/** Clics por segundo que hay en el audio (sin modificarlo). */
export const clickRate = (x, rate) => findClicks(x, rate, 'soft').clicks / Math.max(0.1, x.length / rate);

/** Potencia media por bin con ventana de 2^15 puntos. */
function avgPower(x, from, to) {
  const N = 32768, re = new Float64Array(N), im = new Float64Array(N), pw = new Float64Array(N / 2 + 1); let cnt = 0;
  for (let s = from; s + N <= to; s += N / 2) {
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
    fftInPlace(re, im, false); for (let k = 0; k <= N / 2; k++) pw[k] += re[k] * re[k] + im[k] * im[k]; cnt++;
  }
  return cnt ? pw.map(v => v / cnt) : null;
}

/** Detecta zumbido: ¿hay picos finos y constantes en 50 o 60 Hz y sus armónicos? → {hz, harmonics:[Hz…], db} o null. */
export function findHum(x, rate) {
  const N = 32768; if (x.length < N * 1.5) return null;
  const halves = [avgPower(x, 0, x.length >> 1), avgPower(x, x.length >> 1, x.length)];
  if (!halves[0] || !halves[1]) return null;
  const bin = rate / N;
  const stand = (pw, f) => {                                        // cuántos dB sobresale el pico en f de su entorno (10–40 Hz alrededor)
    const k = Math.round(f / bin); let pk = 0, kk = k; for (let d = -1; d <= 1; d++) if (pw[k + d] > pk) { pk = pw[k + d]; kk = k + d; }
    const la = Math.log(pw[kk - 1] + 1e-20), lb = Math.log(pk + 1e-20), lc = Math.log(pw[kk + 1] + 1e-20), off = (la - lc) / (2 * (la - 2 * lb + lc) || 1);
    if (Math.abs((kk + off) * bin - f) > 0.4) return 0;                // la corriente es exacta (±0,1 Hz); una nota de bajo cercana no cuenta
    const env = []; for (let d = Math.round(8 / bin); d <= Math.round(40 / bin); d++) { env.push(pw[k + d], pw[k - d]); }
    env.sort((a, b) => a - b); return 10 * Math.log10((pk + 1e-20) / (env[env.length >> 1] + 1e-20));
  };
  let best = null;
  for (const f0 of [50, 60]) {
    const hs = []; let top = 0;
    for (let m = 1; m <= 8 && f0 * m < 700; m++) {
      const f = f0 * m, s = Math.min(stand(halves[0], f), stand(halves[1], f));
      if (s >= 12) { hs.push(f); top = Math.max(top, s); }
    }
    if (hs.length >= 2 && (!best || hs.length > best.harmonics.length || (hs.length === best.harmonics.length && top > best.db))) best = { hz: f0, harmonics: hs, db: Math.round(top) };
  }
  return best;
}

/** Filtro muesca (biquad) estrecho. */
function notch(x, rate, f, q) {
  const w = 2 * Math.PI * f / rate, al = Math.sin(w) / (2 * q), c = Math.cos(w), b0 = 1, b1 = -2 * c, b2 = 1, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}

/** Quita el zumbido detectado con muescas finas (Q 30) en cada armónico, pasando dos veces (ida y vuelta) para no desfasar. */
export function dehum(x, rate, hum = findHum(x, rate)) {
  if (!hum) return { audio: x, hum: null };
  let y = x;
  for (const f of hum.harmonics) { y = notch(y, rate, f, 30); y = Float32Array.from(notch(Float32Array.from(y).reverse(), rate, f, 30)).reverse(); }
  return { audio: y, hum };
}

// Memoria de estilo: aprende, en el propio dispositivo y sin enviar nada, cómo recortas y cómo armas tus loops.
// No es una red neuronal: son estadísticas sencillas y explicables que mejoran con el uso.
//  1) De cada sonido saca unos números (duración, ataque, caída, brillo, golpes por segundo).
//  2) De tus sonidos con tipo (textura, bajo, batería) aprende cómo suena cada tipo y reconoce los nuevos.
//  3) De cada recorte y cada loop que haces aprende cuánto aire dejas antes del golpe y después de la cola,
//     qué fundido usas, qué largo de loop prefieres y cuántos tiempos/compases dura.
//  4) Con eso sugiere un recorte o un loop (tú lo corriges y la memoria aprende de la corrección).
import { fftInPlace, transients, nearestZeroCross } from './dsp.js';
import { constellation, repetition, refineLoopEnd, seamScore } from './constellation.js';

const KEY = 'denavilab.sounds.style';
export const MIN_SEEN = 3;            // con menos ejemplos que esto se usan valores de fábrica
const EMA = 0.3;                      // cuánto pesa lo último que hiciste
const FACTORY = { trim: { golpe: { lead: 8, tail: 60, fade: 4 }, sostenido: { lead: 20, tail: 250, fade: 20 } } };
const ms = (i, hop, rate) => i * hop / rate * 1000;
const ema = (old, v, n) => n === 0 || old == null ? v : old + EMA * (v - old);

const fresh = () => ({ v: 1, on: true, seen: 0, kinds: {}, trim: {}, loop: {}, ids: {} });
export function load() {
  try { const m = JSON.parse(localStorage.getItem(KEY)); if (m && m.v === 1) return { ...fresh(), ...m }; } catch (e) {}
  return fresh();
}
export function save(m) { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) {} return m; }
export function forget() { try { localStorage.removeItem(KEY); } catch (e) {} return fresh(); }
export function setEnabled(on) { const m = load(); m.on = !!on; return save(m); }

// ------------------------------------------------------------------------------------------------ rasgos de un sonido
function envelope(x, rate, hopMs = 5) {
  const hop = Math.max(32, Math.round(rate * hopMs / 1000)), n = Math.floor(x.length / hop), e = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * hop; j < (i + 1) * hop; j++) s += x[j] * x[j]; e[i] = Math.sqrt(s / hop); }
  return { e, hop };
}
function centroid(x, rate) {
  const N = 2048; if (x.length < N) return 0;
  const frames = 6, num = new Float64Array(N / 2), win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  let used = 0;
  for (let f = 0; f < frames; f++) {
    const off = Math.floor((x.length - N) * (frames === 1 ? 0 : f / (frames - 1))), re = new Float64Array(N), im = new Float64Array(N); let en = 0;
    for (let i = 0; i < N; i++) { re[i] = x[off + i] * win[i]; en += re[i] * re[i]; }
    if (en < 1e-8) continue;
    fftInPlace(re, im, false); used++;
    for (let k = 1; k < N / 2; k++) num[k] += Math.hypot(re[k], im[k]);
  }
  if (!used) return 0;
  let a = 0, b = 0; for (let k = 1; k < N / 2; k++) { a += k * rate / N * num[k]; b += num[k]; }
  return b > 0 ? a / b : 0;
}
/** Números que describen un sonido. null si es casi silencio o dura menos de 50 ms. */
export function features(x, rate) {
  if (!x || x.length < rate * 0.05) return null;
  const { e, hop } = envelope(x, rate), n = e.length; let pk = 0, pi = 0;
  for (let i = 0; i < n; i++) if (e[i] > pk) { pk = e[i]; pi = i; }
  if (pk < 1e-4) return null;
  let on = 0; while (on < n && e[on] < pk * 0.1) on++;                                  // −20 dB del pico: arranca el sonido
  let dec = pi; while (dec < n && e[dec] >= pk * 0.0316) dec++;                          // −30 dB: se fue el cuerpo
  let end = n - 1; while (end > 0 && e[end] < pk * 0.0178) end--;                        // −35 dB: fin audible
  let peak = 0, sq = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; sq += x[i] * x[i]; }
  const rms = Math.sqrt(sq / x.length), dur = x.length / rate;
  return { dur, onsetMs: ms(on, hop, rate), attackMs: ms(Math.max(0, pi - on), hop, rate), decayMs: ms(dec - pi, hop, rate), endMs: ms(end + 1, hop, rate),
    crest: 20 * Math.log10(peak / Math.max(rms, 1e-9)), centroid: centroid(x, rate), onsetsPerSec: transients(x, 0.5, Math.round(rate * 0.08)).length / dur };
}
const vec = f => [Math.log10(f.dur + 0.01), Math.log10(1 + f.decayMs), f.crest / 20, Math.log10(1 + f.centroid), Math.min(f.onsetsPerSec, 8) / 8];

/** ¿golpe (corto, de caída rápida) o sostenido (pad, textura)? Primero con lo que aprendió de tus tipos; si no, con una regla simple. */
export function styleOf(f, model = load()) {
  const heur = f.decayMs < 500 && f.crest > 14 ? 'golpe' : 'sostenido';
  const cands = Object.entries(model.kinds).filter(([, k]) => k.n >= MIN_SEEN);
  if (cands.length < 2 || !f) return { kind: null, group: heur, confidence: 0 };
  const v = vec(f); let best = null, second = Infinity;
  for (const [name, k] of cands) {
    let d = 0; for (let i = 0; i < v.length; i++) { const sd = Math.sqrt(k.m2[i] / Math.max(1, k.n - 1)) + 0.15; d += ((v[i] - k.mean[i]) / sd) ** 2; }
    d = Math.sqrt(d / v.length);
    if (!best || d < best.d) { if (best) second = best.d; best = { name, d }; } else if (d < second) second = d;
  }
  const confidence = Math.max(0, Math.min(1, 1 - best.d / (second + 1e-9)));
  const group = best.name === 'bateria' || best.name === 'bajo' ? 'golpe' : best.name === 'textura' ? 'sostenido' : heur;
  return { kind: best.name, group, confidence };
}

// ------------------------------------------------------------------------------------------------ aprender
/** Un sonido con tipo (textura, bajo, batería) enseña cómo suena ese tipo. */
export function learnSound(kind, f, model = load(), id = null) {
  if (!model.on || !f || !kind || kind === 'libre') return model;
  if (id) { model.ids = model.ids || {}; if (model.ids[id]) return model; model.ids[id] = 1; }          // cada sonido enseña una sola vez
  const v = vec(f), k = model.kinds[kind] || (model.kinds[kind] = { n: 0, mean: v.map(() => 0), m2: v.map(() => 0) });
  k.n++; for (let i = 0; i < v.length; i++) { const d = v[i] - k.mean[i]; k.mean[i] += d / k.n; k.m2[i] += d * (v[i] - k.mean[i]); }   // Welford
  model.seen++; return save(model);
}
/** Un recorte enseña cuánto aire dejas antes del golpe (lead), después de la cola (tail) y qué fundido usas. */
export function learnTrim({ f, group, startMs, endMs, fadeMs }, model = load()) {
  if (!model.on || !f) return model;
  const lead = Math.max(-50, Math.min(400, f.onsetMs - startMs)), tail = Math.max(-300, Math.min(2000, endMs - f.endMs));
  const t = model.trim[group] || (model.trim[group] = { n: 0 });
  t.lead = ema(t.lead, lead, t.n); t.tail = ema(t.tail, tail, t.n); t.fade = ema(t.fade, Math.max(0, Math.min(200, fadeMs)), t.n); t.n++;
  model.seen++; return save(model);
}
/** Un loop enseña qué largo prefieres, cuántos tiempos dura, el fundido del empalme y si afinas el final. */
export function learnLoop({ group, lenSec, bpm, crossSec, refine }, model = load()) {
  if (!model.on || !(lenSec > 0)) return model;
  const l = model.loop[group] || (model.loop[group] = { n: 0, cross: {}, beats: {} });
  l.lenSec = ema(l.lenSec, lenSec, l.n); l.refine = ema(l.refine, refine ? 1 : 0, l.n);
  l.cross[crossSec] = (l.cross[crossSec] || 0) + 1;
  if (bpm > 0) { const b = Math.max(1, Math.round(lenSec * bpm / 60)); l.beats[b] = (l.beats[b] || 0) + 1; }
  l.n++; model.seen++; return save(model);
}

// ------------------------------------------------------------------------------------------------ sugerir
const mode = obj => { let best = null, bv = 0; for (const [k, v] of Object.entries(obj || {})) if (v > bv) { bv = v; best = k; } return best; };
const snap = (x, i) => nearestZeroCross(x, Math.max(0, Math.min(i, x.length - 2)), 256);

/** Recorte sugerido: arranca un poco antes del ataque y acaba tras la cola, con el aire y el fundido que sueles dejar. */
export function suggestTrim(x, rate, model = load()) {
  const f = features(x, rate); if (!f) return null;
  const st = styleOf(f, model), l = model.on && model.trim[st.group] && model.trim[st.group].n >= MIN_SEEN ? model.trim[st.group] : null, d = l || FACTORY.trim[st.group];
  const a = snap(x, Math.round((f.onsetMs - d.lead) / 1000 * rate)), b = Math.min(x.length, Math.round((f.endMs + d.tail) / 1000 * rate));
  if (b - a < rate * 0.02) return null;
  return { a, b, fadeMs: Math.round(d.fade), group: st.group, kind: st.kind, learned: l ? l.n : 0, f,
    why: `${st.group === 'golpe' ? 'Golpe' : 'Sonido sostenido'}: ${Math.round(d.lead)} ms antes del ataque y ${Math.round(d.tail)} ms tras la cola, fundido ${Math.round(d.fade)} ms${l ? ` (aprendido de ${l.n} recortes tuyos)` : ' (valores de fábrica: aún aprendo de ti)'}` };
}
/** Loop sugerido: parte la zona estable (después del ataque) en tiempos si hay pulso, o en el largo que sueles preferir; elige fundido y afinado como tú. */
export function suggestLoop(x, rate, { bpm = null, bpmConfidence = 0 } = {}, model = load()) {
  const f = features(x, rate); if (!f) return null;
  const st = styleOf(f, model), l = model.on && model.loop[st.group] && model.loop[st.group].n >= MIN_SEEN ? model.loop[st.group] : null;
  const startMs = f.onsetMs + (st.group === 'golpe' ? f.attackMs + 20 : Math.min(300, f.attackMs + 40)), availMs = f.endMs - startMs;
  if (availMs < 500) return null;
  let lenMs, how;
  if (bpm && bpmConfidence >= 0.25) {
    const beatMs = 60000 / bpm, pref = l ? +mode(l.beats) : 0, fit = [1, 2, 4, 8, 16, 32].filter(b => b * beatMs <= availMs);
    const beats = fit.includes(pref) ? pref : fit.length ? fit[fit.length - 1] : 0;
    if (beats) { lenMs = beats * beatMs; how = `${beats} tiempos a ${Math.round(bpm)} BPM${fit.includes(pref) ? ' (tu largo habitual)' : ''}`; }
  }
  let periodo = null;
  if (!lenMs) {      // sin pulso: ¿el sonido se repite solo? (histograma de desfases entre picos iguales, como en Shazam)
    const zone = x.subarray(Math.round(startMs / 1000 * rate), Math.min(x.length, Math.round(f.endMs / 1000 * rate))), rep = repetition(zone, rate, { minSec: 0.3, maxSec: Math.min(20, availMs / 1000) });
    const best = rep.find(r => r.sec * 1000 <= availMs);
    if (best) {
      let k = 1; while (best.sec * k < 1.0 && best.sec * (k + 1) * 1000 <= availMs) k++;          // al menos ~1 s: se juntan periodos enteros
      lenMs = best.sec * k * 1000; periodo = best.sec; how = `${(lenMs / 1000).toFixed(1).replace('.', ',')} s (${k === 1 ? 'un periodo' : k + ' periodos'}: se repite cada ${best.sec.toFixed(2).replace('.', ',')} s)`;
    }
  }
  if (!lenMs) { lenMs = Math.min(availMs, l ? l.lenSec * 1000 : availMs); how = l ? `${(lenMs / 1000).toFixed(1).replace('.', ',')} s (tu largo habitual)` : `${(lenMs / 1000).toFixed(1).replace('.', ',')} s de la zona estable`; }
  const a = snap(x, Math.round(startMs / 1000 * rate)); let b = Math.min(x.length, a + Math.round(lenMs / 1000 * rate)), seam = null;
  try {                // el final se afina por continuidad espectral: lo que sigue a b debe parecerse a lo que sigue a a
    const c = constellation(x, rate), r = refineLoopEnd(c, a, b, 0.1);
    if (r && r.score >= 0.3) { b = Math.min(x.length, snap(x, r.b)); seam = r.score; } else seam = r ? r.score : null;
  } catch (e) {}
  let crossSec = l && mode(l.cross) ? +mode(l.cross) : 1; crossSec = Math.max(0.5, Math.min(crossSec, (b - a) / rate / 4));
  const choices = [0.5, 1, 2, 4], cross = choices.reduce((p, c) => Math.abs(c - crossSec) < Math.abs(p - crossSec) ? c : p, 1);
  return { a, b, crossSec: cross, refine: l ? l.refine >= 0.5 : true, group: st.group, kind: st.kind, learned: l ? l.n : 0, seam, periodo, why: `Loop de ${how}${seam != null && seam >= 0 ? `, continuidad espectral ${Math.round(seam * 100)} %` : ''}, empalme de ${String(cross).replace('.', ',')} s${l ? ` (aprendido de ${l.n} loops tuyos)` : ' (valores de fábrica)'}` };
}

/** Frases para mostrar al usuario qué ha aprendido (transparencia). */
export function summary(model = load()) {
  const out = [];
  const kinds = Object.entries(model.kinds).filter(([, k]) => k.n > 0).map(([k, v]) => `${k} ${v.n}`);
  if (kinds.length) out.push('Sonidos con tipo vistos: ' + kinds.join(' · '));
  for (const [g, t] of Object.entries(model.trim)) if (t.n) out.push(`Recortes de ${g === 'golpe' ? 'golpes' : 'sonidos sostenidos'} (${t.n}): ${Math.round(t.lead)} ms antes del ataque, ${Math.round(t.tail)} ms tras la cola, fundido ${Math.round(t.fade)} ms`);
  for (const [g, l] of Object.entries(model.loop)) if (l.n) out.push(`Loops de ${g === 'golpe' ? 'golpes' : 'sonidos sostenidos'} (${l.n}): ~${l.lenSec.toFixed(1).replace('.', ',')} s${mode(l.beats) ? `, ${mode(l.beats)} tiempos` : ''}, empalme de ${String(mode(l.cross)).replace('.', ',')} s`);
  return out.length ? out : ['Aún no he aprendido nada: se llena solo cuando recortas, haces loops y guardas sonidos con tipo.'];
}

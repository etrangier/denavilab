// Laboratorio de pads: bucle sin clics, estirar, tono, filtros, reverb, saturación, capas y teclado (computador y MIDI).
// El mismo grafo de audio suena en vivo y se renderiza (OfflineAudioContext) para guardar el resultado como «procesado».
import { app, refreshSamples } from './state.js';
import { h, fill, btn, link, card, label, muted, sheet, toast, sliderRow, drawBars } from './ui.js';
import * as dsp from './dsp.js';
import { getAudio, putSample, newSample } from './store.js';
import { compute } from './work.js';

export const LAB = { maxLayers: 3, loopMs: [50, 500], stretches: [1, 2, 4, 8], pitch: [-24, 12], root: 60, renderRate: 48000, maxSeconds: 60 };
export const DEFAULTS = { loopMs: 200, stretch: 1, pitch: 0, hp: 0, lp: 100, mix: 0, decay: 3, sat: 0 };
const hpHz = v => v <= 0 ? 0 : Math.round(20 * Math.pow(100, v / 100));            // 0 = sin filtro; hasta 2 kHz
const lpHz = v => v >= 100 ? 0 : Math.round(200 * Math.pow(100, v / 100));         // 100 = sin filtro; desde 200 Hz
const ratioOf = semis => Math.pow(2, semis / 12);
export const noteName = n => ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'][((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

/** Bucle sin clic: el final se funde (potencia constante) con el inicio durante `ms`. El resultado empalma consigo mismo. */
export function crossLoop(x, rate, ms) {
  const F = Math.min(Math.round(ms / 1000 * rate), x.length >> 1);
  if (F < 16 || x.length < 64) return Float32Array.from(x);
  const L = x.length - F, out = new Float32Array(L);
  for (let i = 0; i < L; i++) out[i] = x[i];
  for (let i = 0; i < F; i++) { const t = (i + 0.5) / F, wi = Math.sin(t * Math.PI / 2), wo = Math.cos(t * Math.PI / 2); out[i] = x[i] * wi + x[L + i] * wo; }
  return out;
}
/** Qué tan brusco es el salto entre el final y el inicio (0 = invisible; >1 = se oye un clic). */
export const seamScore = x => dsp.seamJump(x);

/** Respuesta al impulso sintética: ruido que decae exponencialmente (estéreo, descorrelacionado). */
export function makeImpulse(ctx, seconds) {
  const n = Math.max(1, Math.round(ctx.sampleRate * seconds)), buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); let seed = 777 + c * 91; for (let i = 0; i < n; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; d[i] = ((seed / 2147483648) - 1) * Math.pow(1 - i / n, 3.2); } }
  return buf;
}
const satCurve = d => { const n = 1024, k = 1 + d * 12, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } return c; };

/** Cadena de efectos: entrada → saturación → pasa-altos → pasa-bajos → (seco + reverb) → salida. */
export function buildBus(ctx, dest) {
  const input = ctx.createGain(), sat = ctx.createWaveShaper(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), dry = ctx.createGain(), wet = ctx.createGain(), conv = ctx.createConvolver(), out = ctx.createGain();
  hp.type = 'highpass'; lp.type = 'lowpass';
  input.connect(sat); sat.connect(hp); hp.connect(lp); lp.connect(dry); lp.connect(conv); conv.connect(wet); dry.connect(out); wet.connect(out); out.connect(dest || ctx.destination);
  let decay = null;
  const set = p => {
    sat.curve = p.sat > 0 ? satCurve(p.sat / 100) : null; sat.oversample = '2x';
    const h0 = hpHz(p.hp), l0 = lpHz(p.lp);
    hp.frequency.value = h0 || 10; lp.frequency.value = l0 || Math.min(20000, ctx.sampleRate / 2 - 200);
    const m = Math.max(0, Math.min(1, p.mix / 100)); dry.gain.value = 1 - m * 0.5; wet.gain.value = m * 1.2;
    if (m > 0 && decay !== p.decay) { conv.buffer = makeImpulse(ctx, p.decay); decay = p.decay; }
    out.gain.value = p.sat > 0 ? 1 / (1 + p.sat / 100 * 0.6) : 1;                 // la saturación sube el nivel: se compensa un poco
  };
  return { input, set };
}

/** Qué se aplicó, en palabras, para anotarlo en el sonido guardado. */
export function describe(p, layers) {
  const o = [`bucle ${p.loopMs} ms`];
  if (p.stretch > 1) o.push(`estirar ×${p.stretch}`);
  if (p.pitch) o.push(`tono ${p.pitch > 0 ? '+' : ''}${p.pitch} st`);
  if (hpHz(p.hp)) o.push(`pasa-altos ${hpHz(p.hp)} Hz`);
  if (lpHz(p.lp)) o.push(`pasa-bajos ${lpHz(p.lp)} Hz`);
  if (p.mix > 0) o.push(`reverb ${p.mix} % (${p.decay} s)`);
  if (p.sat > 0) o.push(`saturación ${p.sat} %`);
  if (layers.length > 1) o.push('capas: ' + layers.map(l => `${l.name} (vol ${Math.round(l.vol * 100)} %${l.tune ? `, ${l.tune > 0 ? '+' : ''}${l.tune} st` : ''})`).join(' + '));
  return o;
}

/** Renderiza la mezcla lista para bucle: suena dos vueltas y se queda con la segunda (la cola de la reverb ya empalma). Devuelve Float32Array mono. */
export async function renderMix(layers, p, rate = LAB.renderRate) {
  const base = layers[0], baseDur = base.buf.length / base.rate / ratioOf(p.pitch + base.tune), len = Math.round(baseDur * rate);
  if (len < 64 || len / rate > LAB.maxSeconds) throw new Error('el resultado dura ' + (len / rate).toFixed(0) + ' s (máximo ' + LAB.maxSeconds + ' s)');
  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext, ctx = new Off(2, len * 2, rate), bus = buildBus(ctx);
  bus.set(p);
  for (const l of layers) {
    const b = ctx.createBuffer(1, l.buf.length, l.rate); b.copyToChannel(l.buf, 0);
    const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; s.loop = true; s.playbackRate.value = ratioOf(p.pitch + l.tune); g.gain.value = l.vol;
    s.connect(g); g.connect(bus.input); s.start(0);
  }
  const r = await ctx.startRendering(), a = r.getChannelData(0), c = r.numberOfChannels > 1 ? r.getChannelData(1) : a, out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = 0.5 * (a[len + i] + c[len + i]);
  return dsp.normalize(dsp.removeDC(out), Math.pow(10, -1 / 20));
}

const KEYS = 'awsedftgyhujk';

export async function openLab(sample) {
  const base = await getAudio(sample.id);
  if (!base.length) return toast('Esta grabación no tiene audio');
  const p = { ...DEFAULTS }, layers = [{ id: sample.id, name: sample.name, rate: sample.rate, raw: base, vol: 1, tune: 0, buf: null, key: '' }];
  let ctx = null, bus = null, octave = 0, midi = null, busy = 0;
  const voices = new Map(), held = new Set();
  const ensure = () => { if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); bus = buildBus(ctx); bus.set(p); } if (ctx.state === 'suspended') ctx.resume(); return ctx; };
  const say = t => { status.textContent = t; };

  // ----- preparar cada capa: estirar y luego cerrar el bucle -----
  async function prepare(l) {
    const key = p.stretch + '|' + p.loopMs; if (l.key === key && l.buf) return;
    const mine = l.tok = (l.tok || 0) + 1; busy++; say('Procesando…');
    try {
      let x = l.raw;
      if (p.stretch > 1) x = await compute('padStretch', [x, p.stretch, l.rate, true]);
      if (mine === l.tok) { l.buf = crossLoop(x, l.rate, p.loopMs); l.key = key; }
    } finally { busy--; }
    if (!busy) say('Listo');
  }
  const prepareAll = async () => { await Promise.all(layers.map(prepare)); paintSeam(); retune(); };

  // ----- voces (reproducción en vivo) -----
  function noteOn(note, vel = 1) {
    if (voices.has(note) || !layers[0].buf) return;
    const c = ensure(), now = c.currentTime, vs = [];
    for (const l of layers) {
      if (!l.buf) continue;
      const b = c.createBuffer(1, l.buf.length, l.rate); b.copyToChannel(l.buf, 0);
      const s = c.createBufferSource(), g = c.createGain(); s.buffer = b; s.loop = true; s.playbackRate.value = ratioOf(note - LAB.root + p.pitch + l.tune);
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(l.vol * vel, now + 0.02); s.connect(g); g.connect(bus.input); s.start(now); vs.push({ s, g, l, note });
    }
    voices.set(note, vs); paintKeys();
  }
  function noteOff(note) {
    const vs = voices.get(note); if (!vs) return; voices.delete(note);
    const now = ctx.currentTime;
    for (const v of vs) { v.g.gain.cancelScheduledValues(now); v.g.gain.setValueAtTime(v.g.gain.value, now); v.g.gain.linearRampToValueAtTime(0, now + 0.4); try { v.s.stop(now + 0.45); } catch (e) {} }
    paintKeys();
  }
  const allOff = () => { for (const n of [...voices.keys()]) noteOff(n); held.clear(); };
  const retune = () => { for (const vs of voices.values()) for (const v of vs) v.s.playbackRate.value = ratioOf(v.note - LAB.root + p.pitch + v.l.tune); };
  const applyBus = () => { if (bus) bus.set(p); };

  // ----- interfaz -----
  const status = h('span', { class: 'muted small', role: 'status', 'aria-live': 'polite' }, 'Preparando…');
  const seamCanvas = h('canvas', { class: 'wave small-wave', 'aria-label': 'Empalme del bucle: final seguido del inicio' }), seamInfo = h('small', { class: 'muted', 'aria-live': 'polite' });
  const paintSeam = () => {
    const b = layers[0].buf; if (!b) return;
    const W = Math.min(Math.round(0.4 * layers[0].rate), b.length >> 1), j = new Float32Array(2 * W); j.set(b.subarray(b.length - W), 0); j.set(b.subarray(0, W), W);
    drawBars(seamCanvas, dsp.peaks(j, 80), [0, 1], null, null, [0.5]);
    const sc = seamScore(b); seamInfo.textContent = sc < 0.6 ? `Empalme limpio (salto ${sc.toFixed(2)})` : `Se podría oír un clic (salto ${sc.toFixed(2)}): sube el fundido cruzado`;
  };
  const layerBox = h('div', { class: 'stack tight' }), keysBox = h('div', { class: 'labkeys', role: 'group', 'aria-label': 'Teclado en pantalla' });
  const paintLayers = () => {
    fill(layerBox, ...layers.map((l, i) => card([
      h('div', { class: 'between' }, h('b', {}, `Capa ${i + 1}: ${l.name}`), i ? link('Quitar', () => { layers.splice(i, 1); paintLayers(); prepareAll(); }) : null),
      sliderRow('Volumen', { min: 0, max: 100, step: 1, value: Math.round(l.vol * 100), fmt: v => v + ' %', onInput: v => { l.vol = v / 100; } }),
      sliderRow('Afinación', { min: -24, max: 24, step: 1, value: l.tune, fmt: v => (v > 0 ? '+' : '') + v + ' st', onInput: v => { l.tune = v; retune(); } })])),
      layers.length < LAB.maxLayers ? h('select', { class: 'field', 'aria-label': 'Añadir una capa', onchange: async e => {
        const s = app.samples.find(x => x.id === e.target.value); e.target.value = ''; if (!s) return;
        const raw = await getAudio(s.id); if (!raw.length) return toast('Esa grabación no tiene audio');
        layers.push({ id: s.id, name: s.name, rate: s.rate, raw, vol: 0.8, tune: 0, buf: null, key: '' }); paintLayers(); prepareAll();
      } }, h('option', { value: '' }, '＋ Añadir una capa…'), app.samples.filter(s => !layers.some(l => l.id === s.id)).map(s => h('option', { value: s.id }, s.name))) : muted(`Máximo ${LAB.maxLayers} capas.`, 'tiny'));
  };
  const keyEls = new Map();
  const paintKeys = () => { for (const [i, el] of keyEls) { el.setAttribute('aria-pressed', String(voices.has(noteFor(i)))); el.setAttribute('aria-label', 'Tocar ' + noteName(noteFor(i)) + ' (tecla ' + KEYS[i].toUpperCase() + ')'); } octLabel.textContent = 'Octava ' + (octave >= 0 ? '+' : '') + octave; };
  const octLabel = h('span', { class: 'amber small' });
  const keyBtn = i => { const el = h('button', { type: 'button', class: 'btn key', 'aria-pressed': 'false', 'aria-label': 'Tocar ' + noteName(LAB.root + octave * 12 + i) + ' (tecla ' + KEYS[i].toUpperCase() + ')' }, KEYS[i].toUpperCase()); keyEls.set(i, el);
    return el; };
  // la tecla i toca Do central + octava*12 + i
  const noteFor = i => LAB.root + octave * 12 + i;
  const keyMap = new Map(); // tecla física → nota que está sonando
  const playBtn = h('button', { type: 'button', class: 'btn amber', 'aria-pressed': 'false', 'data-act': 'lab-oir' }, '▶ Oír en bucle');
  let hearing = false;
  playBtn.onclick = () => { if (hearing) { noteOff(LAB.root); hearing = false; playBtn.textContent = '▶ Oír en bucle'; playBtn.setAttribute('aria-pressed', 'false'); return; } if (!layers[0].buf) return; noteOn(LAB.root, 1); hearing = true; playBtn.textContent = '■ Parar'; playBtn.setAttribute('aria-pressed', 'true'); };
  const seamBtn = btn('Oír el empalme', { small: true, act: 'lab-empalme', onclick: () => {
    const b = layers[0].buf; if (!b) return; const c = ensure(), W = Math.min(Math.round(0.6 * layers[0].rate), b.length >> 1), j = new Float32Array(2 * W);
    j.set(b.subarray(b.length - W), 0); j.set(b.subarray(0, W), W); const ab = c.createBuffer(1, j.length, layers[0].rate); ab.copyToChannel(j, 0);
    const s = c.createBufferSource(); s.buffer = ab; s.connect(bus.input); s.start(); } });

  const midiLine = h('small', { class: 'muted', 'aria-live': 'polite' }, 'MIDI desactivado');
  const midiBtn = btn('Activar MIDI', { small: true, act: 'lab-midi', onclick: async () => {
    if (!navigator.requestMIDIAccess) return (midiLine.textContent = 'Este navegador no tiene Web MIDI (en iPhone no está disponible; usa Chrome en el computador).');
    try {
      midi = await navigator.requestMIDIAccess();
      const hook = () => { const names = []; midi.inputs.forEach(i => { names.push(i.name); i.onmidimessage = m => { const [st, n, v] = m.data, cmd = st & 0xf0; if (cmd === 0x90 && v > 0) noteOn(n, v / 127); else if (cmd === 0x80 || (cmd === 0x90 && v === 0)) noteOff(n); }; });
        midiLine.textContent = names.length ? 'MIDI: ' + names.join(', ') : 'MIDI activo, pero no veo ningún teclado conectado'; };
      midi.onstatechange = hook; hook();
    } catch (e) { midiLine.textContent = 'No se pudo usar MIDI: ' + (e && e.name === 'SecurityError' ? 'permiso denegado' : (e.message || e)); }
  } });

  const nameIn = h('input', { type: 'text', class: 'field name', 'aria-label': 'Nombre del resultado', value: sample.name + ' pad' });
  const saveBtn = btn('Guardar como nuevo sonido', { kind: 'amber', act: 'lab-guardar', onclick: async () => {
    saveBtn.disabled = true; say('Renderizando…');
    try {
      await prepareAll();
      const out = await renderMix(layers, p), proc = describe(p, layers);
      const srcs = layers.map(l => app.samples.find(s => s.id === l.id)).filter(Boolean);
      const origins = [...new Set(srcs.map(s => s.origin).filter(Boolean))].join(' + ');
      const tags = [...new Set(srcs.flatMap(s => s.tags || []))];
      const prev = sample.process && sample.process.length ? sample.process : [];
      const ns = newSample(nameIn.value.trim() || sample.name + ' pad', out, LAB.renderRate, { folder: sample.folder, subfolder: sample.subfolder || null, status: 'procesado', origin: origins || sample.origin || '', tags, key: sample.key || null, bpm: sample.bpm || null, comment: 'Laboratorio de pads. Original: ' + sample.name + (sample.comment ? ' · ' + sample.comment : ''), process: [...prev, ...proc] });
      await putSample(ns, out); await refreshSamples();
      toast(`Guardado como procesado: ${ns.name} · ${dsp.stamp(out.length / LAB.renderRate)}${out.length / LAB.renderRate > 6 ? ' · dura más de 6 s' : ''}`); say('Guardado');
    } catch (err) { toast(err && err.name === 'QuotaExceededError' ? 'No hay espacio para guardar el resultado.' : 'No se pudo renderizar: ' + ((err && err.message) || err)); say('Error'); }
    saveBtn.disabled = false;
  } });

  let deb = 0; const later = fn => { clearTimeout(deb); deb = setTimeout(fn, 250); };

  // teclado del computador
  const onKeyDown = e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target; if (t && (/^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === 'INPUT' && t.type !== 'range'))) return;
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'x') { octave = Math.max(-3, Math.min(3, octave + (k === 'x' ? 1 : -1))); paintKeys(); return; }
    const i = KEYS.indexOf(k); if (i < 0 || keyMap.has(k)) return;
    e.preventDefault(); const n = noteFor(i); keyMap.set(k, n); noteOn(n, 0.9);
  };
  const onKeyUp = e => { const k = e.key.toLowerCase(); if (keyMap.has(k)) { noteOff(keyMap.get(k)); keyMap.delete(k); } };

  return sheet(close => {
    paintLayers();
    for (let i = 0; i < 13; i++) { const el = keyBtn(i); const down = e => { e.preventDefault(); const n = noteFor(i); el.dataset.n = n; noteOn(n, 0.9); }; const up = () => { if (el.dataset.n) { noteOff(+el.dataset.n); delete el.dataset.n; } };
      el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up); el.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) down(e); } }); el.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') up(); }); keysBox.append(el); }
    document.addEventListener('keydown', onKeyDown); document.addEventListener('keyup', onKeyUp); window.addEventListener('blur', allOff);
    paintKeys(); prepareAll().then(() => say('Listo'));
    return h('div', { class: 'stack lab' },
      h('div', { class: 'title-row' }, h('div', {}, h('h2', {}, 'Laboratorio de pads'), h('p', { class: 'muted small' }, 'Prueba y escucha en tiempo real; nada se guarda hasta que lo pidas.')), link('Cerrar', close)),
      h('div', { class: 'row-gap' }, playBtn, status),
      label('Capas (hasta 3)'), layerBox,
      label('Bucle sin clics'),
      sliderRow('Fundido cruzado', { min: LAB.loopMs[0], max: LAB.loopMs[1], step: 10, value: p.loopMs, fmt: v => v + ' ms', onInput: v => { p.loopMs = v; }, onChange: () => later(prepareAll) }),
      card([seamCanvas, seamInfo, seamBtn]),
      label('Estirar (mantiene el tono)'),
      h('div', { class: 'row4', role: 'group', 'aria-label': 'Estirar' }, LAB.stretches.map(n => { const b = btn('×' + n, { small: true, sel: p.stretch === n, onclick: async () => { p.stretch = n; for (const x of b.parentNode.children) x.classList.toggle('sel', x === b); for (const x of b.parentNode.children) x.setAttribute('aria-pressed', String(x === b)); await prepareAll(); } }); b.setAttribute('aria-pressed', String(p.stretch === n)); return b; })),
      muted('El estirado es granular con fases al azar: va muy bien en pads y texturas; los golpes pierden su ataque. Con ×8 y una toma larga puede tardar unos segundos.', 'tiny'),
      label('Tono'),
      sliderRow('Cambio de tono', { min: LAB.pitch[0], max: LAB.pitch[1], step: 1, value: p.pitch, fmt: v => (v > 0 ? '+' : '') + v + ' st', onInput: v => { p.pitch = v; retune(); } }),
      muted('Es como cambiar la velocidad de un vinilo: al bajar el tono el sonido dura más.', 'tiny'),
      label('Filtros'),
      sliderRow('Pasa-altos', { min: 0, max: 100, step: 1, value: p.hp, fmt: v => hpHz(v) ? hpHz(v) + ' Hz' : 'apagado', onInput: v => { p.hp = v; applyBus(); } }),
      sliderRow('Pasa-bajos', { min: 0, max: 100, step: 1, value: p.lp, fmt: v => lpHz(v) ? lpHz(v) + ' Hz' : 'apagado', onInput: v => { p.lp = v; applyBus(); } }),
      label('Reverb larga'),
      sliderRow('Mezcla', { min: 0, max: 100, step: 1, value: p.mix, fmt: v => v + ' %', onInput: v => { p.mix = v; applyBus(); } }),
      sliderRow('Largo', { min: 0.5, max: 8, step: 0.5, value: p.decay, fmt: v => String(v).replace('.', ',') + ' s', onInput: v => { p.decay = v; later(applyBus); } }),
      label('Saturación'),
      sliderRow('Cantidad', { min: 0, max: 100, step: 1, value: p.sat, fmt: v => v + ' %', onInput: v => { p.sat = v; applyBus(); } }),
      label('Tocarlo como instrumento'),
      muted('Teclas A W S E D F T G Y H U J K (Z y X cambian de octava). Mantén para sostener. La primera tecla es el sonido tal cual.', 'tiny'),
      keysBox, h('div', { class: 'row-gap' }, octLabel, btn('Octava −', { small: true, onclick: () => { octave = Math.max(-3, octave - 1); paintKeys(); } }), btn('Octava +', { small: true, onclick: () => { octave = Math.min(3, octave + 1); paintKeys(); } })),
      h('div', { class: 'row-gap' }, midiBtn, midiLine),
      label('Guardar'), nameIn, saveBtn,
      muted('Guarda un archivo nuevo y deja el original intacto. El resultado queda como «procesado», con el origen y la lista de procesos. Está pensado para bucle: no lleva fundidos en los bordes.', 'tiny'));
  }, { onClose: () => { allOff(); document.removeEventListener('keydown', onKeyDown); document.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', allOff); try { ctx && ctx.close(); } catch (e) {} } });
}

// Modo materia prima: de una toma de 10–15 s se elige un fragmento de 2–5 s (con bucle para oírlo) y se guarda como «crudo» con su origen.
import { app, refreshSamples } from './state.js';
import { h, mount, fill, btn, link, card, label, muted, sheet, toast, drawBars } from './ui.js';
import * as dsp from './dsp.js';
import { putSample, newSample } from './store.js';
import { koPrepare, koLevel } from './koprep.js';
import { declick, dehum, findHum, clickRate } from './restore.js';

export const TAKE_SECONDS = 15, SOFT_LIMIT = 6, MIN_FRAGMENT = 0.1;

/** Ventana de `sec` segundos con más energía (donde suele estar lo bueno); devuelve [inicio, fin] en fracción 0–1. */
export function bestWindow(x, rate, sec) {
  const n = x.length, w = Math.min(n, Math.round(sec * rate));
  if (w >= n) return [0, 1];
  const blk = Math.round(rate * 0.05), e = [];
  for (let i = 0; i + blk <= n; i += blk) { let s = 0; for (let j = i; j < i + blk; j++) s += x[j] * x[j]; e.push(s); }
  const k = Math.max(1, Math.round(w / blk)); let cur = 0, best = 0, at = 0;
  for (let i = 0; i < e.length; i++) { cur += e[i]; if (i >= k) cur -= e[i - k]; if (i >= k - 1 && cur > best) { best = cur; at = i - k + 1; } }
  const a = at * blk; return [a / n, Math.min(1, (a + w) / n)];
}
/** Salida larga: hasta 1,5 s y como mucho un tercio del fragmento, para que una textura se apague en vez de quedar cortada. */
export const longFadeSec = lenSec => Math.min(1.5, lenSec / 3);
/** Recorta [a,b] (fracciones), quita continua y suaviza los bordes para que el bucle y el corte no hagan clic.
 *  opts: {longFade, declick, dehum} (declick: 'soft'|'strong'|false; dehum: lo que devolvió findHum, o true para detectarlo). */
export function cutFragment(x, rate, a, b, opts = {}) {
  const i = Math.max(0, Math.floor(a * x.length)), j = Math.min(x.length, Math.ceil(b * x.length));
  let y = dsp.removeDC(x.slice(i, j));
  if (opts.dehum) y = dehum(y, rate, opts.dehum === true ? undefined : opts.dehum).audio;
  if (opts.declick) y = declick(y, rate, opts.declick === true ? 'soft' : opts.declick).audio;
  const out = opts.longFade ? Math.round(longFadeSec(y.length / rate) * rate) : Math.round(0.02 * rate);
  return dsp.cosFade(y, Math.round((opts.longFade ? 0.01 : 0.005) * rate), out);
}
const storeError = err => err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message))) ? 'No se pudo guardar: el dispositivo se quedó sin espacio. Libera espacio o borra sonidos viejos.' : 'No se pudo guardar el sonido (' + ((err && err.message) || 'error desconocido') + ').';

/** Hoja de recorte. `take` es la toma completa (Float32Array mono). */
export function openMateria(take0, rate0) {
  const { audio: take, rate } = koPrepare(take0, rate0);         // «listo para el K.O. II»: a 46 875 Hz
  const total = take.length / rate, pk = dsp.peaks(take, 120);
  const [a0, b0] = bestWindow(take, rate, Math.min(4, total));
  const ed = { start: a0, end: b0 }; let src = null, ctx = null, raf = 0, t0 = 0;
  const kindKey = (() => { try { return JSON.parse(localStorage.getItem('denavilab.sounds.kind')) || 'libre'; } catch (e) { return 'libre'; } })();
  return sheet(close => {
    const canvas = h('canvas', { class: 'wave', 'aria-label': 'Forma de onda de la toma' });
    const wrap = h('div', { class: 'wave-edit card' }, canvas), info = h('div', { class: 'between small bold' }), warn = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' });
    const durOf = () => (ed.end - ed.start) * total;
    const live = () => { if (src) { src.loopStart = ed.start * total; src.loopEnd = ed.end * total; } };
    const layout = () => {
      hs.style.left = `calc(14px + (100% - 28px) * ${ed.start})`; he.style.left = `calc(14px + (100% - 28px) * ${ed.end})`;
      hs.setAttribute('aria-valuetext', dsp.stamp(ed.start * total)); he.setAttribute('aria-valuetext', dsp.stamp(ed.end * total));
      drawBars(canvas, pk, [ed.start, ed.end], playhead());
      fill(info, h('span', {}, dsp.stamp(ed.start * total)), h('span', { class: 'amber' }, 'Fragmento: ' + dsp.stamp(durOf())), h('span', {}, dsp.stamp(ed.end * total)));
      const d = durOf();
      warn.textContent = d > SOFT_LIMIT ? `Dura ${d.toFixed(1).replace('.', ',')} s: más de ${SOFT_LIMIT} s. Puedes guardarla igual, pero para una textura del K.O. II conviene acortar.` : d < 2 ? 'Menos de 2 s: sirve para golpes; para un pad, mejor 2 a 5 s.' : '';
      warn.className = 'small ' + (d > SOFT_LIMIT ? 'warn-text' : 'muted');
    };
    const playhead = () => { if (!src || !ctx) return null; const len = ed.end - ed.start; if (len <= 0) return null; const t = ((ctx.currentTime - t0) % (len * total)); return ed.start + t / total; };
    const handle = which => {
      const el = h('div', { class: 'handle', role: 'slider', tabindex: '0', 'aria-label': which === 'start' ? 'Marcador de inicio' : 'Marcador de final', 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(total * 100) / 100) }, h('i'));
      const set = f => { const minF = MIN_FRAGMENT / total; if (which === 'start') ed.start = Math.max(0, Math.min(f, ed.end - minF)); else ed.end = Math.min(1, Math.max(f, ed.start + minF)); live(); layout(); };
      el.addEventListener('pointerdown', ev => { el.setPointerCapture(ev.pointerId); el.dataset.drag = '1'; });
      el.addEventListener('pointerup', () => { delete el.dataset.drag; });
      el.addEventListener('pointermove', ev => { if (!el.dataset.drag) return; const r = canvas.getBoundingClientRect(); set(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))); });
      el.addEventListener('keydown', ev => { const step = (ev.shiftKey ? 0.1 : 0.01) / Math.max(1, total / 10) , d = ev.key === 'ArrowLeft' ? -step : ev.key === 'ArrowRight' ? step : 0; if (!d) return; ev.preventDefault(); set((which === 'start' ? ed.start : ed.end) + d); });
      return el;
    };
    const hs = handle('start'), he = handle('end'); mount(wrap, hs, he);
    const playBtn = h('button', { type: 'button', class: 'btn', 'aria-pressed': 'false', 'data-act': 'bucle' }, '▶ Escuchar en bucle');
    const stop = () => { if (src) { try { src.stop(); } catch (e) {} src = null; } cancelAnimationFrame(raf); playBtn.textContent = '▶ Escuchar en bucle'; playBtn.setAttribute('aria-pressed', 'false'); layout(); };
    const tick = () => { layout(); raf = requestAnimationFrame(tick); };
    playBtn.onclick = () => {
      if (src) return stop();
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume();
        const buf = ctx.createBuffer(1, take.length, rate); buf.copyToChannel(take, 0);
        src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.loopStart = ed.start * total; src.loopEnd = ed.end * total; src.connect(ctx.destination);
        t0 = ctx.currentTime; src.start(0, ed.start * total); playBtn.textContent = '■ Parar'; playBtn.setAttribute('aria-pressed', 'true'); tick();
      } catch (e) { src = null; toast('No se pudo reproducir'); }
    };
    const crk = clickRate(take, rate), hum = findHum(take, rate), prefs = { longFade: true, declick: crk > 1, dehum: !!hum };
    const opt = (title, sub, key, act) => { const cb = h('input', { type: 'checkbox', 'data-act': act, checked: prefs[key] ? '' : null, onchange: () => { prefs[key] = cb.checked; } }); cb.checked = !!prefs[key]; return h('div', { class: 'card opt-row' }, h('span', {}, h('b', {}, title), h('br', {}), h('span', { class: 'muted small' }, sub)), cb); };
    const restoreBox = h('div', { class: 'stack tight' },
      opt('Fade-out largo', 'La textura se apaga en vez de quedar cortada (hasta 1,5 s)', 'longFade', 'fade-largo'),
      opt('Quitar crujidos de vinilo', crk > 1 ? `Detecté unos ${Math.round(crk)} clics por segundo` : 'No detecté crujidos; actívalo si los oyes', 'declick', 'quitar-crujidos'),
      opt('Quitar zumbido', hum ? `Detecté zumbido de ${hum.hz} Hz y sus armónicos` : 'No detecté zumbido de 50 o 60 Hz', 'dehum', 'quitar-zumbido'));
    const name = h('input', { type: 'text', class: 'field name', 'aria-label': 'Nombre', placeholder: dsp.autoName(app.samples.length, (dsp.SOUND_KINDS[kindKey] || dsp.SOUND_KINDS.libre).prefix) });
    const origin = h('input', { type: 'text', class: 'field', 'aria-label': 'Origen del sonido', maxlength: '200', placeholder: 'Artista, disco, minuto… o «mi balcón», «piano de casa»' });
    const save = btn('Guardar como crudo', { kind: 'amber', act: 'guardar-crudo', onclick: async () => {
      stop(); save.disabled = true;
      try {
        const out = koLevel(cutFragment(take, rate, ed.start, ed.end, { longFade: prefs.longFade, declick: prefs.declick && (crk > 6 ? 'strong' : 'soft'), dehum: prefs.dehum && (hum || false) }), rate), kind = kindKey !== 'libre' && dsp.SOUND_KINDS[kindKey] ? { kind: kindKey } : {};
        await putSample(newSample(name.value.trim() || name.placeholder, out, rate, { status: 'crudo', origin: origin.value.trim(), ...kind }), out);
        await refreshSamples(); toast(`Guardada como crudo · ${dsp.stamp(out.length / rate)}` + (origin.value.trim() ? '' : ' · falta el origen (Detalles)'));
      } catch (err) { toast(storeError(err)); save.disabled = false; return; }
      close(); app.render();
    } });
    setTimeout(layout, 30);
    return h('div', { class: 'stack' },
      h('div', { class: 'title-row' }, h('div', {}, h('h2', {}, 'Elige el fragmento'), h('p', { class: 'muted small' }, `Toma de ${dsp.stamp(total)} · arrastra los marcadores (o usa ← →)`)), link('Descartar', close)),
      wrap, info, warn, playBtn, restoreBox,
      label('Origen'), origin, label('Nombre'), name, save,
      muted('Se guarda solo el fragmento (con lo que actives arriba) y su volumen se nivela. Queda como «crudo» para trabajarlo después.', 'tiny'));
  }, { onClose: () => { try { src && src.stop(); } catch (e) {} cancelAnimationFrame(raf); } });
}

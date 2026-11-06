// Hoja «Efectos de carácter»: los cinco efectos estilo SP-404MKII, con explicación, ajustes, preajustes, escucha previa y aplicar (deshacible).
import { h, fill, btn, link, chip, card, label, muted, sheet, toast, sliderRow, toggleRow } from './ui.js';
import * as dsp from './dsp.js';
import { FX, FX_ORDER, fxDefaults, fxParams, describeFx } from './fx404.js';
import { compute } from './work.js';

const KEY = 'denavilab.sounds.fx404';
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} };

/** `audio` es la toma actual; `onApply(salida, etiqueta)` recibe el resultado ya procesado (mismo largo). */
export function openFx(audio, rate, onApply) {
  const mem = load(), st = { id: FX[mem.id] ? mem.id : FX_ORDER[0], busy: false, src: null, ctx: null };
  const P = id => fxParams(id, (mem.p || {})[id]);
  const params = {}; for (const id of FX_ORDER) params[id] = P(id);
  const persist = () => save({ id: st.id, p: params });
  return sheet(close => {
    const box = h('div', { class: 'stack' }), status = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
    const stop = () => { if (st.src) { try { st.src.onended = null; st.src.stop(); } catch (e) {} st.src = null; } };
    const run = async () => {
      const id = st.id, p = { ...params[id] };
      return compute('fx404', [id, audio, rate, p]);
    };
    const preview = async () => {
      if (st.busy) return; stop(); st.busy = true; status.textContent = 'Procesando…'; paint();
      try {
        const out = await run(); st.busy = false; status.textContent = 'Escuchando el resultado (no se ha aplicado)'; paint();
        st.ctx = st.ctx || new (window.AudioContext || window.webkitAudioContext)(); st.ctx.resume();
        const b = st.ctx.createBuffer(1, out.length, rate); b.copyToChannel(out, 0);
        const s = st.ctx.createBufferSource(); s.buffer = b; s.connect(st.ctx.destination); s.onended = () => { if (st.src === s) { st.src = null; status.textContent = ''; } }; st.src = s; s.start();
      } catch (e) { st.busy = false; status.textContent = ''; paint(); toast('No se pudo procesar: ' + ((e && e.message) || e)); }
    };
    const applyIt = async () => {
      if (st.busy) return; stop(); st.busy = true; status.textContent = 'Aplicando…'; paint();
      try { const id = st.id, p = { ...params[id] }, out = await run(); st.busy = false; onApply(out, FX[id].name, describeFx(id, p)); close(); }
      catch (e) { st.busy = false; status.textContent = ''; paint(); toast('No se pudo aplicar: ' + ((e && e.message) || e)); }
    };
    const control = (id, q) => {
      const p = params[id];
      if (q.kind === 'range') return sliderRow(q.label, { min: q.min, max: q.max, step: q.step, value: p[q.k], fmt: v => String(Math.round(v * 100) / 100).replace('.', ',') + (q.unit || ''), onInput: v => { p[q.k] = v; persist(); } });
      if (q.kind === 'bool') return toggleRow(q.label, 'Deja la voz sin inflexión, siempre en la misma nota', p[q.k], v => { p[q.k] = v; persist(); });
      return h('div', { class: 'stack tight' }, label(q.label), h('div', { class: 'wrap', role: 'group', 'aria-label': q.label }, q.options.map((o, i) => chip(o, p[q.k] === i, () => { p[q.k] = i; persist(); paint(); }))));
    };
    function paint() {
      const id = st.id, fx = FX[id];
      fill(box,
        h('div', { class: 'title-row' }, h('div', {}, h('h2', {}, 'Efectos de carácter'), h('p', { class: 'muted small' }, 'Inspirados en la SP-404MKII · se aplican antes de compartir el sonido')), link('Cerrar', () => { stop(); close(); })),
        h('div', { class: 'wrap', role: 'group', 'aria-label': 'Efecto' }, FX_ORDER.map(k => chip(FX[k].name, k === id, () => { st.id = k; persist(); paint(); }))),
        card([h('b', {}, fx.name), h('p', { class: 'small' }, fx.about), h('p', { class: 'muted small' }, 'Para tu estilo: ' + fx.uso),
          h('details', {}, h('summary', {}, 'Cómo se produce'), h('p', { class: 'muted small' }, fx.how))]),
        label('Preajustes'),
        h('div', { class: 'wrap' }, fx.presets.map(([n, v]) => chip(n, false, () => { params[id] = fxParams(id, v); persist(); paint(); }))),
        ...fx.params.map(q => control(id, q)),
        h('div', { class: 'row2' }, btn(st.busy ? 'Procesando…' : '▶ Escuchar', { act: 'fx-escuchar', disabled: st.busy, onclick: preview }), btn('Restablecer', { small: true, onclick: () => { params[id] = fxDefaults(id); persist(); paint(); } })),
        btn('Aplicar al sonido', { kind: 'amber', act: 'fx-aplicar', disabled: st.busy, onclick: applyIt }), status,
        muted(`Se aplica a toda la toma (${dsp.stamp(audio.length / rate)}) y puedes deshacerlo desde el historial de Editar. Mismo largo que el original.` + (id === 'autopitch' ? ' Funciona con una sola voz o instrumento; en acordes sale mal.' : ''), 'tiny'));
    }
    paint(); return box;
  }, { onClose: () => { try { st.src && st.src.stop(); st.ctx && st.ctx.close(); } catch (e) {} } });
}

// Hoja «Cadena de efectos»: ordena hasta 8 efectos, cambia sus ajustes, mezcla otro sonido, escucha original/procesado,
// tira los dados para sacar variaciones y aplica el resultado (deshacible) o lo guarda como sonido nuevo.
import { h, fill, btn, link, chip, card, label, muted, sheet, toast, sliderRow, toggleRow, promptSheet } from './ui.js';
import * as dsp from './dsp.js';
import { ALL, ALL_ORDER, FAMILIES, MAX_SLOTS, CHAIN_PRESETS, STYLES, newSlot, cleanChain, describeChain, defaultsOf, paramsOf, randomChain } from './fxall.js';
import { compute } from './work.js';

const K_CHAIN = 'denavilab.sounds.fxChain', K_USER = 'denavilab.sounds.fxChains';
const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

/** ctx: { audio, rate, bpm, name, samples:[{id,name}], loadAudio(id)→{audio,rate}, onApply(out, label, notes), onSaveNew(out, notes), onSaveVariants([{out, notes}]) } */
export function openRack(ctx) {
  const st = { chain: cleanChain(read(K_CHAIN, [])), open: 0, busy: false, src: null, audioCtx: null, style: 'libre', intensity: 50, seed: Date.now() % 100000, user: read(K_USER, {}) };
  if (!st.chain.length) st.chain = [newSlot('cassette')];
  const persist = () => write(K_CHAIN, st.chain);
  return sheet(close => {
    const box = h('div', { class: 'stack' }), status = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
    const stop = () => { if (st.src) { try { st.src.onended = null; st.src.stop(); } catch (e) {} st.src = null; } };
    const layersFor = async chain => { const o = {}; for (const s of chain) if (s.id === 'layer' && !s.bypass && s.ref) { try { o[s.ref] = await ctx.loadAudio(s.ref); } catch (e) {} } return o; };
    const render = async chain => compute('fxChain', [chain, ctx.audio, ctx.rate, await layersFor(chain)]);
    const sayLen = out => `${dsp.stamp(out.length / ctx.rate)}${out.length / ctx.rate > 6.05 ? ' · dura más de 6 s' : ''}`;
    const play = async which => {
      if (st.busy) return; stop();
      const chain = cleanChain(st.chain); st.busy = true; status.textContent = which === 'orig' ? '' : 'Procesando…'; paint();
      try {
        const out = which === 'orig' ? ctx.audio : await render(chain);
        st.busy = false; status.textContent = which === 'orig' ? 'Escuchando el original' : `Escuchando el procesado (${sayLen(out)}) · aún no se ha aplicado`; paint();
        st.audioCtx = st.audioCtx || new (window.AudioContext || window.webkitAudioContext)(); st.audioCtx.resume();
        const b = st.audioCtx.createBuffer(1, out.length, ctx.rate); b.copyToChannel(out, 0);
        const s = st.audioCtx.createBufferSource(); s.buffer = b; s.connect(st.audioCtx.destination); s.onended = () => { if (st.src === s) { st.src = null; status.textContent = ''; } }; st.src = s; s.start();
      } catch (e) { st.busy = false; status.textContent = ''; paint(); toast('No se pudo procesar: ' + ((e && e.message) || e)); }
    };
    const finalize = async fn => {
      if (st.busy) return; const active = cleanChain(st.chain).filter(s => !s.bypass);
      if (!active.length) return toast('Todos los efectos están apagados: no hay nada que aplicar');
      stop(); st.busy = true; status.textContent = 'Procesando…'; paint();
      try { const chain = cleanChain(st.chain), out = await render(chain); st.busy = false; await fn(out, describeChain(chain), chain); }
      catch (e) { st.busy = false; status.textContent = ''; paint(); toast('No se pudo procesar: ' + ((e && e.message) || e)); }
    };
    const saveVariants = async () => {
      if (st.busy) return; stop(); st.busy = true; paint(); const list = [];
      try {
        for (let i = 0; i < 4; i++) {
          status.textContent = `Variante ${i + 1} de 4…`;
          const chain = randomChain(st.seed + i * 977, { style: st.style, intensity: st.intensity / 100, bpm: ctx.bpm }), out = await render(chain);
          list.push({ out, notes: describeChain(chain), style: STYLES[st.style].name });
        }
        st.busy = false; await ctx.onSaveVariants(list); status.textContent = 'Guardadas 4 variantes como sonidos nuevos (procesados)'; paint();
      } catch (e) { st.busy = false; status.textContent = ''; paint(); toast('No se pudieron generar las variantes: ' + ((e && e.message) || e)); }
    };
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= st.chain.length) return; [st.chain[i], st.chain[j]] = [st.chain[j], st.chain[i]]; st.open = j; persist(); paint(); };
    const control = (slot, q) => {
      const p = slot.params;
      if (q.kind === 'range') return sliderRow(q.label, { min: q.min, max: q.max, step: q.step, value: p[q.k], fmt: v => String(Math.round(v * 100) / 100).replace('.', ',') + (q.unit || ''), onInput: v => { p[q.k] = v; persist(); } });
      if (q.kind === 'bool') return toggleRow(q.label, q.hint || '', p[q.k], v => { p[q.k] = v; persist(); });
      return h('div', { class: 'stack tight' }, label(q.label), h('div', { class: 'wrap', role: 'group', 'aria-label': q.label }, q.options.map((o, i) => chip(o, p[q.k] === i, () => { p[q.k] = i; persist(); paint(); }))));
    };
    const slotCard = (s, i) => {
      const isLayer = s.id === 'layer', def = isLayer ? null : ALL[s.id], opened = st.open === i, name = isLayer ? `Mezcla con «${s.name || 'otro sonido'}»` : def.name;
      return h('div', { class: 'card slot' + (s.bypass ? ' off' : ''), 'data-slot': String(i) },
        h('div', { class: 'between' },
          h('button', { type: 'button', class: 'slot-name', 'aria-expanded': String(opened), 'aria-label': `${i + 1}. ${name}${s.bypass ? ' (apagado)' : ''}: ${opened ? 'cerrar' : 'ajustar'}`, onclick: () => { st.open = opened ? -1 : i; paint(); } }, h('b', {}, `${i + 1}. ${name}`), h('small', { class: 'muted' }, s.bypass ? ' · apagado' : '')),
          h('span', { class: 'row-gap' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-pressed': String(!s.bypass), 'aria-label': (s.bypass ? 'Encender ' : 'Apagar ') + name, onclick: () => { s.bypass = !s.bypass; persist(); paint(); } }, s.bypass ? '○' : '●'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Subir ' + name, disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Bajar ' + name, disabled: i === st.chain.length - 1, onclick: () => move(i, 1) }, '↓'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Quitar ' + name, onclick: () => { st.chain.splice(i, 1); st.open = Math.min(st.open, st.chain.length - 1); persist(); paint(); } }, '✕'))),
        opened ? h('div', { class: 'stack' },
          isLayer ? sliderRow('Nivel del otro sonido', { min: 0, max: 100, step: 1, value: s.gain, fmt: v => v + ' %', onInput: v => { s.gain = v; persist(); } })
            : [h('p', { class: 'small' }, def.about), h('details', {}, h('summary', {}, 'Cómo se produce'), h('p', { class: 'muted small' }, def.how)), h('p', { class: 'muted small' }, 'Para tu estilo: ' + def.uso),
              h('div', { class: 'wrap' }, def.presets.map(([n, v]) => chip(n, false, () => { s.params = paramsOf(s.id, v); persist(); paint(); }))),
              ...def.params.map(q => control(s, q)), btn('Restablecer este efecto', { small: true, onclick: () => { s.params = defaultsOf(s.id); persist(); paint(); } })]) : null);
    };
    function paint() {
      const full = st.chain.length >= MAX_SLOTS, others = (ctx.samples || []);
      fill(box,
        h('div', { class: 'title-row' }, h('div', {}, h('h2', {}, 'Cadena de efectos'), h('p', { class: 'muted small' }, 'Se aplican de arriba abajo · ' + ctx.name)), link('Cerrar', () => { stop(); close(); })),
        label(`La cadena (${st.chain.length} de ${MAX_SLOTS})`),
        st.chain.length ? h('div', { class: 'stack tight' }, st.chain.map(slotCard)) : muted('Vacía: añade un efecto abajo.'),
        label('Añadir un efecto'),
        full ? muted(`Máximo ${MAX_SLOTS} efectos.`, 'small') : h('div', { class: 'stack tight' }, FAMILIES.map(f => { const ids = ALL_ORDER.filter(id => ALL[id].family === f); return ids.length ? h('div', { class: 'wrap', role: 'group', 'aria-label': 'Efectos de ' + f }, h('small', { class: 'muted fam' }, f), ids.map(id => chip(ALL[id].name, false, () => { st.chain.push(newSlot(id, ctx.bpm && 'bpm' in defaultsOf(id) ? { bpm: Math.round(ctx.bpm) } : {})); st.open = st.chain.length - 1; persist(); paint(); }))) : null; })),
        !full && others.length ? h('select', { class: 'field', 'aria-label': 'Mezclar con otro sonido', onchange: e => { const o = others.find(x => x.id === e.target.value); e.target.value = ''; if (o) { st.chain.push({ id: 'layer', ref: o.id, name: o.name, gain: 70, bypass: false }); st.open = st.chain.length - 1; persist(); paint(); } } },
          h('option', { value: '' }, '＋ Mezclar con otro sonido…'), others.map(o => h('option', { value: o.id }, o.name))) : null,
        label('Cadenas guardadas'),
        h('div', { class: 'wrap' }, CHAIN_PRESETS.map(([n, c]) => chip(n, false, () => { st.chain = cleanChain(JSON.parse(JSON.stringify(c))); st.open = 0; persist(); paint(); })),
          Object.keys(st.user).map(n => chip('★ ' + n, false, () => { st.chain = cleanChain(JSON.parse(JSON.stringify(st.user[n]))); st.open = 0; persist(); paint(); }))),
        h('div', { class: 'row2' }, btn('Guardar esta cadena…', { small: true, act: 'rack-guardar-cadena', onclick: async () => { const n = await promptSheet({ title: 'Guardar la cadena', message: 'Ponle un nombre para encontrarla luego.', value: '' }); if (n && n.trim()) { st.user[n.trim().slice(0, 30)] = cleanChain(st.chain); write(K_USER, st.user); paint(); toast('Cadena guardada: ' + n.trim()); } } }),
          Object.keys(st.user).length ? btn('Borrar una guardada…', { small: true, onclick: async () => { const n = await promptSheet({ title: 'Borrar una cadena guardada', message: 'Escribe su nombre: ' + Object.keys(st.user).join(', '), value: '', ok: 'Borrar' }); if (n && st.user[n.trim()]) { delete st.user[n.trim()]; write(K_USER, st.user); paint(); } } }) : null),
        label('Sorpréndeme'),
        h('div', { class: 'wrap', role: 'group', 'aria-label': 'Estilo de las variaciones' }, Object.entries(STYLES).map(([k, v]) => chip(v.name, st.style === k, () => { st.style = k; paint(); }))),
        sliderRow('Cuánto cambiar', { min: 10, max: 100, step: 5, value: st.intensity, fmt: v => v + ' %', onInput: v => { st.intensity = v; } }),
        h('div', { class: 'row2' }, btn('🎲 Generar una cadena', { act: 'rack-dado', disabled: st.busy, onclick: () => { st.seed = (st.seed * 31 + 7) % 1000003; st.chain = randomChain(st.seed, { style: st.style, intensity: st.intensity / 100, bpm: ctx.bpm }); st.open = 0; persist(); paint(); } }),
          btn('Guardar 4 variantes', { act: 'rack-variantes', disabled: st.busy, onclick: saveVariants })),
        label('Escuchar'),
        h('div', { class: 'row3' }, btn('▶ Original', { small: true, act: 'rack-original', disabled: st.busy, onclick: () => play('orig') }), btn(st.busy ? 'Procesando…' : '▶ Procesado', { small: true, kind: 'amber', act: 'rack-procesado', disabled: st.busy, onclick: () => play('fx') }), btn('■ Parar', { small: true, onclick: () => { stop(); status.textContent = ''; } })),
        status,
        btn('Aplicar al sonido', { kind: 'amber', act: 'rack-aplicar', disabled: st.busy, onclick: () => finalize(async (out, notes) => { ctx.onApply(out, notes.length > 1 ? 'Cadena de efectos' : (notes[0] || 'Efecto').split(' (')[0], notes); close(); }) }),
        btn('Guardar como sonido nuevo', { act: 'rack-nuevo', disabled: st.busy, onclick: () => finalize(async (out, notes) => { await ctx.onSaveNew(out, notes); status.textContent = `Guardado como sonido nuevo (procesado) · ${sayLen(out)}`; paint(); }) }),
        muted('Aplicar cambia la toma actual (puedes deshacerlo en Editar). «Guardar como sonido nuevo» deja el original intacto y crea otro marcado «procesado», con su origen y la lista de efectos. Con delay, reverb o granular la toma puede alargarse.', 'tiny'));
    }
    paint(); return box;
  }, { onClose: () => { try { st.src && st.src.stop(); st.audioCtx && st.audioCtx.close(); } catch (e) {} } });
}

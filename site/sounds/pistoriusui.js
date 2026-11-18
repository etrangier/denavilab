// Pantallas del asistente Pistorius: después de grabar pregunta «edición convencional o asistente», y el asistente pregunta qué se grabó,
// qué se quiere hacer, explica si conviene cortar o chopear (según la literatura) y aplica la receta con vista previa antes de guardar.
import { app, go, refreshSamples } from './state.js';
import { h, fill, btn, link, chip, card, label, muted, sheet, toast, toggleRow, drawBars } from './ui.js';
import * as dsp from './dsp.js';
import { putSample, newSample } from './store.js';
import { SOURCES, goalsFor, GOALS, analyze, advise, run } from './pistorius.js';
import { pIcon } from './fxicons.js';
import { openChop } from './chop.js';
import * as mem from './pistoriusmem.js';

const KEY = 'denavilab.sounds.pistorius';
export const pistoriusOn = () => { try { return JSON.parse(localStorage.getItem(KEY)) !== false; } catch (e) { return true; } };       // encendido por defecto: solo se apaga si tú lo apagas
export const setPistorius = v => { try { localStorage.setItem(KEY, JSON.stringify(!!v)); } catch (e) {} };

/** Después de grabar: si el asistente está activo pregunta cómo seguir; si no, sigue con la edición convencional. */
export function afterCapture(audio, rate, conventional, opts = {}) {
  if (!pistoriusOn()) return conventional();
  sheet(close => h('div', { class: 'stack' },
    h('div', { class: 'title-row' }, h('div', {}, h('h2', {}, '¿Cómo seguimos?'), h('p', { class: 'muted small' }, 'Acabas de grabar ' + dsp.stamp(audio.length / rate)), h('p', { class: 'muted tiny' }, mem.summary())), link('Cerrar', close)),
    h('div', { class: 'fxgrid two' },
      h('button', { type: 'button', class: 'fxtile big', 'data-act': 'convencional', onclick: () => { close(); setTimeout(conventional, 200); } }, pIcon('tijeras'), h('b', {}, 'Edición convencional'), h('span', { class: 'muted tiny' }, 'Nombre, carpeta y recorte, como siempre')),
      h('button', { type: 'button', class: 'fxtile big', 'data-act': 'asistente', onclick: () => { close(); setTimeout(() => openPistorius(audio, rate, opts), 200); } }, pIcon('asistente'), h('b', {}, 'Asistente Pistorius'), h('span', { class: 'muted tiny' }, 'Te pregunto qué grabaste y qué quieres hacer'))),
    link('Apagar el asistente', () => { setPistorius(false); close(); toast('Asistente apagado: lo reactivas en Grabar → Ajustes de captura'); setTimeout(conventional, 200); })));
}

/** El asistente. `opts`: { base, origin, folder, subfolder, fromSample } (fromSample: ya está guardado: no se guarda otra vez el original). */
export function openPistorius(audio, rate, opts = {}) {
  const base = opts.base || 'grabación', st = { step: 'source', source: null, goal: null, an: null, adv: null, res: null, name: '', keepOrig: !opts.fromSample, playing: null };
  let ctx = null, src = null;
  const stop = () => { if (src) { try { src.onended = null; src.stop(); } catch (e) {} src = null; } st.playing = null; };
  const play = (which, a) => { stop(); ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); const b = ctx.createBuffer(1, a.length, rate); b.copyToChannel(a, 0); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.onended = () => { if (src === s) { src = null; st.playing = null; paint(); } }; src = s; st.playing = which; s.start(); paint(); };
  const tile = (icon, text, sub, onclick, extra = '') => h('button', { type: 'button', class: 'fxtile big' + extra, onclick }, pIcon(icon), h('b', {}, text), sub ? h('span', { class: 'muted tiny' }, sub) : null);
  let box, close;

  const wave = (markers, region) => { const c = h('canvas', { class: 'wave small-wave', 'aria-label': 'Forma de onda con los cortes propuestos' }); setTimeout(() => drawBars(c, dsp.peaks(audio, 56), region && region.length === 2 ? region : [0, 1], null, null, markers || []), 30); return c; };

  const stepSource = () => [h('h2', {}, '¿Qué grabaste?'), muted('Con eso decido qué te sugiero primero.'),
    h('div', { class: 'fxgrid two' }, (rs => rs.list.map(s => tile(s.icon, s.label + (s.id === rs.top ? ' ★' : ''), s.id === rs.top ? 'Lo que sueles grabar' : null, () => { st.source = s.id; st.step = 'goal'; paint(); })))(mem.rankSources(SOURCES)))];

  const stepGoal = () => [h('div', { class: 'title-row' }, h('h2', {}, '¿Qué quieres hacer con ese sonido?'), link('‹ Atrás', () => { st.step = 'source'; paint(); })),
    h('div', { class: 'fxgrid two' }, (rg => rg.list.map((g, i) => tile(g.icon, g.label + (i === 0 ? ' ★' : ''), rg.top === g.id ? 'Lo que sueles hacer con esto' : g.hint, () => { st.goal = g.id; st.step = 'guide'; st.an = null; paint(); setTimeout(() => { st.an = analyze(audio, rate); st.adv = advise(audio, rate, st.an, g.id); paint(); }, 40); })))(mem.rankGoals(st.source, goalsFor(st.source))))];

  const apply = async (action, chopMode) => {
    st.action = action; st.step = 'busy'; paint();
    setTimeout(async () => {
      try {
        if (action === 'chop') {
          const clean = run('limpiar', audio, rate, { source: st.source, base, analysis: st.an });
          const s = newSample(base + ' · para chop', clean.audio, rate, { folder: opts.folder || 'Sin clasificar', subfolder: opts.subfolder || null, status: 'procesado', origin: opts.origin || '', kind: 'libre', process: clean.process.concat('Pistorius: preparado para chopear'), bpm: st.an.bpm && st.an.bpm.confidence > 0.2 ? st.an.bpm.bpm : null });
          mem.record({ source: st.source, goal: st.goal, action: 'chop' }); await putSample(s, clean.audio); if (st.keepOrig && !opts.fromSample) await saveOriginal(); await refreshSamples(); stop(); close(); app.selectedId = s.id; toast('Guardado: abro Chop con el modo sugerido'); setTimeout(() => openChop(s, clean.audio, { mode: chopMode }), 250);
          return;
        }
        st.res = run(st.goal, audio, rate, { source: st.source, base, analysis: st.an }); st.name = st.res.name; st.step = 'result';
      } catch (e) { toast('No se pudo aplicar la receta: ' + ((e && e.message) || e)); st.step = 'guide'; }
      paint();
    }, 40);
  };
  const saveOriginal = () => putSample(newSample(base + ' (original)', audio, rate, { folder: opts.folder || 'Sin clasificar', subfolder: opts.subfolder || null, status: 'crudo', origin: opts.origin || '' }), audio);
  const save = async (after) => {
    const r = st.res; stop();
    try {
      const s = newSample(st.name.trim() || r.name, r.audio, rate, { folder: opts.folder || 'Sin clasificar', subfolder: opts.subfolder || null, status: 'procesado', origin: opts.origin || '', ...(r.kind !== 'libre' ? { kind: r.kind } : {}), tags: r.tags, process: r.process, bpm: r.bpm || null, key: r.note || null, comment: 'Hecho con el asistente Pistorius' });
      mem.record({ source: st.source, goal: st.goal, action: st.action || 'seguir' }); await putSample(s, r.audio); if (st.keepOrig && !opts.fromSample) await saveOriginal(); await refreshSamples(); close(); app.selectedId = s.id; toast('Guardado: ' + s.name);
      if (after === 'editar') go('editar'); else if (after === 'chop') setTimeout(() => openChop(s, r.audio, { mode: 0 }), 250); else app.render();
    } catch (e) { toast('No se pudo guardar (¿poco espacio?)'); }
  };

  const stepGuide = () => {
    const g = GOALS.find(x => x.id === st.goal), a = st.an, ad = st.adv;
    if (!ad) return [h('div', { class: 'title-row' }, h('h2', {}, g.label), link('‹ Atrás', () => { st.step = 'goal'; paint(); })), muted('Escuchando tu sonido…', 'center')];
    const alt = [], usual = mem.usualAction(st.goal);
    if (ad.action !== 'cortar') alt.push(btn('Cortar un solo fragmento', { small: true, act: 'p-cortar', onclick: () => apply('cortar') }));
    if (ad.action !== 'chop') { alt.push(btn('Chopear por golpes', { small: true, act: 'p-chop-golpes', onclick: () => apply('chop', 0) })); alt.push(btn('Chopear por notas', { small: true, act: 'p-chop-notas', onclick: () => apply('chop', -2) })); }
    return [h('div', { class: 'title-row' }, h('h2', {}, g.label), link('‹ Atrás', () => { st.step = 'goal'; paint(); })),
      card([label('Lo que escuché'), h('p', { class: 'small' }, `${dsp.stamp(a.sec)} · ${ad.facts.join(' · ')}`), wave(ad.markers, ad.markers && ad.markers.length === 2 && ad.action === 'cortar' ? ad.markers : null)]),
      card([label('Mi sugerencia'), h('b', {}, ad.title), ...ad.why.map(t => h('p', { class: 'small' }, t)),
        h('details', {}, h('summary', {}, 'En qué me baso'), ad.refs.map(t => h('p', { class: 'muted tiny' }, t)))], true),
      btn(ad.action === 'chop' ? 'Seguir: guardar y abrir Chop' : 'Seguir la sugerencia', { kind: 'amber', act: 'p-seguir', onclick: () => apply(ad.action === 'loop' ? 'cortar' : ad.action, ad.chopMode) }),
      usual && usual !== (ad.action === 'loop' ? 'cortar' : ad.action) ? h('p', { class: 'muted small', 'data-act': 'p-habitual' }, 'Con esta meta sueles preferir ' + (usual === 'chop' ? 'chopear' : 'cortar un solo fragmento') + ': lo tienes en «Otra opción».') : null,
      alt.length ? h('div', { class: 'stack tight' }, label('Otra opción'), h('div', { class: 'wrap' }, alt)) : null];
  };

  const stepResult = () => {
    const r = st.res, g = GOALS.find(x => x.id === st.goal);
    return [h('div', { class: 'title-row' }, h('h2', {}, 'Resultado: ' + g.label.toLowerCase()), link('‹ Atrás', () => { stop(); st.step = 'guide'; paint(); })),
      card([label('Lo que hice'), h('ul', { class: 'steps' }, r.notes.map(t => h('li', { class: 'small' }, t))), h('p', { class: 'muted tiny' }, `${dsp.stamp(r.audio.length / rate)} · ${r.note ? 'nota ' + r.note + ' · ' : ''}${r.bpm ? '≈ ' + Math.round(r.bpm) + ' BPM · ' : ''}mono`), wave([])]),
      h('div', { class: 'row2' }, btn(st.playing === 'orig' ? '■ Original' : '▶ Original', { small: true, act: 'p-orig', onclick: () => st.playing === 'orig' ? (stop(), paint()) : play('orig', audio) }), btn(st.playing === 'res' ? '■ Resultado' : '▶ Resultado', { small: true, kind: 'amber', act: 'p-res', onclick: () => st.playing === 'res' ? (stop(), paint()) : play('res', r.audio) })),
      label('Nombre'), h('input', { type: 'text', class: 'field', value: st.name, 'aria-label': 'Nombre', oninput: e => { st.name = e.target.value; } }),
      opts.fromSample ? null : toggleRow('Guardar también la toma original', 'Queda como «crudo», por si quieres volver a empezar', st.keepOrig, v => { st.keepOrig = v; }),
      btn('Guardar', { kind: 'amber', act: 'p-guardar', onclick: () => save('biblioteca') }),
      h('div', { class: 'row2' }, btn('Guardar y abrir Editar', { small: true, onclick: () => save('editar') }), r.openChop ? btn('Guardar y abrir Chop', { small: true, onclick: () => save('chop') }) : btn('Probar otra meta', { small: true, onclick: () => { stop(); st.step = 'goal'; paint(); } }))];
  };

  function paint() {
    const body = st.step === 'source' ? stepSource() : st.step === 'goal' ? stepGoal() : st.step === 'guide' ? stepGuide() : st.step === 'busy' ? [h('h2', {}, 'Trabajando…'), muted('Aplicando la receta a tu sonido', 'center')] : stepResult();
    fill(box, h('div', { class: 'title-row' }, h('small', { class: 'muted' }, 'Asistente Pistorius'), link('Cerrar', () => { stop(); close(); })), ...body);
  }
  sheet(c => { close = c; box = h('div', { class: 'stack' }); paint(); return box; }, { onClose: () => { stop(); try { ctx && ctx.close(); } catch (e) {} } });
}

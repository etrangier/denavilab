// Pestaña Editar: onda con dos marcadores, reproducción, recorte, fundido, normalizado, deshacer, tempo y carpeta.
import { app, go, refreshSamples, sampleById } from './state.js';
import { starBtn } from './screens.js';
import { openLab } from './lab.js';
import { openRack } from './fxui.js';
import { describeChain, cleanChain } from './fxall.js';
import { h, mount, fill, btn, link, chip, card, label, muted, tip, title, toggleRow, sliderRow, logo, confirmSheet, toast, folderPicker, drawBars, fx, flash } from './ui.js';
import { compute } from './work.js';
import * as dsp from './dsp.js';
import * as learn from './learn.js';
import { putSample, getAudio, deleteSamples, newSample } from './store.js';
import { openChop } from './chop.js';
import * as sc from './scratch.js';

const ed = { id: null, audio: null, saved: null, labels: [], rlabels: [], peaks: [], undo: [], redo: [], start: 0, end: 1, fadeMs: 10, loop: false, noiseAmt: dsp.DENOISE_AMOUNT, sustain: true, cross: 1, refine: true, scratch: { kind: 'baby', beats: 4, depth: 0.6 } };
let playCtx = null, src = null, t0 = 0, dur = 0;

const stopPlay = () => { if (src) { try { src.onended = null; src.stop(); } catch (e) {} src = null; } };
const sel = () => { const n = ed.audio.length; return [Math.round(ed.start * n), Math.round(ed.end * n)]; };
/** Memoria de estilo: «golpe» o «sostenido» según el tipo con que se grabó el sonido o, si no lo tiene, según cómo suena. */
const styleGroup = (s, f) => s.kind === 'bateria' || s.kind === 'bajo' ? 'golpe' : s.kind === 'textura' ? 'sostenido' : (f ? learn.styleOf(f).group : 'sostenido');

function play() {
  stopPlay();
  const [a, b] = sel(); if (b - a < 8) return;
  playCtx = playCtx || new (window.AudioContext || window.webkitAudioContext)();
  playCtx.resume();
  const rate = app.samples.find(s => s.id === ed.id).rate, buf = playCtx.createBuffer(1, b - a, rate);
  buf.copyToChannel(ed.audio.subarray(a, b), 0);
  src = playCtx.createBufferSource(); src.buffer = buf; src.loop = ed.loop; src.connect(playCtx.destination);
  src.onended = () => { src = null; app.render(); };
  dur = (b - a) / rate; t0 = playCtx.currentTime; src.start();
}

function setAudio(a) { ed.audio = a; ed.peaks = dsp.peaks(a, 56); }
/** El historial guarda copias enteras del audio: se limita por cantidad y por memoria, y siempre se conserva el original (el primero). */
export const HISTORY_MAX_STEPS = 20, HISTORY_MAX_BYTES = 160e6;
export function trimHistory(h = ed) {
  const bytes = () => h.undo.reduce((a, x) => a + x.length * 4, 0);
  while (h.undo.length > 2 && (h.undo.length > HISTORY_MAX_STEPS || bytes() > HISTORY_MAX_BYTES)) { h.undo.splice(1, 1); h.labels.splice(1, 1); }
}
/** Aplica un cambio al audio (deshacible). Con `key`, el botón correspondiente se ilumina al terminar; devuelve si se aplicó. */
function apply(fn, key, label = 'Cambio') {
  const fail = msg => { fx.busy = null; if (key) app.render(); toast(msg); return false; };
  const out = fn(ed.audio);
  if (!out.length) return fail('La selección quedó vacía');
  if (out === ed.audio) return fail('No hay nada que cambiar: la selección es muy corta para eso');
  fx.busy = null; if (key) flash(key);
  stopPlay(); ed.undo.push(ed.audio); ed.labels.push(label); trimHistory(); ed.redo = []; ed.rlabels = []; setAudio(out); ed.start = 0; ed.end = 1; app.render();
  return true;
}
const LABELS = { recortar: 'Recortar', normalizar: 'Normalizar', fundido: 'Fundido', armonizar: 'Armonizar bordes', invertir: 'Invertir', scratch: 'Scratch', nivelar: 'Nivelar volumen', colchon4: 'Colchón ×4', colchon8: 'Colchón ×8', colchon16: 'Colchón ×16',
  loop: 'Loop continuo', 'ruido-suave': 'Ruido (suave)', 'ruido-fuerte': 'Ruido (fuerte)', 'ruido-fondo': 'Quitar ruido de fondo', 'ruido-sel': 'Ruido de la selección' };
/** Acción con respuesta visible: si es lenta, el botón pulsa en amarillo mientras trabaja; al terminar destella y avisa «Listo». */
function run(key, fn, { slow = false, done = null } = {}) {
  const go = () => { if (apply(fn, key, LABELS[key] || key) && done) toast(typeof done === 'function' ? done() : done); };
  if (!slow) return go();
  fx.busy = key; app.render(); setTimeout(go, 90);
}
/** Acción lenta en un hilo aparte (la pantalla no se congela): el botón pulsa mientras trabaja y, si la toma sigue igual al terminar, se aplica el resultado. */
function runWorker(key, op, args, { done = null, onApplied = null } = {}) {
  if (fx.busy) return;                                              // ya hay una acción trabajando
  const base = ed.audio, id = ed.id;
  fx.busy = key; app.render();
  compute(op, args).then(out => {
    if (ed.audio !== base || ed.id !== id) { fx.busy = null; app.render(); return toast('La toma cambió mientras trabajaba: no se aplicó'); }
    if (apply(() => out, key, LABELS[key] || key)) { if (onApplied) { onApplied(); app.render(); } if (done) toast(typeof done === 'function' ? done() : done); }
  }).catch(() => { fx.busy = null; app.render(); toast('No se pudo completar la acción'); });
}

/** Abre la cadena de efectos sobre la toma actual. Los sonidos nuevos salen como «procesados», con el origen del original, la lista de efectos y su receta
 *  (la cadena + el sonido de origen). Con `rec` (la receta de un sonido ya procesado) se abre sobre el sonido de origen con la cadena puesta, para
 *  re-editarla y actualizar el sonido sin volver a procesar un audio ya procesado. */
async function openFxRack(s, rec = null) {
  let src = s, srcAudio = ed.audio;
  if (rec) {
    src = app.samples.find(x => x.id === rec.from);
    if (!src) return toast('El sonido de origen de esta receta ya no está en la biblioteca');
    srcAudio = await getAudio(src.id);
    if (!srcAudio.length) return toast('No se pudo leer el sonido de origen');
  }
  const recipe = chain => ({ from: src.id, fromName: src.name, chain: JSON.parse(JSON.stringify(chain)) });
  const saveNew = async (out, notes, suffix = ' fx', extra = {}) => {
    const n = newSample(src.name + suffix, out, src.rate, { folder: src.folder, subfolder: src.subfolder || null, status: 'procesado', origin: src.origin || '', tags: [...(src.tags || [])], key: src.key || null, bpm: src.bpm || null,
      comment: (extra.comment || 'Cadena de efectos sobre: ' + src.name) + (src.comment ? ' · ' + src.comment : ''), process: [...(src.process || []), ...notes], recipe: extra.chain ? recipe(extra.chain) : null });
    await putSample(n, out); await refreshSamples();
  };
  openRack({ audio: srcAudio, rate: src.rate, bpm: src.bpm || null, name: src.name, initialChain: rec ? rec.chain : null, samples: app.samples.filter(x => x.id !== s.id && x.id !== src.id).map(x => ({ id: x.id, name: x.name })),
    loadAudio: async id => { const o = app.samples.find(x => x.id === id); return { audio: await getAudio(id), rate: o ? o.rate : src.rate }; },
    onApply: rec ? null : (out, name) => { if (apply(() => out, 'fx404', name)) toast('Listo: ' + name + ' aplicado · puedes deshacerlo'); },
    onUpdate: rec ? async (out, notes, chain) => {
      try {
        await putSample({ ...s, duration: out.length / s.rate, process: [...(src.process || []), ...notes], recipe: recipe(chain) }, out);
        await refreshSamples(); stopPlay(); ed.id = null; toast('Sonido actualizado con la receta'); app.render();
      } catch (e) { toast('No se pudo guardar el sonido actualizado'); }
    } : null,
    onSaveNew: async (out, notes, chain) => { try { await saveNew(out, notes, ' fx', { chain }); toast('Guardado como sonido nuevo (procesado, con receta)'); } catch (e) { toast('No se pudo guardar el sonido nuevo'); } },
    onSaveVariants: async list => { for (let i = 0; i < list.length; i++) await saveNew(list[i].out, list[i].notes, ` var ${i + 1}`, { comment: `Variante ${i + 1} (${list[i].style}) de: ${src.name}`, chain: list[i].chain }); toast('Guardadas 4 variantes (procesadas, con receta)'); } });
}
function stepRaw(from, to, lfrom, lto) {
  const x = from.pop(); if (!x) return false;
  to.push(ed.audio); lto.push(lfrom.pop() || 'Cambio'); stopPlay(); setAudio(x); ed.start = 0; ed.end = 1; return true;
}
function step(from, to, lfrom, lto) { if (stepRaw(from, to, lfrom, lto)) app.render(); }
/** Vuelve a cómo estaba la toma al abrirla (Rehacer permite volver a todo lo hecho). */
function toOriginal() {
  if (!ed.undo.length) return;
  while (stepRaw(ed.undo, ed.redo, ed.labels, ed.rlabels));
  flash('original'); toast('Volviste al original: la toma como estaba al abrirla'); app.render();
}

export function renderEdit(root) {
  const s = sampleById(app.selectedId);
  if (!s) {
    mount(root, title('Escuchar y editar'), h('div', { class: 'empty' }, logo(56), h('h2', {}, 'Elige una grabación'),
      muted('Abre una en la Biblioteca para recortarla y darle carácter.', 'center'), btn('Ir a la Biblioteca', { kind: 'amber', onclick: () => go('biblioteca') })));
    return;
  }
  if (ed.id !== s.id) {
    stopPlay(); Object.assign(ed, { id: s.id, audio: null, peaks: [], undo: [], redo: [], labels: [], rlabels: [], start: 0, end: 1 });
    getAudio(s.id).then(a => { if (ed.id === s.id) { setAudio(a); ed.saved = a; if (app.tab === 'editar') app.render(); } });
  }
  if (!ed.audio) { mount(root, title('Escuchar y editar'), muted('Cargando…')); return; }

  const n = ed.audio.length, total = n / s.rate, pk = dsp.peakDB(ed.audio), fade = Math.round(ed.fadeMs / 1000 * s.rate);
  const canvas = h('canvas', { class: 'wave', 'aria-label': 'Forma de onda' });
  const wrap = h('div', { class: 'wave-edit card' + (fx.flash ? ' fx-flash' : '') }, canvas);
  const times = h('div', { class: 'between small amber bold' });
  const durEl = h('span', { class: 'muted' });
  const handle = which => {
    const el = h('div', { class: 'handle', role: 'slider', 'aria-label': which === 'start' ? 'Marcador de inicio' : 'Marcador de final', tabindex: '0' }, h('i'));
    el.addEventListener('pointerdown', ev => { el.setPointerCapture(ev.pointerId); el.dataset.drag = '1'; });
    el.addEventListener('pointerup', () => { delete el.dataset.drag; });
    el.addEventListener('pointermove', ev => {
      if (!el.dataset.drag) return;
      const r = canvas.getBoundingClientRect(), f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      if (which === 'start') ed.start = Math.min(f, ed.end - 0.01); else ed.end = Math.max(f, ed.start + 0.01);
      stopPlay(); layout();
    });
    el.addEventListener('keydown', ev => {
      const d = ev.key === 'ArrowLeft' ? -0.01 : ev.key === 'ArrowRight' ? 0.01 : 0; if (!d) return;
      if (which === 'start') ed.start = Math.min(Math.max(0, ed.start + d), ed.end - 0.01); else ed.end = Math.max(Math.min(1, ed.end + d), ed.start + 0.01);
      layout();
    });
    return el;
  };
  const hs = handle('start'), he = handle('end'); mount(wrap, hs, he);
  const layout = (ph = null) => {
    // los agarradores quedan 14 px hacia dentro para que no los corte el borde de la tarjeta
    hs.style.left = `calc(14px + (100% - 28px) * ${ed.start})`; he.style.left = `calc(14px + (100% - 28px) * ${ed.end})`;
    drawBars(canvas, ed.peaks, [ed.start, ed.end], ph);
    fill(times, h('span', {}, dsp.stamp(ed.start * total)), durEl, h('span', {}, dsp.stamp(ed.end * total)));
    durEl.textContent = 'Dura ' + dsp.stamp((ed.end - ed.start) * total);
  };

  const playing = !!src;
  const nameInput = h('input', { type: 'text', class: 'field name', value: s.name, 'aria-label': 'Nombre',
    onchange: async e => { const v = e.target.value.trim(); if (v && v !== s.name) { await putSample({ ...s, name: v }); await refreshSamples(); } } });
  const bpmCard = card([
    h('div', { class: 'between' }, h('b', {}, 'Tempo'), h('span', { class: s.bpm ? 'amber small' : 'muted small' }, s.bpm ? `≈ ${Math.round(s.bpm)} BPM` : 'sin detectar')),
    h('div', { class: 'row2' }, btn('Detectar BPM', { small: true, onclick: async () => {
      const r = dsp.estimateBPM(ed.audio, s.rate); if (!r) return toast('No encuentro un pulso claro en esta toma');
      await putSample({ ...s, bpm: r.bpm }); await refreshSamples(); toast(`≈ ${r.bpm.toFixed(0)} BPM · confianza ${Math.round(r.confidence * 100)} %`); app.render();
    } }), s.bpm ? btn('Usar en el metrónomo', { small: true, sel: true, onclick: () => { app.metro.set('bpm', Math.min(300, Math.max(30, Math.round(s.bpm)))); toast('Metrónomo a ' + Math.round(s.bpm) + ' BPM'); } }) : null),
    muted('Funciona mejor con pulso claro y al menos 2 segundos.', 'tiny')]);
  const fp = { folder: s.folder, sub: s.subfolder || null };

  mount(root, 
    title('Escuchar y editar', null, starBtn(s)),
    h('div', { class: 'undo-bar', role: 'group', 'aria-label': 'Historial de cambios' },
      h('div', { class: 'row3' },
        btn('↶ Deshacer', { small: true, act: 'deshacer', disabled: !ed.undo.length, aria: 'Deshacer el último cambio', onclick: () => step(ed.undo, ed.redo, ed.labels, ed.rlabels) }),
        btn('↷ Rehacer', { small: true, disabled: !ed.redo.length, aria: 'Rehacer', onclick: () => step(ed.redo, ed.undo, ed.rlabels, ed.labels) }),
        btn('⟲ Original', { small: true, act: 'original', disabled: !ed.undo.length, aria: 'Volver al original', onclick: toOriginal })),
      h('p', { class: 'muted tiny undo-note' }, ed.undo.length ? `Último cambio: ${ed.labels[ed.labels.length - 1]} · ${ed.undo.length} desde que abriste la toma` : 'Sin cambios todavía: aquí podrás deshacer o volver al original')),
    h('div', { class: 'stack tight' }, nameInput, h('p', { class: 'muted small' }, `${dsp.stamp(total)} · mono · ${s.rate} Hz · pico ${Math.round(pk)} dB · nivel ${Math.max(-99, Math.round(dsp.levelDB(ed.audio, s.rate)))} dB`),
      pk < -30 ? h('p', { class: 'amber small' }, 'Nivel muy bajo: usa Normalizar para oírla bien.') : null),
    wrap, times,
    h('div', { class: 'controls' },
      h('div', { class: 'side' }, h('button', { type: 'button', class: 'circle', 'aria-label': 'Al inicio', onclick: () => { stopPlay(); app.render(); } }, '⏮'), h('span', { class: 'muted tiny' }, 'Al inicio')),
      h('button', { type: 'button', class: 'play-btn', 'aria-label': playing ? 'Parar' : 'Reproducir', onclick: () => { playing ? stopPlay() : play(); app.render(); } }, playing ? '❚❚' : '▶'),
      h('div', { class: 'side' }, h('button', { type: 'button', class: 'circle' + (ed.loop ? ' on' : ''), 'aria-pressed': String(ed.loop), 'aria-label': 'Repetir', onclick: () => { ed.loop = !ed.loop; if (src) src.loop = ed.loop; app.render(); } }, '↻'), h('span', { class: 'muted tiny' }, 'Repetir'))),
    label('Herramientas'),
    h('div', { class: 'row3' },
      btn('Recortar', { small: true, act: 'recortar', onclick: () => { const [a, b] = sel(); try { if (a > 0 || b < ed.audio.length) { const f = learn.features(ed.audio, s.rate); if (f) learn.learnTrim({ f, group: styleGroup(s, f), startMs: a / s.rate * 1000, endMs: b / s.rate * 1000, fadeMs: ed.fadeMs }); } } catch (e) {} run('recortar', x => dsp.fade(dsp.trim(x, a, b), fade, fade), { done: 'Listo: recortado' }); } }),
      btn('Normalizar', { small: true, act: 'normalizar', onclick: () => run('normalizar', x => dsp.normalize(x), { done: 'Listo: normalizado a −1 dB' }) }),
      btn('Fundido', { small: true, act: 'fundido', onclick: () => run('fundido', x => dsp.fade(x, fade, fade), { done: 'Listo: fundido aplicado' }) })),
    h('div', { class: 'row2' },
      btn(fx.flash === 'recorte-ia' ? '✓ Recorte sugerido' : '✨ Recorte inteligente', { small: true, act: 'recorte-ia', onclick: () => {
        const r = learn.suggestTrim(ed.audio, s.rate); if (!r) return toast('No encuentro un sonido claro para sugerir un recorte');
        ed.start = r.a / ed.audio.length; ed.end = r.b / ed.audio.length; ed.fadeMs = r.fadeMs; toast(r.why + ' · ajusta y pulsa Recortar', 8000); flash('recorte-ia'); app.render();
      } }),
      btn(fx.flash === 'loop-ia' ? '✓ Loop sugerido' : '✨ Loop inteligente', { small: true, act: 'loop-ia', onclick: () => {
        const est = s.bpm ? { bpm: s.bpm, confidence: 1 } : dsp.estimateBPM(ed.audio, s.rate), r = learn.suggestLoop(ed.audio, s.rate, { bpm: est ? est.bpm : null, bpmConfidence: est ? est.confidence : 0 });
        if (!r) return toast('No encuentro una zona estable de al menos 0,5 s para sugerir un loop');
        ed.start = r.a / ed.audio.length; ed.end = r.b / ed.audio.length; ed.cross = r.crossSec; ed.refine = r.refine; toast(r.why + ' · ajusta y pulsa Hacer loop continuo', 8000); flash('loop-ia'); app.render();
      } })),
    btn('Nivelar volumen', { small: true, act: 'nivelar', onclick: () => {
      const r = dsp.levelTo(ed.audio, s.rate);
      if (r.beforeDB < -80) return toast('La toma está casi en silencio: no hay nada que nivelar');
      const f = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',');
      run('nivelar', () => r.audio, { done: `Listo: nivel típico de ${Math.round(r.beforeDB)} a ${Math.round(r.afterDB)} dB (${f(r.gainDB)} dB)${r.short ? ' · los picos no dejan subir más: queda algo bajo' : r.limited ? ' · picos suavizados' : ''}` });
    } }),
    tip(`Lleva el volumen típico de la toma a ${dsp.levelTarget()} dB (no el pico): así un golpe seco y un pad suenan igual de fuertes. El nivel se cambia en Compartir. Puedes deshacer.`),
    btn('Armonizar bordes (sin clics)', { small: true, act: 'armonizar', onclick: () => run('armonizar', x => dsp.harmonize(x, s.rate), { done: 'Listo: bordes armonizados' }) }),
    tip('Centra la onda y suaviza el inicio y el final a medida, para que un recorte no suene «cortado». Puedes deshacer.'),
    label('Creativo'),
    btn('Invertir', { small: true, act: 'invertir', onclick: () => { const [a, b] = sel(); run('invertir', x => dsp.reverseRange(x, a, b), { done: 'Listo: invertido' }); } }),
    tip('Da la vuelta a la selección (o a toda la toma): una cola que se apaga pasa a ser un crescendo que «chupa» hacia el golpe.'),
    label('Scratch'),
    h('div', { class: 'wrap' }, sc.SCRATCH_KINDS.map(([k, name]) => chip(name, ed.scratch.kind === k, () => { ed.scratch.kind = k; app.render(); }))),
    h('div', { class: 'wrap' }, [2, 4, 8].map(n => chip(`${n} tiempos`, ed.scratch.beats === n, () => { ed.scratch.beats = n; app.render(); }))),
    sliderRow('Recorrido de la aguja', { min: 0.2, max: 1, step: 0.05, value: ed.scratch.depth, fmt: v => Math.round(v * 100) + ' %', onInput: v => { ed.scratch.depth = v; } }),
    btn('Scratchear', { small: true, act: 'scratch', onclick: () => {
      const [a, b] = sel(), bpm = Math.round(s.bpm || 100);
      if (b - a < s.rate * 0.05) return toast('Marca al menos 0,05 s (o no marques nada para usar toda la toma)');
      const { kind, beats, depth } = ed.scratch;
      run('scratch', x => sc.scratch(x, a, b, s.rate, { kind, bpm, beats, depth }), { done: () => `Listo: scratch de ${beats} tiempos a ${bpm} BPM · dura ${dsp.stamp(ed.audio.length / s.rate)}` });
    } }),
    tip(`Mueve la aguja sobre la selección (o toda la toma) como en un vinilo: el tono sube y baja con la velocidad y al volver suena hacia atrás. Dura los tiempos elegidos al BPM de la toma (${Math.round(s.bpm || 100)}${s.bpm ? '' : ', porque aún no está detectado'}). Se queda sólo con el scratch; puedes deshacer y guardarlo como cualquier sonido.`),
    label('Colchón sostenido'),
    h('div', { class: 'row3' }, [4, 8, 16].map(f => btn('Colchón ×' + f, { small: true, act: 'colchon' + f, onclick: () => {
      const [a, b] = sel();
      if (b - a < s.rate / 10) return toast('Marca al menos 0,1 s (o no marques nada para usar toda la toma)');
      if ((b - a) * f > s.rate * 600) return toast('Quedaría demasiado largo (más de 10 minutos): marca un tramo más corto');
      toast('Creando el colchón…');
      runWorker('colchon' + f, 'padStretch', [ed.audio.slice(a, b), f, s.rate, ed.sustain], { done: () => `Listo: colchón ×${f} · dura ${dsp.stamp(ed.audio.length / s.rate)}` });
    } }))),
    toggleRow('Sostener el nivel', 'Sube las colas que se apagan para que el colchón no se desvanezca', ed.sustain, v => { ed.sustain = v; }),
    tip('Estira la selección (o toda la toma) sin cambiar el tono y la difumina en un sonido continuo, ideal para notas de cuerda, pads y ambientes. Se queda sólo con lo estirado; puedes deshacer.'),
    label('Loop continuo (sin pulso)'),
    h('div', { class: 'between' }, h('b', {}, 'Empalme'), h('span', { class: 'muted small' }, 'cuánto se funden final y principio')),
    h('div', { class: 'wrap' }, [0.5, 1, 2, 4].map(c => chip(String(c).replace('.', ',') + ' s', ed.cross === c, () => { ed.cross = c; app.render(); }))),
    toggleRow('Afinar el final', 'Busca, hasta medio segundo cerca de tu marcador, el punto donde el sonido más se parece al del inicio', ed.refine, v => { ed.refine = v; }),
    btn('Hacer loop continuo', { small: true, act: 'loop', onclick: () => {
      const [a, b] = sel();
      if (b - a < s.rate / 2) return toast('Marca al menos 0,5 s (o no marques nada para usar toda la toma)');
      try { const f = learn.features(ed.audio, s.rate); learn.learnLoop({ group: styleGroup(s, f), lenSec: (b - a) / s.rate, bpm: s.bpm, crossSec: ed.cross, refine: ed.refine }); } catch (e) {}
      toast('Creando el loop…');
      runWorker('loop', 'loopSeamless', [ed.audio, a, b, s.rate, ed.cross, ed.refine], { onApplied: () => { ed.loop = true; }, done: () => { const j = dsp.seamJump(ed.audio); return `Listo: loop de ${dsp.stamp(ed.audio.length / s.rate)} · empalme ${j < 1.5 ? 'inaudible' : j < 4 ? 'casi inaudible' : 'se nota (prueba otro empalme)'} · pulsa ▶ para oírlo`; } });
    } }),
    tip('Une el final con el principio para que el tramo se repita sin saltos, aunque no tenga ritmo: pads, cuerdas, ambientes. Se queda sólo con el loop; ya queda activado «Repetir» para oírlo con ▶. Puedes deshacer.'),
    label('Limpiar ruido'),
    h('div', { class: 'row2' },
      btn('Suave', { small: true, act: 'ruido-suave', onclick: () => runWorker('ruido-suave', 'cleanNoise', [ed.audio, s.rate, 'soft'], { done: 'Listo: ruido reducido (suave)' }) }),
      btn('Fuerte', { small: true, act: 'ruido-fuerte', onclick: () => runWorker('ruido-fuerte', 'cleanNoise', [ed.audio, s.rate, 'strong'], { done: 'Listo: ruido reducido (fuerte)' }) })),
    h('div', { class: 'row2' },
      btn('Quitar ruido de fondo', { small: true, act: 'ruido-fondo', onclick: () => {
        const w = dsp.quietestWindows(ed.audio, s.rate); if (!w.length) return toast('No hay una parte tranquila: marca una con los marcadores y usa «Con la selección»');
        runWorker('ruido-fondo', 'denoise', [ed.audio, w.map(([a, b]) => ed.audio.slice(a, b)), ed.noiseAmt], { done: 'Listo: ruido de fondo quitado' });
      } }),
      btn('Con la selección', { small: true, act: 'ruido-sel', onclick: () => {
        const [a, b] = sel(); if (b - a < s.rate / 10) return toast('Marca una parte de solo ruido de al menos 0,1 s');
        runWorker('ruido-sel', 'denoise', [ed.audio, ed.audio.slice(a, b), ed.noiseAmt], { done: 'Listo: ruido de la selección quitado' });
      } })),
    sliderRow('Intensidad', { min: 0.5, max: 3, step: 0.1, value: ed.noiseAmt, fmt: v => v < 1.2 ? 'Suave' : v < 2.2 ? 'Normal' : 'Fuerte', onInput: v => { ed.noiseAmt = v; } }),
    tip('Suave y Fuerte cortan graves (respiración, soplidos) y apagan lo que suena bajito entre sonidos. «Quitar ruido de fondo» aprende el ruido de la parte más tranquila; «Con la selección» lo aprende de lo que marques. Puedes deshacer.'),
    sliderRow('Fundido', { min: 0, max: 200, step: 1, value: ed.fadeMs, fmt: v => v + ' ms', onInput: v => { ed.fadeMs = v; } }),
    bpmCard,
    s.recipe ? card([h('b', {}, 'Receta de efectos'), h('p', { class: 'muted small' }, `De «${s.recipe.fromName}»: ${describeChain(cleanChain(s.recipe.chain)).map(x => x.split(' (')[0]).join(' → ')}`), btn('Re-editar la receta', { act: 'receta', onclick: () => openFxRack(s, s.recipe) }), h('p', { class: 'muted tiny' }, 'Se edita sobre el original y actualiza este sonido.')]) : null,
    card([h('b', {}, 'Cadena de efectos'), h('p', { class: 'muted small' }, 'Cassette, vinilo, granular, delay, reverb y más.'), btn('Abrir la cadena de efectos', { act: 'efectos', onclick: () => openFxRack(s) })]),
    card([h('b', {}, 'Laboratorio de pads'), h('p', { class: 'muted small' }, 'Bucle sin clics, estirar, tono, filtros, reverb, capas y teclado.'), btn('Abrir el laboratorio', { act: 'laboratorio', onclick: () => openLab(s) })]),
    btn(app.ko2 ? 'Chop en pads' : 'Chop', { onclick: () => openChop(s, ed.audio) }),
    folderPicker(fp, async st => { await putSample({ ...s, folder: st.folder, subfolder: st.sub }); await refreshSamples(); }),
    label('¿Qué hacemos con esta toma?'),
    h('div', { class: 'row3' },
      btn('Descartar', { kind: 'danger', small: true, onclick: async () => {
        if (!await confirmSheet({ title: '¿Borrar esta grabación?', message: 'Se elimina también el audio y no se puede deshacer.', ok: 'Borrar', danger: true })) return;
        stopPlay(); await deleteSamples([s.id]); app.selectedId = null; ed.id = null; await refreshSamples(); go('biblioteca');
      } }),
      btn('Grabar', { small: true, onclick: () => go('grabar') }),
      btn('Guardar', { kind: 'amber', small: true, act: 'guardar', onclick: async () => {
        // Misma toma que la ya guardada (p. ej. al tocar Guardar dos veces): se avisa de que se va a sobrescribir el mismo archivo.
        const igual = ed.audio === ed.saved;
        if (igual && !await confirmSheet({ title: 'No hay cambios nuevos', message: `«${s.name}» ya está guardada tal cual. Si sigues, se sobrescribe el mismo archivo.`, ok: 'Sobrescribir' })) return;
        try {
          await putSample({ ...s, duration: ed.audio.length / s.rate }, ed.audio); ed.saved = ed.audio; try { if (s.kind) learn.learnSound(s.kind, learn.features(ed.audio, s.rate), learn.load(), s.id); } catch (e) {} await refreshSamples(); flash('guardar');
          toast(igual ? `Se sobrescribió «${s.name}» (sin cambios)` : `Guardado: «${s.name}»`); app.render();
        } catch (e) { toast('No se pudo guardar (¿poco espacio en el dispositivo?)'); }
      } })),
    null);

  let raf = 0;
  const loop = () => {
    layout(src && playCtx ? ed.start + (ed.end - ed.start) * (((playCtx.currentTime - t0) % dur) / dur) : null);
    raf = requestAnimationFrame(loop);
  };
  loop();
  return () => cancelAnimationFrame(raf);
}

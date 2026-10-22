// Pestaña Editar: onda con dos marcadores, reproducción, recorte, fundido, normalizado, deshacer, tempo y carpeta.
import { app, go, refreshSamples, sampleById } from './state.js';
import { h, mount, fill, btn, link, chip, card, label, muted, title, toggleRow, sliderRow, logo, confirmSheet, toast, folderPicker, drawBars, fx, flash } from './ui.js';
import { compute } from './work.js';
import * as dsp from './dsp.js';
import { putSample, getAudio, deleteSamples } from './store.js';
import { openChop } from './chop.js';
import * as sc from './scratch.js';

const ed = { id: null, audio: null, saved: null, labels: [], rlabels: [], peaks: [], undo: [], redo: [], start: 0, end: 1, fadeMs: 10, loop: false, noiseAmt: dsp.DENOISE_AMOUNT, sustain: true, cross: 1, refine: true, scratch: { kind: 'baby', beats: 4, depth: 0.6 } };
let playCtx = null, src = null, t0 = 0, dur = 0;

const stopPlay = () => { if (src) { try { src.onended = null; src.stop(); } catch (e) {} src = null; } };
const sel = () => { const n = ed.audio.length; return [Math.round(ed.start * n), Math.round(ed.end * n)]; };

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
    title('Escuchar y editar'),
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
      btn('Recortar', { small: true, act: 'recortar', onclick: () => { const [a, b] = sel(); run('recortar', x => dsp.fade(dsp.trim(x, a, b), fade, fade), { done: 'Listo: recortado' }); } }),
      btn('Normalizar', { small: true, act: 'normalizar', onclick: () => run('normalizar', x => dsp.normalize(x), { done: 'Listo: normalizado a −1 dB' }) }),
      btn('Fundido', { small: true, act: 'fundido', onclick: () => run('fundido', x => dsp.fade(x, fade, fade), { done: 'Listo: fundido aplicado' }) })),
    btn('Nivelar volumen', { small: true, act: 'nivelar', onclick: () => {
      const r = dsp.levelTo(ed.audio, s.rate);
      if (r.beforeDB < -80) return toast('La toma está casi en silencio: no hay nada que nivelar');
      const f = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',');
      run('nivelar', () => r.audio, { done: `Listo: nivel típico de ${Math.round(r.beforeDB)} a ${Math.round(r.afterDB)} dB (${f(r.gainDB)} dB)${r.short ? ' · los picos no dejan subir más: queda algo bajo' : r.limited ? ' · picos suavizados' : ''}` });
    } }),
    muted(`Lleva el volumen típico de la toma a ${dsp.levelTarget()} dB (no el pico): así un golpe seco y un pad suenan igual de fuertes. El nivel se cambia en Compartir. Puedes deshacer.`, 'tiny'),
    btn('Armonizar bordes (sin clics)', { small: true, act: 'armonizar', onclick: () => run('armonizar', x => dsp.harmonize(x, s.rate), { done: 'Listo: bordes armonizados' }) }),
    muted('Centra la onda y suaviza el inicio y el final a medida, para que un recorte no suene «cortado». Puedes deshacer.', 'tiny'),
    label('Creativo'),
    btn('Invertir', { small: true, act: 'invertir', onclick: () => { const [a, b] = sel(); run('invertir', x => dsp.reverseRange(x, a, b), { done: 'Listo: invertido' }); } }),
    muted('Da la vuelta a la selección (o a toda la toma): una cola que se apaga pasa a ser un crescendo que «chupa» hacia el golpe.', 'tiny'),
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
    muted(`Mueve la aguja sobre la selección (o toda la toma) como en un vinilo: el tono sube y baja con la velocidad y al volver suena hacia atrás. Dura los tiempos elegidos al BPM de la toma (${Math.round(s.bpm || 100)}${s.bpm ? '' : ', porque aún no está detectado'}). Se queda sólo con el scratch; puedes deshacer y guardarlo como cualquier sonido.`, 'tiny'),
    label('Colchón sostenido'),
    h('div', { class: 'row3' }, [4, 8, 16].map(f => btn('Colchón ×' + f, { small: true, act: 'colchon' + f, onclick: () => {
      const [a, b] = sel();
      if (b - a < s.rate / 10) return toast('Marca al menos 0,1 s (o no marques nada para usar toda la toma)');
      if ((b - a) * f > s.rate * 600) return toast('Quedaría demasiado largo (más de 10 minutos): marca un tramo más corto');
      toast('Creando el colchón…');
      runWorker('colchon' + f, 'padStretch', [ed.audio.slice(a, b), f, s.rate, ed.sustain], { done: () => `Listo: colchón ×${f} · dura ${dsp.stamp(ed.audio.length / s.rate)}` });
    } }))),
    toggleRow('Sostener el nivel', 'Sube las colas que se apagan para que el colchón no se desvanezca', ed.sustain, v => { ed.sustain = v; }),
    muted('Estira la selección (o toda la toma) sin cambiar el tono y la difumina en un sonido continuo, ideal para notas de cuerda, pads y ambientes. Se queda sólo con lo estirado; puedes deshacer.', 'tiny'),
    label('Loop continuo (sin pulso)'),
    h('div', { class: 'between' }, h('b', {}, 'Empalme'), h('span', { class: 'muted small' }, 'cuánto se funden final y principio')),
    h('div', { class: 'wrap' }, [0.5, 1, 2, 4].map(c => chip(String(c).replace('.', ',') + ' s', ed.cross === c, () => { ed.cross = c; app.render(); }))),
    toggleRow('Afinar el final', 'Busca, hasta medio segundo cerca de tu marcador, el punto donde el sonido más se parece al del inicio', ed.refine, v => { ed.refine = v; }),
    btn('Hacer loop continuo', { small: true, act: 'loop', onclick: () => {
      const [a, b] = sel();
      if (b - a < s.rate / 2) return toast('Marca al menos 0,5 s (o no marques nada para usar toda la toma)');
      toast('Creando el loop…');
      runWorker('loop', 'loopSeamless', [ed.audio, a, b, s.rate, ed.cross, ed.refine], { onApplied: () => { ed.loop = true; }, done: () => `Listo: loop de ${dsp.stamp(ed.audio.length / s.rate)} · pulsa ▶ para oírlo` });
    } }),
    muted('Une el final con el principio para que el tramo se repita sin saltos, aunque no tenga ritmo: pads, cuerdas, ambientes. Se queda sólo con el loop; ya queda activado «Repetir» para oírlo con ▶. Puedes deshacer.', 'tiny'),
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
    muted('Suave y Fuerte cortan graves (respiración, soplidos) y apagan lo que suena bajito entre sonidos. «Quitar ruido de fondo» aprende el ruido de la parte más tranquila; «Con la selección» lo aprende de lo que marques. Puedes deshacer.', 'tiny'),
    sliderRow('Fundido', { min: 0, max: 200, step: 1, value: ed.fadeMs, fmt: v => v + ' ms', onInput: v => { ed.fadeMs = v; } }),
    bpmCard,
    btn(app.ko2 ? 'Chop en pads' : 'Chop', { sel: true, onclick: () => openChop(s, ed.audio) }),
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
          await putSample({ ...s, duration: ed.audio.length / s.rate }, ed.audio); ed.saved = ed.audio; await refreshSamples(); flash('guardar');
          toast(igual ? `Se sobrescribió «${s.name}» (sin cambios)` : `Guardado: «${s.name}»`); app.render();
        } catch (e) { toast('No se pudo guardar (¿poco espacio en el dispositivo?)'); }
      } })),
    btn('Compartir', { sel: true, onclick: () => go('exportar') }));

  let raf = 0;
  const loop = () => {
    layout(src && playCtx ? ed.start + (ed.end - ed.start) * (((playCtx.currentTime - t0) % dur) / dur) : null);
    raf = requestAnimationFrame(loop);
  };
  loop();
  return () => cancelAnimationFrame(raf);
}

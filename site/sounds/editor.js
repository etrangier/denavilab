// Pestaña Editar: onda con dos marcadores, reproducción, recorte, fundido, normalizado, deshacer, tempo y carpeta.
import { app, go, refreshSamples, sampleById } from './state.js';
import { h, mount, fill, btn, link, card, label, muted, title, toggleRow, sliderRow, logo, confirmSheet, toast, folderPicker, drawBars } from './ui.js';
import * as dsp from './dsp.js';
import { putSample, getAudio, deleteSamples } from './store.js';
import { openChop } from './chop.js';

const ed = { id: null, audio: null, saved: null, peaks: [], undo: [], redo: [], start: 0, end: 1, fadeMs: 10, loop: false, noiseAmt: dsp.DENOISE_AMOUNT, sustain: true };
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
function apply(fn) {
  const out = fn(ed.audio);
  if (!out.length) return toast('La selección quedó vacía');
  if (out === ed.audio) return toast('No hay nada que cambiar: la selección es muy corta para eso');
  stopPlay(); ed.undo.push(ed.audio); ed.redo = []; setAudio(out); ed.start = 0; ed.end = 1; app.render();
}
function step(from, to) { const x = from.pop(); if (!x) return; to.push(ed.audio); stopPlay(); setAudio(x); ed.start = 0; ed.end = 1; app.render(); }

export function renderEdit(root) {
  const s = sampleById(app.selectedId);
  if (!s) {
    mount(root, title('Escuchar y editar'), h('div', { class: 'empty' }, logo(56), h('h2', {}, 'Elige una grabación'),
      muted('Abre una en la Biblioteca para recortarla y darle carácter.', 'center'), btn('Ir a la Biblioteca', { kind: 'amber', onclick: () => go('biblioteca') })));
    return;
  }
  if (ed.id !== s.id) {
    stopPlay(); Object.assign(ed, { id: s.id, audio: null, peaks: [], undo: [], redo: [], start: 0, end: 1 });
    getAudio(s.id).then(a => { if (ed.id === s.id) { setAudio(a); ed.saved = a; if (app.tab === 'editar') app.render(); } });
  }
  if (!ed.audio) { mount(root, title('Escuchar y editar'), muted('Cargando…')); return; }

  const n = ed.audio.length, total = n / s.rate, pk = dsp.peakDB(ed.audio), fade = Math.round(ed.fadeMs / 1000 * s.rate);
  const canvas = h('canvas', { class: 'wave', 'aria-label': 'Forma de onda' });
  const wrap = h('div', { class: 'wave-edit card' }, canvas);
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
    h('div', { class: 'stack tight' }, nameInput, h('p', { class: 'muted small' }, `${dsp.stamp(total)} · mono · ${s.rate} Hz · pico ${Math.round(pk)} dB`),
      pk < -30 ? h('p', { class: 'amber small' }, 'Nivel muy bajo: usa Normalizar para oírla bien.') : null),
    wrap, times,
    h('div', { class: 'controls' },
      h('div', { class: 'side' }, h('button', { type: 'button', class: 'circle', 'aria-label': 'Al inicio', onclick: () => { stopPlay(); app.render(); } }, '⏮'), h('span', { class: 'muted tiny' }, 'Al inicio')),
      h('button', { type: 'button', class: 'play-btn', 'aria-label': playing ? 'Parar' : 'Reproducir', onclick: () => { playing ? stopPlay() : play(); app.render(); } }, playing ? '❚❚' : '▶'),
      h('div', { class: 'side' }, h('button', { type: 'button', class: 'circle' + (ed.loop ? ' on' : ''), 'aria-pressed': String(ed.loop), 'aria-label': 'Repetir', onclick: () => { ed.loop = !ed.loop; if (src) src.loop = ed.loop; app.render(); } }, '↻'), h('span', { class: 'muted tiny' }, 'Repetir'))),
    label('Herramientas'),
    h('div', { class: 'row3' },
      btn('Recortar', { small: true, onclick: () => { const [a, b] = sel(); apply(x => dsp.fade(dsp.trim(x, a, b), fade, fade)); } }),
      btn('Normalizar', { small: true, onclick: () => apply(x => dsp.normalize(x)) }),
      btn('Fundido', { small: true, onclick: () => apply(x => dsp.fade(x, fade, fade)) })),
    btn('Armonizar bordes (sin clics)', { small: true, onclick: () => apply(x => dsp.harmonize(x, s.rate)) }),
    muted('Centra la onda y suaviza el inicio y el final a medida, para que un recorte no suene «cortado». Puedes deshacer.', 'tiny'),
    label('Creativo'),
    btn('Invertir', { small: true, onclick: () => { const [a, b] = sel(); apply(x => dsp.reverseRange(x, a, b)); } }),
    muted('Da la vuelta a la selección (o a toda la toma): una cola que se apaga pasa a ser un crescendo que «chupa» hacia el golpe.', 'tiny'),
    label('Colchón sostenido'),
    h('div', { class: 'row3' }, [4, 8, 16].map(f => btn('Colchón ×' + f, { small: true, onclick: () => {
      const [a, b] = sel();
      if (b - a < s.rate / 10) return toast('Marca al menos 0,1 s (o no marques nada para usar toda la toma)');
      if ((b - a) * f > s.rate * 600) return toast('Quedaría demasiado largo (más de 10 minutos): marca un tramo más corto');
      toast('Creando el colchón…'); setTimeout(() => apply(x => dsp.padStretch(x.slice(a, b), f, s.rate, ed.sustain)), 30);
    } }))),
    toggleRow('Sostener el nivel', 'Sube las colas que se apagan para que el colchón no se desvanezca', ed.sustain, v => { ed.sustain = v; }),
    muted('Estira la selección (o toda la toma) sin cambiar el tono y la difumina en un sonido continuo, ideal para notas de cuerda, pads y ambientes. Se queda sólo con lo estirado; puedes deshacer.', 'tiny'),
    label('Limpiar ruido'),
    h('div', { class: 'row2' },
      btn('Suave', { small: true, onclick: () => apply(x => dsp.cleanNoise(x, s.rate, 'soft')) }),
      btn('Fuerte', { small: true, onclick: () => apply(x => dsp.cleanNoise(x, s.rate, 'strong')) })),
    h('div', { class: 'row2' },
      btn('Quitar ruido de fondo', { small: true, onclick: () => {
        const w = dsp.quietestWindows(ed.audio, s.rate); if (!w.length) return toast('No hay una parte tranquila: marca una con los marcadores y usa «Con la selección»');
        apply(x => dsp.denoise(x, w.map(([a, b]) => x.slice(a, b)), ed.noiseAmt));
      } }),
      btn('Con la selección', { small: true, onclick: () => {
        const [a, b] = sel(); if (b - a < s.rate / 10) return toast('Marca una parte de solo ruido de al menos 0,1 s');
        apply(x => dsp.denoise(x, x.slice(a, b), ed.noiseAmt));
      } })),
    sliderRow('Intensidad', { min: 0.5, max: 3, step: 0.1, value: ed.noiseAmt, fmt: v => v < 1.2 ? 'Suave' : v < 2.2 ? 'Normal' : 'Fuerte', onInput: v => { ed.noiseAmt = v; } }),
    muted('Suave y Fuerte cortan graves (respiración, soplidos) y apagan lo que suena bajito entre sonidos. «Quitar ruido de fondo» aprende el ruido de la parte más tranquila; «Con la selección» lo aprende de lo que marques. Puedes deshacer.', 'tiny'),
    sliderRow('Fundido', { min: 0, max: 200, step: 1, value: ed.fadeMs, fmt: v => v + ' ms', onInput: v => { ed.fadeMs = v; } }),
    h('div', { class: 'row2' }, btn('Deshacer', { small: true, disabled: !ed.undo.length, onclick: () => step(ed.undo, ed.redo) }), btn('Rehacer', { small: true, disabled: !ed.redo.length, onclick: () => step(ed.redo, ed.undo) })),
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
      btn('Guardar', { kind: 'amber', small: true, onclick: async () => {
        // Misma toma que la ya guardada (p. ej. al tocar Guardar dos veces): se avisa de que se va a sobrescribir el mismo archivo.
        const igual = ed.audio === ed.saved;
        if (igual && !await confirmSheet({ title: 'No hay cambios nuevos', message: `«${s.name}» ya está guardada tal cual. Si sigues, se sobrescribe el mismo archivo.`, ok: 'Sobrescribir' })) return;
        try {
          await putSample({ ...s, duration: ed.audio.length / s.rate }, ed.audio); ed.saved = ed.audio; await refreshSamples();
          toast(igual ? `Se sobrescribió «${s.name}» (sin cambios)` : `Guardado: «${s.name}»`); app.render();
        } catch (e) { toast('No se pudo guardar (¿poco espacio en el dispositivo?)'); }
      } })),
    btn(app.ko2 ? 'Exportar al K.O. II' : 'Exportar', { sel: true, onclick: () => go('exportar') }));

  let raf = 0;
  const loop = () => {
    layout(src && playCtx ? ed.start + (ed.end - ed.start) * (((playCtx.currentTime - t0) % dur) / dur) : null);
    raf = requestAnimationFrame(loop);
  };
  loop();
  return () => cancelAnimationFrame(raf);
}

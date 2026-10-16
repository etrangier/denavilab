// Chop: corta la toma en trozos y deja elegir cuáles guardar o exportar (uno, varios, juntos o no).
import { app, refreshSamples } from './state.js';
import { h, mount, fill, btn, link, chip, card, label, muted, toggleRow, sliderRow, sheet, toast, drawBars } from './ui.js';
import * as dsp from './dsp.js';
import { putSample, newSample } from './store.js';
import { deliver, wavFromAudio, zipFiles } from './screens.js';

let ctx = null;
function playSlice(audio, rate, [a, b]) {
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume();
  const buf = ctx.createBuffer(1, b - a, rate); buf.copyToChannel(audio.subarray(a, b), 0);
  const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
}

export function openChop(sample, audio) {
  const pads = app.ko2 ? 'pads' : 'cortes';
  const S = { mode: 8, sens: 0.5, grid: false, harm: true, ranges: [], selected: new Set(), bpm: sample.bpm || (dsp.estimateBPM(audio, sample.rate) || {}).bpm || null };
  const peaks = dsp.peaks(audio, 56);
  const padEls = [];                       // botones de los pads, para iluminar el que está sonando
  let preview = null;                      // { src, raf } mientras suena «Escuchar selección»
  const stopPreview = () => {
    if (preview) { cancelAnimationFrame(preview.raf); try { preview.src.onended = null; preview.src.stop(); } catch (e) {} preview = null; }
    padEls.forEach(el => el && el.classList.remove('playing'));
  };

  sheet(close => {
    const box = h('div', { class: 'stack' }), canvas = h('canvas', { class: 'wave', style: { height: '110px' } });
    const recompute = () => {
      let starts = S.mode === 0 ? dsp.transients(audio, S.sens, Math.floor(sample.rate / 10), 11) : dsp.evenSlices(audio, S.mode);
      if (S.grid && S.bpm) starts = dsp.snapToGrid(starts, sample.rate * 60 / S.bpm / 4);
      S.ranges = dsp.slices(starts, audio.length).slice(0, 12);
      stopPreview(); S.selected = new Set();                   // al cambiar los cortes, los números ya no significan lo mismo
    };
    const chosen = () => [...S.selected].sort((a, b) => a - b).filter(i => i < S.ranges.length);
    const drawWave = () => drawBars(canvas, peaks, [0, 1], null, S.selected.size ? dsp.highlightRanges(S.ranges, audio.length, S.selected) : null, S.ranges.slice(1).map(r => r[0] / audio.length));

    const saveSelected = async () => {
      const ids = chosen();
      try {
        for (const i of ids) {
          const piece = harmonized(audio.slice(S.ranges[i][0], S.ranges[i][1]));
          await putSample(newSample(`${sample.name} · corte ${i + 1}`, piece, sample.rate, { folder: sample.folder, subfolder: sample.subfolder }), piece);
        }
        await refreshSamples(); toast(ids.length === 1 ? '1 corte guardado en la Biblioteca' : `${ids.length} cortes guardados en la Biblioteca`);
      } catch (e) { toast('No se pudo guardar (¿poco espacio en el dispositivo?)'); }
    };
    const harmonized = x => S.harm ? dsp.harmonize(x, sample.rate) : x;
    /** Los cortes elegidos, en su orden original, pegados en un solo sonido nuevo. */
    const saveJoined = async () => {
      const ids = chosen(), pieces = ids.map(i => audio.slice(S.ranges[i][0], S.ranges[i][1]));
      const joined = S.harm ? dsp.joinPieces(pieces, sample.rate) : pieces.reduce((a, p) => { const r = new Float32Array(a.length + p.length); r.set(a); r.set(p, a.length); return r; }, new Float32Array(0));
      try {
        await putSample(newSample(`${sample.name} · ${ids.map(i => i + 1).join('+')}`, joined, sample.rate, { folder: sample.folder, subfolder: sample.subfolder }), joined);
        await refreshSamples(); toast(`${ids.length} cortes unidos en un sonido nuevo (${dsp.stamp(joined.length / sample.rate)})`);
      } catch (e) { toast('No se pudo guardar (¿poco espacio en el dispositivo?)'); }
    };
    /** Escuchar la selección: los cortes elegidos uno tras otro, en su orden original; el pad que suena se ilumina. */
    const startPreview = () => {
      stopPreview();
      const pre = dsp.previewAudio(audio, S.ranges, S.selected, sample.rate); if (!pre.length) return;
      const plan = dsp.previewSegments(S.ranges, S.selected, sample.rate);
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume();
      const buf = ctx.createBuffer(1, pre.length, sample.rate); buf.copyToChannel(pre, 0);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
      const t0 = ctx.currentTime; src.start();
      preview = { src, raf: 0 };
      const tick = () => {
        if (!preview) return;
        const pos = Math.floor((ctx.currentTime - t0) * sample.rate), seg = plan.find(s => pos >= s.start && pos < s.end);
        padEls.forEach((el, i) => el && el.classList.toggle('playing', !!seg && seg.i === i));
        preview.raf = requestAnimationFrame(tick);
      };
      src.onended = () => { stopPreview(); paint(); };
      tick();
    };

    const exportSelected = async () => {
      const ids = chosen(), files = ids.map(i => wavFromAudio(dsp.pieceName(i, sample.name), harmonized(audio.slice(S.ranges[i][0], S.ranges[i][1])), sample.rate));
      if (files.length === 1) return deliver(files[0]);
      const zip = files.length ? await Promise.all(files.map(async f => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))) : [];
      await deliver(new File([zipFiles(zip)], 'denavilab-cortes.zip', { type: 'application/zip' }));
    };

    const paint = () => {
      const n = S.selected.size, total = S.ranges.length;
      const plan = dsp.previewSegments(S.ranges, S.selected, sample.rate), secs = plan.length ? plan[plan.length - 1].end / sample.rate : 0;
      padEls.length = 0;
      fill(box,
        h('div', { class: 'title-row' }, h('div', {}, h('h2', {}, app.ko2 ? 'Chop en pads' : 'Chop'), h('p', { class: 'muted small' }, `${total} cortes · ${n} seleccionado${n === 1 ? '' : 's'}`)), link('Cerrar', close)),
        card([canvas]),
        h('div', { class: 'wrap' }, [[4, '4'], [8, '8'], [12, '12'], [0, 'Auto']].map(([m, t]) => chip(t, S.mode === m, () => { S.mode = m; recompute(); paint(); }))),
        S.mode === 0 ? sliderRow('Sensibilidad de golpes', { min: 0, max: 1, step: 0.01, value: S.sens, fmt: v => v < 0.34 ? 'Baja' : v < 0.67 ? 'Media' : 'Alta', onInput: v => { S.sens = v; }, onChange: () => { recompute(); paint(); } }) : null,
        toggleRow('Ajustar a la cuadrícula', S.bpm ? `${Math.round(S.bpm)} BPM · 1/16 · funciona mejor si grabaste con compás` : 'BPM sin detectar: usa «Detectar BPM» en Editar', S.grid, v => { if (!S.bpm) return paint(); S.grid = v; recompute(); paint(); }),
        toggleRow('Armonizar cortes', 'Centra la onda y suaviza bordes, y al unir iguala el volumen: sin clics ni saltos', S.harm, v => { S.harm = v; paint(); }),
        muted(`Toca los ${pads} que quieras quedarte: se escuchan y se marcan. Puedes elegir los que quieras, juntos o no (por ejemplo, el 1 y el 3).`, 'small'),
        h('div', { class: 'row2' }, btn('Todos', { small: true, disabled: n === total, onclick: () => { stopPreview(); S.selected = new Set(S.ranges.keys()); paint(); } }), btn('Ninguno', { small: true, disabled: !n, onclick: () => { stopPreview(); S.selected = new Set(); paint(); } })),
        h('div', { class: 'padgrid' }, Array.from({ length: 12 }, (_, i) => {
          const live = i < total, on = S.selected.has(i);
          const el = h('button', { type: 'button', class: 'pad' + (on ? ' on' : ''), disabled: !live, 'aria-pressed': live ? String(on) : null, 'aria-label': (app.ko2 ? 'Pad ' : 'Corte ') + (i + 1) + (on ? ', seleccionado' : ''),
            onclick: () => { stopPreview(); on ? S.selected.delete(i) : S.selected.add(i); playSlice(audio, sample.rate, S.ranges[i]); paint(); } }, String(i + 1));
          padEls[i] = el; return el;
        })),
        app.ko2 && total < 12 ? muted(`Pads ${total + 1}–12 libres`, 'center tiny') : null,
        btn(preview ? 'Parar' : (n ? `Escuchar selección · ${secs.toFixed(1).replace('.', ',')} s` : 'Escuchar selección'), { sel: !!preview, disabled: !n, aria: preview ? 'Parar la escucha de la selección' : null,
          onclick: () => { if (preview) { stopPreview(); paint(); } else { startPreview(); paint(); } } }),
        btn(n ? `Guardar ${n} en la Biblioteca` : 'Elige al menos un corte', { kind: 'amber', disabled: !n, onclick: async () => { await saveSelected(); paint(); app.render(); } }),
        btn('Guardar unidos en un solo sonido', { sel: true, disabled: n < 2, onclick: async () => { await saveJoined(); paint(); app.render(); } }),
        btn(n ? (app.ko2 ? `Exportar ${n} para el K.O. II` : `Exportar ${n}`) : 'Exportar cortes', { sel: true, disabled: !n, onclick: exportSelected }));
      requestAnimationFrame(drawWave);
    };
    recompute(); paint(); return box;
  }, { onClose: stopPreview });
}

// Chop: corta la toma en trozos y deja elegir cuáles guardar o exportar (uno, varios, juntos o no).
import { app, refreshSamples } from './state.js';
import { h, mount, fill, btn, link, chip, card, label, muted, toggleRow, sliderRow, sheet, toast, drawBars, fx, flash } from './ui.js';
import * as dsp from './dsp.js';
import * as hm from './harmony.js';
import { putSample, newSample } from './store.js';
import { deliverMany, wavFromAudio } from './screens.js';

let ctx = null;
function playSlice(audio, rate, [a, b]) {
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume();
  const buf = ctx.createBuffer(1, b - a, rate); buf.copyToChannel(audio.subarray(a, b), 0);
  const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
}

export function openChop(sample, audio) {
  const pads = app.ko2 ? 'pads' : 'cortes';
  const S = { mode: 8, sens: 0.5, grid: false, harm: true, hm: false, an: null, lay: null, shift: 0, per: 1, want: 4, pick: null, fix: true, fixBpm: null, ranges: [], selected: new Set(), bpm: sample.bpm || (dsp.estimateBPM(audio, sample.rate) || {}).bpm || null };
  const peaks = dsp.peaks(audio, 56);
  const padEls = [];                       // botones de los pads, para iluminar el que está sonando
  let preview = null;                      // { src, raf } mientras suena «Escuchar selección»
  let loopSrc = null;                      // suena «Escuchar loop» (en bucle)
  const stopLoop = () => { if (loopSrc) { try { loopSrc.stop(); } catch (e) {} loopSrc = null; } };
  const stopPreview = () => {
    stopLoop();
    if (preview) { cancelAnimationFrame(preview.raf); try { preview.src.onended = null; preview.src.stop(); } catch (e) {} preview = null; }
    padEls.forEach(el => el && el.classList.remove('playing'));
  };

  sheet(close => {
    const box = h('div', { class: 'stack' }), canvas = h('canvas', { class: 'wave', style: { height: '110px' } });
    const autoPer = () => [1, 2, 4].find(p => Math.ceil(S.lay.bars.length / p) <= 12) || 4;
    /** Cortes por compás (o por 2 / 4 compases) cuando se detectaron compases. */
    const barRanges = () => {
      const bars = S.lay.bars, out = [];
      for (let i = 0; i * S.per < bars.length && out.length < 12; i++) { const g = bars.slice(i * S.per, i * S.per + S.per); out.push([g[0].start, g[g.length - 1].end]); }
      return out;
    };
    const padChord = i => { const g = S.lay.bars.slice(i * S.per, i * S.per + S.per); return g.length ? g.map(b => b.label).join(' · ') : null; };
    const relayout = () => { S.lay = hm.layout(S.an, S.an.downbeat + S.shift, S.want); };
    const recompute = () => {
      if (S.mode === -1 && S.lay) { relayout(); S.ranges = barRanges(); stopPreview(); S.selected = new Set(); return; }
      let starts = S.mode === 0 ? dsp.transients(audio, S.sens, Math.floor(sample.rate / 10), 11) : dsp.evenSlices(audio, S.mode);
      if (S.grid && S.bpm) starts = dsp.snapToGrid(starts, sample.rate * 60 / S.bpm / 4);
      S.ranges = dsp.slices(starts, audio.length).slice(0, 12);
      stopPreview(); S.selected = new Set();                   // al cambiar los cortes, los números ya no significan lo mismo
    };
    const chosen = () => [...S.selected].sort((a, b) => a - b).filter(i => i < S.ranges.length);
    const drawWave = () => drawBars(canvas, peaks, [0, 1], null, S.pick && !S.selected.size ? [[S.pick.start / audio.length, S.pick.end / audio.length]] : S.selected.size ? dsp.highlightRanges(S.ranges, audio.length, S.selected) : null, S.ranges.slice(1).map(r => r[0] / audio.length));

    const saveSelected = async () => {
      const ids = chosen();
      try {
        for (const i of ids) {
          const piece = harmonized(audio.slice(S.ranges[i][0], S.ranges[i][1]));
          await putSample(newSample(`${sample.name} · corte ${i + 1}`, piece, sample.rate, { folder: sample.folder, subfolder: sample.subfolder }), piece);
        }
        await refreshSamples(); flash('guardar-cortes'); toast(ids.length === 1 ? '1 corte guardado en la Biblioteca' : `${ids.length} cortes guardados en la Biblioteca`);
      } catch (e) { toast('No se pudo guardar (¿poco espacio en el dispositivo?)'); }
    };
    const analyzeWith = bpm => {
      const a = hm.analyze(audio, sample.rate, bpm);
      if (!a) { toast('No encuentro un pulso claro (o la toma tiene menos de 8 tiempos): no puedo detectar compases'); return false; }
      S.an = a; S.shift = 0; S.fixBpm = null; S.lay = hm.layout(a, a.downbeat, S.want); S.pick = S.lay.loop; S.per = autoPer(); S.mode = -1; return true;
    };
    /** Rango de audio de la selección si son compases seguidos (para escuchar o guardar como loop). */
    const loopRange = () => {
      if (S.mode !== -1 || !S.lay) return null;
      if (S.pick && !S.selected.size) return [S.pick.start, S.pick.end, S.pick.bars];
      const ids = chosen(); if (!ids.length || ids.some((v, k) => k && v !== ids[k - 1] + 1)) return null;
      return [S.ranges[ids[0]][0], S.ranges[ids[ids.length - 1]][1], ids.length * S.per];
    };
    /** BPM al que se fija el loop: el que pone el usuario o el detectado, redondeado. */
    const fmt = n => dsp.stamp(n / sample.rate), secs = n => (n / sample.rate).toFixed(2).replace(/\.?0+$/, '').replace('.', ',') + ' s';
    const loopBpm = () => S.fixBpm || hm.fixedBpm(S.lay.bpm);
    /** Ajuste de duración para el loop elegido, o null si no se fija el BPM o el cambio sería audible. */
    const loopFix = r => S.fix && Math.abs(hm.stretchPct(r[1] - r[0], hm.loopLength(sample.rate, loopBpm(), Math.round(r[2])))) <= hm.MAX_STRETCH_PCT ? { bpm: loopBpm(), bars: Math.round(r[2]) } : null;
    const toggleLoop = () => {
      if (loopSrc) { stopLoop(); return paint(); }
      const r = loopRange(); if (!r) return; stopPreview();
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume();
      const lp = hm.makeLoop(audio, r[0], r[1], sample.rate, 15, loopFix(r)), buf = ctx.createBuffer(1, lp.length, sample.rate); buf.copyToChannel(lp, 0);
      loopSrc = ctx.createBufferSource(); loopSrc.buffer = buf; loopSrc.loop = true; loopSrc.connect(ctx.destination); loopSrc.start(); paint();
    };
    const saveLoop = async () => {
      const r = loopRange(); if (!r) return;
      const fix = loopFix(r), lp = hm.makeLoop(audio, r[0], r[1], sample.rate, 15, fix), bars = Math.round(r[2]), chords = S.lay.bars.filter(b => b.start >= r[0] && b.end <= r[1] + 1).map(b => b.label).join(' · ');
      try {
        await putSample(newSample(`${sample.name} · loop ${bars === 1 ? '1 compás' : bars + ' compases'}${fix ? ' · ' + fix.bpm + ' BPM' : ''}`, lp, sample.rate, { folder: sample.folder, subfolder: sample.subfolder, bpm: fix ? fix.bpm : Math.round(S.lay.bpm * 10) / 10 }), lp);
        await refreshSamples(); flash('guardar-loop'); toast(`Loop de ${bars === 1 ? '1 compás' : bars + ' compases'} guardado (${chords}) · ${fix ? fix.bpm + ' BPM fijos, dura ' + dsp.stamp(lp.length / sample.rate) : '≈ ' + Math.round(S.lay.bpm) + ' BPM'}`);
      } catch (e) { toast('No se pudo guardar (¿poco espacio en el dispositivo?)'); }
    };
    const harmonized = x => S.harm ? dsp.harmonize(x, sample.rate) : x;
    /** Los cortes elegidos, en su orden original, pegados en un solo sonido nuevo. */
    const saveJoined = async () => {
      const ids = chosen(), pieces = ids.map(i => audio.slice(S.ranges[i][0], S.ranges[i][1]));
      const joined = S.harm ? dsp.joinPieces(pieces, sample.rate) : pieces.reduce((a, p) => { const r = new Float32Array(a.length + p.length); r.set(a); r.set(p, a.length); return r; }, new Float32Array(0));
      try {
        await putSample(newSample(`${sample.name} · ${ids.map(i => i + 1).join('+')}`, joined, sample.rate, { folder: sample.folder, subfolder: sample.subfolder }), joined);
        await refreshSamples(); flash('guardar-unidos'); toast(`${ids.length} cortes unidos en un sonido nuevo (${dsp.stamp(joined.length / sample.rate)})`);
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
      const ids = chosen(); if (!ids.length) return;
      await deliverMany(ids.map(i => wavFromAudio(dsp.pieceName(i, sample.name), harmonized(audio.slice(S.ranges[i][0], S.ranges[i][1])), sample.rate)), 'denavilab-cortes.zip');
    };

    const harmonyCard = () => {
      const L = S.lay, bars = L.bars, redo = f => () => { f(); recompute(); S.pick = S.lay.loop; paint(); };
      const chords = bars.slice(0, 12).map(b => b.label).join(' · ') + (bars.length > 12 ? ' …' : '');
      return card([
        h('div', { class: 'between' }, h('b', {}, 'Armonía'), h('span', { class: 'amber small' }, `≈ ${Math.round(L.bpm)} BPM · 4/4 · ${bars.length} compases`)),
        h('p', { class: 'small', 'aria-label': 'Acordes detectados' }, 'Acordes: ' + chords),
        h('p', { class: 'muted tiny' }, `El compás 1 empieza en ${dsp.stamp(bars[0].start / sample.rate)}. Si no cae donde lo oyes, muévelo un tiempo.`),
        h('div', { class: 'row2' }, btn('◀ 1 tiempo', { small: true, onclick: redo(() => { S.shift--; }) }), btn('1 tiempo ▶', { small: true, onclick: redo(() => { S.shift++; }) })),
        h('div', { class: 'row2' }, btn('Tempo ÷ 2', { small: true, onclick: () => { if (analyzeWith(L.bpm / 2)) { recompute(); } paint(); } }), btn('Tempo × 2', { small: true, onclick: () => { if (analyzeWith(L.bpm * 2)) { recompute(); } paint(); } })),
        S.mode === -1 && [1, 2, 4].some(p => p !== S.per) ? h('div', { class: 'wrap' }, [1, 2, 4].map(p => chip(p === 1 ? '1 compás por corte' : `${p} compases`, S.per === p, () => { S.per = p; recompute(); paint(); }))) : null,
        loopCard(L)]);
    };
    /** Loop de N compases sugerido (4 por defecto) sobre toda la toma, con alternativas y BPM fijo para pasarlo al K.O. */
    const loopCard = L => {
      const bpm = loopBpm(), counts = [1, 2, 4, 8].filter(n => n <= L.bars.length || n === S.want), r = loopRange();
      const stretch = r ? hm.stretchPct(r[1] - r[0], hm.loopLength(sample.rate, bpm, Math.round(r[2]))) : 0, okFix = r && Math.abs(stretch) <= hm.MAX_STRETCH_PCT;
      const setBpm = v => { S.fixBpm = Math.max(30, Math.min(300, v)); paint(); };
      return h('div', { class: 'loop-card', 'aria-label': 'Loop sugerido' }, [
        h('b', {}, 'Loop sugerido'),
        h('div', { class: 'wrap' }, counts.map(n => chip(n === 1 ? '1 compás' : `${n} compases`, S.want === n, () => { S.want = n; recompute(); S.pick = S.lay.loop; paint(); }))),
        L.loops && L.loops.length ? h('div', { class: 'wrap' }, L.loops.map((c, i) => chip(`${i === 0 ? 'Mejor' : 'Opción ' + (i + 1)} · ${fmt(c.start)}`, !!S.pick && S.pick.start === c.start && !S.selected.size, () => { S.selected = new Set(); S.pick = c; stopPreview(); paint(); }))) : null,
        h('p', { class: 'muted tiny' }, S.pick && !S.selected.size ? `${S.pick.bars === 1 ? '1 compás' : S.pick.bars + ' compases'} de ${fmt(S.pick.start)} a ${fmt(S.pick.end)} · ${S.pick.chords.join(' · ')}` : L.loop ? 'Elegiste cortes a mano: el loop son esos compases seguidos.' : 'No encontré un tramo que se repita bien.'),
        toggleRow('Fijar BPM', S.fix ? `${bpm} BPM: el loop dura justo ${r ? secs(hm.loopLength(sample.rate, bpm, Math.round(r[2]))) : '—'}${r && okFix ? ` (ajuste ${stretch >= 0 ? '+' : ''}${stretch.toFixed(2).replace('.', ',')} %)` : r ? ' · el ajuste sería muy grande: se deja sin fijar' : ''}` : 'El loop conserva su duración original', S.fix, v => { S.fix = v; paint(); }),
        S.fix ? h('div', { class: 'row2' }, btn('BPM −1', { small: true, onclick: () => setBpm(bpm - 1) }), btn('BPM +1', { small: true, onclick: () => setBpm(bpm + 1) })) : null]);
    };
    const paint = () => {
      const n = S.selected.size, total = S.ranges.length;
      const plan = dsp.previewSegments(S.ranges, S.selected, sample.rate), secs = plan.length ? plan[plan.length - 1].end / sample.rate : 0;
      padEls.length = 0;
      fill(box,
        h('div', { class: 'title-row' }, h('div', {}, h('h2', {}, app.ko2 ? 'Chop en pads' : 'Chop'), h('p', { class: 'muted small' }, `${total} cortes · ${n} seleccionado${n === 1 ? '' : 's'}`)), link('Cerrar', close)),
        card([canvas]),
        h('div', { class: 'wrap' }, [[4, '4'], [8, '8'], [12, '12'], [0, 'Auto'], ...(S.lay ? [[-1, 'Compases']] : [])].map(([m, t]) => chip(t, S.mode === m, () => { S.mode = m; recompute(); paint(); }))),
        S.mode === 0 ? sliderRow('Sensibilidad de golpes', { min: 0, max: 1, step: 0.01, value: S.sens, fmt: v => v < 0.34 ? 'Baja' : v < 0.67 ? 'Media' : 'Alta', onInput: v => { S.sens = v; }, onChange: () => { recompute(); paint(); } }) : null,
        toggleRow('Detectar acordes y compases', 'Aproximado: acordes mayores y menores, compás de 4 tiempos', S.hm, v => {
          if (!v) { S.hm = false; S.an = S.lay = S.pick = null; if (S.mode === -1) S.mode = 8; recompute(); return paint(); }
          if (analyzeWith(S.bpm)) { S.hm = true; recompute(); } paint();
        }),
        S.lay ? harmonyCard() : null,
        toggleRow('Ajustar a la cuadrícula', S.bpm ? `${Math.round(S.bpm)} BPM · 1/16 · funciona mejor si grabaste con compás` : 'BPM sin detectar: usa «Detectar BPM» en Editar', S.grid, v => { if (!S.bpm) return paint(); S.grid = v; recompute(); paint(); }),
        toggleRow('Armonizar cortes', 'Centra la onda y suaviza bordes, y al unir iguala el volumen: sin clics ni saltos', S.harm, v => { S.harm = v; paint(); }),
        muted(`Toca los ${pads} que quieras quedarte: se escuchan y se marcan. Puedes elegir los que quieras, juntos o no (por ejemplo, el 1 y el 3).`, 'small'),
        h('div', { class: 'row2' }, btn('Todos', { small: true, disabled: n === total, onclick: () => { stopPreview(); S.selected = new Set(S.ranges.keys()); paint(); } }), btn('Ninguno', { small: true, disabled: !n, onclick: () => { stopPreview(); S.selected = new Set(); paint(); } })),
        h('div', { class: 'padgrid' }, Array.from({ length: 12 }, (_, i) => {
          const live = i < total, on = S.selected.has(i);
          const el = h('button', { type: 'button', class: 'pad' + (on ? ' on' : ''), disabled: !live, 'aria-pressed': live ? String(on) : null, 'aria-label': (app.ko2 ? 'Pad ' : 'Corte ') + (i + 1) + (live && S.mode === -1 && S.lay ? ', ' + padChord(i) : '') + (on ? ', seleccionado' : ''),
            onclick: () => { stopPreview(); on ? S.selected.delete(i) : S.selected.add(i); playSlice(audio, sample.rate, S.ranges[i]); paint(); } },
            String(i + 1), live && S.mode === -1 && S.lay ? h('small', { class: 'pad-chord' }, padChord(i)) : null);
          padEls[i] = el; return el;
        })),
        app.ko2 && total < 12 ? muted(`Pads ${total + 1}–12 libres`, 'center tiny') : null,
        btn(preview ? 'Parar' : (n ? `Escuchar selección · ${secs.toFixed(1).replace('.', ',')} s` : 'Escuchar selección'), { sel: !!preview, disabled: !n, aria: preview ? 'Parar la escucha de la selección' : null,
          onclick: () => { if (preview) { stopPreview(); paint(); } else { startPreview(); paint(); } } }),
        btn(n ? `Guardar ${n} en la Biblioteca` : 'Elige al menos un corte', { kind: 'amber', act: 'guardar-cortes', disabled: !n, onclick: async () => { await saveSelected(); paint(); app.render(); } }),
        S.lay ? btn(loopSrc ? 'Parar el loop' : 'Escuchar loop', { sel: !!loopSrc, disabled: !loopRange(), aria: loopSrc ? 'Parar el loop' : null, onclick: toggleLoop }) : null,
        S.lay ? btn('Guardar selección como loop', { sel: true, act: 'guardar-loop', disabled: !loopRange(), onclick: async () => { await saveLoop(); paint(); app.render(); } }) : null,
        btn('Guardar unidos en un solo sonido', { sel: true, act: 'guardar-unidos', disabled: n < 2, onclick: async () => { await saveJoined(); paint(); app.render(); } }),
        btn(n ? `Compartir ${n} (WAV)` : 'Compartir cortes (WAV)', { sel: true, disabled: !n, onclick: exportSelected }));
      requestAnimationFrame(drawWave);
    };
    recompute(); paint(); return box;
  }, { onClose: stopPreview });
}

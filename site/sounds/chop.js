// Chop: corta la toma en trozos y deja elegir cuáles guardar o exportar (uno, varios, juntos o no).
import { app, refreshSamples } from './state.js';
import { h, mount, fill, btn, link, chip, card, label, muted, toggleRow, sliderRow, sheet, toast, drawBars, fx, flash } from './ui.js';
import * as dsp from './dsp.js';
import * as hm from './harmony.js';
import * as gd from './grid.js';
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
  const S = { mode: 8, sens: 0.5, grid: false, harm: true, hm: false, an: null, lay: null, shift: 0, per: 1, want: 4, pick: null, style: 'libre', pump: false, auto: true, saved: new Map(), G: { on: false, bars: 2, steps: 8, cells: gd.emptyCells(2, 8), brush: null, tool: 'paint', sel: new Set(), clip: null }, fix: true, fixBpm: null, ranges: [], selected: new Set(), bpm: sample.bpm || (dsp.estimateBPM(audio, sample.rate) || {}).bpm || null };
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
    const relayout = () => { S.lay = hm.layout(S.an, S.an.downbeat + S.shift, S.want, S.style); };
    /** Lo que se sugiere al abrir o cambiar de estilo: el loop de siempre, o el primer arreglo / patrón detectado del estilo. */
    const firstPick = () => S.style === 'libre' ? S.lay.loop : S.lay.arranged[0] || S.lay.patterns.best || S.lay.loop;
    const recompute = () => {
      if (S.mode === -1 && S.lay) { relayout(); S.ranges = barRanges(); stopPreview(); S.selected = new Set(); return; }
      let starts = S.mode === 0 ? dsp.transients(audio, S.sens, Math.floor(sample.rate / 10), 11) : dsp.evenSlices(audio, S.mode);
      if (S.grid && S.bpm) starts = dsp.snapToGrid(starts, sample.rate * 60 / S.bpm / 4);
      S.ranges = dsp.slices(starts, audio.length).slice(0, 12);
      stopPreview(); S.selected = new Set();                   // al cambiar los cortes, los números ya no significan lo mismo
    };
    const chosen = () => [...S.selected].sort((a, b) => a - b).filter(i => i < S.ranges.length);
    const drawWave = () => drawBars(canvas, peaks, [0, 1], null, S.pick && !S.selected.size ? (S.pick.ranges || [[S.pick.start, S.pick.end]]).map(([a, b]) => [a / audio.length, b / audio.length]) : S.selected.size ? dsp.highlightRanges(S.ranges, audio.length, S.selected) : null, S.ranges.slice(1).map(r => r[0] / audio.length));

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
      S.an = a; S.shift = 0; S.fix = true; S.fixBpm = hm.fixedBpm(a.bpm); S.lay = hm.layout(a, a.downbeat, S.want, S.style); S.pick = firstPick(); S.per = autoPer(); S.mode = -1;
      if (S.pick) toast(`Loop sugerido listo: ${S.pick.bars === 1 ? '1 compás' : S.pick.bars + ' compases'} a ${S.fixBpm} BPM fijos`);
      return true;
    };
    /** Rango de audio de la selección si son compases seguidos (para escuchar o guardar como loop). */
    const loopRange = () => {
      if (S.mode !== -1 || !S.lay) return null;
      if (S.pick && !S.selected.size) return S.pick.ranges ? [S.pick.start, S.pick.end, S.pick.bars, S.pick.len, S.pick.ranges] : [S.pick.start, S.pick.end, S.pick.bars];
      const ids = chosen(); if (!ids.length) return null;
      if (ids.some((v, k) => k && v !== ids[k - 1] + 1)) {                        // cortes sueltos (1, 3 y 5…): se combinan en un solo loop
        const ranges = ids.map(i => S.ranges[i]), len = ranges.reduce((a, r) => a + r[1] - r[0], 0);
        return [ranges[0][0], ranges[ranges.length - 1][1], Math.max(1, Math.round(len / (4 * S.lay.period))), len, ranges];
      }
      return [S.ranges[ids[0]][0], S.ranges[ids[ids.length - 1]][1], ids.length * S.per];
    };
    /** BPM al que se fija el loop: el que pone el usuario o el detectado, redondeado. */
    const same = (a, b) => !!a && !!b && a.kind === b.kind && a.name === b.name && a.start === b.start && a.bars === b.bars && !!a.picks === !!b.picks && (!a.picks || a.picks.join() === b.picks.join());
    const fmt = n => dsp.stamp(n / sample.rate), secs = n => (n / sample.rate).toFixed(2).replace(/\.?0+$/, '').replace('.', ',') + ' s';
    const loopBpm = () => S.fixBpm || hm.fixedBpm(S.lay.bpm);
    /** Ajuste de duración para el loop elegido, o null si no se fija el BPM o el cambio sería audible. */
    const loopFix = r => S.fix && Math.abs(hm.stretchPct(r[3] || r[1] - r[0], hm.loopLength(sample.rate, loopBpm(), Math.round(r[2])))) <= hm.MAX_STRETCH_PCT ? { bpm: loopBpm(), bars: Math.round(r[2]) } : null;
    /** Audio del loop elegido: tramo seguido o, si son compases sueltos, los compases combinados. */
    const loopAudio = r => {
      const fix = loopFix(r), st = hm.STYLES[S.style];
      const base = r[4] && r[4].length > 1 ? hm.makeCombo(audio, r[4], sample.rate, fix, { crossfadeMs: st.crossfadeMs }) : hm.makeLoop(audio, r[0], r[1], sample.rate, 15, fix);
      return S.pump && st.pump ? hm.pump(base, sample.rate, fix ? fix.bpm : S.lay.bpm, st.pump) : base;
    };
    /** Cómo se llama lo que se está guardando: loop, loop combinado, patrón o arreglo. */
    const pickName = () => {
      const k = S.pick && !S.selected.size ? S.pick.kind : null, r = loopRange();
      return k === 'pattern' ? 'Patrón' : k === 'arreglo' ? `Arreglo ${S.pick.name}` : r && r[4] && r[4].length > 1 || k === 'combo' ? 'Loop combinado' : 'Loop';
    };
    const styleTag = () => S.style === 'libre' ? '' : ' · ' + (S.style === 'daftpunk' ? 'Daft Punk' : 'Cerati');
    const toggleLoop = () => {
      if (loopSrc) { stopLoop(); return paint(); }
      const r = loopRange(); if (!r) return; stopPreview();
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume();
      const lp = loopAudio(r), buf = ctx.createBuffer(1, lp.length, sample.rate); buf.copyToChannel(lp, 0);
      loopSrc = ctx.createBufferSource(); loopSrc.buffer = buf; loopSrc.loop = true; loopSrc.connect(ctx.destination); loopSrc.start(); paint();
    };
    const saveLoop = async () => {
      const r = loopRange(); if (!r) return;
      const fix = loopFix(r), bars = Math.round(r[2]), nm = pickName(), pumped = S.pump && hm.STYLES[S.style].pump > 0;
      const full = `${sample.name} · ${nm.toLowerCase()} ${bars === 1 ? '1 compás' : bars + ' compases'}${styleTag()}${pumped ? ' · bombeo' : ''}${fix ? ' · ' + fix.bpm + ' BPM' : ''}`;
      if (S.saved.has(full)) { toast(S.saved.get(full)); return; }          // ya guardado (al elegir): no se duplica
      const lp = loopAudio(r), spans = r[4] || [[r[0], r[1]]], chords = S.lay.bars.filter(b => spans.some(([a, z]) => b.start >= a && b.end <= z + 1)).map(b => b.label).join(' · ');
      try {
        await putSample(newSample(full, lp, sample.rate, { folder: sample.folder, subfolder: sample.subfolder, bpm: fix ? fix.bpm : Math.round(S.lay.bpm * 10) / 10 }), lp);
        await refreshSamples(); flash('guardar-loop');
        const msg = `${nm} de ${bars === 1 ? '1 compás' : bars + ' compases'} guardado (${chords}) · ${fix ? fix.bpm + ' BPM fijos, dura ' + dsp.stamp(lp.length / sample.rate) : '≈ ' + Math.round(S.lay.bpm) + ' BPM'}`;
        S.saved.set(full, msg); toast(msg);
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
      const L = S.lay, bars = L.bars, redo = f => () => { f(); recompute(); S.pick = firstPick(); paint(); };
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
    /** Elige una sugerencia; con «Guardar al elegir» encendido queda guardada en la Biblioteca de inmediato. */
    const choose = c => {
      S.selected = new Set(); S.pick = c; stopPreview(); paint();
      if (S.auto) saveLoop().then(() => { paint(); app.render(); });
    };
    const loopCard = L => {
      const bpm = loopBpm(), counts = [1, 2, 3, 4, 8].filter(n => n <= L.bars.length || n === S.want), r = loopRange();
      const stretch = r ? hm.stretchPct(r[3] || r[1] - r[0], hm.loopLength(sample.rate, bpm, Math.round(r[2]))) : 0, okFix = r && Math.abs(stretch) <= hm.MAX_STRETCH_PCT;
      const setBpm = v => { S.fixBpm = Math.max(30, Math.min(300, v)); paint(); };
      return h('div', { class: 'loop-card', 'aria-label': 'Loop sugerido' }, [
        h('b', {}, 'Loop sugerido'),
        h('div', { class: 'wrap' }, [['libre', 'Libre'], ['daftpunk', 'Daft Punk'], ['cerati', 'Cerati']].map(([k, t]) => chip(t, S.style === k, () => { S.style = k; S.want = hm.STYLES[k].want; S.pump = !!hm.STYLES[k].pump; S.selected = new Set(); recompute(); S.pick = firstPick(); stopPreview(); paint(); }))),
        S.style !== 'libre' ? h('p', { class: 'muted tiny' }, S.style === 'daftpunk' ? 'Daft Punk: trozos cortos con groove y golpe en el 1, cortes secos, repetidos en bucle con una variación al final y bombeo (sidechain)' : 'Cerati: texturas largas que cambian de armonía con suavidad, empalmes largos y forma A B A C') : null,
        patternBlock(L),
        h('div', { class: 'wrap' }, counts.map(n => chip(n === 1 ? '1 compás' : `${n} compases`, S.want === n, () => { S.want = n; recompute(); S.pick = firstPick(); paint(); }))),
        L.loops && L.loops.length ? h('div', { class: 'wrap' }, L.loops.map((c, i) => chip(`${i === 0 ? 'Mejor' : 'Opción ' + (i + 1)} · ${fmt(c.start)}`, same(S.pick, c) && !S.selected.size, () => choose(c)))) : null,
        L.combos && L.combos.length ? [h('p', { class: 'muted tiny' }, 'Combinaciones: compases sueltos de la toma, en su orden, que juntos forman una progresión que empalma bien'),
          h('div', { class: 'wrap' }, L.combos.map((c, i) => chip(`Combinado ${i + 1} · ${c.chords.join(' ')}`, same(S.pick, c) && !S.selected.size, () => choose(c))))] : null,
        h('p', { class: 'muted tiny' }, S.pick && !S.selected.size ? (S.pick.kind === 'pattern' ? `Patrón de ${S.pick.bars === 1 ? '1 compás' : S.pick.bars + ' compases'} (compases ${S.pick.picks.map(i => i + 1).join(', ')} de la toma, los más típicos de cada posición) · ${S.pick.chords.join(' · ')}` : S.pick.kind === 'arreglo' ? `Arreglo ${S.pick.name}: compases ${S.pick.picks.map(i => i + 1).join(', ')} de la toma · ${S.pick.chords.join(' · ')}` : S.pick.picks ? `Combinado de ${S.pick.bars} compases: los compases ${S.pick.picks.map(i => i + 1).join(', ')} de la toma · ${S.pick.chords.join(' · ')}` : `${S.pick.bars === 1 ? '1 compás' : S.pick.bars + ' compases'} de ${fmt(S.pick.start)} a ${fmt(S.pick.end)} · ${S.pick.chords.join(' · ')}`) : L.loop ? 'Elegiste cortes a mano: el loop son esos compases, seguidos o combinados en su orden.' : 'No encontré un tramo que se repita bien.'),
        toggleRow('Guardar al elegir', 'Al tocar una sugerencia (loop, patrón, arreglo o combinado) queda guardada en la Biblioteca sin pulsar nada más', S.auto, v => { S.auto = v; paint(); }),
        toggleRow('Fijar BPM', S.fix ? `${bpm} BPM: el loop dura justo ${r ? secs(hm.loopLength(sample.rate, bpm, Math.round(r[2]))) : '—'}${r && okFix ? ` (ajuste ${stretch >= 0 ? '+' : ''}${stretch.toFixed(2).replace('.', ',')} %)` : r ? ' · el ajuste sería muy grande: se deja sin fijar' : ''}` : 'El loop conserva su duración original', S.fix, v => { S.fix = v; paint(); }),
        S.fix ? h('div', { class: 'row2' }, btn('BPM −1', { small: true, onclick: () => setBpm(bpm - 1) }), btn('BPM +1', { small: true, onclick: () => setBpm(bpm + 1) })) : null]);
    };
    /** Patrón detectado y sus opciones de 1 a 4 compases, más los arreglos del estilo elegido. */
    const patternBlock = L => {
      const P = L.patterns, pick = c => () => choose(c);
      if (!P || !P.best) return null;
      const pct = v => Math.round(Math.max(0, Math.min(1, v)) * 100) + ' %', on = c => same(S.pick, c) && !S.selected.size;
      return [h('p', { class: 'small', 'aria-label': 'Patrón detectado' }, `Patrón detectado: ${P.best.period === 1 ? '1 compás' : P.best.period + ' compases'} (se repite ${P.best.repeats} ${P.best.repeats === 1 ? 'vez' : 'veces'}, similitud ${pct(P.best.strength)})`),
        h('div', { class: 'wrap' }, P.options.map(c => chip(`Patrón de ${c.period === 1 ? '1 compás' : c.period + ' compases'}${c === P.best ? ' ★' : ''}`, on(c), pick(c)))),
        L.arranged && L.arranged.length ? [h('p', { class: 'muted tiny' }, 'Arreglos del estilo, armados con compases de la toma'),
          h('div', { class: 'wrap' }, L.arranged.map(c => chip(`Arreglo ${c.name}`, on(c), pick(c))))] : null,
        S.style === 'daftpunk' ? toggleRow('Bombeo (sidechain)', 'Baja el volumen en cada tiempo y lo recupera, como la compresión sobre el bombo', S.pump, v => { S.pump = v; stopLoop(); paint(); }) : null];
    };
    // ---- Grilla: cada casilla lleva un corte; copiar, cortar y pegar casillas ----
    const gridBpm = () => S.fixBpm || hm.fixedBpm(S.lay ? S.lay.bpm : S.bpm || 100);
    const gridAudio = () => gd.renderGrid(S.ranges.map(r => harmonized(audio.slice(r[0], r[1]))), S.G.cells, { bars: S.G.bars, steps: S.G.steps, bpm: gridBpm(), rate: sample.rate });
    const gridPlay = () => {
      if (loopSrc) { stopLoop(); return paint(); }
      stopPreview(); ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume();
      const lp = gridAudio(), buf = ctx.createBuffer(1, lp.length, sample.rate); buf.copyToChannel(lp, 0);
      loopSrc = ctx.createBufferSource(); loopSrc.buffer = buf; loopSrc.loop = true; loopSrc.connect(ctx.destination); loopSrc.start(); paint();
    };
    const gridSave = async () => {
      const G = S.G, lp = gridAudio(), bpm = gridBpm();
      try {
        await putSample(newSample(`${sample.name} · grilla ${G.bars === 1 ? '1 compás' : G.bars + ' compases'} · ${bpm} BPM`, lp, sample.rate, { folder: sample.folder, subfolder: sample.subfolder, bpm }), lp);
        await refreshSamples(); flash('guardar-grilla'); toast(`Grilla de ${G.bars === 1 ? '1 compás' : G.bars + ' compases'} guardada · ${bpm} BPM fijos, dura ${dsp.stamp(lp.length / sample.rate)}`);
      } catch (e) { toast('No se pudo guardar (¿poco espacio en el dispositivo?)'); }
    };
    const gridCard = () => {
      const G = S.G;
      if (!G.on) return toggleRow('Armar en grilla', 'Pon cada corte en una casilla; copia, corta y pega casillas, y guárdalo como loop a BPM fijo', false, () => { G.on = true; if (G.brush === null && S.ranges.length) G.brush = 0; paint(); });
      const sel = [...G.sel].sort((a, b) => a - b), filled = G.cells.some(v => v !== null), cols = Math.min(8, G.steps);
      const edit = f => () => { f(); paint(); };
      const resize = (bars, steps) => { G.cells = gd.resizeCells(G.cells, bars, steps, G.bars, G.steps); G.bars = bars; G.steps = steps; G.sel = new Set(); stopLoop(); paint(); };
      const tap = k => {
        if (G.tool === 'select') { G.sel.has(k) ? G.sel.delete(k) : G.sel.add(k); return paint(); }
        if (G.brush === null || G.brush >= S.ranges.length) return toast('Elige primero un corte (pincel)');
        G.cells[k] = G.cells[k] === G.brush ? null : G.brush; if (G.cells[k] !== null) playSlice(audio, sample.rate, S.ranges[G.brush]); stopLoop(); paint();
      };
      return card([
        toggleRow('Armar en grilla', 'Pon cada corte en una casilla; copia, corta y pega casillas, y guárdalo como loop a BPM fijo', true, v => { if (!v) { G.on = false; G.sel = new Set(); stopLoop(); } paint(); }),
        h('div', { class: 'wrap' }, [1, 2, 4].map(b => chip(b === 1 ? '1 compás' : `${b} compases `, G.bars === b, () => resize(b, G.steps)))),
        h('div', { class: 'wrap' }, gd.GRID_STEPS.map(n => chip(`${n} casillas por compás`, G.steps === n, () => resize(G.bars, n)))),
        h('div', { class: 'wrap' }, [['paint', 'Pintar'], ['select', 'Seleccionar casillas']].map(([t, name]) => chip(name, G.tool === t, edit(() => { G.tool = t; })))),
        G.tool === 'paint' ? h('div', { class: 'wrap' }, S.ranges.map((_, i) => chip(`Pincel ${i + 1}`, G.brush === i, edit(() => { G.brush = i; })))) : null,
        h('div', { class: 'seq', 'aria-label': 'Grilla de cortes', style: { gridTemplateColumns: `repeat(${cols}, 1fr)` } }, G.cells.map((v, k) => {
          const on = G.sel.has(k);
          return h('button', { type: 'button', class: 'pad cell' + (v !== null ? ' on' : '') + (on ? ' picked' : '') + (k % G.steps === 0 ? ' bar0' : ''), 'aria-pressed': G.tool === 'select' ? String(on) : null,
            'aria-label': `Casilla ${k + 1}${v !== null ? ', corte ' + (v + 1) : ', vacía'}${on ? ', seleccionada' : ''}`, onclick: () => tap(k) }, v !== null ? String(v + 1) : '·');
        })),
        G.tool === 'select' ? h('div', { class: 'wrap' }, [
          btn('Copiar', { small: true, disabled: !sel.length, onclick: edit(() => { G.clip = gd.copyCells(G.cells, G.sel); }) }),
          btn('Cortar', { small: true, disabled: !sel.length, onclick: edit(() => { G.clip = gd.copyCells(G.cells, G.sel); G.cells = gd.clearCells(G.cells, G.sel); stopLoop(); }) }),
          btn('Pegar', { small: true, disabled: !G.clip || !sel.length, onclick: edit(() => { G.cells = gd.pasteCells(G.cells, G.clip, sel[0]); stopLoop(); }) }),
          btn('Borrar', { small: true, disabled: !sel.length, onclick: edit(() => { G.cells = gd.clearCells(G.cells, G.sel); stopLoop(); }) }),
          btn('Quitar selección', { small: true, disabled: !sel.length, onclick: edit(() => { G.sel = new Set(); }) })]) : null,
        G.tool === 'select' ? muted(G.clip ? `Copiadas ${G.clip.items.length} casillas: elige la casilla donde empieza el pegado y pulsa Pegar` : 'Toca las casillas que quieras copiar o cortar (se conserva el ritmo entre ellas)', 'tiny') : muted('Toca una casilla para poner el corte elegido; tócala otra vez para vaciarla. Cada corte suena hasta el siguiente.', 'tiny'),
        muted(`${G.bars === 1 ? '1 compás' : G.bars + ' compases'} · ${gridBpm()} BPM fijos · dura ${dsp.stamp(hm.loopLength(sample.rate, gridBpm(), G.bars) / sample.rate)}`, 'tiny'),
        btn(loopSrc ? 'Parar la grilla' : 'Escuchar grilla', { sel: !!loopSrc, disabled: !filled, onclick: gridPlay }),
        btn('Guardar grilla como loop', { sel: true, act: 'guardar-grilla', disabled: !filled, onclick: async () => { await gridSave(); paint(); app.render(); } }),
        btn('Vaciar grilla', { small: true, disabled: !filled, onclick: edit(() => { G.cells = gd.emptyCells(G.bars, G.steps); G.sel = new Set(); stopLoop(); }) })]);
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
            onclick: () => { stopPreview(); if (S.G.on) S.G.brush = i; on ? S.selected.delete(i) : S.selected.add(i); playSlice(audio, sample.rate, S.ranges[i]); paint(); } },
            String(i + 1), live && S.mode === -1 && S.lay ? h('small', { class: 'pad-chord' }, padChord(i)) : null);
          padEls[i] = el; return el;
        })),
        app.ko2 && total < 12 ? muted(`Pads ${total + 1}–12 libres`, 'center tiny') : null,
        gridCard(),
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

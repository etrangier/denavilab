// Pantallas: Inicio, Grabar, Biblioteca, Exportar, y las hojas (retroactiva, guardar, metrónomo, manual…).
import { app, go, openSample, refreshSamples, sampleById, VERSION, inst, isStandalone, platform, installApp } from './state.js';
import { h, mount, fill, btn, link, chip, card, label, muted, title, toggleRow, sliderRow, logo, sheet, confirmSheet, promptSheet, toast, folderPicker, drawBars } from './ui.js';
import * as dsp from './dsp.js';
import { FOLDERS, UNSORTED, folderDetail, folderOf } from './folders.js';
import { getAudio, putSample, putMany, deleteSamples, newSample } from './store.js';
import { manualFor } from './manual.js';
import { makeZip, readZip } from './zip.js';
import { rateLabel, exportRates, KO_EXPORT } from './profile.js';

const ls = {
  get(k, d) { try { const v = localStorage.getItem('denavilab.sounds.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('denavilab.sounds.' + k, JSON.stringify(v)); } catch (e) {} },
};
const hz = r => String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Hz';
const pathOf = s => [folderOf(s), s.subfolder].filter(Boolean).join(' › ');
export const exportRate = () => { const r = ls.get('rate', exportRates()[0]); return exportRates().includes(r) ? r : exportRates()[0]; };
export const loadQuick = () => ({ ...dsp.QUICK_DEFAULTS, ...ls.get('quick', {}) });

// Escucha rápida desde la Biblioteca: una a la vez, sin abrir la edición.
const aud = { id: null, src: null, ctx: null };
export function stopAudition() {
  if (aud.src) { try { aud.src.onended = null; aud.src.stop(); } catch (e) {} }
  aud.src = null; aud.id = null;
}
async function toggleAudition(s) {
  if (aud.id === s.id) { stopAudition(); return app.render(); }
  stopAudition(); aud.id = s.id; app.render();
  try {
    const a = await getAudio(s.id); if (aud.id !== s.id) return;
    if (!a.length) { stopAudition(); app.render(); return toast('Esta grabación no tiene audio'); }
    aud.ctx = aud.ctx || new (window.AudioContext || window.webkitAudioContext)(); aud.ctx.resume();
    const buf = aud.ctx.createBuffer(1, a.length, s.rate); buf.copyToChannel(a, 0);
    const src = aud.ctx.createBufferSource(); src.buffer = buf; src.connect(aud.ctx.destination);
    src.onended = () => { if (aud.src === src) { aud.src = null; aud.id = null; app.render(); } };
    aud.src = src; src.start();
  } catch (e) { stopAudition(); app.render(); toast('No se pudo reproducir'); }
}
const listenBtn = s => h('button', { type: 'button', class: 'icon-btn' + (aud.id === s.id ? ' on' : ''), 'aria-pressed': String(aud.id === s.id),
  'aria-label': (aud.id === s.id ? 'Parar ' : 'Escuchar ') + s.name, onclick: () => toggleAudition(s) }, aud.id === s.id ? '■' : '▶');

export function sampleRow(s, { onclick, trailing, listen = false } = {}) {
  const right = trailing !== undefined ? trailing : (app.ko2 ? (s.slot ? 'slot ' + s.slot : 'sin enviar') : '');
  const row = h('button', { type: 'button', class: 'card row-btn', onclick: onclick || (() => { stopAudition(); openSample(s); }) },
    h('span', { class: 'rb-text' }, h('b', {}, s.name), h('small', {}, pathOf(s) + ' · ' + dsp.stamp(s.duration))),
    right ? h('span', { class: 'amber small' }, right) : null);
  return listen ? h('div', { class: 'sel-row' }, row, listenBtn(s)) : row;
}

// ====================================================================== INICIO
/** Deja la app como acceso directo en la pantalla de inicio: con el aviso del navegador si existe; si no, con los pasos a mano. */
async function instalar() {
  const r = await installApp();
  if (r === 'accepted') return toast('Instalada: búscala en la pantalla de inicio de tu celular');
  if (r === 'dismissed') return;
  const pasos = {
    ios: ['Abre esta página en Safari (en otros navegadores el iPhone no deja instalar).', 'Toca el botón Compartir (el cuadrado con una flecha hacia arriba).', 'Baja y elige «Añadir a pantalla de inicio».', 'Toca «Añadir». El ícono aparece junto a tus otras apps.'],
    android: ['Abre esta página en Chrome.', 'Toca el menú ⋮ (arriba a la derecha).', 'Elige «Instalar app» (o «Añadir a la pantalla de inicio»).', 'Confirma con «Instalar». El ícono aparece junto a tus otras apps.'],
    otra: ['En el menú de tu navegador busca «Instalar app» o «Añadir a la pantalla de inicio».', 'Confirma. En el celular, el ícono queda junto a tus otras apps.'],
  }[platform()];
  sheet(close => h('div', { class: 'stack' },
    h('div', { class: 'title-row' }, h('h2', {}, 'Instalar en mi celular'), link('Cerrar', close)),
    muted('Queda como una app más, a pantalla completa y sin la barra del navegador.'),
    h('ol', { class: 'pasos' }, pasos.map(p => h('li', {}, p))),
    muted('Si ya la instalaste, ábrela desde ese ícono y este botón desaparece.', 'small'),
    btn('Entendido', { kind: 'amber', onclick: close })));
}

export function renderHome(root) {
  const n = app.samples.length, last = app.samples[0];
  const shortcut = (name, detail, icon, onclick) => h('button', { type: 'button', class: 'card shortcut', onclick },
    h('span', { class: 'ico', 'aria-hidden': 'true' }, icon), h('b', {}, name), h('small', {}, detail));
  const sesion = document.getElementById('sesion');
  mount(root, 
    h('div', { class: 'home-head' },
      h('div', { class: 'logo-box' }, logo(64)),
      h('h1', { class: 'big' }, 'DenaviLab: Sounds'),
      h('p', { class: 'muted small' }, 'capturador de sonidos para sampling')),
    btn('Grabar un sonido', { kind: 'amber', onclick: () => go('grabar') }),
    h('div', { class: 'grid2' },
      shortcut('Biblioteca', n + (n === 1 ? ' grabación' : ' grabaciones'), '▤', () => go('biblioteca')),
      shortcut('Editar', last ? last.name : 'Sin grabaciones', '✂', () => last ? openSample(last) : go('biblioteca')),
      shortcut('Compartir', 'WAV por correo, Bluetooth o Drive', '⇪', () => go('exportar')),
      shortcut('Manual', 'Glosario técnico', '?', openManual)),
    isStandalone() || inst.done ? null : btn('📲 Instalar en mi celular', { sel: true, aria: 'Instalar la app en mi celular', onclick: instalar }),
    n ? h('div', { class: 'stack tight' }, label('Recientes'), app.samples.slice(0, 3).map(s => sampleRow(s))) : null,
    h('p', { class: 'muted tiny center' }, `Beta ${VERSION} · Desarrollado por: Rolando Chaparro Gehren`),
    sesion ? (sesion.hidden = false, sesion) : null);
}

// ====================================================================== GRABAR
export function renderRecord(root) {
  const e = app.engine, m = app.metro, rec = e.state === 'recording', listening = e.state === 'listening';
  const pill = (text, onclick, aria) => h('button', { type: 'button', class: 'pill', onclick, 'aria-label': aria }, text);

  const levelFill = h('div', { class: 'meter-fill' }), db = h('span', { class: 'amber small' }, '—');
  const wave = h('canvas', { class: 'wave', 'aria-label': 'Forma de onda en vivo' });
  const waveCard = h('div', { class: 'card wave-card' }, wave,
    h('p', { class: 'muted center wave-hint' }, 'Toca el botón para grabar tu primer sample'));
  const timer = h('div', { class: 'timer' }, '00:00.00');
  const buffer = h('p', { class: 'muted small center' }, '');
  const dots = h('div', { class: 'dots', 'aria-hidden': 'true' });
  const notice = h('p', { class: 'muted tiny center' });

  const side = (name, icon, on, onclick) => h('div', { class: 'side' },
    h('button', { type: 'button', class: 'circle' + (on ? ' on' : ''), onclick, 'aria-pressed': on == null ? null : String(!!on), 'aria-label': name }, icon),
    h('span', { class: 'muted tiny' }, name));
  const first = app.samples.length === 0 && listening;
  const recBtn = h('button', { type: 'button', class: 'rec-btn' + (rec ? ' on' : '') + (first && !rec ? ' first' : ''), 'aria-label': rec ? 'Parar grabación' : 'Grabar', onclick: onRecord },
    h('span', { class: 'rec-in' }));

  const denied = e.micDenied ? card([
    h('b', { class: 'err' }, 'Sin acceso al micrófono'),
    muted('Actívalo para este sitio en los ajustes del navegador (el candado junto a la dirección) y vuelve a intentarlo.'),
    btn('Reintentar', { kind: 'amber', onclick: () => e.start() })]) : null;

  mount(root, 
    h('div', { class: 'rec-head' },
      h('button', { type: 'button', class: 'brand', onclick: () => go('inicio'), 'aria-label': 'Ir al inicio' }, logo(26), h('span', {}, 'DenaviLab: Sounds')),
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'icon-btn', onclick: openQuick, 'aria-label': 'Guardado rápido' }, '⚡'),
      pill('→ Compartir', () => go('exportar'))),
    h('div', { class: 'title-row' }, h('h1', {}, 'Grabar sample'),
      pill(m.mode === 'bar' ? `Con compás · ${m.bpm} BPM` : 'Libre', openMetro, 'Metrónomo')),
    denied,
    denied ? null : [
      card([h('b', {}, 'Entrada · Micrófono del dispositivo')]),
      card([h('div', { class: 'sr-head' }, h('span', { class: 'muted small' }, 'Nivel'), db), h('div', { class: 'meter' }, levelFill)]),
      waveCard, timer, dots, notice, buffer,
      first ? h('div', { class: 'center' }, h('span', { class: 'pill static' }, '↓ Empieza aquí')) : null,
      h('div', { class: 'controls' },
        side('Escuchar', '🎧', e.monitoring, () => e.setMonitoring(!e.monitoring)),
        recBtn,
        side('Retro', '↺', null, openRetro)),
      h('div', { class: 'format' }, `WAV · 16 bit · mono · ${hz(exportRate())}`),
      h('div', { class: 'center' }, link('Manual técnico', openManual)),
      e.error ? h('p', { class: 'err small center' }, e.error) : null,
      app.samples.length === 1 && !ls.get('firstTakeDismissed', false) && !rec ? card([
        h('b', {}, 'Primera toma guardada'),
        muted('La encuentras en la Biblioteca. Desde ahí la recortas y la exportas.'),
        btn('Ver la Biblioteca', { kind: 'amber', onclick: () => { ls.set('firstTakeDismissed', true); go('biblioteca'); } }),
        link('Entendido', () => { ls.set('firstTakeDismissed', true); app.render(); })], true) : null,
    ]);

  function onRecord() {
    if (e.state === 'idle') { e.start(); return; }
    if (e.state === 'recording') { m.running && m.stop(); finishTake(e.stopRecording()); return; }
    if (m.mode !== 'bar') { e.startRecording(); return; }
    const beat = 60 / m.bpm, lat = m.start(e.ctx);
    const lead = Math.round((lat + (m.countIn ? m.beats * beat : 0)) * e.rate);
    e.startRecording(lead, dsp.takeSamples(m.bars, m.beats, m.bpm, e.rate));
  }

  let raf = 0;
  const paint = () => {
    levelFill.style.width = Math.round(Math.min(1, e.level) * 100) + '%';
    levelFill.classList.toggle('clip', e.clipped);
    db.textContent = e.state === 'idle' ? '—' : (e.level > 0.0001 ? Math.round(20 * Math.log10(e.level)) : -60) + ' dB';
    db.classList.toggle('err', e.clipped);
    timer.textContent = e.countInRemaining > 0 ? String(Math.max(1, Math.ceil(e.countInRemaining / (60 / m.bpm)))) : dsp.stamp(e.elapsed);
    timer.classList.toggle('on', e.state === 'recording');
    buffer.textContent = e.state === 'idle' ? 'Búfer apagado · toca el botón para activar el micrófono' : `Búfer: últimos ${Math.floor(Math.min(e.retroSeconds, e.bufferedSeconds))} s`;
    const live = listening || rec, hint = waveCard.querySelector('.wave-hint');
    hint.style.display = live && e.liveWave.length ? 'none' : '';
    drawBars(wave, live ? e.liveWave : [], [0, 1]);
    waveCard.classList.toggle('flash', m.flashing && m.flash);
    fill(dots, ...(m.running && m.mode === 'bar' ? Array.from({ length: m.beats }, (_, i) => h('i', { class: i === m.beat ? 'on' : '' })) : []));
    notice.textContent = e.clipped ? 'Clip: baja la ganancia de entrada' : '';
    raf = requestAnimationFrame(paint);
  };
  paint();
  app.repaint = () => {};
  return () => cancelAnimationFrame(raf);
}

/** Al terminar una toma: guardado rápido si está activo; si no, hoja para elegir nombre y carpeta. */
export async function finishTake(audio) {
  if (!audio || !audio.length) return;
  const rate = app.engine.rate, q = loadQuick();
  if (!q.enabled) return showSave(audio, rate);
  const out = dsp.quickProcess(audio, rate, q), name = dsp.autoName(app.samples.length);
  try {
    await putSample(newSample(name, out, rate), out);
    await refreshSamples();
    toast(`Guardada: ${name} · ${dsp.stamp(audio.length / rate)} → ${dsp.stamp(out.length / rate)}`);
  } catch (err) { toast('No se pudo guardar (¿poco espacio en el dispositivo?)'); }
  app.render();
}

// ---------- hoja: guardar grabación ----------
function showSave(audio, rate) {
  const st = { folder: UNSORTED, sub: null };
  const stampName = (() => { const d = new Date(); return 'Grabación ' + d.toLocaleDateString('es', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); })();
  sheet(close => {
    const name = h('input', { type: 'text', class: 'field', value: '', placeholder: stampName, 'aria-label': 'Nombre' });
    const canvas = h('canvas', { class: 'wave small-wave' });
    const go2 = h('button', { type: 'button', class: 'btn amber' });
    const paintBtn = () => { go2.textContent = 'Guardar en ' + (st.sub ? st.folder + ' › ' + st.sub : st.folder); };
    paintBtn();
    go2.addEventListener('click', async () => {
      const out = dsp.quickProcess(audio, rate, loadQuick());
      try {
        const s = newSample(name.value.trim() || stampName, out, rate, { folder: st.folder, subfolder: st.sub });
        await putSample(s, out); await refreshSamples(); toast('Guardada en ' + (st.sub ? st.folder + ' › ' + st.sub : st.folder));
      } catch (err) { toast('No se pudo guardar (¿poco espacio en el dispositivo?)'); }
      close(); app.render();
    });
    setTimeout(() => drawBars(canvas, dsp.peaks(audio, 40), [0, 1]), 30);
    return h('div', { class: 'stack' },
      h('div', { class: 'title-row' }, h('h2', {}, 'Guardar grabación'), link('Cancelar', close)),
      card([h('b', {}, stampName), h('small', { class: 'muted' }, `${dsp.stamp(audio.length / rate)} · WAV mono · ${hz(rate)}`), canvas]),
      label('Nombre'), name, folderPicker(st, paintBtn), go2,
      muted('Puedes cambiar nombre, carpeta y recorte después.', 'center small'));
  });
}

// ---------- hoja: captura retroactiva ----------
function openRetro() {
  const e = app.engine; let timer = 0;
  sheet(close => {
    const canvas = h('canvas', { class: 'wave', style: { height: '110px' } });
    const refresh = () => {
      const pk = dsp.peaks(e.lastSamples(Math.floor(e.rate * 30)), 48), f = 1 - e.retroSeconds / 30;
      drawBars(canvas, pk, [f, 1]);
    };
    timer = setInterval(refresh, 500); setTimeout(refresh, 30);
    const saveBtn = btn(`Guardar los últimos ${e.retroSeconds} s`, { kind: 'amber', disabled: e.state === 'idle', onclick: () => {
      const a = e.captureRetro(); if (!a.length) return toast('Todavía no hay nada en el búfer');
      close(); setTimeout(() => showSave(a, e.rate), 250);
    } });
    return h('div', { class: 'stack' },
      h('div', { class: 'title-row' }, h('h2', {}, 'Captura retroactiva'), link('Cerrar', close)),
      muted('Guarda lo que acaba de sonar'),
      card([canvas]),
      h('div', { class: 'between muted tiny' }, h('span', {}, '−30 s'), h('span', {}, 'ahora')),
      sliderRow('Cuánto atrás', { min: 1, max: 30, step: 1, value: e.retroSeconds, fmt: v => `Últimos ${v} s`, onInput: v => { e.retroSeconds = v; saveBtn.textContent = `Guardar los últimos ${v} s`; refresh(); } }),
      toggleRow('Búfer siempre activo', 'Escucha sin guardar hasta que lo pidas', e.state !== 'idle', on => { on ? e.start() : e.stop(); setTimeout(() => { saveBtn.disabled = e.state === 'idle'; }, 400); }),
      muted('El búfer se borra al cerrar la app. No se envía a ningún lado.', 'center small'),
      saveBtn);
  }, { onClose: () => clearInterval(timer) });
}

// ---------- hoja: guardado rápido ----------
function noiseRow(q, set) {
  const box = h('div', { class: 'stack tight' });
  const paint = () => fill(box, h('div', { class: 'between' }, h('b', {}, 'Reducir ruido al guardar'), h('span', { class: 'muted small' }, q.denoise === 'strong' ? 'Fuerte' : q.denoise === 'soft' ? 'Suave' : 'Apagado')),
    h('div', { class: 'row3' }, ...[['off', 'Off'], ['soft', 'Suave'], ['strong', 'Fuerte']].map(([k, t]) => btn(t, { small: true, sel: (q.denoise || 'off') === k, onclick: () => { q.denoise = k; set('denoise', k); paint(); } }))),
    muted('Corta la respiración y los graves, y apaga lo que suena bajito entre sonidos. Se aplica a toda toma que guardes.', 'tiny'));
  paint(); return box;
}

function openQuick() {
  sheet(close => {
    const q = loadQuick(), set = (k, v) => { q[k] = v; ls.set('quick', q); };
    return h('div', { class: 'stack' },
      h('div', { class: 'title-row' }, h('h2', {}, 'Guardado rápido'), link('Listo', close)),
      muted('Una toma llega lista a la Biblioteca'),
      toggleRow('Guardado rápido', 'Un toque en parar y queda guardada', q.enabled, v => set('enabled', v)),
      toggleRow('Recortar silencios', 'Quita el vacío al inicio y al final', q.trim, v => set('trim', v)),
      toggleRow('Fundidos cortos', '5 ms al inicio y al final, sin clics', q.fades, v => set('fades', v)),
      noiseRow(q, set),
      toggleRow('Normalizar volumen', 'Sube el nivel hasta −1 dB', q.normalize, v => set('normalize', v)),
      sliderRow('Umbral de silencio', { min: -80, max: -20, step: 1, value: q.thresholdDB, fmt: v => v + ' dB', onInput: v => set('thresholdDB', v) }),
      muted('El nombre es automático (grabacion_001…) y va a Sin clasificar. Puedes cambiar nombre, carpeta y recorte después.', 'center small'),
      btn('Listo', { kind: 'amber', onclick: close }));
  });
}

// ---------- hoja: metrónomo ----------
function openMetro() {
  const m = app.metro; let testCtx = null;
  sheet(close => {
    const box = h('div', { class: 'stack' });
    const paint = () => {
      const bpmBig = h('div', { class: 'bpm' }, String(m.bpm));
      const step = (txt, d) => h('button', { type: 'button', class: 'circle big', 'aria-label': d > 0 ? 'Más tempo' : 'Menos tempo', onclick: () => { m.set('bpm', Math.min(300, Math.max(30, m.bpm + d))); paint(); } }, txt);
      fill(box, 
        h('div', { class: 'title-row' }, h('h2', {}, 'Metrónomo'), link('Listo', () => { m.stop(); close(); })),
        h('div', { class: 'row2' }, btn('Libre', { sel: m.mode === 'free', onclick: () => { m.set('mode', 'free'); paint(); app.render(); } }),
          btn('Con compás', { sel: m.mode === 'bar', onclick: () => { m.set('mode', 'bar'); paint(); app.render(); } })),
        muted(m.mode === 'bar' ? 'Con compás, el metrónomo marca el tiempo 1 y la grabación empieza ahí. Libre graba tal como suena.' : 'Libre graba tal como suena, sin metrónomo.', 'small'),
        card([h('div', { class: 'between' }, label('Tempo'), link('Marcar con toques', () => { m.tap(); paint(); })),
          h('div', { class: 'between' }, step('−', -1), bpmBig, step('+', 1)),
          h('p', { class: 'muted small center' }, app.ko2 ? 'BPM · como en el K.O. II' : 'BPM')]),
        m.mode === 'bar' ? card([label('Compás'),
          h('div', { class: 'wrap' }, [[2, '2/4'], [3, '3/4'], [4, '4/4'], [6, '6/8']].map(([v, t]) => chip(t, m.beats === v, () => { m.set('beats', v); paint(); }))),
          label('Cuántos compases'),
          h('div', { class: 'wrap' }, [[1, '1'], [2, '2'], [4, '4'], [8, '8'], [0, 'Sin límite']].map(([v, t]) => chip(t, m.bars === v, () => { m.set('bars', v); paint(); })))]) : null,
        m.mode === 'bar' ? toggleRow('Cuenta de entrada', `${m.beats} clics antes de grabar`, m.countIn, v => { m.set('countIn', v); paint(); }) : null,
        m.mode === 'bar' ? toggleRow('Aviso visual', 'La pantalla late en cada tiempo', m.flash, v => m.set('flash', v)) : null,
        m.mode === 'bar' ? muted('Usa auriculares: el navegador no puede saber si los hay, y sin ellos el clic entra en la grabación.', 'small') : null,
        btn(m.running ? 'Parar prueba' : 'Probar el pulso', { sel: m.running, onclick: () => {
          if (m.running) m.stop(); else { const c = app.engine.ctx || (testCtx = testCtx || new (window.AudioContext || window.webkitAudioContext)()); c.resume(); m.start(c); }
          paint();
        } }),
        muted('Los cambios valen para la próxima grabación.', 'center small'));
    };
    paint(); return box;
  }, { onClose: () => m.stop() });
}

// ---------- hoja: manual ----------
export function openManual() {
  sheet(close => {
    const pages = manualFor(app.ko2); let page = 0; const box = h('div', { class: 'stack' });
    const paint = () => fill(box, 
      h('div', { class: 'title-row' }, h('div', {}, h('h2', {}, pages[page].title), h('p', { class: 'muted small' }, `Manual técnico · ${page + 1} de ${pages.length}`)), link('Cerrar', close)),
      h('div', { class: 'wrap' }, pages.map((_, i) => chip(String(i + 1), page === i, () => { page = i; paint(); }))),
      h('div', { class: 'glossary' }, pages[page].entries.map(([t, d]) => h('div', {}, h('b', { class: 'amber' }, t), h('p', {}, d)))),
      h('div', { class: 'row2' }, page > 0 ? btn('← Anterior', { onclick: () => { page--; paint(); } }) : null, page < pages.length - 1 ? btn('Siguiente →', { sel: true, onclick: () => { page++; paint(); } }) : null));
    paint(); return box;
  });
}

// ====================================================================== BIBLIOTECA
const L = { folder: null, selecting: false, sel: new Set(), query: '' };

export function renderLibrary(root) {
  if (L.folder) return renderFolder(root);
  const n = app.samples.length;
  const results = h('div', { class: 'stack' });
  const paint = () => {
    const q = L.query.trim().toLowerCase();
    if (!n) {
      fill(results, h('div', { class: 'empty' }, logo(56), h('h2', {}, 'Aún no hay samples'),
        muted('Graba tu primer sample y aparecerá aquí, ordenado por carpeta.', 'center'), btn('Grabar', { kind: 'amber', onclick: () => go('grabar') }),
        label('Carpetas'), h('div', { class: 'wrap' }, FOLDERS.map(f => h('span', { class: 'chip static' }, f.name)))));
    } else if (q) {
      const found = app.samples.filter(s => s.name.toLowerCase().includes(q) || (s.tags || []).some(t => t.toLowerCase().includes(q)));
      fill(results, label('Resultados'), found.length ? found.map(s => sampleRow(s, { listen: true })) : muted('Nada coincide con la búsqueda.'));
    } else {
      fill(results, 
        FOLDERS.map(f => {
          const c = app.samples.filter(s => folderOf(s) === f.name).length, hl = f.name === UNSORTED && c > 0;
          return h('button', { type: 'button', class: 'card folder' + (hl ? ' hl' : ''), onclick: () => { L.folder = f.name; app.render(); } },
            h('span', { class: 'dot' }), h('span', { class: 'rb-text' }, h('b', { class: hl ? 'amber' : '' }, f.name), h('small', {}, folderDetail(f))), h('b', { class: 'amber' }, String(c)));
        }),
        label('Recientes'), app.samples.slice(0, 5).map(s => sampleRow(s, { listen: true })),
        h('div', { class: 'row2 backup' }, btn('Copia de seguridad', { small: true, onclick: backupAll }), btn('Restaurar', { small: true, onclick: () => fileInput.click() })));
    }
  };
  const fileInput = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, onchange: e => restoreBackup(e.target.files[0]) });
  mount(root, 
    title('Biblioteca', null, h('span', { class: 'row-gap' }, h('span', { class: 'muted small' }, `${n} ${n === 1 ? 'grabación' : 'grabaciones'}`),
      n ? link('Seleccionar', () => { L.folder = '*'; L.selecting = true; L.sel = new Set(); app.render(); }) : null)),
    h('input', { type: 'search', class: 'field', placeholder: 'Buscar sonido…', value: L.query, 'aria-label': 'Buscar sonido', oninput: e => { L.query = e.target.value; paint(); } }),
    results, fileInput);
  paint();
}

function renderFolder(root) {
  const all = L.folder === '*';
  const items = () => all ? app.samples.filter(s => !L.query.trim() || s.name.toLowerCase().includes(L.query.trim().toLowerCase())) : app.samples.filter(s => folderOf(s) === L.folder);
  const list = h('div', { class: 'stack tight' }), bar = h('div', { class: 'selbar' }), head = h('div');
  const exit = () => { L.folder = null; L.selecting = false; L.sel = new Set(); app.render(); };
  const targets = () => app.samples.filter(s => L.sel.has(s.id));

  const act = {
    async rename(list0 = targets()) {
      if (!list0.length) return;
      const v = await promptSheet({ title: list0.length > 1 ? `Cambiar nombre de ${list0.length} grabaciones` : 'Cambiar nombre',
        message: list0.length > 1 ? 'Se numeran: ' + dsp.names('nombre', Math.min(3, list0.length)).join(', ') + (list0.length > 3 ? '…' : '') : null,
        value: list0.length === 1 ? list0[0].name : '' });
      if (v == null || !v.trim()) return;
      const sorted = [...list0].sort((a, b) => a.created - b.created), nn = dsp.names(v.trim(), sorted.length);
      await putMany(sorted.map((s, i) => ({ ...s, name: nn[i] }))); await refreshSamples(); stopSel(); app.render();
    },
    async move(list0 = targets()) {
      if (!list0.length) return;
      const folders = new Set(list0.map(folderOf)), st = { folder: folders.size === 1 ? [...folders][0] : UNSORTED, sub: null };
      sheet(close => h('div', { class: 'stack' },
        h('div', { class: 'title-row' }, h('div', {}, h('h2', {}, 'Mover'), h('p', { class: 'muted small' }, `${list0.length} grabación${list0.length === 1 ? '' : 'es'}`)), link('Cancelar', close)),
        folderPicker(st),
        btn('Mover aquí', { kind: 'amber', onclick: async () => { await putMany(list0.map(s => ({ ...s, folder: st.folder, subfolder: st.sub }))); await refreshSamples(); close(); stopSel(); app.render(); } })));
    },
    async del(list0 = targets()) {
      if (!list0.length) return;
      const ok = await confirmSheet({ title: list0.length > 1 ? `¿Borrar ${list0.length} grabaciones?` : '¿Borrar esta grabación?', message: 'Se elimina también el audio y no se puede deshacer.', ok: 'Borrar', danger: true });
      if (!ok) return;
      await deleteSamples(list0.map(s => s.id)); if (list0.some(s => s.id === app.selectedId)) app.selectedId = null;
      await refreshSamples(); stopSel(); app.render();
    },
  };
  const stopSel = () => { L.selecting = false; L.sel = new Set(); };

  const paint = () => {
    const its = items();
    fill(head, 
      h('div', { class: 'title-row' }, link('‹ Biblioteca', exit), L.selecting ? h('b', {}, `${L.sel.size} seleccionada${L.sel.size === 1 ? '' : 's'}`) : h('b', {}, all ? 'Todas las grabaciones' : L.folder),
        h('span', { class: 'row-gap' }, L.selecting ? link(L.sel.size === its.length ? 'Ninguna' : 'Todas', () => { L.sel = L.sel.size === its.length ? new Set() : new Set(its.map(s => s.id)); paint(); }) : null,
          link(L.selecting ? 'Cancelar' : 'Seleccionar', () => { L.selecting = !L.selecting; L.sel = new Set(); paint(); }))));
    fill(list, ...(its.length ? its.map(s => {
      const on = L.sel.has(s.id);
      return h('div', { class: 'sel-row' },
        h('button', { type: 'button', class: 'card row-btn' + (on ? ' picked' : ''), 'aria-pressed': L.selecting ? String(on) : null,
          onclick: () => { if (L.selecting) { on ? L.sel.delete(s.id) : L.sel.add(s.id); paint(); } else { stopAudition(); openSample(s); } } },
          L.selecting ? h('span', { class: 'check' + (on ? ' on' : ''), 'aria-hidden': 'true' }, on ? '✓' : '') : null,
          h('span', { class: 'rb-text' }, h('b', {}, s.name), h('small', {}, pathOf(s) + ' · ' + dsp.stamp(s.duration))),
          app.ko2 && s.slot ? h('span', { class: 'amber small' }, 'slot ' + s.slot) : null),
        L.selecting ? null : listenBtn(s),
        L.selecting ? null : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Más acciones para ' + s.name, onclick: () => rowMenu(s) }, '⋯'));
    }) : [muted('Esta carpeta está vacía.', 'center')]));
    bar.hidden = !L.selecting;
    fill(bar, h('p', { class: 'muted tiny center' }, L.sel.size ? `${L.sel.size} seleccionada${L.sel.size === 1 ? '' : 's'}` : 'Elige una o varias grabaciones'),
      h('div', { class: 'row3' }, btn('Cambiar nombre', { small: true, disabled: !L.sel.size, onclick: () => act.rename() }), btn('Mover', { small: true, disabled: !L.sel.size, onclick: () => act.move() }),
        btn('Borrar', { small: true, kind: 'danger', disabled: !L.sel.size, onclick: () => act.del() })));
  };
  const rowMenu = s => sheet(close => h('div', { class: 'stack' }, h('h2', {}, s.name),
    btn('Seleccionar', { onclick: () => { close(); L.selecting = true; L.sel = new Set([s.id]); paint(); } }),
    btn('Cambiar nombre', { onclick: () => { close(); act.rename([s]); } }),
    btn('Mover', { onclick: () => { close(); act.move([s]); } }),
    btn('Borrar', { kind: 'danger', onclick: () => { close(); act.del([s]); } }), link('Cerrar', close)));

  mount(root, head, list, bar);
  paint();
  if (L.selecting) bar.hidden = false;
}

// ---------- copia de seguridad ----------
async function backupAll() {
  if (!app.samples.length) return toast('No hay nada que guardar todavía');
  toast('Preparando la copia…');
  const files = [{ name: 'biblioteca.json', data: new TextEncoder().encode(JSON.stringify({ formato: 1, app: 'denavilab-sounds', samples: app.samples })) }];
  for (const s of app.samples) files.push({ name: `audio/${s.id}.wav`, data: dsp.encodeWav(await getAudio(s.id), s.rate) });
  const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await deliver(new File([makeZip(files)], `denavilab-sounds-copia-${stamp}.zip`, { type: 'application/zip' }));
}

async function restoreBackup(file) {
  if (!file) return;
  try {
    const entries = readZip(new Uint8Array(await file.arrayBuffer()));
    const meta = entries && entries.find(e => e.name === 'biblioteca.json');
    if (!meta) throw new Error('no es una copia de DenaviLab: Sounds');
    const data = JSON.parse(new TextDecoder().decode(meta.data)), have = new Set(app.samples.map(s => s.id)); let added = 0;
    for (const s of data.samples || []) {
      if (have.has(s.id)) continue;
      const w = entries.find(e => e.name === `audio/${s.id}.wav`), dec = w && dsp.decodeWav(w.data);
      if (dec) { await putSample(s, dec.samples); added++; }
    }
    await refreshSamples(); toast(added ? `Restauradas ${added} grabaciones` : 'No había nada nuevo que restaurar'); app.render();
  } catch (err) { toast('No se pudo restaurar: ' + (err.message || err)); }
}

// ====================================================================== EXPORTAR
const koX = () => app.ko2 && KO_EXPORT;       // formato K.O. II en pausa
const fileNameFor = s => {
  // sin tildes: algunos navegadores descartan el nombre si no es ASCII, y el K.O. II y otros programas lo prefieren
  const clean = s.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'sonido';
  return koX() ? (s.slot ? String(s.slot).padStart(3, '0') + '_' : '') + clean.slice(0, 24) + '.wav' : clean.slice(0, 60) + '.wav';
};
/** WAV de un trozo de audio en memoria (nombre ya sin tildes), a la frecuencia de exportación actual. */
export function wavFromAudio(name, audio, srcRate) {
  const rate = exportRate(), out = dsp.resample(audio, srcRate, rate);
  return new File([dsp.encodeWav(out, rate)], fileNameFor({ name, slot: null }), { type: 'audio/wav' });
}
export { makeZip as zipFiles };
async function wavFile(s, rate) {
  const out = dsp.resample(await getAudio(s.id), s.rate, rate);
  return new File([dsp.encodeWav(out, rate)], fileNameFor(s), { type: 'audio/wav' });
}
export function download(file) {
  const a = h('a', { href: URL.createObjectURL(file), download: file.name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 15000);
}
/** ¿La hoja de compartir del sistema acepta estos archivos? (Android: correo, Bluetooth, Drive…; iPhone: Mail, AirDrop, Archivos…) */
export const canShareFiles = files => !!(navigator.canShare && navigator.share && navigator.canShare({ files }));
/** En móvil, la hoja de compartir con el archivo tal cual; si no, descarga. */
export async function deliver(file) {
  if (canShareFiles([file])) {
    try { await navigator.share({ files: [file], title: file.name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  download(file);
}
/** Varios WAV: se comparten como archivos sueltos; sin hoja de compartir, un ZIP con todos. */
export async function deliverMany(files, zipName = 'denavilab-sonidos.zip') {
  if (files.length === 1) return deliver(files[0]);
  if (canShareFiles(files)) {
    try { await navigator.share({ files, title: `${files.length} sonidos` }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const zip = await Promise.all(files.map(async f => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
  download(new File([makeZip(zip)], zipName, { type: 'application/zip' }));
}
/** WAV ya preparado de la grabación abierta: compartir necesita un toque reciente, así que se deja listo antes de que lo pidan. */
const ready = { key: '', file: null };
const readyKey = (s, rate) => [s.id, rate, s.duration, s.name].join('|');
async function wavReady(s, rate) {
  const key = readyKey(s, rate);
  if (ready.key === key && ready.file) return ready.file;
  const f = await wavFile(s, rate); ready.key = key; ready.file = f; return f;
}

export function renderExport(root) {
  mount(root, title(koX() ? 'Formato K.O. II' : 'Compartir'));
  if (!app.samples.length) {
    mount(root, h('div', { class: 'empty' }, h('h2', {}, 'Aún no hay nada que compartir'), muted('Graba un sample y vuelve aquí.', 'center'), btn('Grabar', { kind: 'amber', onclick: () => go('grabar') })));
    return;
  }
  const s = sampleById(app.selectedId) || app.samples[0], rate = exportRate(), mb = s.duration * rate * 2 / 1e6;
  const pick = h('select', { class: 'field', 'aria-label': 'Grabación a exportar', onchange: e => { app.selectedId = e.target.value; app.render(); } },
    app.samples.map(x => h('option', { value: x.id, selected: x.id === s.id }, x.name)));
  const slotInput = h('input', { type: 'number', class: 'field num', min: 1, max: 999, value: s.slot || 600, 'aria-label': 'Slot de destino',
    onchange: async e => { const v = Math.min(999, Math.max(1, parseInt(e.target.value, 10) || 600)); await putSample({ ...s, slot: v }); await refreshSamples(); app.render(); } });
  if (!koX()) wavReady(s, rate).catch(() => {});                       // deja el WAV listo: compartir necesita un toque reciente
  const bump = d => async () => { const v = Math.min(999, Math.max(1, (s.slot || 600) + d)); await putSample({ ...s, slot: v }); await refreshSamples(); app.render(); };

  mount(root, 
    app.samples.length > 1 ? h('div', { class: 'stack tight' }, label('Grabación'), pick) : card([h('b', {}, s.name)]),
    label('Frecuencia de muestreo'),
    h('div', { class: 'row3' }, exportRates().map(r => btn(rateLabel(r), { small: true, sel: r === rate, onclick: () => { ls.set('rate', r); app.render(); } }))),
    koX() ? muted('46 875 Hz es lo que usa el K.O. II · por confirmar con el aparato', 'small') : null,
    label('Canales'), h('div', { class: 'row2' }, btn('Mono', { sel: true }), btn('Estéreo · próximamente', { small: true, disabled: true })),
    label('Profundidad'), h('div', { class: 'row2' }, btn('16 bit', { sel: true }), btn(koX() ? '24 bit · por confirmar' : '24 bit · próximamente', { small: true, disabled: true })),
    koX() ? card([h('div', { class: 'between' }, h('div', {}, h('b', {}, 'Slot de destino'), h('p', { class: 'muted small' }, 'Libres 600–999 · por confirmar')),
      h('div', { class: 'stepper' }, h('button', { type: 'button', class: 'circle', 'aria-label': 'Slot anterior', onclick: bump(-1) }, '−'), slotInput, h('button', { type: 'button', class: 'circle', 'aria-label': 'Slot siguiente', onclick: bump(1) }, '+')))]) : null,
    koX() ? card([h('b', {}, 'Memoria'), h('p', { class: 'muted small' }, `${mb.toFixed(1).replace('.', ',')} MB · quedan ${Math.max(0, 128 - mb).toFixed(0)} MB de 128 MB`),
      h('div', { class: 'meter' }, h('div', { class: 'meter-fill', style: { width: Math.max(2, Math.min(100, mb / 128 * 100)) + '%' } }))]) : null,
    card([h('div', { class: 'between' }, h('span', { class: 'muted small' }, 'Nombre'), h('span', { class: 'small file-name' }, fileNameFor(s)))]),
    muted(koX() ? 'Otras frecuencias y 24 bit no están confirmadas para el K.O. II.' : 'Se envía un archivo .wav (mono, 16 bit): por correo, Bluetooth, Drive o la app que elijas.', 'small'),
    ...(koX() ? koButtons(s, rate) : shareButtons(s, rate)));
}
const koButtons = (s, rate) => [
  btn('Guardar con este formato', { kind: 'amber', onclick: async () => { download(await wavFile(s, rate)); toast('Archivo preparado: ' + fileNameFor(s)); } }),
  navigator.canShare ? btn('Compartir…', { onclick: async () => deliver(await wavFile(s, rate)) }) : null,
  (() => {
    const kit = app.samples.filter(x => x.slot);
    return btn(`Exportar kit (${kit.length} con slot)`, { disabled: !kit.length, onclick: async () => {
      toast('Preparando el kit…');
      const files = []; for (const x of kit) { const f = await wavFile(x, rate); files.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }); }
      await deliver(new File([makeZip(files)], 'denavilab-kit.zip', { type: 'application/zip' }));
    } });
  })()];
/** Compartir en WAV: la hoja del sistema (correo, Bluetooth, Drive…) con el archivo .wav; sin ella, se descarga. */
const shareButtons = (s, rate) => [
  btn('Compartir WAV', { kind: 'amber', act: 'compartir', onclick: async () => {
    const f = ready.key === readyKey(s, rate) && ready.file ? ready.file : await wavReady(s, rate);
    if (!canShareFiles([f])) toast('Este navegador no tiene hoja de compartir: se descargó el WAV');
    await deliver(f);
  } }),
  btn('Guardar WAV', { onclick: async () => { download(await wavReady(s, rate)); toast('Archivo preparado: ' + fileNameFor(s)); } }),
  (() => btn(`Compartir todo (${app.samples.length}) en WAV`, { disabled: !app.samples.length, onclick: async () => {
    toast('Preparando los archivos…');
    const files = []; for (const x of app.samples) files.push(await wavFile(x, rate));
    await deliverMany(files, 'denavilab-sonidos.zip');
  } }))()];

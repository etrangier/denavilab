// Pantallas: Inicio, Grabar, Biblioteca, Exportar, y las hojas (retroactiva, guardar, metrónomo, manual…).
import { app, go, openSample, refreshSamples, sampleById, VERSION, BUILD, inst, isStandalone, platform, installApp } from './state.js';
import { h, mount, fill, btn, link, chip, card, label, muted, title, toggleRow, sliderRow, logo, sheet, confirmSheet, promptSheet, toast, folderPicker, drawBars } from './ui.js';
import * as dsp from './dsp.js';
import { FOLDERS, UNSORTED, folderDetail, folderOf } from './folders.js';
import { getAudio, putSample, putMany, deleteSamples, newSample, normalizeSample, storageInfo, requestPersist, STATES, CHAR_TAGS } from './store.js';
import { manualFor } from './manual.js';
import { makeZip, readZip } from './zip.js';
import { decodeFile, baseName, MAX_SECONDS } from './importer.js';
import { rateLabel, exportRates, KO_EXPORT } from './profile.js';
import { KO_RATES, KO_DEFAULTS, koOpts, koPlan, buildKoBatch, LONG_FADE_MS } from './koexport.js';

const ls = {
  get(k, d) { try { const v = localStorage.getItem('denavilab.sounds.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('denavilab.sounds.' + k, JSON.stringify(v)); } catch (e) {} },
};
const hz = r => String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Hz';
const pathOf = s => [folderOf(s), s.subfolder].filter(Boolean).join(' › ');
/** ¿Nivelar el volumen al compartir? Encendido por defecto: los sonidos salen parejos, no unos muy fuertes y otros muy bajos. */
export const levelOn = () => ls.get('levelExport', true);
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

// ---------- favoritos, orden y filtro ----------
export const SORTS = [['fecha', 'Fecha (recientes primero)'], ['nombre', 'Nombre (A–Z)'], ['duracion', 'Duración (largos primero)'], ['favoritos', 'Favoritos primero']];
/** «Listo para K.O.» sólo se nombra así para quien tiene el aparato; el resto ve «Listo». */
export const stateName = k => k === 'listo' && !app.ko2 ? 'Listo' : (STATES.find(x => x[0] === k) || STATES[0])[1];
const charTags = () => { const v = ls.get('charTags', null); return Array.isArray(v) && v.length ? v : CHAR_TAGS; };
export const view = {
  get onlyFav() { return ls.get('onlyFav', false) === true; }, set onlyFav(v) { ls.set('onlyFav', !!v); },
  get status() { const v = ls.get('fStatus', ''); return STATES.some(x => x[0] === v) ? v : ''; }, set status(v) { ls.set('fStatus', v); },
  get tags() { const v = ls.get('fTags', []); return Array.isArray(v) ? v : []; }, set tags(v) { ls.set('fTags', v); },
  get origin() { return String(ls.get('fOrigin', '')); }, set origin(v) { ls.set('fOrigin', v); },
  get active() { return this.onlyFav || !!this.status || this.tags.length > 0 || !!this.origin.trim(); },
  get sort() { const v = ls.get('sort', 'fecha'); return SORTS.some(x => x[0] === v) ? v : 'fecha'; }, set sort(v) { ls.set('sort', v); },
};
/** Filtra por «solo favoritos» y ordena según la vista elegida. No toca la lista original. */
export function arrange(list) {
  const o = view.origin.trim().toLowerCase(), tg = view.tags;
  const out = list.filter(s => (!view.onlyFav || s.favorite) && (!view.status || s.status === view.status) && tg.every(t => (s.tags || []).includes(t)) && (!o || (s.origin || '').toLowerCase().includes(o))), byDate = (a, b) => b.created - a.created;
  if (view.sort === 'nombre') out.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }) || byDate(a, b));
  else if (view.sort === 'duracion') out.sort((a, b) => b.duration - a.duration || byDate(a, b));
  else if (view.sort === 'favoritos') out.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || byDate(a, b));
  else out.sort(byDate);
  return out;
}
export async function setFavorite(list, value) {
  const ch = list.filter(s => !!s.favorite !== value);
  if (!ch.length) return;
  try { await putMany(ch.map(s => ({ ...s, favorite: value }))); await refreshSamples(); }
  catch (err) { toast(storeError(err)); }
}
export async function toggleFavorite(s) {
  const now = !s.favorite;
  await setFavorite([s], now); app.render();
  const el = document.querySelector(`[data-star="${s.id}"]`); if (el) el.focus();
  toast(now ? 'Favorito: ' + s.name : 'Quitado de favoritos: ' + s.name);
}
export const starBtn = s => h('button', { type: 'button', class: 'icon-btn star' + (s.favorite ? ' on' : ''), 'data-star': s.id, 'aria-pressed': String(!!s.favorite),
  'aria-label': (s.favorite ? 'Quitar de favoritos: ' : 'Marcar como favorito: ') + s.name, title: 'Favorito (tecla F)', onclick: e => { e.stopPropagation(); toggleFavorite(s); } }, s.favorite ? '★' : '☆');
/** Barra de vista: «solo favoritos», orden y filtros (estado, etiquetas, origen). `repaint` vuelve a pintar la lista. */
export function viewBar(repaint) {
  const onlyBtn = h('button', { type: 'button', class: 'chip' + (view.onlyFav ? ' sel' : ''), 'aria-pressed': String(view.onlyFav), 'data-act': 'solo-favoritos',
    onclick: () => { view.onlyFav = !view.onlyFav; onlyBtn.setAttribute('aria-pressed', String(view.onlyFav)); onlyBtn.classList.toggle('sel', view.onlyFav); repaint(); } }, '★ Solo favoritos');
  const sel = h('select', { class: 'field sort', 'aria-label': 'Ordenar por', onchange: e => { view.sort = e.target.value; repaint(); } },
    SORTS.map(([k, t]) => h('option', { value: k, selected: view.sort === k }, t)));
  const st = h('select', { class: 'field', 'aria-label': 'Filtrar por estado', onchange: e => { view.status = e.target.value; repaint(); } },
    h('option', { value: '' }, 'Cualquier estado'), STATES.map(([k]) => h('option', { value: k, selected: view.status === k }, stateName(k))));
  const origin = h('input', { type: 'search', class: 'field', placeholder: 'Origen contiene…', value: view.origin, 'aria-label': 'Filtrar por origen', oninput: e => { view.origin = e.target.value; repaint(); } });
  const tagBox = h('div', { class: 'wrap', role: 'group', 'aria-label': 'Filtrar por etiquetas de carácter' });
  const paintTags = () => fill(tagBox, ...[...new Set([...charTags(), ...view.tags])].map(t => chip(t, view.tags.includes(t), () => { view.tags = view.tags.includes(t) ? view.tags.filter(x => x !== t) : [...view.tags, t]; paintTags(); repaint(); })));
  paintTags();
  const clear = link('Quitar filtros', () => { view.onlyFav = false; view.status = ''; view.tags = []; view.origin = ''; app.render(); });
  const det = h('details', { class: 'filters', open: view.status || view.tags.length || view.origin ? '' : null }, h('summary', {}, 'Filtros', view.active ? ' (activos)' : ''),
    h('div', { class: 'stack tight' }, st, origin, label('Etiquetas (deben estar todas)'), tagBox, view.active ? clear : null));
  return h('div', { class: 'viewbar' }, onlyBtn, sel, det);
}
/** Atajo F: marca o desmarca el sonido con el foco en la lista, el abierto en Editar o, en modo selección, los elegidos. */
document.addEventListener('keydown', e => {
  if (e.key.toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  if (document.querySelector('dialog[open]')) return;
  const row = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-id]');
  let list = row ? [sampleById(row.dataset.id)] : app.tab === 'editar' && app.selectedId ? [sampleById(app.selectedId)] : L.selecting ? app.samples.filter(x => L.sel.has(x.id)) : [];
  list = list.filter(Boolean); if (!list.length) return;
  e.preventDefault();
  if (list.length === 1) return toggleFavorite(list[0]);
  const v = list.some(x => !x.favorite); setFavorite(list, v).then(() => { app.render(); toast(v ? `${list.length} marcadas como favoritas` : `${list.length} quitadas de favoritos`); });
});

export function sampleRow(s, { onclick, trailing, listen = false } = {}) {
  const right = trailing !== undefined ? trailing : (app.ko2 ? (s.slot ? 'slot ' + s.slot : 'sin enviar') : '');
  const row = h('button', { type: 'button', class: 'card row-btn', onclick: onclick || (() => { stopAudition(); openSample(s); }) },
    h('span', { class: 'rb-text' }, h('b', {}, s.name), h('small', {}, pathOf(s) + ' · ' + dsp.stamp(s.duration) + (s.status !== 'crudo' ? ' · ' + stateName(s.status) : ''))),
    right ? h('span', { class: 'amber small' }, right) : null);
  return listen ? h('div', { class: 'sel-row', 'data-id': s.id }, row, starBtn(s), listenBtn(s)) : row;
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
    h('p', { class: 'muted tiny center' }, `Beta ${VERSION} · versión ${BUILD} · Desarrollado por: Rolando Chaparro Gehren`),
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
  const kind = dsp.SOUND_KINDS[ls.get('kind', 'libre')] ? ls.get('kind', 'libre') : 'libre', maxSec = dsp.SOUND_KINDS[kind].maxSec;
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
      card([h('b', {}, 'Tipo de sonido'),
        h('div', { class: 'wrap' }, Object.entries(dsp.SOUND_KINDS).map(([k, v]) => chip(v.label, kind === k, () => { ls.set('kind', k); app.render(); }))),
        h('p', { class: 'muted tiny' }, dsp.SOUND_KINDS[kind].hint)]),
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
    notice.textContent = e.clipped ? 'Clip: baja la ganancia de entrada' : maxSec && rec && e.elapsed > maxSec ? `Ya pasa de ${maxSec} s: para ${dsp.SOUND_KINDS[kind].label.toLowerCase()} conviene parar y grabar otra toma más corta` : '';
    raf = requestAnimationFrame(paint);
  };
  paint();
  app.repaint = () => {};
  return () => cancelAnimationFrame(raf);
}

/** Las texturas para el K.O. II se piensan de hasta 6 s: no se corta nada solo, pero se avisa. */
export const MAX_TEXTURE = 6;
const longNote = secs => secs > MAX_TEXTURE + 0.05 ? ` · dura más de ${MAX_TEXTURE} s` : '';
const storeError = err => err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message))) ? 'No se pudo guardar: el dispositivo se quedó sin espacio. Libera espacio o borra sonidos viejos.' : 'No se pudo guardar el sonido (' + ((err && err.message) || 'error desconocido') + ').';

/** Al terminar una toma: guardado rápido si está activo; si no, hoja para elegir nombre y carpeta. */
export async function finishTake(audio) {
  if (!audio || !audio.length) return;
  const rate = app.engine.rate, q = loadQuick();
  if (!q.enabled) return showSave(audio, rate);
  const kind = ls.get('kind', 'libre'), kd = dsp.SOUND_KINDS[kind] || dsp.SOUND_KINDS.libre;
  const out = dsp.quickProcess(audio, rate, q), name = dsp.autoName(app.samples.length, kd.prefix);
  try {
    await putSample(newSample(name, out, rate, kind === 'libre' ? {} : { kind }), out);
    await refreshSamples();
    toast(`Guardada: ${name} · ${dsp.stamp(audio.length / rate)} → ${dsp.stamp(out.length / rate)}${longNote(out.length / rate)}`);
  } catch (err) { toast(storeError(err)); }
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
    const cut = { on: false }, tooLong = audio.length / rate > MAX_TEXTURE + 0.05;
    const longBox = tooLong ? h('div', { class: 'card warn', role: 'status' }, h('b', {}, `Dura ${dsp.stamp(audio.length / rate)}, más de ${MAX_TEXTURE} s`),
      h('small', { class: 'muted' }, 'Para texturas del K.O. II conviene 6 s o menos. Puedes guardarla entera o quedarte con los primeros 6 s.'),
      toggleRow('Recortar a los primeros 6 s', 'Sin ajustes de guardado rápido', false, on => { cut.on = on; })) : null;
    const paintBtn = () => { go2.textContent = 'Guardar en ' + (st.sub ? st.folder + ' › ' + st.sub : st.folder); };
    paintBtn();
    go2.addEventListener('click', async () => {
      const out = cut.on ? audio.slice(0, Math.floor(MAX_TEXTURE * rate)) : dsp.quickProcess(audio, rate, loadQuick());
      try {
        const kind = ls.get('kind', 'libre'), s = newSample(name.value.trim() || stampName, out, rate, { folder: st.folder, subfolder: st.sub, ...(dsp.SOUND_KINDS[kind] && kind !== 'libre' ? { kind } : {}) });
        await putSample(s, out); await refreshSamples(); toast('Guardada en ' + (st.sub ? st.folder + ' › ' + st.sub : st.folder));
      } catch (err) { toast(storeError(err)); }
      close(); app.render();
    });
    setTimeout(() => drawBars(canvas, dsp.peaks(audio, 40), [0, 1]), 30);
    return h('div', { class: 'stack' },
      h('div', { class: 'title-row' }, h('h2', {}, 'Guardar grabación'), link('Cancelar', close)),
      card([h('b', {}, stampName), h('small', { class: 'muted' }, `${dsp.stamp(audio.length / rate)} · WAV mono · ${hz(rate)}`), canvas]),
      longBox, label('Nombre'), name, folderPicker(st, paintBtn), go2,
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
      toggleRow('Nivelar volumen', `Lleva el nivel típico a ${dsp.levelTarget()} dB, sin pasar de ${dsp.LEVEL_CEILING_DB} dB en el pico`, q.level, v => set('level', v)),
      toggleRow('Normalizar volumen', 'Sube el pico hasta −1 dB (si Nivelar está apagado)', q.normalize, v => set('normalize', v)),
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
        muted('Graba tu primer sample y aparecerá aquí, ordenado por carpeta.', 'center'), btn('Grabar', { kind: 'amber', onclick: () => go('grabar') }), btn('Importar sonidos', { small: true, act: 'importar', onclick: () => importInput.click() }),
        label('Carpetas'), h('div', { class: 'wrap' }, FOLDERS.map(f => h('span', { class: 'chip static' }, f.name)))));
    } else if (q || view.active) {
      const found = arrange(app.samples.filter(s => !q || s.name.toLowerCase().includes(q) || (s.tags || []).some(t => t.toLowerCase().includes(q)) || (s.key || '').toLowerCase() === q));
      fill(results, label(view.active && !q ? 'Con filtros' : 'Resultados'), found.length ? found.map(s => sampleRow(s, { listen: true })) : muted(view.active && !q ? 'Ningún sonido cumple los filtros. Prueba quitar alguno.' : 'Nada coincide con la búsqueda.'));
    } else {
      fill(results, 
        FOLDERS.map(f => {
          const c = app.samples.filter(s => folderOf(s) === f.name).length, hl = f.name === UNSORTED && c > 0;
          return h('button', { type: 'button', class: 'card folder' + (hl ? ' hl' : ''), onclick: () => { L.folder = f.name; app.render(); } },
            h('span', { class: 'dot' }), h('span', { class: 'rb-text' }, h('b', { class: hl ? 'amber' : '' }, f.name), h('small', {}, folderDetail(f))), h('b', { class: 'amber' }, String(c)));
        }),
        label('Recientes'), app.samples.slice(0, 5).map(s => sampleRow(s, { listen: true })),
        btn('Importar sonidos', { small: true, act: 'importar', onclick: () => importInput.click() }),
        muted('Trae WAV (también MP3, M4A…) desde Archivos o Drive. Entran a Sin clasificar, a su frecuencia original y en mono.', 'tiny'),
        app.ko2 ? btn('Exportar para el K.O. II', { small: true, act: 'ko-lote', 'aria-label': 'Exportar para el K.O. II: favoritos, selección o todo', onclick: openKoExport }) : null,
        storagePanel(),
        h('div', { class: 'row2 backup' }, btn('Respaldo', { small: true, 'aria-label': 'Respaldo: guardar toda la colección en un .zip', onclick: backupAll }), btn('Restaurar', { small: true, onclick: () => fileInput.click() })));
    }
  };
  const fileInput = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, onchange: e => restoreBackup(e.target.files[0]) });
  const importInput = h('input', { type: 'file', accept: 'audio/*,.wav,.mp3,.m4a,.aac,.aif,.aiff,.flac,.ogg', multiple: true, hidden: true, 'aria-label': 'Elegir sonidos para importar', onchange: e => { importFiles([...e.target.files]); e.target.value = ''; } });
  mount(root, 
    title('Biblioteca', null, h('span', { class: 'row-gap' }, h('span', { class: 'muted small' }, `${n} ${n === 1 ? 'grabación' : 'grabaciones'}`),
      n ? link('Seleccionar', () => { L.folder = '*'; L.selecting = true; L.sel = new Set(); app.render(); }) : null)),
    h('input', { type: 'search', class: 'field', placeholder: 'Buscar sonido…', value: L.query, 'aria-label': 'Buscar sonido', oninput: e => { L.query = e.target.value; paint(); } }),
    n ? viewBar(paint) : null, results, fileInput, importInput);
  paint();
}

function renderFolder(root) {
  const all = L.folder === '*';
  const items = () => arrange(all ? app.samples.filter(s => !L.query.trim() || s.name.toLowerCase().includes(L.query.trim().toLowerCase())) : app.samples.filter(s => folderOf(s) === L.folder));
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
      return h('div', { class: 'sel-row', 'data-id': s.id },
        h('button', { type: 'button', class: 'card row-btn' + (on ? ' picked' : ''), 'aria-pressed': L.selecting ? String(on) : null,
          onclick: () => { if (L.selecting) { on ? L.sel.delete(s.id) : L.sel.add(s.id); paint(); } else { stopAudition(); openSample(s); } } },
          L.selecting ? h('span', { class: 'check' + (on ? ' on' : ''), 'aria-hidden': 'true' }, on ? '✓' : '') : null,
          h('span', { class: 'rb-text' }, h('b', {}, s.name), h('small', {}, pathOf(s) + ' · ' + dsp.stamp(s.duration) + (s.status !== 'crudo' ? ' · ' + stateName(s.status) : ''))),
          app.ko2 && s.slot ? h('span', { class: 'amber small' }, 'slot ' + s.slot) : null),
        starBtn(s),
        L.selecting ? null : listenBtn(s),
        L.selecting ? null : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Más acciones para ' + s.name, onclick: () => rowMenu(s) }, '⋯'));
    }) : [muted(view.active ? 'Ningún sonido de aquí cumple los filtros.' : 'Esta carpeta está vacía.', 'center')]));
    bar.hidden = !L.selecting;
    fill(bar, h('p', { class: 'muted tiny center' }, L.sel.size ? `${L.sel.size} seleccionada${L.sel.size === 1 ? '' : 's'}` : 'Elige una o varias grabaciones'),
      h('div', { class: 'row3' }, btn('Cambiar nombre', { small: true, disabled: !L.sel.size, onclick: () => act.rename() }), btn('Mover', { small: true, disabled: !L.sel.size, onclick: () => act.move() }),
        btn('Borrar', { small: true, kind: 'danger', disabled: !L.sel.size, onclick: () => act.del() })),
      app.ko2 ? btn('Exportar selección al K.O. II', { small: true, act: 'ko-seleccion', disabled: !L.sel.size, onclick: openKoExport }) : null);
  };
  const rowMenu = s => sheet(close => h('div', { class: 'stack' }, h('h2', {}, s.name),
    btn('Detalles (etiquetas, nota, BPM…)', { act: 'detalles', onclick: () => { close(); openDetails(s); } }),
    btn('Seleccionar', { onclick: () => { close(); L.selecting = true; L.sel = new Set([s.id]); paint(); } }),
    btn('Cambiar nombre', { onclick: () => { close(); act.rename([s]); } }),
    btn('Mover', { onclick: () => { close(); act.move([s]); } }),
    btn('Borrar', { kind: 'danger', onclick: () => { close(); act.del([s]); } }), link('Cerrar', close)));

  mount(root, head, viewBar(paint), list, bar);
  paint();
  if (L.selecting) bar.hidden = false;
}

// ---------- hoja: detalles de un sonido ----------
export function openDetails(s) {
  sheet(close => {
    const st = { tags: [...(s.tags || [])], status: s.status, replaced: s.replaced, edit: false };
    const f = (type, value, lab, extra = {}) => h('input', { type, class: 'field', value: value == null ? '' : String(value), 'aria-label': lab, ...extra });
    const key = f('text', s.key, 'Nota o tonalidad', { placeholder: 'Am, C#, F…', maxlength: '8' });
    const bpm = f('number', s.bpm ? Math.round(s.bpm) : '', 'BPM', { min: '30', max: '300', inputmode: 'numeric', placeholder: 'sin BPM' });
    const origin = f('text', s.origin, 'Origen', { placeholder: 'artista, disco, minuto o dónde lo grabé', maxlength: '200' });
    const note = h('textarea', { class: 'field', rows: '3', 'aria-label': 'Comentario', placeholder: 'Cómo la grabé, para qué sirve…' }, s.comment || '');
    const newTag = f('text', '', 'Nueva etiqueta', { placeholder: 'Nueva etiqueta…', maxlength: '20', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } } });
    const tagBox = h('div', { class: 'wrap', role: 'group', 'aria-label': 'Etiquetas de carácter' }), stBox = h('div', { class: 'row3', role: 'group', 'aria-label': 'Estado' });
    const paint = () => {
      const list = [...new Set([...charTags(), ...st.tags])];
      fill(tagBox, ...list.map(t => st.edit ? h('button', { type: 'button', class: 'chip', 'aria-label': 'Quitar de la lista: ' + t, onclick: () => { ls.set('charTags', charTags().filter(x => x !== t)); st.tags = st.tags.filter(x => x !== t); paint(); } }, t + ' ✕')
        : chip(t, st.tags.includes(t), () => { st.tags = st.tags.includes(t) ? st.tags.filter(x => x !== t) : [...st.tags, t]; paint(); })));
      fill(stBox, ...STATES.map(([k]) => btn(stateName(k), { small: true, sel: st.status === k, onclick: () => { st.status = k; paint(); } })));
    };
    const addTag = () => { const t = newTag.value.trim().toLowerCase().slice(0, 20); if (!t) return; if (!charTags().includes(t)) ls.set('charTags', [...charTags(), t]); if (!st.tags.includes(t)) st.tags.push(t); newTag.value = ''; paint(); };
    paint();
    return h('div', { class: 'stack' },
      h('div', { class: 'title-row' }, h('div', {}, h('h2', {}, 'Detalles'), h('p', { class: 'muted small' }, s.name + ' · ' + dsp.stamp(s.duration) + ' · ' + new Date(s.created).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }))), link('Cancelar', close)),
      label('Estado'), stBox,
      label('Carácter (se pueden combinar)'), tagBox,
      h('div', { class: 'row-gap' }, newTag, btn('Añadir', { small: true, onclick: addTag }), btn('Editar lista', { small: true, sel: false, onclick: e => { st.edit = !st.edit; e.target.textContent = st.edit ? 'Listo' : 'Editar lista'; paint(); } })),
      label('Origen'), origin,
      toggleRow('Reemplazado por versión propia', 'Ya no dependo de esta fuente ajena', st.replaced, v => { st.replaced = v; }),
      label('Nota o tonalidad (opcional)'), key, label('BPM (opcional)'), bpm, label('Comentario'), note,
      s.process && s.process.length ? muted('Procesos aplicados: ' + s.process.join(' → '), 'tiny') : null,
      btn('Guardar detalles', { kind: 'amber', act: 'guardar-detalles', onclick: async () => {
        const b = parseFloat(bpm.value), k = key.value.trim();
        try { await putSample({ ...s, tags: st.tags, status: st.status, origin: origin.value.trim(), replaced: st.replaced, key: k || null, bpm: b >= 30 && b <= 300 ? b : null, comment: note.value.trim() }); await refreshSamples(); toast('Detalles guardados'); }
        catch (err) { toast(storeError(err)); }
        close(); app.render();
      } }));
  });
}

// ---------- almacenamiento ----------
const mb = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
/** Espacio usado por la biblioteca y si el navegador la protege del borrado automático. */
function storagePanel() {
  const box = h('div', { class: 'stack tight storage' });
  const paint = async () => {
    const i = await storageInfo();
    const used = i.usage != null ? `Espacio usado: ${mb(i.usage)}${i.quota ? ' de ' + mb(i.quota) : ''}` : 'Espacio usado: el navegador no lo informa';
    const prot = i.persisted === true ? 'Protegido: el navegador no borrará la biblioteca solo.' : i.persisted === false ? 'Sin protección: si el dispositivo se queda sin espacio, el navegador podría borrar la biblioteca. Haz respaldos.' : '';
    fill(box, h('div', { role: 'status', 'aria-live': 'polite' }, h('b', { class: 'small' }, used), prot ? h('small', { class: 'muted', 'data-act': 'persist' }, ' ' + prot) : null),
      i.persisted === false ? btn('Proteger el almacenamiento', { small: true, act: 'persistir', onclick: async () => { const ok = await requestPersist(); toast(ok ? 'Almacenamiento protegido' : 'El navegador no lo concedió (en iPhone/Safari conviene instalar la app en la pantalla de inicio)'); paint(); } }) : null);
  };
  paint(); return box;
}

// ---------- respaldo ----------
async function backupAll() {
  if (!app.samples.length) return toast('No hay nada que guardar todavía');
  toast('Preparando el respaldo…');
  const files = [{ name: 'biblioteca.json', data: new TextEncoder().encode(JSON.stringify({ formato: 2, app: 'denavilab-sounds', version: VERSION, fecha: new Date().toISOString(), samples: app.samples })) }];
  for (const s of app.samples) files.push({ name: `audio/${s.id}.wav`, data: dsp.encodeWav(await getAudio(s.id), s.rate) });
  const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await deliver(new File([makeZip(files)], `denavilab-sounds-respaldo-${stamp}.zip`, { type: 'application/zip' }));
}

/** Importa archivos de audio como sonidos nuevos: mono, a su frecuencia original, en Sin clasificar. Los muy largos o ilegibles se saltan y se avisa. */
async function importFiles(files) {
  if (!files.length) return;
  toast(files.length === 1 ? 'Importando…' : `Importando ${files.length} archivos…`);
  let ok = 0; const bad = [];
  for (const f of files) {
    try {
      const d = await decodeFile(f);
      if (!d.samples.length || d.samples.length / d.rate > MAX_SECONDS) throw new Error('largo');
      await putSample(newSample(baseName(f.name), d.samples, d.rate), d.samples); ok++;
    } catch (err) { bad.push(f.name); }
  }
  await refreshSamples(); app.render();
  toast(`${ok === 1 ? '1 sonido importado' : ok + ' sonidos importados'} en Sin clasificar` + (bad.length ? ` · no se pudo leer: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''} (sólo hasta ${MAX_SECONDS / 60} min)` : ''));
}

async function restoreBackup(file) {
  if (!file) return;
  try {
    let entries;
    try { entries = readZip(new Uint8Array(await file.arrayBuffer())); } catch (e) { entries = null; }
    if (!entries) throw new Error('el archivo está dañado o no es un .zip');
    const meta = entries.find(e => e.name === 'biblioteca.json');
    if (!meta) throw new Error('no es un respaldo de DenaviLab: Sounds');
    let data; try { data = JSON.parse(new TextDecoder().decode(meta.data)); } catch (e) { throw new Error('el índice del respaldo está dañado'); }
    if (!data || !Array.isArray(data.samples)) throw new Error('el índice del respaldo está dañado');
    const have = new Set(app.samples.map(s => s.id)); let added = 0, skipped = 0, bad = 0;
    for (const raw of data.samples) {
      if (!raw || !raw.id) { bad++; continue; }
      if (have.has(raw.id)) { skipped++; continue; }
      const w = entries.find(e => e.name === `audio/${raw.id}.wav`), dec = w && dsp.decodeWav(w.data);
      if (!dec || !dec.samples.length) { bad++; continue; }
      await putSample(normalizeSample({ ...raw, rate: raw.rate || dec.rate }), dec.samples); added++;
    }
    await refreshSamples(); app.render();
    toast((added ? `Restauradas ${added} grabaciones` : 'No había nada nuevo que restaurar') + (skipped ? ` · ${skipped} ya estaban` : '') + (bad ? ` · ${bad} con el audio dañado, omitidas` : ''));
  } catch (err) { toast(err && (err.name === 'QuotaExceededError') ? 'No se pudo restaurar: el dispositivo se quedó sin espacio.' : 'No se pudo restaurar: ' + (err.message || err)); }
}

// ---------- exportación por lotes para el K.O. II ----------
/** Hoja «Exportar para el K.O. II»: alcance (favoritos, selección o todo), ajustes, vista previa de nombres y .zip. Sólo para quien tiene el aparato. */
export function openKoExport() {
  const favs = () => app.samples.filter(s => s.favorite), chosen = () => app.samples.filter(s => L.sel.has(s.id));
  const st = { scope: chosen().length ? 'seleccion' : favs().length ? 'favoritos' : 'todo', o: koOpts(ls.get('koExport', {})), start: 1 };
  const list = () => [...(st.scope === 'seleccion' ? chosen() : st.scope === 'favoritos' ? favs() : app.samples)].sort((a, b) => a.created - b.created);
  sheet(close => {
    const box = h('div', { class: 'stack' });
    const save = () => ls.set('koExport', st.o);
    const paint = () => {
      const items = list(), plan = koPlan(items, st.start), o = st.o;
      const secs = items.reduce((t, x) => t + x.duration, 0), mbx = secs * o.rate * 2 / 1e6;
      const scopeBtn = (k, t, n) => btn(`${t} (${n})`, { small: true, sel: st.scope === k, disabled: k === 'seleccion' && !n, onclick: () => { st.scope = k; paint(); } });
      const num = (lab, key, min, max, unit) => h('label', { class: 'card between' }, h('span', {}, h('b', {}, lab)),
        h('span', { class: 'row-gap' }, h('input', { type: 'number', class: 'field num', min, max, value: key === 'start' ? st.start : o[key], 'aria-label': lab,
          onchange: e => { if (key === 'start') st.start = Math.max(1, Math.min(900, parseInt(e.target.value, 10) || 1)); else { st.o = koOpts({ ...st.o, [key]: e.target.value }); save(); } paint(); } }), h('small', { class: 'muted' }, unit)));
      const go3 = btn(items.length ? `Descargar .zip (${items.length} ${items.length === 1 ? 'sonido' : 'sonidos'})` : 'No hay sonidos en esta opción', { kind: 'amber', act: 'descargar-ko', disabled: !items.length, onclick: async () => {
        go3.disabled = true;
        try {
          const r = await buildKoBatch(items, id => getAudio(id), o, (i, n) => { go3.textContent = `Preparando ${i} de ${n}…`; }, st.start);
          if (!r.files.length) { toast('No quedó ningún sonido para exportar: ' + (r.skipped.join(', ') || 'lista vacía')); go3.disabled = false; paint(); return; }
          const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
          await deliver(new File([makeZip(r.files)], `ko2_${st.scope}_${stamp}.zip`, { type: 'application/zip' }));
          toast(`${r.files.length - 1} sonidos listos para el K.O. II` + (r.skipped.length ? ` · omitidos: ${r.skipped.slice(0, 3).join(', ')}` : ''));
        } catch (err) { toast(err && err.name === 'QuotaExceededError' ? 'No hay espacio para preparar el archivo.' : 'No se pudo preparar la exportación: ' + ((err && err.message) || err)); }
        go3.disabled = false; paint();
      } });
      fill(box,
        h('div', { class: 'title-row' }, h('div', {}, h('h2', {}, 'Exportar para el K.O. II'), h('p', { class: 'muted small' }, 'WAV mono 16 bit · pico a −1 dBFS · sin compresión')), link('Cerrar', close)),
        label('Qué exportar'), h('div', { class: 'row3' }, scopeBtn('favoritos', '★ Favoritos', favs().length), scopeBtn('seleccion', 'Selección', chosen().length), scopeBtn('todo', 'Todo', app.samples.length)),
        label('Frecuencia de muestreo'), h('div', { class: 'row2' }, KO_RATES.map(r => btn(rateLabel(r), { small: true, sel: o.rate === r, onclick: () => { st.o = koOpts({ ...o, rate: r }); save(); paint(); } }))),
        muted('46 875 Hz es la frecuencia que usa el K.O. II · por confirmar con el aparato. 44,1 kHz es la alternativa segura.', 'tiny'),
        num('Umbral de silencio inicial', 'thresholdDB', -80, -20, 'dB'),
        num('Fundido de entrada', 'fadeIn', 0, 100, 'ms'), num('Fundido de salida', 'fadeOut', 0, 500, 'ms'),
        toggleRow('Fade-out largo para one-shots', `${LONG_FADE_MS} ms de salida en vez del fundido corto`, o.longFade, v => { st.o = koOpts({ ...o, longFade: v }); save(); paint(); }),
        toggleRow('Filtro pasa-altos suave (90 Hz)', 'Quita rumor grave que el aparato no necesita', o.hp, v => { st.o = koOpts({ ...o, hp: v }); save(); paint(); }),
        toggleRow('Nivel parejo en vez de pico', 'Nivela por volumen típico (como en Compartir) en lugar de llevar el pico a −1 dBFS', o.even, v => { st.o = koOpts({ ...o, even: v }); save(); paint(); }),
        num('Empezar a numerar en', 'start', 1, 900, ''),
        label(`Vista previa de nombres (${plan.length})`),
        h('ol', { class: 'ko-names', 'aria-label': 'Nombres finales de los archivos' }, plan.length ? plan.slice(0, 60).map(p => h('li', {}, h('code', {}, p.file), h('small', { class: 'muted' }, ' ← ' + p.sample.name))) : [h('li', { class: 'muted' }, 'Nada que exportar. Marca favoritos con la ☆ o elige otra opción.')]),
        plan.length > 60 ? muted(`… y ${plan.length - 60} más`, 'tiny') : null,
        muted(`≈ ${mbx.toFixed(1).replace('.', ',')} MB · lista.txt dentro del .zip dice qué sonido es cada archivo.`, 'tiny'),
        go3);
    };
    paint();           // «Empezar a numerar» no se guarda: vive sólo en esta hoja
    return box;
  });
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
  const rate = exportRate(), out = dsp.resample(levelOn() ? dsp.levelTo(audio, srcRate).audio : audio, srcRate, rate);
  return new File([dsp.encodeWav(out, rate)], fileNameFor({ name, slot: null }), { type: 'audio/wav' });
}
export { makeZip as zipFiles };
async function wavFile(s, rate) {
  const raw = await getAudio(s.id), out = dsp.resample(levelOn() ? dsp.levelTo(raw, s.rate).audio : raw, s.rate, rate);
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
const readyKey = (s, rate) => [s.id, rate, s.duration, s.name, app.rev, levelOn()].join('|');
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
    toggleRow('Nivelar volumen', `Lleva el sonido al mismo nivel que los demás (${dsp.levelTarget()} dB de nivel típico) para que no suene muy fuerte ni muy bajo; el pico queda bajo ${dsp.LEVEL_CEILING_DB} dB`, levelOn(), v => { ls.set('levelExport', v); ready.key = ''; app.render(); }),
    levelOn() ? sliderRow('Nivel objetivo', { min: -36, max: -12, step: 1, value: dsp.levelTarget(), fmt: v => v + ' dB', onInput: v => { ls.set('levelTarget', v); ready.key = ''; } }) : null,
    levelOn() ? muted('Más a la izquierda, más bajo. Si en el aparato suenan más fuertes que sus sonidos de fábrica, baja este nivel hasta que igualen.', 'tiny') : null,
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

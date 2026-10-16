// Componentes comunes: el mismo lenguaje visual de la app de iPhone (oscuro y ámbar).
export const $ = (sel, el = document) => el.querySelector(sel);

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

/** `append` y `replaceChildren` nativos convierten null y listas en texto; estos las aplanan y descartan lo vacío. */
const clean = kids => kids.flat(Infinity).filter(k => k != null && k !== false);
export function mount(el, ...kids) { el.append(...clean(kids)); }
export function fill(el, ...kids) { el.replaceChildren(...clean(kids)); }

export function toast(msg, ms = 4000) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms);
}

// ---------- componentes ----------
export const btn = (label, { kind = 'outline', sel = false, onclick, disabled = false, small = false, aria } = {}) =>
  h('button', { type: 'button', class: ['btn', kind, sel ? 'sel' : '', small ? 'small' : ''].join(' ').trim(), onclick, disabled, 'aria-label': aria }, label);
export const link = (label, onclick) => h('button', { type: 'button', class: 'link', onclick }, label);
export const chip = (label, selected, onclick) => h('button', { type: 'button', class: 'chip' + (selected ? ' sel' : ''), 'aria-pressed': String(!!selected), onclick }, label);
export const card = (kids, hl = false) => h('div', { class: 'card' + (hl ? ' hl' : '') }, kids);
export const label = text => h('div', { class: 'label' }, text);
export const muted = (text, cls = '') => h('p', { class: 'muted ' + cls }, text);
export const title = (text, sub, trailing) =>
  h('div', { class: 'title' }, h('div', { class: 'title-row' }, h('h1', {}, text), trailing || null), sub ? h('p', { class: 'muted' }, sub) : null);

export function toggleRow(name, sub, checked, onchange) {
  const input = h('input', { type: 'checkbox', checked, onchange: e => onchange(e.target.checked) });
  return h('label', { class: 'card toggle-row' },
    h('span', { class: 'tr-text' }, h('b', {}, name), sub ? h('small', {}, sub) : null),
    input, h('span', { class: 'switch', 'aria-hidden': 'true' }));
}

/** Fila con deslizador. Devuelve el elemento; `onInput(valor)` y `fmt(valor)` para el texto de la derecha. */
export function sliderRow(name, { min = 0, max = 1, step = 0.01, value, fmt = v => String(v), onInput }) {
  const val = h('span', { class: 'amber' }, fmt(value));
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': name,
    oninput: e => { const v = parseFloat(e.target.value); val.textContent = fmt(v); onInput && onInput(v); } });
  return h('div', { class: 'card slider-row' }, h('div', { class: 'sr-head' }, h('b', {}, name), val), input);
}

export function logo(size = 64) {
  const hs = [0.3, 0.6, 1, 0.7, 0.4, 0.8, 0.5];
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 70 64'); svg.setAttribute('width', size * 1.1); svg.setAttribute('height', size); svg.setAttribute('aria-hidden', 'true');
  hs.forEach((v, i) => {
    const r = document.createElementNS(ns, 'rect'), hh = 52 * v;
    r.setAttribute('x', 4 + i * 9); r.setAttribute('y', 32 - hh / 2); r.setAttribute('width', 5.5); r.setAttribute('height', hh); r.setAttribute('rx', 2.75);
    r.setAttribute('fill', '#e8a94a'); svg.append(r);
  });
  return svg;
}

// ---------- hojas (diálogos desde abajo) ----------
export function sheet(build, { onClose } = {}) {
  const d = h('dialog', { class: 'sheet' }), inner = h('div', { class: 'sheet-in' });
  const close = () => { try { d.close(); } catch (e) {} };
  d.addEventListener('close', () => { d.remove(); onClose && onClose(); });
  inner.append(build(close)); d.append(inner); document.body.append(d); d.showModal();
  return close;
}

export const confirmSheet = ({ title: t, message, ok = 'Aceptar', danger = false }) => new Promise(res => {
  let answer = false;
  sheet(close => h('div', { class: 'stack' },
    h('h2', {}, t), message ? muted(message) : null,
    h('div', { class: 'row2' }, btn('Cancelar', { onclick: close }), btn(ok, { kind: danger ? 'danger' : 'amber', onclick: () => { answer = true; close(); } }))),
  { onClose: () => res(answer) });
});

export const promptSheet = ({ title: t, message, value = '', ok = 'Guardar' }) => new Promise(res => {
  let answer = null;
  sheet(close => {
    const input = h('input', { type: 'text', class: 'field', value, 'aria-label': t, autocapitalize: 'sentences' });
    const go = () => { answer = input.value; close(); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    setTimeout(() => { input.focus(); input.select(); }, 50);
    return h('div', { class: 'stack' }, h('h2', {}, t), message ? muted(message) : null, input,
      h('div', { class: 'row2' }, btn('Cancelar', { onclick: close }), btn(ok, { kind: 'amber', onclick: go })));
  }, { onClose: () => res(answer) });
});

// ---------- carpetas ----------
import { FOLDERS } from './folders.js';
/** `st` = {folder, sub}; se actualiza solo y avisa con onChange. */
export function folderPicker(st, onChange = () => {}) {
  const box = h('div', { class: 'stack tight' });
  const paint = () => {
    const subs = (FOLDERS.find(f => f.name === st.folder) || { subs: [] }).subs;
    fill(box, 
      label('Carpeta'),
      h('div', { class: 'grid3' }, FOLDERS.map(f => btn(f.name, { sel: st.folder === f.name, small: true, onclick: () => { st.folder = f.name; st.sub = null; paint(); onChange(st); } }))),
      subs.length ? label('Subcarpeta') : null,
      subs.length ? h('div', { class: 'wrap' }, subs.map(s => chip(s, st.sub === s, () => { st.sub = st.sub === s ? null : s; paint(); onChange(st); }))) : null);
  };
  paint();
  return box;
}

// ---------- onda ----------
/** Dibuja barras de onda; las del rango seleccionado en ámbar. */
export function drawBars(canvas, pk, range = [0, 1], playhead = null) {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, hh = canvas.clientHeight;
  if (!w || !hh) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
  if (!pk.length) return;
  const step = w / pk.length, bw = Math.max(2, step * 0.55), mid = hh / 2;
  pk.forEach((p, i) => {
    const f = i / pk.length, bh = Math.max(3, Math.min(1, p) * hh * 0.9);
    g.fillStyle = f >= range[0] && f <= range[1] ? '#e8a94a' : '#322e3f';
    g.beginPath(); g.roundRect ? g.roundRect(i * step + (step - bw) / 2, mid - bh / 2, bw, bh, bw / 2) : g.rect(i * step + (step - bw) / 2, mid - bh / 2, bw, bh); g.fill();
  });
  if (playhead != null) { g.fillStyle = '#ede9f3'; g.fillRect(w * playhead - 1, 0, 2, hh); }
}

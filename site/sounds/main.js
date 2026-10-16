// DenaviLab: Sounds · arranque: puerta de acceso, bienvenida, pestañas y actualizaciones.
import { app, refreshSamples, go } from './state.js';
import { h, fill, btn, link, logo, muted, toast } from './ui.js';
import { renderHome, renderRecord, renderLibrary, renderExport, finishTake, openManual } from './screens.js';
import { renderEdit } from './editor.js';
import { who, NAMES } from './profile.js';

const TABS = [['inicio', 'Inicio', '⌂'], ['grabar', 'Grabar', '●'], ['biblioteca', 'Biblioteca', '▤'], ['editar', 'Editar', '✂'], ['exportar', 'Exportar', '⇪']];
const SCREENS = { inicio: renderHome, grabar: renderRecord, biblioteca: renderLibrary, editar: renderEdit, exportar: renderExport };
const screenEl = document.getElementById('screen'), tabsEl = document.getElementById('tabs');
let cleanup = null, lastTab = null;

function render() {
  const keep = lastTab === app.tab ? screenEl.scrollTop : 0;
  if (cleanup) { cleanup(); cleanup = null; }
  fill(screenEl, );
  cleanup = SCREENS[app.tab](screenEl) || null;
  screenEl.scrollTop = keep; lastTab = app.tab;
  tabsEl.querySelectorAll('.tab').forEach(b => { const on = b.dataset.tab === app.tab; b.setAttribute('aria-selected', String(on)); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
}

function buildTabs() {
  tabsEl.hidden = false;
  fill(tabsEl, ...TABS.map(([id, name, icon]) =>
    h('button', { type: 'button', class: 'tab', role: 'tab', 'data-tab': id, onclick: () => go(id) }, h('span', { class: 'tab-ico', 'aria-hidden': 'true' }, icon), h('span', {}, name))));
}

/** Sin sesión: pantalla cerrada; el botón abre la misma puerta del resto del sitio (acceso.js). */
function renderLock() {
  tabsEl.hidden = true;
  // el acceso como invitado no recarga la página por su cuenta: al cerrarse la puerta con sesión, se entra
  document.getElementById('puerta').addEventListener('close', () => { if (who()) location.reload(); });
  fill(screenEl, h('div', { class: 'home-head lock' },
    h('div', { class: 'logo-box' }, logo(64)), h('h1', { class: 'big' }, 'DenaviLab: Sounds'), h('p', { class: 'muted small' }, 'capturador de sonidos para sampling'),
    h('p', { class: 'muted' }, 'Entra con tu nombre y tu clave, o como invitado.'),
    btn('Entrar', { kind: 'amber', onclick: () => document.getElementById('btnLogin').click() })));
}

/** Primera vez: bienvenida y permiso del micrófono (el permiso nace de un toque, como piden iOS y Safari). */
function welcome() {
  const done = () => { try { localStorage.setItem('denavilab.sounds.onboarded', '1'); } catch (e) {} ov.remove(); render(); };
  const ov = h('div', { class: 'welcome', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Bienvenida' });
  const step1 = () => fill(ov, h('div', { class: 'welcome-in' },
    h('div', { class: 'logo-box' }, logo(64)), h('h1', { class: 'big' }, 'DenaviLab: Sounds'), h('p', { class: 'muted small' }, 'capturador de sonidos para sampling'),
    h('ol', { class: 'steps' }, ['Graba con el micrófono', 'Corta y dale carácter', app.ko2 ? 'Envíalo al K.O. II' : 'Expórtalo en WAV'].map((t, i) => h('li', {}, h('b', { class: 'amber' }, String(i + 1)), t))),
    muted('Rescata lo que acabas de tocar y guárdalo.', 'small center'),
    btn('Empezar', { kind: 'amber', onclick: step2 }), link('Ver el manual', openManual)));
  const step2 = () => fill(ov, h('div', { class: 'welcome-in' },
    h('div', { class: 'logo-box round' }, h('span', { class: 'mic' }, '🎙')), h('h1', {}, 'Permitir el micrófono'),
    muted('Para grabar samples necesitamos usar el micrófono del dispositivo.', 'center'),
    h('ul', { class: 'bullets' }, ['Solo graba mientras tú lo decides', 'Nada sale del teléfono sin tu permiso', 'Puedes cambiarlo luego en los ajustes del navegador'].map(t => h('li', {}, t))),
    btn('Permitir micrófono', { kind: 'amber', onclick: () => { app.engine.start(); done(); } }), link('Ahora no', done)));
  step1(); document.body.append(ov);
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (refreshing) location.reload(); });
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing; if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          const bar = document.getElementById('update'); bar.hidden = false;
          bar.querySelector('button').onclick = () => { refreshing = true; (reg.waiting || nw).postMessage('skipWaiting'); };
        }
      });
    });
  }).catch(() => {});
}

async function boot() {
  registerWorker();
  if (!who()) return renderLock();
  app.user = who();
  try { await refreshSamples(); } catch (e) { toast('No se pudo abrir la biblioteca de este dispositivo'); }
  app.render = render;
  app.engine.onChange = () => {
    if (app.engine.completed) { const a = app.engine.completed; app.engine.completed = null; app.metro.stop(); finishTake(a); }
    if (app.tab === 'grabar') render();
  };
  buildTabs(); render();
  let seen = false; try { seen = localStorage.getItem('denavilab.sounds.onboarded') === '1'; } catch (e) {}
  if (!seen) welcome();
}
boot();

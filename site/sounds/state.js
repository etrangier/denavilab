// Estado compartido de la app.
import { Engine } from './audio.js';
import { Metronome } from './metronome.js';
import { who, hasKO2 } from './profile.js';
import { listSamples } from './store.js';

export const app = {
  user: who(),
  ko2: hasKO2(),
  engine: new Engine(),
  metro: new Metronome(),
  samples: [],            // metadatos, la más reciente primero
  tab: 'inicio',
  selectedId: null,       // grabación abierta en Editar
  render: () => {},       // los pone main.js
  repaint: () => {},      // actualiza sin reconstruir (lo pone cada pantalla)
};

export async function refreshSamples() { app.samples = await listSamples(); app.rev = (app.rev || 0) + 1; return app.samples; }    // rev: cambia con cada guardado (invalida lo preparado)
export const sampleById = id => app.samples.find(s => s.id === id);

/** Cambia de pestaña. Si es Grabar, arranca el micrófono en el mismo gesto (iOS y Safari lo exigen). */
export function go(tab, id) {
  if (id !== undefined) app.selectedId = id;
  if (tab === 'grabar') app.engine.start();
  app.tab = tab;
  app.render();
}
export const openSample = (s, tab = 'editar') => go(tab, s.id);

export const VERSION = '0.1.0';
/** Número de publicación: coincide con el de sw.js (sounds-vN). Se muestra en Inicio para saber de un vistazo si la PWA está al día. */
export const BUILD = 24;

// ---------- Instalar como app (acceso directo en la pantalla de inicio del celular) ----------
export const inst = { evt: null, done: false };      // `evt`: aviso de instalación que ofrece Chrome en Android
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); inst.evt = e; app.render(); });
window.addEventListener('appinstalled', () => { inst.evt = null; inst.done = true; app.render(); });
/** ¿Ya se abrió como app instalada (sin barra del navegador)? */
export const isStandalone = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } };
/** Plataforma para mostrar los pasos correctos: 'ios', 'android' u 'otra'. */
export const platform = () => {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  return /Android/i.test(ua) ? 'android' : 'otra';
};
/** Lanza la instalación si el navegador la ofrece; devuelve 'accepted' | 'dismissed' | null (sin aviso: hay que mostrar los pasos a mano). */
export async function installApp() {
  const e = inst.evt; if (!e) return null;
  inst.evt = null;
  try { e.prompt(); const r = await e.userChoice; return r && r.outcome || 'dismissed'; } catch (err) { return null; }
}

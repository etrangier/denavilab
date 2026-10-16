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

export async function refreshSamples() { app.samples = await listSamples(); return app.samples; }
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

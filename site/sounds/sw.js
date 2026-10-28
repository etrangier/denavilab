// Service worker de DenaviLab: Sounds. Primero la red (así cada publicación llega sola) y, sin conexión, lo guardado.
// Sube VERSION en cada publicación para renovar los archivos guardados.
const VERSION = 'sounds-v26';
const CORE = ['./', 'index.html', 'app.css', 'main.js', 'state.js', 'ui.js', 'screens.js', 'editor.js', 'chop.js', 'harmony.js', 'grid.js', 'scratch.js', 'importer.js', 'dsp.js', 'work.js', 'work-ops.js', 'dsp-worker.js', 'audio.js', 'metronome.js',
  'store.js', 'zip.js', 'koexport.js', 'materia.js', 'lab.js', 'folders.js', 'manual.js', 'profile.js', 'worklet.js', 'manifest.json',
  'fonts/Ubuntu-Regular.ttf', 'fonts/Ubuntu-Medium.ttf', 'fonts/Ubuntu-Bold.ttf',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE))); });

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k.startsWith('sounds-')).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { const idx = await cache.match('index.html'); if (idx) return idx; }
      throw err;
    }
  })());
});

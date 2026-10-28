// Biblioteca en IndexedDB: metadatos de cada grabación por un lado, audio (Float32) por otro.
const DB = 'denavilab-sounds', META = 'samples', AUDIO = 'audio';
let dbp = null;

function open() {
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(META, { keyPath: 'id' }); r.result.createObjectStore(AUDIO); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const done = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

/** Campos de cada sonido y su valor por defecto; los guardados antes de tenerlos se completan al leerlos (sin migración de la base). */
export const STATES = [['crudo', 'Crudo'], ['procesado', 'Procesado'], ['listo', 'Listo para K.O.']];
export const CHAR_TAGS = ['cálido', 'oscuro', 'brillante', 'granular', 'metálico', 'etéreo', 'suave', 'áspero', 'cuerdas', 'teclas', 'ambiente'];
export const META_DEFAULTS = { favorite: false, tags: [], key: null, bpm: null, comment: '', status: 'crudo', origin: '', replaced: false, process: [] };
export const normalizeSample = s => {
  const o = { ...META_DEFAULTS, ...s };
  o.favorite = o.favorite === true; o.tags = Array.isArray(o.tags) ? o.tags : [];
  o.status = STATES.some(x => x[0] === o.status) ? o.status : 'crudo'; o.origin = o.origin ? String(o.origin) : ''; o.replaced = o.replaced === true; o.process = Array.isArray(o.process) ? o.process : [];
  o.key = o.key ? String(o.key) : null; o.comment = o.comment ? String(o.comment) : '';
  return o;
};

export async function listSamples() {
  const db = await open();
  const all = await wrap(db.transaction(META).objectStore(META).getAll());
  return all.map(normalizeSample).sort((a, b) => b.created - a.created);   // la más reciente primero
}

/** Espacio que usa el origen y si el navegador prometió no borrarlo. {usage, quota, persisted} (null si el navegador no lo informa). */
export async function storageInfo() {
  const o = { usage: null, quota: null, persisted: null };
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); o.usage = e.usage; o.quota = e.quota; } } catch (e) {}
  try { if (navigator.storage && navigator.storage.persisted) o.persisted = await navigator.storage.persisted(); } catch (e) {}
  return o;
}
/** Pide al navegador que no borre la biblioteca si falta espacio. true si lo concedió. */
export async function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {}
  return false;
}

export async function getAudio(id) {
  const db = await open();
  const a = await wrap(db.transaction(AUDIO).objectStore(AUDIO).get(id));
  return a ? new Float32Array(a) : new Float32Array(0);
}

/** Guarda metadatos y, si se da, el audio. Lanza si no hay espacio. */
export async function putSample(sample, audio) {
  const db = await open();
  const tx = db.transaction(audio ? [META, AUDIO] : [META], 'readwrite');
  tx.objectStore(META).put(sample);
  if (audio) tx.objectStore(AUDIO).put(audio, sample.id);
  await done(tx);
}

export async function putMany(samples) {
  const db = await open();
  const tx = db.transaction(META, 'readwrite');
  for (const s of samples) tx.objectStore(META).put(s);
  await done(tx);
}

export async function deleteSamples(ids) {
  const db = await open();
  const tx = db.transaction([META, AUDIO], 'readwrite');
  for (const id of ids) { tx.objectStore(META).delete(id); tx.objectStore(AUDIO).delete(id); }
  await done(tx);
}

export function newSample(name, audio, rate, extra = {}) {
  return { id: uid(), name, folder: 'Sin clasificar', subfolder: null, tags: [], slot: null, rate,
           created: Date.now(), duration: audio.length / rate, bpm: null, favorite: false, key: null, comment: '', status: 'crudo', origin: '', replaced: false, process: [], ...extra };
}

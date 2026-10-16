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

export async function listSamples() {
  const db = await open();
  const all = await wrap(db.transaction(META).objectStore(META).getAll());
  return all.sort((a, b) => b.created - a.created);   // la más reciente primero
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
           created: Date.now(), duration: audio.length / rate, bpm: null, ...extra };
}

// «Listo para el K.O. II»: lo que se graba se guarda ya a la frecuencia del aparato y con el volumen nivelado.
// 46 875 Hz / 16 bit, mono o estéreo, según la ficha de Teenage Engineering y varias tiendas. El volumen NO tiene una recomendación oficial
// que yo haya encontrado: se usa el nivel objetivo de la app (Compartir → Nivel objetivo), que se calibra comparando con un sonido de fábrica.
import * as dsp from './dsp.js';
import { app } from './state.js';

export const KO_RATE = 46875;
const KEY = 'denavilab.sounds.koPrep';
/** Sólo quien tiene el K.O. II; encendido por defecto. */
export const koPrepOn = () => { if (!app.ko2) return false; try { return JSON.parse(localStorage.getItem(KEY)) !== false; } catch (e) { return true; } };
export const setKoPrep = v => { try { localStorage.setItem(KEY, JSON.stringify(!!v)); } catch (e) {} };

/** Lleva la toma a 46 875 Hz (si está activo). Devuelve {audio, rate}. */
export function koPrepare(audio, rate) {
  if (!koPrepOn() || rate === KO_RATE || !audio || audio.length < 2) return { audio, rate };
  return { audio: dsp.resample(audio, rate, KO_RATE), rate: KO_RATE };
}
/** Nivela el volumen típico al objetivo de la app, con techo de pico (si está activo). */
export function koLevel(audio, rate) {
  return koPrepOn() && audio && audio.length ? dsp.levelTo(audio, rate).audio : audio;
}

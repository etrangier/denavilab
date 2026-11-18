// «Listo para tu sampler»: lo que se graba se guarda ya a la frecuencia del aparato y con el volumen nivelado.
// 46 875 Hz / 16 bit, mono o estéreo, según las fichas técnicas de varios samplers. El volumen NO tiene una recomendación oficial
// que yo haya encontrado: se usa el nivel objetivo de la app (Compartir → Nivel objetivo), que se calibra comparando con un sonido de fábrica.
import * as dsp from './dsp.js';
import { app } from './state.js';

export const SAMPLER_RATE = 46875;
const KEY = 'denavilab.sounds.samplerPrep';
/** Sólo para quien tiene sampler (perfil del autor); encendido por defecto. */
export const samplerPrepOn = () => { if (!app.sampler) return false; try { return JSON.parse(localStorage.getItem(KEY)) !== false; } catch (e) { return true; } };
export const setSamplerPrep = v => { try { localStorage.setItem(KEY, JSON.stringify(!!v)); } catch (e) {} };

/** Lleva la toma a 46 875 Hz (si está activo). Devuelve {audio, rate}. */
export function samplerPrepare(audio, rate) {
  if (!samplerPrepOn() || rate === SAMPLER_RATE || !audio || audio.length < 2) return { audio, rate };
  return { audio: dsp.resample(audio, rate, SAMPLER_RATE), rate: SAMPLER_RATE };
}
/** Nivela el volumen típico al objetivo de la app, con techo de pico (si está activo). */
export function samplerLevel(audio, rate) {
  return samplerPrepOn() && audio && audio.length ? dsp.levelTo(audio, rate).audio : audio;
}

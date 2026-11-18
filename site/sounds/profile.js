// Perfil según quién entró por la puerta del taller (la misma sesión que usa el resto del sitio).
// El autor trabaja con un sampler de hardware; los invitados no, así que para ellos no aparecen slots, memoria ni la frecuencia de muestreo del aparato.
export const SESSION_KEY = 'denavilab.sesion';
export const VALID = ['rolando', 'schair', 'invitado'];
export const NAMES = { rolando: 'Rolando', schair: 'Schair', invitado: 'Invitado' };

export function who() { try { const q = localStorage.getItem(SESSION_KEY); return VALID.includes(q) ? q : null; } catch (e) { return null; } }
export const hasSampler = (user = who()) => user === 'rolando';
/** Exportar con el formato del sampler (slot, 46 875 Hz, memoria) está en pausa: por ahora todos comparten WAV normales (correo, Bluetooth, Drive). */
export const SAMPLER_EXPORT = false;
/** Frecuencias de exportación: con sampler la suya primero; sin él, las habituales. */
export const exportRates = (sampler = hasSampler() && SAMPLER_EXPORT) => sampler ? [46875, 44100, 48000] : [48000, 44100];
export const rateLabel = r => r === 46875 ? '46 875 Hz' : r === 44100 ? '44,1 kHz' : '48 kHz';

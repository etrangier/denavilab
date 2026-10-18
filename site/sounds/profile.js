// Perfil según quién entró por la puerta del taller (la misma sesión que usa el resto del sitio).
// Rolando trabaja con el EP-133 K.O. II; Schair y los invitados no tienen ese aparato ni ningún MIDI,
// así que para ellos no aparece nada del K.O. II (ni slots, ni memoria, ni su frecuencia de muestreo).
export const SESSION_KEY = 'denavilab.sesion';
export const VALID = ['rolando', 'schair', 'invitado'];
export const NAMES = { rolando: 'Rolando', schair: 'Schair', invitado: 'Invitado' };

export function who() { try { const q = localStorage.getItem(SESSION_KEY); return VALID.includes(q) ? q : null; } catch (e) { return null; } }
export const hasKO2 = (user = who()) => user === 'rolando';
/** Exportar con el formato del K.O. II (slot, 46 875 Hz, memoria) está en pausa: por ahora todos comparten WAV normales (correo, Bluetooth, Drive). */
export const KO_EXPORT = false;
/** Frecuencias de exportación: con K.O. II la suya primero; sin él, las habituales. */
export const exportRates = (ko2 = hasKO2() && KO_EXPORT) => ko2 ? [46875, 44100, 48000] : [48000, 44100];
export const rateLabel = r => r === 46875 ? '46 875 Hz' : r === 44100 ? '44,1 kHz' : '48 kHz';

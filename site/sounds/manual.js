// Manual técnico con glosario (páginas Manual 1–3 del diseño).
export const MANUAL = [
  { title: 'Grabar y editar', entries: [
    ['Sample (muestra)', 'Fragmento de audio grabado para reutilizarlo.'],
    ['Loop', 'Fragmento que se repite sin cortes audibles.'],
    ['Chop', 'Cortar una toma en trozos y asignar cada uno a un pad.'],
    ['Pad', 'Botón que dispara un sonido al tocarlo.'],
    ['Slot', 'Posición numerada de memoria del K.O. II donde vive un sonido.', true],
    ['Captura retroactiva', 'Guarda lo que sonó justo antes, usando un búfer temporal.'],
    ['Búfer', 'Memoria temporal que escucha sin guardar hasta que lo pidas.'],
    ['Cruce por cero', 'Punto donde la onda pasa por silencio. Cortar ahí evita clics.'],
    ['Fundido (fade)', 'Subida o bajada gradual del volumen en el inicio o el final.'],
  ] },
  { title: 'Tiempo y nivel', entries: [
    ['BPM', 'Pulsos por minuto. Mide la velocidad de la música.'],
    ['Tap tempo', 'Tocar al ritmo varias veces para calcular los BPM.'],
    ['Compás', 'Grupo de pulsos. En 4/4 hay cuatro pulsos por compás.'],
    ['Cuadrícula 1/16', 'Divide cada compás 4/4 en 16 partes para alinear cortes.'],
    ['Cuantizar', 'Mover cortes o golpes a la línea más cercana de la cuadrícula.'],
    ['Fader', 'Control deslizante que sube o baja un valor, como el volumen.'],
    ['Ganancia', 'Nivel de la señal que entra antes de grabar.'],
    ['dB (decibelios)', 'Unidad de nivel. En digital, 0 dB es el máximo posible.'],
    ['Clip (saturación)', 'Distorsión al pasar de 0 dB. No se puede arreglar después.'],
  ] },
  { title: 'Sonido y formato', entries: [
    ['Normalizar', 'Sube el volumen hasta un nivel objetivo, sin pasar de él.'],
    ['EQ (ecualizador)', 'Sube o baja graves, medios y agudos.'],
    ['Filtro', 'Pasa bajos deja los graves; pasa altos deja los agudos.'],
    ['Compresor', 'Reduce la diferencia entre sonidos fuertes y suaves.'],
    ['Reverb', 'Simula el eco de un espacio, como una sala o un pasillo.'],
    ['Grit', 'Distorsión suave que da carácter, como vinilo o cinta.'],
    ['Pitch (tono)', 'Qué tan agudo o grave suena. Un semitono es un paso musical.'],
    ['Frecuencia de muestreo', 'Muestras por segundo. El K.O. II usa 46 875 Hz (por confirmar).', false, 'Muestras por segundo. Lo habitual son 44 100 o 48 000 Hz.'],
    ['No destructivo', 'El original queda intacto; los cambios se aplican al guardar.'],
  ] },
];

/** Manual según el perfil: sin K.O. II se quita «Slot» y la frecuencia no lo menciona. */
export function manualFor(ko2) {
  return MANUAL.map(s => ({
    title: s.title,
    entries: s.entries.filter(e => ko2 || !e[2]).map(e => [e[0], ko2 || !e[3] ? e[1] : e[3]]),
  }));
}

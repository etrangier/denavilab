import Foundation

struct ManualEntry: Hashable {
    let term: String
    let text: String
}

struct ManualSection: Hashable {
    let title: String
    let entries: [ManualEntry]
}

/// Manual técnico con glosario (páginas Manual 1–3 del diseño).
enum ManualContent {
    nonisolated static let all: [ManualSection] = [
        ManualSection(title: "Grabar y editar", entries: [
            ManualEntry(term: "Sample (muestra)", text: "Fragmento de audio grabado para reutilizarlo."),
            ManualEntry(term: "Loop", text: "Fragmento que se repite sin cortes audibles."),
            ManualEntry(term: "Chop", text: "Cortar una toma en trozos y asignar cada uno a un pad."),
            ManualEntry(term: "Pad", text: "Botón que dispara un sonido al tocarlo."),
            ManualEntry(term: "Slot", text: "Posición numerada de memoria del K.O. II donde vive un sonido."),
            ManualEntry(term: "Captura retroactiva", text: "Guarda lo que sonó justo antes, usando un búfer temporal."),
            ManualEntry(term: "Búfer", text: "Memoria temporal que escucha sin guardar hasta que lo pidas."),
            ManualEntry(term: "Cruce por cero", text: "Punto donde la onda pasa por silencio. Cortar ahí evita clics."),
            ManualEntry(term: "Fundido (fade)", text: "Subida o bajada gradual del volumen en el inicio o el final."),
        ]),
        ManualSection(title: "Tiempo y nivel", entries: [
            ManualEntry(term: "BPM", text: "Pulsos por minuto. Mide la velocidad de la música."),
            ManualEntry(term: "Tap tempo", text: "Tocar al ritmo varias veces para calcular los BPM."),
            ManualEntry(term: "Compás", text: "Grupo de pulsos. En 4/4 hay cuatro pulsos por compás."),
            ManualEntry(term: "Cuadrícula 1/16", text: "Divide cada compás 4/4 en 16 partes para alinear cortes."),
            ManualEntry(term: "Cuantizar", text: "Mover cortes o golpes a la línea más cercana de la cuadrícula."),
            ManualEntry(term: "Fader", text: "Control deslizante que sube o baja un valor, como el volumen."),
            ManualEntry(term: "Ganancia", text: "Nivel de la señal que entra antes de grabar."),
            ManualEntry(term: "dB (decibelios)", text: "Unidad de nivel. En digital, 0 dB es el máximo posible."),
            ManualEntry(term: "Clip (saturación)", text: "Distorsión al pasar de 0 dB. No se puede arreglar después."),
        ]),
        ManualSection(title: "Sonido y formato", entries: [
            ManualEntry(term: "Normalizar", text: "Sube el volumen hasta un nivel objetivo, sin pasar de él."),
            ManualEntry(term: "EQ (ecualizador)", text: "Sube o baja graves, medios y agudos."),
            ManualEntry(term: "Filtro", text: "Pasa bajos deja los graves; pasa altos deja los agudos."),
            ManualEntry(term: "Compresor", text: "Reduce la diferencia entre sonidos fuertes y suaves."),
            ManualEntry(term: "Reverb", text: "Simula el eco de un espacio, como una sala o un pasillo."),
            ManualEntry(term: "Grit", text: "Distorsión suave que da carácter, como vinilo o cinta."),
            ManualEntry(term: "Pitch (tono)", text: "Qué tan agudo o grave suena. Un semitono es un paso musical."),
            ManualEntry(term: "Frecuencia de muestreo", text: "Muestras por segundo. El K.O. II usa 46 875 Hz (por confirmar)."),
            ManualEntry(term: "No destructivo", text: "El original queda intacto; los cambios se aplican al guardar."),
        ]),
    ]
}

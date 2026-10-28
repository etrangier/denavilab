import Foundation

/// Escuchar tempo: oye unos segundos por el micrófono (lo que se toca en el K.O. II, sin grabar) y estima el BPM.
enum Tempo {
    nonisolated static let seconds = 10
    nonisolated static let range = 40.0...240.0

    enum Outcome: Equatable {
        case bpm(Double, confidence: Double)
        case failed(String)
    }

    nonisolated static func label(_ confidence: Double) -> String { confidence >= 0.3 ? "buena" : confidence >= 0.15 ? "regular" : "dudosa" }

    /// Mismo pulso leído a la mitad o al doble, dentro de un rango musical.
    nonisolated static func alternatives(_ bpm: Double) -> [Double] {
        [bpm / 2, bpm * 2].filter { range.contains($0) }.map { ($0 * 10).rounded() / 10 }
    }

    nonisolated static func analyze(_ x: [Float], rate: Int) -> Outcome {
        guard x.count >= rate * 4 else { return .failed("Todavía no hay audio suficiente. Vuelve a intentarlo.") }
        guard Editing.peakDB(x) > -50 else { return .failed("No oigo nada. Acerca el micrófono al aparato o sube su volumen.") }
        guard let r = Editing.estimateBPM(x, rate: rate) else {
            return .failed("No encuentro un pulso claro. Prueba con un patrón más marcado (bombo y caja) o escucha unos segundos más.")
        }
        return .bpm(r.bpm, confidence: r.confidence)
    }
}

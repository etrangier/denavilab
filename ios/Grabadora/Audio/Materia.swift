import Foundation

/// Modo materia prima: de una toma de 10–15 s se elige un fragmento de 2–5 s y se guarda como «crudo».
enum Materia {
    nonisolated static let takeSeconds = 15.0          // la toma se corta sola a los 15 s
    nonisolated static let softLimit = 6.0             // avisa (sin impedir nada) si el fragmento pasa de 6 s
    nonisolated static let minFragment = 0.1

    /// Ventana de `seconds` con más energía (donde suele estar lo bueno), en fracciones 0...1 de la toma.
    nonisolated static func bestWindow(_ x: [Float], rate: Int, seconds: Double) -> (start: Double, end: Double) {
        let n = x.count, w = min(n, Int(seconds * Double(rate)))
        guard n > 0, w < n else { return (0, 1) }
        let blk = max(1, rate / 20)
        var e: [Float] = []
        var i = 0
        while i + blk <= n { var s: Float = 0; for j in i..<(i + blk) { s += x[j] * x[j] }; e.append(s); i += blk }
        let k = max(1, w / blk)
        guard e.count >= k else { return (0, 1) }
        var cur: Float = 0, best: Float = -1, at = 0
        for idx in 0..<e.count {
            cur += e[idx]
            if idx >= k { cur -= e[idx - k] }
            if idx >= k - 1 && cur > best { best = cur; at = idx - k + 1 }
        }
        let a = at * blk
        return (Double(a) / Double(n), min(1, Double(a + w) / Double(n)))
    }

    /// Recorta [a, b] (fracciones), quita la continua y suaviza los bordes para que ni el corte ni el bucle hagan clic.
    nonisolated static func cut(_ x: [Float], rate: Int, start a: Double, end b: Double) -> [Float] {
        let i = max(0, min(x.count, Int(floor(a * Double(x.count))))), j = max(i, min(x.count, Int(ceil(b * Double(x.count)))))
        let piece = Harmonize.removeDC(Array(x[i..<j]))
        return Harmonize.cosFade(piece, inSamples: rate * 5 / 1000, outSamples: rate * 20 / 1000)
    }

    /// Aviso suave según la duración del fragmento (nil si está bien).
    nonisolated static func advice(seconds d: Double) -> String? {
        if d > softLimit {
            let n = String(format: "%.1f", d).replacingOccurrences(of: ".", with: ",")
            return "Dura \(n) s: más de \(Int(softLimit)) s. Puedes guardarla igual, pero para una textura del K.O. II conviene acortar."
        }
        if d < 2 { return "Menos de 2 s: sirve para golpes; para un pad, mejor de 2 a 5 s." }
        return nil
    }
}

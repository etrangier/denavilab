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

    /// Salida larga: hasta 1,5 s y como mucho un tercio del fragmento, para que una textura se apague en vez de quedar cortada.
    nonisolated static func longFadeSec(_ len: Double) -> Double { min(1.5, len / 3) }

    /// Recorta [a, b] (fracciones), quita la continua y suaviza los bordes para que ni el corte ni el bucle hagan clic.
    /// Opcional: fade-out largo, quitar crujidos y quitar el zumbido detectado.
    nonisolated static func cut(_ x: [Float], rate: Int, start a: Double, end b: Double, longFade: Bool = false, declick: Bool = false, strong: Bool = false, hum: Restore.Hum? = nil) -> [Float] {
        let i = max(0, min(x.count, Int(floor(a * Double(x.count))))), j = max(i, min(x.count, Int(ceil(b * Double(x.count)))))
        var piece = Harmonize.removeDC(Array(x[i..<j]))
        if let h = hum { piece = Restore.dehum(piece, rate: rate, hum: h) }
        if declick { piece = Restore.declick(piece, rate: rate, strong: strong).audio }
        let out = longFade ? Int(longFadeSec(Double(piece.count) / Double(rate)) * Double(rate)) : rate * 20 / 1000
        return Harmonize.cosFade(piece, inSamples: longFade ? rate * 10 / 1000 : rate * 5 / 1000, outSamples: out)
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

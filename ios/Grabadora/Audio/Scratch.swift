import Foundation

/// Scratch «horneado»: mueve el punto de lectura de la toma hacia adelante y atrás como una aguja sobre un vinilo (el tono sube y baja con la
/// velocidad, y al ir hacia atrás suena invertido) y cierra el volumen como un crossfader. El resultado es un sample normal.
/// Mismo algoritmo y mismos números que `scratch.js` en la PWA.
enum Scratch {
    enum Kind: String, CaseIterable {
        case baby, chirp, tape, stutter
        nonisolated var title: String {
            switch self { case .baby: return "Baby scratch"; case .chirp: return "Chirp"; case .tape: return "Tape stop"; case .stutter: return "Stutter" }
        }
    }

    /// Lectura con interpolación cúbica (Catmull-Rom) en la posición fraccionaria `p`; 0 fuera de la toma.
    nonisolated private static func readAt(_ x: [Float], _ p: Double) -> Float {
        let len = x.count
        guard len > 0, p >= 0, p <= Double(len - 1) else { return 0 }
        let i0 = Int(p.rounded(.down)), t = Float(p - Double(i0))
        func at(_ i: Int) -> Float { x[i < 0 ? 0 : (i >= len ? len - 1 : i)] }
        let a = at(i0 - 1), b = at(i0), c = at(i0 + 1), d = at(i0 + 2)
        return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)))
    }

    /// Scratch del tramo [a, b) de `x`, de `beats` tiempos a `bpm`. `depth` (0–1) es cuánto del tramo recorre la aguja.
    /// Devuelve vacío si el tramo dura menos de 50 ms.
    nonisolated static func scratch(_ x: [Float], from a: Int, to b: Int, rate: Int, kind: Kind = .baby, bpm: Double = 100, beats: Int = 4, depth: Double = 0.6) -> [Float] {
        let lo = max(0, a), hi = min(x.count, b)
        guard hi > lo, Double(hi - lo) >= Double(rate) * 0.05, bpm > 0 else { return [] }
        let src = Array(x[lo..<hi]), L = Double(src.count)
        let beat = Int((60 * Double(rate) / bpm).rounded()), N = beat * max(1, beats)
        let W = max(1, min(1, depth) * L), p0 = (kind == .tape || kind == .stutter) ? 0 : (L - W) / 2
        let ramp = max(1, Int((Double(rate) * 0.003).rounded())), step = max(1, Int((Double(beat) / 4).rounded()))
        var out = [Float](repeating: 0, count: N)
        for i in 0..<N {
            var pos = 0.0, g = 1.0
            switch kind {
            case .chirp:
                let u = Double(i % beat) / Double(beat), r = Double(ramp) / Double(beat)
                pos = p0 + W * min(u, 0.5) / 0.5
                g = u < 0.5 ? min(1, u / r) * min(1, (0.5 - u) / r) : 0
            case .tape:
                let t = Double(i) / Double(N)
                pos = p0 + (Double(N) / 3) * (1 - pow(1 - t, 3)); g = min(1, (1 - t) / 0.08)
            case .stutter:
                let k = Double(i % step)
                pos = p0 + k
                g = max(0, min(1, k / Double(ramp)) * min(1, (Double(step) * 0.75 - k) / Double(ramp)))
            case .baby:
                let u = Double(i % beat) / Double(beat)
                pos = p0 + W * (0.5 - 0.5 * cos(2 * Double.pi * u))
            }
            out[i] = readAt(src, pos) * Float(g)
        }
        return Harmonize.cosFade(out, inSamples: ramp, outSamples: ramp)
    }
}

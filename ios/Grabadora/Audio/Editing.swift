import Foundation

/// Edición de forma de onda: funciones puras y sin estado.
enum Editing {
    /// Cruce por cero más cercano a `index` (evita clics en los cortes).
    static func nearestZeroCross(_ x: [Float], to index: Int, window: Int = 2048) -> Int {
        guard x.count > 1 else { return 0 }
        let c = min(max(index, 0), x.count - 2)
        for d in 0...window {
            for i in [c - d, c + d] where i >= 0 && i < x.count - 1 {
                if x[i] == 0 || (x[i] < 0) != (x[i + 1] < 0) { return i }
            }
        }
        return c
    }

    static func trim(_ x: [Float], from a: Int, to b: Int, snapToZero: Bool = true) -> [Float] {
        guard !x.isEmpty else { return x }
        var s = min(max(a, 0), x.count - 1), e = min(max(b, 0), x.count)
        if snapToZero { s = nearestZeroCross(x, to: s); e = nearestZeroCross(x, to: e) + 1 }
        guard e > s else { return [] }
        return Array(x[s..<min(e, x.count)])
    }

    static func fade(_ x: [Float], inSamples: Int, outSamples: Int) -> [Float] {
        var y = x
        let fi = min(inSamples, y.count), fo = min(outSamples, y.count)
        for i in 0..<fi { y[i] *= Float(i) / Float(fi) }
        for i in 0..<fo { y[y.count - 1 - i] *= Float(i) / Float(fo) }
        return y
    }

    /// Normaliza a un pico objetivo (por defecto -1 dBFS).
    static func normalize(_ x: [Float], peak target: Float = 0.891) -> [Float] {
        let p = x.map(abs).max() ?? 0
        guard p > 0 else { return x }
        return x.map { $0 * target / p }
    }

    /// Picos por bloque para dibujar la onda con zoom.
    static func peaks(_ x: [Float], buckets: Int) -> [Float] {
        guard !x.isEmpty, buckets > 0 else { return [] }
        let size = max(1, x.count / buckets)
        return stride(from: 0, to: x.count, by: size).map { i in
            x[i..<min(i + size, x.count)].map(abs).max() ?? 0
        }
    }

    static func peakDB(_ x: [Float]) -> Float {
        let p = x.map(abs).max() ?? 0
        return p > 0 ? 20 * log10(p) : -120
    }
}

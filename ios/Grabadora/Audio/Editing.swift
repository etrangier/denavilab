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

    // MARK: Guardado rápido y chop

    /// Quita el silencio del principio y del final (umbral en dBFS). Si todo es silencio, no toca nada.
    static func trimSilence(_ x: [Float], thresholdDB: Float = -48, pad: Int = 0) -> [Float] {
        let th = pow(10, thresholdDB / 20)
        guard let a = x.firstIndex(where: { abs($0) > th }), let b = x.lastIndex(where: { abs($0) > th }) else { return x }
        return Array(x[max(0, a - pad)..<min(x.count, b + 1 + pad)])
    }

    /// Inicios de golpes por subida de energía. `sensitivity` 0...1: más alta, más cortes.
    static func transients(_ x: [Float], sensitivity: Double, minGapSamples: Int, maxCount: Int = 12) -> [Int] {
        let hop = 512
        guard x.count > hop * 4 else { return [] }
        let n = x.count / hop
        var e = [Float](repeating: 0, count: n)
        for i in 0..<n {
            var s: Float = 0
            for j in (i * hop)..<((i + 1) * hop) { s += x[j] * x[j] }
            e[i] = (s / Float(hop)).squareRoot()
        }
        var flux = [Float](repeating: 0, count: n)
        for i in 1..<n { flux[i] = max(0, e[i] - e[i - 1]) }
        let mean = flux.reduce(0, +) / Float(n)
        let sd = (flux.map { ($0 - mean) * ($0 - mean) }.reduce(0, +) / Float(n)).squareRoot()
        let k = Float(4 - 3.5 * min(max(sensitivity, 0), 1))
        let thr = mean + k * sd
        var picks: [(i: Int, f: Float)] = []
        for i in 1..<n where flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] >= (i + 1 < n ? flux[i + 1] : 0) {
            picks.append((i, flux[i]))
        }
        let gap = max(1, minGapSamples / hop)
        var chosen: [Int] = []
        for p in picks.sorted(by: { $0.f > $1.f }) where chosen.allSatisfy({ abs($0 - p.i) >= gap }) { chosen.append(p.i) }
        return Array(chosen.prefix(maxCount)).sorted().map { nearestZeroCross(x, to: max(0, $0 * hop - hop), window: 256) }
    }

    /// `count` inicios repartidos por igual, ajustados a cruce por cero.
    static func evenSlices(_ x: [Float], count: Int) -> [Int] {
        guard !x.isEmpty, count > 0 else { return [] }
        return (0..<count).map { $0 == 0 ? 0 : nearestZeroCross(x, to: x.count * $0 / count, window: 256) }
    }

    /// Tramos entre inicios; descarta los de menos de 64 muestras.
    static func slices(starts: [Int], total: Int) -> [Range<Int>] {
        let s = Array(Set([0] + starts.filter { $0 > 0 && $0 < total })).sorted()
        return s.enumerated().compactMap { i, a in
            let b = i + 1 < s.count ? s[i + 1] : total
            return b - a >= 64 ? a..<b : nil
        }
    }
}

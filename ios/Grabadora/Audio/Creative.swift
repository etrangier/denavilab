import Foundation

/// Herramientas creativas. Mismo algoritmo que `dsp.js` en la PWA.
enum Creative {
    /// Da la vuelta a un tramo [a, b) del audio (por defecto, todo).
    nonisolated static func reverseRange(_ x: [Float], from a: Int = 0, to b: Int? = nil) -> [Float] {
        let lo = max(0, min(a, x.count)), hi = max(lo, min(b ?? x.count, x.count))
        var y = x
        for i in 0..<(hi - lo) { y[lo + i] = x[hi - 1 - i] }
        return y
    }

    /// Colchón sostenido (estirar mucho, al estilo Paul's Extreme Sound Stretch): ventanas largas (~0,25 s) cuyo espectro se
    /// conserva pero con la fase al azar, así cada nota se difumina en un sonido continuo sin cambiar de tono. `factor` ≥ 2.
    /// Con `sustain`, las colas que se apagan se suben (hasta +18 dB). Determinista; el volumen se iguala al de la toma original.
    nonisolated static func padStretch(_ x: [Float], factor: Double, rate: Int, sustain: Bool = true) -> [Float] {
        let n = x.count
        guard n >= 64, factor > 1, factor.isFinite else { return x }
        var N = 1024
        while Double(N) < Double(rate) * 0.25 { N <<= 1 }
        let H = N / 2, m = Int((Double(n) * factor).rounded()), off = N
        let win: [Double] = (0..<N).map { sin(Double.pi * (Double($0) + 0.5) / Double(N)) }
        var out = [Double](repeating: 0, count: m + 3 * N)
        var re = [Double](repeating: 0, count: N), im = [Double](repeating: 0, count: N)
        var seed: UInt32 = 12345
        func rnd() -> Double { seed = seed &* 1664525 &+ 1013904223; return Double(seed) / 4294967296 }
        var k = 0
        while (k - 1) * H <= m {
            let s = (k - 1) * H, start = Int((Double(s + H) / factor - Double(H)).rounded())
            for i in 0..<N {
                let j = start + i
                re[i] = (j >= 0 && j < n ? Double(x[j]) : 0) * win[i]; im[i] = 0
            }
            NoiseReduction.fft(&re, &im, inverse: false)
            for b in 0...H {
                let mag = (re[b] * re[b] + im[b] * im[b]).squareRoot()
                if b == 0 || b == H { re[b] = mag; im[b] = 0; continue }
                let th = 2 * Double.pi * rnd()
                re[b] = mag * cos(th); im[b] = mag * sin(th)
                re[N - b] = re[b]; im[N - b] = -im[b]
            }
            NoiseReduction.fft(&re, &im, inverse: true)
            for i in 0..<N { out[off + s + i] += re[i] * win[i] }
            k += 1
        }
        var y = (0..<m).map { Float(out[off + $0]) }
        if sustain { y = levelEnvelope(y, rate: rate) }
        var ein = 0.0, eout = 0.0, pk = 0.0
        for v in x { ein += Double(v) * Double(v) }
        for v in y { eout += Double(v) * Double(v) }
        var g = eout > 1e-18 && ein > 1e-18 ? min(4, ((ein / Double(n)) / (eout / Double(m))).squareRoot()) : 1
        for v in y { pk = max(pk, Double(abs(v)) * g) }
        if pk > 0.98 { g *= 0.98 / pk }
        y = y.map { $0 * Float(g) }
        return Harmonize.cosFade(y, inSamples: Int((Double(rate) * 0.01).rounded()), outSamples: Int((Double(rate) * 0.15).rounded()))
    }

    /// Sube las partes que se apagan hacia el nivel de las más fuertes (sólo sube, hasta `maxBoostDB`; el silencio real no se toca).
    nonisolated static func levelEnvelope(_ y: [Float], rate: Int, maxBoostDB: Double = 18) -> [Float] {
        let blk = max(1, Int((Double(rate) * 0.1).rounded())), nb = y.count / blk
        guard nb >= 3 else { return y }
        var e = [Double](repeating: 0, count: nb)
        for b in 0..<nb {
            var a = 0.0
            for i in (b * blk)..<((b + 1) * blk) { a += Double(y[i]) * Double(y[i]) }
            e[b] = (a / Double(blk)).squareRoot()
        }
        let sorted = e.sorted(by: >), target = sorted[nb / 4], peak = sorted[0]
        var sm = [Double](repeating: 0, count: nb)
        for b in 0..<nb {                                                       // promedio de ±0,5 s: el nivel cambia despacio
            var a = 0.0, c = 0.0
            for d in -5...5 { let j = b + d; if j >= 0 && j < nb { a += e[j]; c += 1 } }
            sm[b] = a / c
        }
        let maxG = pow(10, maxBoostDB / 20)
        let gain: [Double] = (0..<nb).map { b in
            sm[b] < peak * 1e-3 || sm[b] < 1e-9 ? 1 : min(maxG, max(1, target / sm[b]))
        }
        return (0..<y.count).map { i in
            let f = min(Double(nb - 1), max(0, Double(i) / Double(blk) - 0.5)), b0 = Int(f.rounded(.down)), b1 = min(nb - 1, b0 + 1)
            let g = gain[b0] + (gain[b1] - gain[b0]) * (f - Double(b0))
            return y[i] * Float(g)
        }
    }
}

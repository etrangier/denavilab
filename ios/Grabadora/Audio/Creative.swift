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

    // MARK: loop continuo sin pulso

    /// Parecido entre lo que hay justo antes de `e` y el principio (`a`).
    nonisolated private static func ncc(_ x: [Float], _ e: Int, _ a: Int, _ f: Int, _ stride: Int) -> Double {
        var dot = 0.0, ea = 0.0, eb = 0.0, i = 0
        while i < f {
            let u = Double(x[e - f + i]), v = Double(x[a + i])
            dot += u * v; ea += u * u; eb += v * v
            i += stride
        }
        return dot / (ea * eb + 1e-12).squareRoot()
    }

    /// Convierte el tramo [a, b) en un loop continuo, aunque no tenga pulso (pads, cuerdas, ambientes): el final se funde con el
    /// principio (empalme de `crossSec`) y, con `refine`, el final se mueve hasta ±0,5 s al punto cuyo sonido más se parece al del
    /// principio. Si ambos extremos se parecen, el fundido es lineal; si no, de potencia constante. Mide ~L − empalme.
    nonisolated static func loopSeamless(_ x: [Float], from a0: Int, to b0: Int, rate: Int, crossSec: Double = 1, refine: Bool = true) -> [Float] {
        let a = max(0, min(a0, x.count)), b = max(a, min(b0, x.count))
        guard b - a >= rate / 2 else { return x }
        let f = min(Int((crossSec * Double(rate)).rounded()), (b - a) >> 1)
        guard f >= 64 else { return x }
        var e = b, sim = ncc(x, e, a, f, 8)
        if refine {
            let sRange = Int((Double(rate) * 0.5).rounded()), lo = max(a + 2 * f, e - sRange), hi = min(x.count, e + sRange)
            var best = -Double.infinity, bc = e
            var c = lo
            while c <= hi { let v = ncc(x, c, a, f, 8); if v > best { best = v; bc = c }; c += 16 }
            best = -Double.infinity
            var c2 = max(lo, bc - 16)
            while c2 <= min(hi, bc + 16) { let v = ncc(x, c2, a, f, 2); if v > best { best = v; e = c2 }; c2 += 1 }
            if best > -Double.infinity { sim = best } else { e = b }
        }
        let L = e - a, linear = sim >= 0.6
        var out = Array(x[a..<(a + L - f)])
        for i in 0..<f {
            let t = (Double(i) + 0.5) / Double(f)
            let wi = linear ? t : sin(t * Double.pi / 2), wo = linear ? 1 - t : cos(t * Double.pi / 2)
            out[i] = Float(Double(x[a + i]) * wi + Double(x[e - f + i]) * wo)
        }
        return out
    }

    /// Cuánto «salta» el audio al dar la vuelta: |último − primero| frente al cambio típico entre muestras vecinas.
    nonisolated static func seamJump(_ x: [Float]) -> Double {
        guard x.count >= 3 else { return 0 }
        var d = 0.0
        for i in 1..<x.count { d += Double(abs(x[i] - x[i - 1])) }
        return Double(abs(x[0] - x[x.count - 1])) / (d / Double(x.count - 1) + 1e-12)
    }
}

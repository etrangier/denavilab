import Foundation

/// Herramientas creativas: invertir, tartamudeo y tempo exacto. Mismo algoritmo y mismos números que `dsp.js` en la PWA.
enum Creative {
    /// Da la vuelta a un tramo [a, b) del audio (por defecto, todo).
    nonisolated static func reverseRange(_ x: [Float], from a: Int = 0, to b: Int? = nil) -> [Float] {
        let lo = max(0, min(a, x.count)), hi = max(lo, min(b ?? x.count, x.count))
        var y = x
        for i in 0..<(hi - lo) { y[lo + i] = x[hi - 1 - i] }
        return y
    }

    /// Una repetición con entrada y salida cortas (1,5 ms, de coseno): sin clics en los empalmes.
    nonisolated private static func piece(_ x: [Float], _ a: Int, _ b: Int, rate: Int) -> [Float] {
        let f = Int((Double(rate) * 0.0015).rounded())
        return Harmonize.cosFade(Array(x[a..<b]), inSamples: f, outSamples: f)
    }

    /// Repite el tramo [a, b) `times` veces seguidas (el audio crece). Devuelve `x` tal cual si el tramo es muy corto.
    nonisolated static func repeatRegion(_ x: [Float], from a0: Int, to b0: Int, times t: Int, rate: Int) -> [Float] {
        let a = max(0, min(a0, x.count)), b = max(a, min(b0, x.count)), times = max(1, t)
        guard b - a >= 16, times >= 2 else { return x }
        let p = piece(x, a, b, rate: rate)
        var out = Array(x[0..<a])
        for _ in 0..<times { out.append(contentsOf: p) }
        out.append(contentsOf: x[b...])
        return out
    }

    /// Tartamudeo rítmico: rellena [a, b) repitiendo su primer trozo de `sliceLen` muestras (la duración no cambia).
    nonisolated static func stutterFill(_ x: [Float], from a0: Int, to b0: Int, sliceLen: Int, rate: Int) -> [Float] {
        let a = max(0, min(a0, x.count)), b = max(a, min(b0, x.count))
        guard b - a >= 32, sliceLen >= 16, sliceLen < b - a else { return x }
        let p = piece(x, a, a + sliceLen, rate: rate)
        let f = Int((Double(rate) * 0.0015).rounded())
        var out = x
        var t = a
        while t < b {
            let len = min(sliceLen, b - t)
            let chunk = len == sliceLen ? p : Harmonize.cosFade(Array(p[0..<len]), inSamples: 0, outSamples: f)
            for i in 0..<len { out[t + i] = chunk[i] }
            t += sliceLen
        }
        return out
    }

    /// Largo de una división de compás (1/8, 1/16…) en muestras, a un tempo dado.
    nonisolated static func noteSamples(bpm: Double, division: Int, rate: Int) -> Int {
        Int((Double(rate) * 60 / bpm * 4 / Double(division)).rounded())
    }

    nonisolated private static let tsN = 2048
    nonisolated private static let tsH = 1024
    nonisolated private static let tsD = 400
    nonisolated private static let tsWin: [Double] = (0..<2048).map { 0.5 - 0.5 * cos(2 * Double.pi * Double($0) / 2048) }
    /// Desplazamientos a probar, del más cercano al más lejano (0, +4, −4, +8, −8…): a igualdad gana el más cercano.
    nonisolated private static let tsCoarse: [Int] = {
        var o = [0]
        var d = 4
        while d <= 400 { o.append(d); o.append(-d); d += 4 }
        return o
    }()

    /// Cambia la duración sin cambiar el tono (WSOLA: tramos solapados que se alinean por correlación, primero a grosso modo
    /// y luego afinando). `ratio` = duración nueva / duración vieja (> 1 = más lento). Mejor entre 0,5 y 2 y con material de pulso.
    nonisolated static func timeStretch(_ x: [Float], ratio: Double) -> [Float] {
        let n = x.count
        guard n >= tsN * 2, ratio > 0, abs(ratio - 1) >= 1e-4 else { return x }
        let m = Int((Double(n) * ratio).rounded()), off = tsH
        var out = [Double](repeating: 0, count: m + 4 * tsH)
        func at(_ j: Int) -> Double { j >= 0 && j < n ? Double(x[j]) : 0 }
        func score(_ c: Int, _ ref: Int, _ stride: Int) -> Double {
            var dot = 0.0, en = 0.0, i = 0
            while i < tsH { let v = at(c + i); dot += v * at(ref + i); en += v * v; i += stride }
            return dot / (en + 1e-9).squareRoot()
        }
        var prev = 0, k = 0
        while (k - 1) * tsH <= m {
            let s = (k - 1) * tsH, q = Int((Double(s) / ratio).rounded())
            var pos = q
            if k > 0 {
                let ref = prev + tsH
                var best = -Double.infinity, bc = q
                for d in tsCoarse { let sc = score(q + d, ref, 8); if sc > best { best = sc; bc = q + d } }
                best = -Double.infinity; pos = bc
                for d in -4...4 {
                    let c = bc + d
                    if c < q - tsD || c > q + tsD { continue }
                    let sc = score(c, ref, 2)
                    if sc > best { best = sc; pos = c }
                }
            }
            prev = pos
            for i in 0..<tsN { out[off + s + i] += tsWin[i] * at(pos + i) }
            k += 1
        }
        return (0..<m).map { Float(out[off + $0]) }
    }
}

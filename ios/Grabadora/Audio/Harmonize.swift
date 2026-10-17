import Foundation

/// Armonizar: que un recorte no suene «cortado». Mismo algoritmo y mismos números que `dsp.js` en la PWA.
enum Harmonize {
    /// Quita el desvío de continua: un corte con la onda descentrada suena a «clic» aunque empiece en cero.
    nonisolated static func removeDC(_ x: [Float]) -> [Float] {
        guard !x.isEmpty else { return x }
        let m = x.reduce(0, +) / Float(x.count)
        return x.map { $0 - m }
    }

    nonisolated private static func peakOf(_ x: [Float]) -> Float { x.reduce(0) { max($0, abs($1)) } }

    nonisolated private static func rmsOf(_ x: [Float], _ a: Int, _ b: Int) -> Float {
        var e: Float = 0
        for i in a..<b { e += x[i] * x[i] }
        return (e / Float(max(1, b - a))).squareRoot()
    }

    nonisolated private static func toDB(_ v: Float) -> Float { v > 1e-6 ? 20 * log10(v) : -120 }

    /// Nivel de un borde (5 ms) respecto al pico de la pieza, en dB (≤ 0): cerca de 0 = se cortó en pleno sonido.
    nonisolated static func edgeLevelDB(_ x: [Float], rate: Int, atEnd: Bool) -> Float {
        let w = min(x.count, max(8, Int((Double(rate) * 0.005).rounded())))
        let a = atEnd ? x.count - w : 0
        return toDB(rmsOf(x, a, a + w)) - toDB(peakOf(x))
    }

    /// Fundido de salida a medida: 3 ms si la pieza ya acaba suave, hasta 30 ms si se cortó en pleno sonido (máximo un cuarto de la pieza).
    nonisolated static func endFadeSamples(_ x: [Float], rate: Int) -> Int {
        let rel = edgeLevelDB(x, rate: rate, atEnd: true)
        let ms = 3 + 27 * min(1, max(0, (Double(rel) + 40) / 40))
        return min(Int((ms * Double(rate) / 1000).rounded()), x.count / 4)
    }

    /// Fundido con curva de coseno (suave en los dos extremos, a diferencia del lineal).
    nonisolated static func cosFade(_ x: [Float], inSamples: Int, outSamples: Int) -> [Float] {
        var y = x
        let fi = min(inSamples, y.count), fo = min(outSamples, y.count)
        for i in 0..<fi { y[i] *= Float(0.5 - 0.5 * cos(Double.pi * Double(i) / Double(fi))) }
        for i in 0..<fo { y[y.count - 1 - i] *= Float(0.5 - 0.5 * cos(Double.pi * Double(i) / Double(fo))) }
        return y
    }

    /// Armoniza una pieza: sin desvío de continua, entrada de 3 ms (no se come el ataque) y salida a medida.
    nonisolated static func harmonize(_ x: [Float], rate: Int) -> [Float] {
        guard x.count >= 16 else { return x }
        let y = removeDC(x)
        return cosFade(y, inSamples: min(Int((Double(rate) * 0.003).rounded()), y.count >> 2), outSamples: endFadeSamples(y, rate: rate))
    }

    /// Volumen típico de una pieza: energía de sus partes activas (a menos de 30 dB de su pico).
    nonisolated static func activeRMS(_ x: [Float], rate: Int) -> Float {
        let blk = max(8, Int((Double(rate) * 0.01).rounded())), th = peakOf(x) * 0.0316
        var e: Float = 0, c = 0, i = 0
        while i + blk <= x.count {
            let r = rmsOf(x, i, i + blk)
            if r > th { e += r * r; c += 1 }
            i += blk
        }
        return c > 0 ? (e / Float(c)).squareRoot() : 0
    }

    /// Une piezas en un solo audio sin saltos: iguala el volumen (hasta ±6 dB hacia el típico del grupo) y funde por coseno en cada
    /// empalme. Si la pieza que entra arranca en pleno golpe, la anterior se apaga justo antes; si arranca suave, se cruzan con potencia constante.
    nonisolated static func join(_ pieces: [[Float]], rate: Int, crossfadeMs: Double = 12, match: Bool = true) -> [Float] {
        var ps = pieces.filter { !$0.isEmpty }.map { removeDC($0) }
        guard !ps.isEmpty else { return [] }
        if match && ps.count > 1 {
            let db = ps.map { toDB(activeRMS($0, rate: rate)) }
            let live = db.filter { $0 > -90 }.sorted()
            if !live.isEmpty {
                let med = live[live.count / 2]
                ps = ps.enumerated().map { i, p in
                    guard db[i] > -90 else { return p }
                    var g = Float(pow(10, Double(max(-6, min(6, med - db[i]))) / 20))
                    let pk = peakOf(p) * g
                    if pk > 0.99 { g *= 0.99 / pk }
                    return p.map { $0 * g }
                }
            }
        }
        var out = ps[0]
        for i in 1..<ps.count {
            let p = ps[i], hf = min(Int((Double(rate) * 0.003).rounded()), p.count >> 2)
            let cross = Int((crossfadeMs / 1000 * Double(rate)).rounded())
            if edgeLevelDB(p, rate: rate, atEnd: false) > -20 {           // entra con un golpe: la anterior se apaga y el ataque queda entero
                let f = min(cross, out.count >> 1)
                out = cosFade(out, inSamples: 0, outSamples: f) + cosFade(p, inSamples: hf, outSamples: 0)
            } else {                                                      // entra suave: cruce de potencia constante
                let l = min(cross, out.count >> 1, p.count >> 1), o = out.count - l
                var r = out
                for k in 0..<l {
                    let th = Double.pi / 2 * (Double(k) + 0.5) / Double(l)
                    r[o + k] = out[o + k] * Float(cos(th)) + p[k] * Float(sin(th))
                }
                r.append(contentsOf: p[l...])
                out = r
            }
        }
        return cosFade(out, inSamples: min(Int((Double(rate) * 0.003).rounded()), out.count >> 2), outSamples: endFadeSamples(out, rate: rate))
    }
}

import Foundation

/// Gestos de loop del estilo «french house» (Daft Punk): barrido de filtro, tartamudeo en el primer tiempo y compresión de pegamento.
/// Mismo cálculo que `loopfx.js` de la PWA. Las fuentes consultadas (Mixmag, Equipboard, MusicRadar, Village Voice, Soundation) hablan de trozos cortos
/// y tartamudeados, de filtros pasa-bajos que se abren y de un compresor/limitador como pieza central; la receta de cada gesto es nuestra interpretación.
enum LoopFx {
    /// Barrido de filtro pasa-bajos a lo largo de todo el loop. mode 1 = se abre (250 Hz → 14 kHz), 2 = se cierra.
    nonisolated static func filterSweep(_ x: [Float], _ rate: Int, mode: Int) -> [Float] {
        guard mode != 0, x.count >= 2 else { return x }
        let lo = 250.0, hi = 14000.0, n = Double(x.count), k = log(hi / lo)
        let y = Fx404.svfSweep(x, rate, type: 0, cutoffAt: { i in
            let t = Double(i) / n, u = mode == 2 ? 1 - t : t
            return lo * exp(k * u)
        }, q: 0.9)
        return Fx404.finish(y)
    }

    /// Tartamudeo del primer tiempo: un trocito del arranque (1/16 de compás) se repite hasta llenar el tiempo, con fundidos de 3 ms; el resto queda intacto.
    nonisolated static func stutterIntro(_ x: [Float], _ rate: Int, bpm: Double, sixteenths: Int = 1, span: Double = 1) -> [Float] {
        guard bpm > 0 else { return x }
        let beat = Int((60 / bpm * Double(rate)).rounded()), len = min(x.count, Int((Double(beat) * span).rounded())), piece = max(64, Int((Double(beat) / 4 * Double(sixteenths)).rounded()))
        guard len >= piece * 2 else { return x }
        var y = x
        let f = max(2, Int((Double(rate) * 0.003).rounded()))
        for i in 0..<len {
            let p = i % piece
            let e = min(1, Double(p) / Double(f), Double(piece - 1 - p) / Double(f))
            y[i] = x[p] * Float(e < 1 ? max(0, e) : 1)
        }
        return y
    }

    /// Compresión de pegamento: ratio 3:1, umbral 9 dB bajo el pico típico, nivel igualado.
    nonisolated static func glue(_ x: [Float], _ rate: Int) -> [Float] {
        let pk = 20 * log10(max(Fx404.peakRef(x), 1e-6))
        return Fx404.finish(Fx404.matchLevel(Fx404.compress(x, rate, thDB: pk - 9, ratio: 3, atkMs: 8, relMs: 120), x, rate))
    }

    /// Aplica los gestos en orden: tartamudeo → compresión → barrido de filtro.
    nonisolated static func apply(_ x: [Float], _ rate: Int, bpm: Double, stutter: Bool, glueOn: Bool, sweep: Int) -> [Float] {
        var y = x
        if stutter { y = stutterIntro(y, rate, bpm: bpm) }
        if glueOn { y = glue(y, rate) }
        if sweep != 0 { y = filterSweep(y, rate, mode: sweep) }
        return y
    }
}

import Foundation

/// Limpieza de ruido: pasa-altos + compuerta (Suave/Fuerte) y resta espectral con perfil de ruido.
/// Funciones puras; mismo algoritmo y mismos números que `dsp.js` en la PWA.
enum NoiseReduction {
    enum Level: String {
        case off, soft, strong

        nonisolated var highpassHz: Double { self == .strong ? 160 : 100 }
        nonisolated var margin: Float { self == .strong ? 16 : 10 }
        nonisolated var floorDB: Float { self == .strong ? -35 : -15 }
        /// Fuerte suma la resta espectral (si hay una parte tranquila de la que aprender).
        nonisolated var spectral: Double { self == .strong ? 1.5 : 0 }
    }

    nonisolated private static let blockSeconds = 0.02

    /// Filtro pasa-altos de 4.º orden (dos biquads Butterworth en cascada).
    nonisolated static func highpass(_ x: [Float], rate: Int, hz: Double) -> [Float] {
        let w0 = 2 * Double.pi * hz / Double(rate), c = cos(w0), al = sin(w0) / (2 * 0.7071067811865476), a0 = 1 + al
        let b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0
        var y = x
        for _ in 0..<2 {
            var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
            for i in 0..<y.count {
                let xi = Double(y[i])
                let yi = b0 * xi + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
                x2 = x1; x1 = xi; y2 = y1; y1 = yi
                y[i] = Float(yi)
            }
        }
        return y
    }

    nonisolated private static func blockRMS(_ x: [Float], rate: Int) -> (blk: Int, rms: [Float]) {
        let blk = max(1, Int((Double(rate) * blockSeconds).rounded()))
        var out: [Float] = []
        var i = 0
        while i + blk <= x.count {
            var e: Float = 0
            for j in i..<(i + blk) { e += x[j] * x[j] }
            out.append((e / Float(blk)).squareRoot())
            i += blk
        }
        return (blk, out)
    }

    nonisolated private static func toDB(_ v: Float) -> Float { v > 1e-6 ? 20 * log10(v) : -120 }

    /// Nivel de fondo (dB): percentil 10 de la energía por bloques de 20 ms.
    nonisolated static func noiseFloorDB(_ x: [Float], rate: Int) -> Float {
        let r = blockRMS(x, rate: rate).rms.sorted()
        guard !r.isEmpty else { return -120 }
        return toDB(r[r.count / 10])
    }

    /// Compuerta con ataque rápido, mantenimiento y salida suave. Arranca ya en su estado.
    nonisolated static func gate(_ x: [Float], rate: Int, thresholdDB: Float, floorDB: Float,
                                 holdMs: Double = 60, releaseMs: Double = 120, attackMs: Double = 3) -> [Float] {
        let (blk, rms) = blockRMS(x, rate: rate)
        guard !rms.isEmpty else { return x }
        let th = pow(10, thresholdDB / 20), floor = pow(10, floorDB / 20)
        let hold = max(1, Int((holdMs / (blockSeconds * 1000)).rounded()))
        var open = [Bool](repeating: false, count: rms.count)
        var left = 0
        for b in 0..<rms.count {
            if rms[b] > th { left = hold }
            open[b] = left > 0
            if left > 0 { left -= 1 }
        }
        if rms.count > 1 { for b in 0..<(rms.count - 1) where open[b + 1] { open[b] = true } }   // anticipa un bloque
        let ca = Float(1 - exp(-1 / (Double(rate) * attackMs / 1000))), cr = Float(1 - exp(-1 / (Double(rate) * releaseMs / 1000)))
        var y = x
        var g: Float = open[0] ? 1 : floor
        for i in 0..<x.count {
            let b = min(rms.count - 1, i / blk)
            let t: Float = open[b] ? 1 : floor
            g += (t - g) * (t > g ? ca : cr)
            y[i] = x[i] * g
        }
        return y
    }

    /// Reducir ruido rápido: pasa-altos, resta espectral (sólo Fuerte) y compuerta, con el umbral sacado del fondo de la propia toma.
    nonisolated static func clean(_ x: [Float], rate: Int, level: Level) -> [Float] {
        guard level != .off, x.count >= rate / 10 else { return x }
        var y = highpass(x, rate: rate, hz: level.highpassHz)
        if level.spectral > 0 {
            let w = quietestWindows(y, rate: rate)
            if !w.isEmpty { y = denoise(y, noises: w.map { Array(y[$0]) }, amount: level.spectral) }
        }
        let th = min(noiseFloorDB(y, rate: rate) + level.margin, Editing.peakDB(y) - 20)
        return gate(y, rate: rate, thresholdDB: th, floorDB: level.floorDB)
    }

    /// Hasta `count` partes tranquilas (`seconds` seguidos, sin solaparse) para aprender el ruido; vacío si no hay una parte clara.
    nonisolated static func quietestWindows(_ x: [Float], rate: Int, seconds: Double = 0.3, count: Int = 3) -> [Range<Int>] {
        let (blk, rms) = blockRMS(x, rate: rate)
        let w = max(2, Int((seconds / blockSeconds).rounded()))
        guard rms.count >= w * 2 else { return [] }
        var e: [(en: Float, st: Int)] = []
        var acc: Float = 0
        for b in 0..<rms.count {
            acc += rms[b] * rms[b]
            if b >= w { acc -= rms[b - w] * rms[b - w] }
            if b >= w - 1 { e.append((max(0, acc), b - w + 1)) }
        }
        e.sort { $0.en < $1.en }
        guard let best = e.first else { return [] }
        if Editing.peakDB(x) - toDB((best.en / Float(w)).squareRoot()) < 10 { return [] }
        var out: [Int] = []
        for c in e {
            if out.count >= count || c.en > best.en * 4 + 1e-12 { break }              // sólo partes casi tan tranquilas como la mejor (≤ 6 dB más)
            if out.allSatisfy({ abs($0 - c.st) >= w }) { out.append(c.st) }
        }
        return out.sorted().map { ($0 * blk)..<(($0 + w) * blk) }
    }

    nonisolated static func quietestWindow(_ x: [Float], rate: Int, seconds: Double = 0.3) -> Range<Int>? {
        quietestWindows(x, rate: rate, seconds: seconds, count: 1).first
    }

    // MARK: resta espectral

    nonisolated static let frame = 2048
    nonisolated static let hop = 512

    nonisolated private static let hann: [Double] = (0..<2048).map { 0.5 - 0.5 * cos(2 * Double.pi * Double($0) / 2048) }

    nonisolated static func fft(_ re: inout [Double], _ im: inout [Double], inverse: Bool) {
        let n = re.count
        var j = 0
        for i in 1..<n {
            var bit = n >> 1
            while j & bit != 0 { j ^= bit; bit >>= 1 }
            j ^= bit
            if i < j { re.swapAt(i, j); im.swapAt(i, j) }
        }
        var len = 2
        while len <= n {
            let ang = 2 * Double.pi / Double(len) * (inverse ? 1 : -1), wr = cos(ang), wi = sin(ang)
            var i = 0
            while i < n {
                var cr = 1.0, ci = 0.0
                for k in 0..<(len / 2) {
                    let a = i + k, b = a + len / 2
                    let tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
                    re[b] = re[a] - tr; im[b] = im[a] - ti
                    re[a] += tr; im[a] += ti
                    let nr = cr * wr - ci * wi
                    ci = cr * wi + ci * wr; cr = nr
                }
                i += len
            }
            len <<= 1
        }
        if inverse { for i in 0..<n { re[i] /= Double(n); im[i] /= Double(n) } }
    }

    /// Potencia media por bin de una o varias muestras de ruido (suavizada entre bins vecinos); `frames` 0 si ninguna cabe en una ventana.
    nonisolated static func noiseProfile(_ noises: [[Float]]) -> (pow: [Double], frames: Int) {
        let n = frame
        var pw = [Double](repeating: 0, count: n / 2 + 1)
        var re = [Double](repeating: 0, count: n), im = [Double](repeating: 0, count: n)
        var frames = 0
        for nz in noises {
            var s = 0
            while s + n <= nz.count {
                for i in 0..<n { re[i] = Double(nz[s + i]) * hann[i]; im[i] = 0 }
                fft(&re, &im, inverse: false)
                for k in 0...(n / 2) { pw[k] += re[k] * re[k] + im[k] * im[k] }
                frames += 1
                s += hop
            }
        }
        guard frames > 0 else { return (pw, 0) }
        for k in 0..<pw.count { pw[k] /= Double(frames) }
        var sm = [Double](repeating: 0, count: pw.count)
        for k in 0..<pw.count {                         // 5 bins: el promedio de pocas ventanas es ruidoso
            var a = 0.0, c = 0.0
            for d in -2...2 { let j = k + d; if j >= 0 && j < pw.count { a += pw[j]; c += 1 } }
            sm[k] = a / c
        }
        return (sm, frames)
    }

    nonisolated static let defaultAmount = 1.5

    /// Resta espectral con estimación «dirigida por la decisión» (Wiener): la ganancia de cada bin sale de la relación
    /// señal/ruido de la ventana anterior, así el ruido que queda no «burbujea». `amount` 1,5 = normal; más = más agresivo.
    nonisolated static func denoise(_ x: [Float], noises: [[Float]], amount: Double = defaultAmount) -> [Float] {
        let n = frame, half = n / 2
        let prof = noiseProfile(noises)
        guard prof.frames > 0, x.count >= n else { return x }
        let mu = max(0.2, amount), floor = max(0.03, 0.12 / mu), beta = 0.95, pad = n, len = x.count + 2 * pad
        var src = [Double](repeating: 0, count: len + n)
        for i in 0..<x.count { src[pad + i] = Double(x[i]) }
        var out = [Double](repeating: 0, count: len + n)
        var re = [Double](repeating: 0, count: n), im = [Double](repeating: 0, count: n)
        var aprev = [Double](repeating: 0, count: half + 1), g = [Double](repeating: 1, count: half + 1), sm = [Double](repeating: 1, count: half + 1)
        var s = 0
        while s < len {
            for i in 0..<n { re[i] = src[s + i] * hann[i]; im[i] = 0 }
            fft(&re, &im, inverse: false)
            for k in 0...half {
                let p = re[k] * re[k] + im[k] * im[k], sig = prof.pow[k]
                if p < 1e-18 || sig < 1e-18 {          // silencio digital o sin ruido que quitar: no se toca
                    g[k] = 1; aprev[k] = sig < 1e-18 ? 1e6 : 0; continue
                }
                let gamma = p / sig
                let xi = beta * aprev[k] + (1 - beta) * max(gamma - 1, 0)
                g[k] = max(floor, xi / (xi + mu))
                aprev[k] = g[k] * g[k] * gamma
            }
            for k in 0...half { sm[k] = 0.25 * g[max(0, k - 1)] + 0.5 * g[k] + 0.25 * g[min(half, k + 1)] }
            for k in 0...half {
                re[k] *= sm[k]; im[k] *= sm[k]
                if k > 0 && k < half { re[n - k] *= sm[k]; im[n - k] *= sm[k] }
            }
            fft(&re, &im, inverse: true)
            for i in 0..<n { out[s + i] += re[i] * hann[i] / 1.5 }
            s += hop
        }
        return (0..<x.count).map { Float(out[pad + $0]) }
    }

    nonisolated static func denoise(_ x: [Float], noise: [Float], amount: Double = defaultAmount) -> [Float] {
        denoise(x, noises: [noise], amount: amount)
    }
}

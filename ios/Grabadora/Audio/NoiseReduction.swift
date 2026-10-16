import Foundation

/// Limpieza de ruido: pasa-altos + compuerta (Suave/Fuerte) y resta espectral con perfil de ruido.
/// Funciones puras; mismo algoritmo y mismos números que `dsp.js` en la PWA.
enum NoiseReduction {
    enum Level: String {
        case off, soft, strong

        nonisolated var highpassHz: Double { self == .strong ? 160 : 100 }
        nonisolated var margin: Float { self == .strong ? 16 : 10 }
        nonisolated var floorDB: Float { self == .strong ? -35 : -15 }
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

    /// Reducir ruido rápido: pasa-altos + compuerta, con el umbral sacado del fondo de la propia toma.
    nonisolated static func clean(_ x: [Float], rate: Int, level: Level) -> [Float] {
        guard level != .off, x.count >= rate / 10 else { return x }
        let y = highpass(x, rate: rate, hz: level.highpassHz)
        let th = min(noiseFloorDB(y, rate: rate) + level.margin, Editing.peakDB(y) - 20)
        return gate(y, rate: rate, thresholdDB: th, floorDB: level.floorDB)
    }

    /// La parte más tranquila (`seconds` seguidos) como muestra de ruido; nil si no hay una parte clara.
    nonisolated static func quietestWindow(_ x: [Float], rate: Int, seconds: Double = 0.3) -> Range<Int>? {
        let (blk, rms) = blockRMS(x, rate: rate)
        let w = max(2, Int((seconds / blockSeconds).rounded()))
        guard rms.count >= w * 2 else { return nil }
        var best = 0, bestE = Float.infinity, e: Float = 0
        for b in 0..<rms.count {
            e += rms[b] * rms[b]
            if b >= w { e -= rms[b - w] * rms[b - w] }
            if b >= w - 1 && e < bestE { bestE = e; best = b - w + 1 }
        }
        let noiseDB = toDB((max(bestE, 0) / Float(w)).squareRoot())
        if Editing.peakDB(x) - noiseDB < 10 { return nil }
        return (best * blk)..<((best + w) * blk)
    }

    // MARK: resta espectral

    nonisolated static let frame = 2048
    nonisolated static let hop = 512

    nonisolated private static let hann: [Double] = (0..<2048).map { 0.5 - 0.5 * cos(2 * Double.pi * Double($0) / 2048) }

    nonisolated private static func fft(_ re: inout [Double], _ im: inout [Double], inverse: Bool) {
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

    /// Magnitud media por bin de una muestra de ruido; `frames` 0 si la muestra es más corta que una ventana.
    nonisolated static func noiseProfile(_ noise: [Float]) -> (mag: [Double], frames: Int) {
        let n = frame
        var mag = [Double](repeating: 0, count: n / 2 + 1)
        var re = [Double](repeating: 0, count: n), im = [Double](repeating: 0, count: n)
        var frames = 0, s = 0
        while s + n <= noise.count {
            for i in 0..<n { re[i] = Double(noise[s + i]) * hann[i]; im[i] = 0 }
            fft(&re, &im, inverse: false)
            for k in 0...(n / 2) { mag[k] += (re[k] * re[k] + im[k] * im[k]).squareRoot() }
            frames += 1
            s += hop
        }
        if frames > 0 { for k in 0..<mag.count { mag[k] /= Double(frames) } }
        return (mag, frames)
    }

    /// Quita de toda la toma el ruido de fondo aprendido de `noise`. `amount` 1 = normal.
    nonisolated static func denoise(_ x: [Float], noise: [Float], amount: Double = 1) -> [Float] {
        let n = frame, half = n / 2
        let prof = noiseProfile(noise)
        guard prof.frames > 0, x.count >= n else { return x }
        let alpha = 1.6 * amount, floor = 0.12, pad = n, len = x.count + 2 * pad
        var src = [Double](repeating: 0, count: len + n)
        for i in 0..<x.count { src[pad + i] = Double(x[i]) }
        var out = [Double](repeating: 0, count: len + n)
        var re = [Double](repeating: 0, count: n), im = [Double](repeating: 0, count: n)
        var prev = [Double](repeating: 1, count: half + 1), g = [Double](repeating: 1, count: half + 1), sm = [Double](repeating: 1, count: half + 1)
        var s = 0
        while s < len {
            for i in 0..<n { re[i] = src[s + i] * hann[i]; im[i] = 0 }
            fft(&re, &im, inverse: false)
            for k in 0...half {
                let m = (re[k] * re[k] + im[k] * im[k]).squareRoot()
                g[k] = m > 1e-9 ? max(floor, 1 - alpha * prof.mag[k] / m) : 1
            }
            for k in 0...half {
                let a = g[max(0, k - 1)], c = g[min(half, k + 1)]
                sm[k] = 0.5 * (0.25 * a + 0.5 * g[k] + 0.25 * c) + 0.5 * prev[k]
            }
            for k in 0...half {
                re[k] *= sm[k]; im[k] *= sm[k]
                if k > 0 && k < half { re[n - k] *= sm[k]; im[n - k] *= sm[k] }
                prev[k] = sm[k]
            }
            fft(&re, &im, inverse: true)
            for i in 0..<n { out[s + i] += re[i] * hann[i] / 1.5 }
            s += hop
        }
        return (0..<x.count).map { Float(out[pad + $0]) }
    }
}

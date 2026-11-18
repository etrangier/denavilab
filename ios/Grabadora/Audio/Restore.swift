import Foundation

/// Restauración de material viejo: crujidos de vinilo (clics cortos) y zumbido de corriente (50/60 Hz y armónicos).
enum Restore {
    struct Hum: Equatable { var hz: Int; var harmonics: [Double]; var db: Int }

    nonisolated private static func median5(_ a: Float, _ b: Float, _ c: Float, _ d: Float, _ e: Float) -> Float { [a, b, c, d, e].sorted()[2] }

    nonisolated private static func findClicks(_ x: [Float], rate: Int, strong: Bool) -> (mask: [Bool], clicks: Int) {
        let n = x.count
        var r = [Float](repeating: 0, count: n)
        if n > 4 { for i in 2..<(n - 2) { r[i] = x[i] - median5(x[i - 2], x[i - 1], x[i], x[i + 1], x[i + 2]) } }
        let win = max(256, rate / 20), k: Float = strong ? 5 : 7
        var mask = [Bool](repeating: false, count: n)
        var s = 0
        while s < n {
            let e = min(n, s + win)
            let a = (s..<e).map { abs(r[$0]) }.sorted()
            let thr = max(k * 1.4826 * a[a.count / 2], 0.004)
            for i in s..<e where abs(r[i]) > thr { for j in max(0, i - 3)...min(n - 1, i + 3) { mask[j] = true } }
            s += win
        }
        let maxGap = rate * 3 / 1000
        var clicks = 0, i = 0
        while i < n {
            if !mask[i] { i += 1; continue }
            var j = i; while j < n && mask[j] { j += 1 }
            if j - i > maxGap { for t in i..<j { mask[t] = false } } else { clicks += 1 }
            i = j
        }
        return (mask, clicks)
    }

    /// Quita crujidos: cada clic se reemplaza por una curva cúbica que sigue los bordes sanos. Devuelve el audio y cuántos clics quitó.
    nonisolated static func declick(_ x: [Float], rate: Int, strong: Bool = false) -> (audio: [Float], clicks: Int) {
        var y = x, total = 0
        for _ in 0..<2 {
            let f = findClicks(y, rate: rate, strong: strong)
            if f.clicks == 0 { break }
            total += f.clicks
            var i = 0
            while i < y.count {
                if !f.mask[i] { i += 1; continue }
                var j = i; while j < y.count && f.mask[j] { j += 1 }
                let L = j - i
                let y0 = i > 0 ? y[i - 1] : (j < y.count ? y[j] : 0), y1 = j < y.count ? y[j] : y0
                let m0 = i > 1 ? (y[i - 1] - y[i - 2]) * Float(L + 1) : y1 - y0
                let m1 = j + 1 < y.count ? (y[j + 1] - y[j]) * Float(L + 1) : y1 - y0
                for t in i..<j {
                    let u = Float(t - i + 1) / Float(L + 1), u2 = u * u, u3 = u2 * u
                    y[t] = (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * m1
                }
                i = j
            }
        }
        return (y, total)
    }

    /// Clics por segundo (sin modificar el audio).
    nonisolated static func clickRate(_ x: [Float], rate: Int) -> Double {
        Double(findClicks(x, rate: rate, strong: false).clicks) / max(0.1, Double(x.count) / Double(rate))
    }

    nonisolated private static func avgPower(_ x: [Float], from: Int, to: Int) -> [Double]? {
        let N = 32768
        var pw = [Double](repeating: 0, count: N / 2 + 1), cnt = 0
        var s = from
        while s + N <= to {
            var re = [Double](repeating: 0, count: N), im = [Double](repeating: 0, count: N)
            for i in 0..<N { re[i] = Double(x[s + i]) * (0.5 - 0.5 * cos(2 * Double.pi * Double(i) / Double(N))) }
            NoiseReduction.fft(&re, &im, inverse: false)
            for k in 0...(N / 2) { pw[k] += re[k] * re[k] + im[k] * im[k] }
            cnt += 1; s += N / 2
        }
        return cnt > 0 ? pw.map { $0 / Double(cnt) } : nil
    }

    /// ¿Hay picos finos y constantes en 50 o 60 Hz y sus armónicos?
    nonisolated static func findHum(_ x: [Float], rate: Int) -> Hum? {
        let N = 32768
        guard x.count >= N * 3 / 2, let p1 = avgPower(x, from: 0, to: x.count / 2), let p2 = avgPower(x, from: x.count / 2, to: x.count) else { return nil }
        let bin = Double(rate) / Double(N)
        func stand(_ pw: [Double], _ f: Double) -> Double {
            let k = Int((f / bin).rounded())
            var pk = 0.0, kk = k
            for d in -1...1 where pw[k + d] > pk { pk = pw[k + d]; kk = k + d }
            let la = log(pw[kk - 1] + 1e-20), lb = log(pk + 1e-20), lc = log(pw[kk + 1] + 1e-20)
            let den = 2 * (la - 2 * lb + lc), off = (la - lc) / (den == 0 ? 1 : den)
            if abs((Double(kk) + off) * bin - f) > 0.4 { return 0 }          // la corriente es exacta; una nota de bajo cercana no cuenta
            var env: [Double] = []
            for d in Int((8 / bin).rounded())...Int((40 / bin).rounded()) { env.append(pw[k + d]); env.append(pw[k - d]) }
            env.sort()
            return 10 * log10((pk + 1e-20) / (env[env.count / 2] + 1e-20))
        }
        var best: Hum?
        for f0 in [50, 60] {
            var hs: [Double] = [], top = 0.0
            var m = 1
            while m <= 8 && Double(f0 * m) < 700 {
                let f = Double(f0 * m), s = min(stand(p1, f), stand(p2, f))
                if s >= 12 { hs.append(f); top = max(top, s) }
                m += 1
            }
            if hs.count >= 2, best == nil || hs.count > best!.harmonics.count || (hs.count == best!.harmonics.count && Int(top) > best!.db) {
                best = Hum(hz: f0, harmonics: hs, db: Int(top.rounded()))
            }
        }
        return best
    }

    nonisolated private static func notch(_ x: [Float], rate: Int, f: Double, q: Double) -> [Float] {
        let w = 2 * Double.pi * f / Double(rate), al = sin(w) / (2 * q), c = cos(w)
        let a0 = 1 + al, a1 = -2 * c, a2 = 1 - al, b1 = -2 * c
        var y = [Float](repeating: 0, count: x.count)
        var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
        for i in 0..<x.count {
            let xi = Double(x[i]), v = (xi + b1 * x1 + x2 - a1 * y1 - a2 * y2) / a0
            x2 = x1; x1 = xi; y2 = y1; y1 = v; y[i] = Float(v)
        }
        return y
    }

    /// Quita el zumbido con muescas finas (Q 30) en cada armónico, ida y vuelta para no desfasar.
    nonisolated static func dehum(_ x: [Float], rate: Int, hum: Hum?) -> [Float] {
        guard let hum = hum else { return x }
        var y = x
        for f in hum.harmonics {
            y = notch(y, rate: rate, f: f, q: 30)
            y = Array(notch(Array(y.reversed()), rate: rate, f: f, q: 30).reversed())
        }
        return y
    }
}

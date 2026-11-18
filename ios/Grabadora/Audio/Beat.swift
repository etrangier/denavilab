import Foundation

/// Pulso, compás y tiempo fuerte (misma idea que beat.js de la web): novedad espectral por bandas → autocorrelación con refuerzo armónico
/// y preferencia suave por tempos habituales → fase del pulso → compás (3 a 7 tiempos) y tiempo fuerte por el acento de graves.
/// Sirve para que los loops arranquen en el primer tiempo de un compás y duren compases enteros.
enum Beat {
    struct Analysis {
        var bpm = 0.0, confidence = 0.0, beatSec = 0.0, meter = 4, meterConfidence = 0.0, barSec = 0.0
        var firstBeat = 0.0, firstDownbeat = 0.0, kurt = 0.0
        var downbeats: [Double] = [], beatTimes: [Double] = [], alternatives: [Double] = [], env: [Float] = []
    }
    struct Tempo { let bpm: Double; let confidence: Double; let meter: Int?; let barSec: Double?; let half: Double?; let double: Double? }
    struct BarLoop { let a: Double; let b: Double; let bars: Int; let prior: Double }

    nonisolated private static let N = 1024
    nonisolated private static let edges: [Double] = [40, 80, 130, 200, 320, 500, 800, 1300, 2000, 3200, 5000, 8000]
    nonisolated private static let hann: [Double] = (0..<1024).map { 0.5 - 0.5 * cos(2 * Double.pi * Double($0) / 1024) }

    nonisolated private static func detrend(_ a: [Float], fs: Double) -> [Float] {
        let n = a.count
        guard n > 0 else { return a }
        let w = max(3, Int((fs * 0.3).rounded()))
        var cs = [Double](repeating: 0, count: n + 1)
        for i in 0..<n { cs[i + 1] = cs[i] + Double(a[i]) }
        var out = [Float](repeating: 0, count: n)
        var sq = 0.0
        for i in 0..<n {
            let lo = max(0, i - w), hi = min(n, i + w + 1)
            let m = (cs[hi] - cs[lo]) / Double(hi - lo)
            let v = max(0, Double(a[i]) - m)
            out[i] = Float(v); sq += v * v
        }
        var sd = (sq / Double(max(1, n))).squareRoot()
        if sd == 0 { sd = 1 }
        for i in 0..<n { out[i] = Float(Double(out[i]) / sd) }
        return out
    }

    /// Energía de graves por cuadro: paso bajo de 4 polos a 150 Hz, valor absoluto suavizado 12 ms, luego sin el nivel local.
    nonisolated private static func lowEnv(_ x: [Float], rate: Int, hop: Int, nf: Int) -> [Float] {
        let w0 = 2 * Double.pi * 150 / Double(rate), al = sin(w0) / (2 * 0.707), c = cos(w0), a0 = 1 + al
        let b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, b2 = b0, a1 = -2 * c / a0, a2 = (1 - al) / a0
        var y = [Float](repeating: 0, count: x.count)
        var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0, u1 = 0.0, u2 = 0.0, v1 = 0.0, v2 = 0.0
        for i in 0..<x.count {
            let xi = Double(x[i])
            let v = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = xi; y2 = y1; y1 = v
            let o = b0 * v + b1 * u1 + b2 * u2 - a1 * v1 - a2 * v2
            u2 = u1; u1 = v; v2 = v1; v1 = o
            y[i] = Float(abs(o))
        }
        let sm = max(1, Int((Double(rate) * 0.012).rounded()))
        var out = [Float](repeating: 0, count: nf)
        for t in 0..<nf {
            let c0 = t * hop + N / 2
            var s0 = 0.0, n0 = 0.0
            var i = max(0, c0 - sm)
            let hi = min(y.count, c0 + sm)
            while i < hi { s0 += Double(y[i]); n0 += 1; i += 4 }
            out[t] = n0 > 0 ? Float(s0 / n0) : 0
        }
        return detrend(out, fs: Double(rate) / Double(hop))
    }

    /// Novedad espectral: total y graves, ya sin nivel local y normalizadas. `raw` y `kurt` dicen si hay golpes claros.
    nonisolated static func novelty(_ x: [Float], rate: Int) -> (env: [Float], lf: [Float], fs: Double, raw: Double, kurt: Double) {
        let hop = max(64, Int((Double(rate) / 200).rounded()))
        let nf = max(0, (x.count - N) / hop), fs = Double(rate) / Double(hop)
        let nb = edges.count - 1
        let bins: [Int] = edges.map { min(N / 2 - 1, Int(($0 * Double(N) / Double(rate)).rounded())) }
        var re = [Double](repeating: 0, count: N), im = [Double](repeating: 0, count: N)
        var prev = [Double](repeating: 0, count: nb)
        var env = [Float](repeating: 0, count: nf)
        for t in 0..<nf {
            let o = t * hop
            for i in 0..<N { re[i] = Double(x[o + i]) * hann[i]; im[i] = 0 }
            NoiseReduction.fft(&re, &im, inverse: false)
            var cur = [Double](repeating: 0, count: nb)
            for b in 0..<nb {
                var e = 0.0
                let k1 = max(bins[b] + 1, bins[b + 1])
                var k = bins[b]
                while k < k1 { e += re[k] * re[k] + im[k] * im[k]; k += 1 }
                cur[b] = log1p(1000 * e / Double(N))
            }
            if t > 0 { var s = 0.0; for b in 0..<nb { s += max(0, cur[b] - prev[b]) }; env[t] = Float(s) }
            prev = cur
        }
        var raw = 0.0
        for v in env { raw += Double(v) }
        raw /= Double(max(1, nf))
        let d = detrend(env, fs: fs)
        var m2 = 0.0, m4 = 0.0
        for v in d { let q = Double(v); m2 += q * q; m4 += q * q * q * q }
        let cnt = Double(max(1, d.count)), mm = m2 / cnt
        let kurt = mm > 0 ? (m4 / cnt) / (mm * mm) : 0
        return (d, lowEnv(x, rate: rate, hop: hop, nf: nf), fs, raw, kurt)
    }

    nonisolated private static func ac(_ a: [Float], _ l: Int) -> Double {
        let n = a.count - l
        guard n > 0 else { return 0 }
        var s = 0.0
        for i in 0..<n { s += Double(a[i]) * Double(a[i + l]) }
        return s / Double(max(1, n))
    }
    nonisolated private static func prior(_ bpm: Double, center: Double = 95, sigma: Double = 0.6) -> Double {
        let z = log2(bpm / center) / sigma
        return exp(-0.5 * z * z)
    }

    /// Candidatos de tempo: (bpm, lag, puntuación), del mejor al peor. Refuerza el periodo con sus múltiplos y prefiere tempos habituales.
    nonisolated static func tempoCandidates(_ env: [Float], fs: Double, lo: Double = 60, hi: Double = 165) -> [(bpm: Double, lag: Int, score: Double)] {
        let n = env.count
        let r0 = ac(env, 0) == 0 ? 1.0 : ac(env, 0)
        let minLag = max(2, Int(floor(fs * 60 / hi))), maxLag = min(Int(floor(fs * 60 / lo)), Int(Double(n) / 2.5))
        guard maxLag > minLag else { return [] }
        let size = maxLag * 4 + 8
        var A = [Double](repeating: 0, count: size)
        var l = 1
        while l < size && l < n - 4 { A[l] = ac(env, l) / r0; l += 1 }
        func at(_ x: Double) -> Double { let i = Int(floor(x)), f = x - Double(i); return (i < size ? A[i] : 0) * (1 - f) + (i + 1 < size ? A[i + 1] : 0) * f }
        var all: [(bpm: Double, lag: Int, score: Double)] = []
        for lg in minLag...maxLag {
            let bpm = 60 * fs / Double(lg)
            let v = at(Double(lg)) + 0.5 * at(Double(2 * lg)) + 0.25 * at(Double(3 * lg)) + 0.25 * at(Double(4 * lg))
            all.append((bpm, lg, v * (0.55 + 0.45 * prior(bpm))))
        }
        var peaks: [(bpm: Double, lag: Int, score: Double)] = []
        if all.count > 2 { for i in 1..<(all.count - 1) where all[i].score >= all[i - 1].score && all[i].score >= all[i + 1].score && all[i].score > 0 { peaks.append(all[i]) } }
        peaks.sort { $0.score > $1.score }
        var picked: [(bpm: Double, lag: Int, score: Double)] = []
        for p in peaks {
            if picked.allSatisfy({ abs(log2(p.bpm / $0.bpm)) > 0.06 }) { picked.append(p) }
            if picked.count >= 5 { break }
        }
        return picked
    }

    nonisolated private static func fit(_ env: [Float], fs: Double, bpm0: Double) -> (bpm: Double, phase: Int, score: Double, P: Double) {
        let n = env.count
        var best = (bpm: bpm0, phase: 0, score: -1.0, P: fs * 60 / bpm0)
        for k in -12...12 {
            let bpm = bpm0 * (1 + Double(k) * 0.0025), P = fs * 60 / bpm, np = Int(ceil(P))
            for ph in 0..<np {
                var s = 0.0, c = 0
                var t = Double(ph)
                while t < Double(n - 1) {
                    let i = Int(t.rounded())
                    var m = Double(env[i])
                    if i > 0 && Double(env[i - 1]) > m { m = Double(env[i - 1]) * 0.9 }
                    if i + 1 < n && Double(env[i + 1]) > m { m = Double(env[i + 1]) * 0.9 }
                    s += m; c += 1; t += P
                }
                let v = s / Double(max(1, c))
                if c >= 4 && v > best.score { best = (bpm, ph, v, P) }
            }
        }
        return best
    }

    nonisolated private static func coverage(_ env: [Float], fs: Double, f: (bpm: Double, phase: Int, score: Double, P: Double)) -> Double {
        let w = max(1, Int((fs * 0.03).rounded()))
        var tot = 0.0, on = 0.0
        for v in env { tot += Double(v) }
        var t = Double(f.phase)
        while t < Double(env.count - 1) {
            let c = Int(t.rounded())
            for i in max(0, c - w)...min(env.count - 1, c + w) { on += Double(env[i]) }
            t += f.P
        }
        return tot > 0 ? min(1, on / tot) : 0
    }
    nonisolated private static func hitRate(_ env: [Float], fs: Double, f: (bpm: Double, phase: Int, score: Double, P: Double)) -> Double {
        let w = max(1, Int((fs * 0.03).rounded()))
        var hit = 0, c = 0
        var t = Double(f.phase)
        while t < Double(env.count - 1) {
            let ci = Int(t.rounded())
            var m: Float = 0
            for i in max(0, ci - w)...min(env.count - 1, ci + w) where env[i] > m { m = env[i] }
            if m >= 0.4 { hit += 1 }
            c += 1; t += f.P
        }
        return c > 0 ? Double(hit) / Double(c) : 0
    }

    /// Compás y primer tiempo fuerte a partir del acento de graves en cada tiempo.
    nonisolated static func findMeter(_ acc: [Double]) -> (beats: Int, offset: Int, confidence: Double) {
        let nb = acc.count
        guard nb >= 8 else { return (4, 0, 0) }
        let mean = acc.reduce(0, +) / Double(nb)
        let z = acc.map { $0 - mean }
        var a0 = 0.0
        for v in z { a0 += v * v }
        a0 = a0 / Double(nb) == 0 ? 1 : a0 / Double(nb)
        var A: [Int: Double] = [:]
        for m in [2, 3, 4, 5, 6, 7, 8] {
            var s = 0.0, c = 0
            var k = 0
            while k + m < nb { s += z[k] * z[k + m]; c += 1; k += 1 }
            A[m] = c > 0 ? s / Double(c) / a0 : 0
        }
        let amax = A.values.max() ?? 0
        var m = [2, 3, 4, 5, 6, 7, 8].first { (A[$0] ?? 0) >= 0.8 * amax && (A[$0] ?? 0) > 0.05 } ?? 4
        if m == 2 || m == 8 { m = 4 }
        if m == 6 { m = (A[3] ?? 0) >= 0.7 * (A[6] ?? 0) ? 3 : 6 }
        var sc = [Double](repeating: 0, count: m)
        for o in 0..<m {
            var s = 0.0, c = 0
            var k = o
            while k < nb { s += acc[k]; c += 1; k += m }
            sc[o] = c > 0 ? s / Double(c) : 0
        }
        var o = 0
        for i in 1..<max(1, m) where sc[i] > sc[o] * 1.04 { o = i }
        let sorted = sc.sorted(by: >)
        let conf = sorted[0] > 0 && sorted.count > 1 ? max(0, min(1, (sorted[0] - sorted[1]) / sorted[0])) : 0
        return (m, o, conf)
    }

    /// Análisis completo; nil si no hay golpes claros (pads, ambientes) o menos de 3 s.
    nonisolated static func analyze(_ x: [Float], rate: Int, lo: Double = 60, hi: Double = 165) -> Analysis? {
        guard x.count >= rate * 3 else { return nil }
        let nv = novelty(x, rate: rate)
        guard Double(nv.env.count) >= nv.fs * 2.5, nv.kurt >= 14, nv.raw >= 0.3 else { return nil }
        let env = nv.env, fs = nv.fs
        let cands = tempoCandidates(env, fs: fs, lo: lo, hi: hi)
        guard let top = cands.first else { return nil }
        var pool: [Double] = cands.prefix(4).map { $0.bpm }
        for r in [2.0, 0.5] { let b = top.bpm * r; if b >= lo && b <= hi { pool.append(b) } }
        var best: (bpm: Double, phase: Int, score: Double, P: Double)?
        var bestSc = -1.0, bestHit = 0.0
        var seen = Set<Int>()
        for bpm in pool where seen.insert(Int(bpm.rounded())).inserted {
            let f = fit(env, fs: fs, bpm0: bpm), h = hitRate(env, fs: fs, f: f), cv = coverage(env, fs: fs, f: f)
            let sc = (0.3 * min(1, f.score / 3) + 0.7 * cv) * h * h * (0.6 + 0.4 * prior(f.bpm))
            if sc > bestSc { bestSc = sc; best = f; bestHit = h }
        }
        guard let ft = best else { return nil }
        let r0 = ac(env, 0) == 0 ? 1.0 : ac(env, 0)
        let rawStrength = max(0, min(1, ac(env, Int((fs * 60 / ft.bpm).rounded())) / r0))
        var beatsT: [Double] = []
        var t = Double(ft.phase)
        while t < Double(env.count - 1) { beatsT.append(t); t += ft.P }
        let win = max(1, Int((fs * 0.04).rounded()))
        func peakAt(_ arr: [Float], _ tt: Double) -> Double {
            var m: Float = 0
            let c = Int(tt.rounded())
            for i in max(0, c - win)...min(arr.count - 1, c + win) where arr[i] > m { m = arr[i] }
            return Double(m)
        }
        let low = nv.lf
        let acc = beatsT.map { peakAt(low, $0 + 0.02 * fs) }
        let meter = findMeter(acc)
        let beatSec = 60 / ft.bpm, barSec = Double(meter.beats) * beatSec
        var downs: [Double] = []
        var k = meter.offset
        while k < beatsT.count { downs.append(beatsT[k] / fs); k += meter.beats }
        let confidence = max(0, min(1, 0.4 * min(1, ft.score / 2.5) + 0.3 * bestHit + 0.3 * min(1, rawStrength * 2.5)))
        var an = Analysis()
        an.bpm = ft.bpm; an.confidence = confidence; an.beatSec = beatSec; an.meter = meter.beats; an.meterConfidence = meter.confidence; an.barSec = barSec
        an.firstBeat = (beatsT.first ?? 0) / fs; an.firstDownbeat = downs.first ?? an.firstBeat; an.kurt = nv.kurt
        an.downbeats = downs; an.beatTimes = beatsT.map { $0 / fs }; an.alternatives = cands.dropFirst().prefix(3).map { $0.bpm }; an.env = env
        return an
    }

    /// Tempo para el resto de la app: el análisis de pulso si lo hay; si no, el método simple de antes.
    nonisolated static func estimateTempo(_ x: [Float], rate: Int) -> Tempo? {
        if let a = analyze(x, rate: rate) {
            return Tempo(bpm: a.bpm, confidence: a.confidence, meter: a.meter, barSec: a.barSec, half: a.bpm / 2 >= 40 ? a.bpm / 2 : nil, double: a.bpm * 2 <= 240 ? a.bpm * 2 : nil)
        }
        if let r = Editing.estimateBPM(x, rate: rate) { return Tempo(bpm: r.bpm, confidence: r.confidence, meter: nil, barSec: nil, half: r.bpm / 2, double: r.bpm * 2) }
        return nil
    }

    /// Igual que `estimateTempo`, con la forma simple (bpm, confianza) que usan las pantallas de siempre.
    nonisolated static func tempoPair(_ x: [Float], rate: Int) -> (bpm: Double, confidence: Double)? {
        guard let t = estimateTempo(x, rate: rate) else { return nil }
        return (bpm: t.bpm, confidence: t.confidence)
    }

    /// Loops que arrancan en un primer tiempo y duran compases enteros (segundos), del más al menos recomendable.
    nonisolated static func barLoops(_ an: Analysis, startSec: Double, endSec: Double, prefBars: Int = 0, max maxN: Int = 6) -> [BarLoop] {
        guard !an.downbeats.isEmpty else { return [] }
        var out: [BarLoop] = []
        let downs = an.downbeats.filter { $0 >= startSec - 0.5 * an.beatSec && $0 < endSec }
        for (di, d) in downs.enumerated() {
            for L in [4, 2, 8, 1, 16] {
                let b = d + Double(L) * an.barSec
                if b > endSec + 0.03 { continue }
                var p = 0.4
                if L == prefBars { p = 1 } else if L == 4 { p = 0.9 } else if L == 2 { p = 0.8 } else if L == 8 { p = 0.7 } else if L == 1 { p = 0.5 }
                out.append(BarLoop(a: d, b: b, bars: L, prior: p - 0.04 * Double(di)))
            }
        }
        out.sort { $0.prior > $1.prior }
        return Array(out.prefix(maxN))
    }
}

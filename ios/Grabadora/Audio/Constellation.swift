import Foundation

/// «Escucha» por constelación: la idea de Avery Wang (Shazam, ISMIR 2003) aplicada a recortes y loops. Mismo cálculo que `constellation.js` de la PWA.
///  · Mapa de constelación: del espectrograma se guardan sólo los picos (máximos locales) con densidad pareja.
///  · Hashes combinatorios: cada pico «ancla» se une con picos de su zona objetivo → (f1, f2, Δt).
///  · Histograma de desfases: hashes iguales se separan siempre el mismo tiempo si es el mismo sonido (aquí, el sonido contra sí mismo → periodo).
///  · Continuidad del empalme y cortes por cambio de notas (el conjunto de picos cambia aunque el volumen no suba).
enum Constellation {
    struct Peak { var t: Int; var f: Int; var a: Float }
    struct Map { var peaks: [Peak]; var hop: Int; var N: Int; var T: Int; var rate: Int; var kmax: Int }
    struct Hash { var key: Int; var t: Int }
    struct Period { var sec: Double; var score: Double; var z: Double }

    private static let fmaxHz = 6000.0, peakDB: Float = 45, frameDB: Float = 40
    private static let fanOut = 5, zoneMin = 2, zoneMax = 64, zoneBins = 64

    static func build(_ x: [Float], rate: Int, maxPerFrame: Int = 5, dt dtN: Int = 3, df dfN: Int = 8, winSec: Double = 0.04) -> Map {
        var N = 1024
        while Double(N) < Double(rate) * winSec { N <<= 1 }
        let hop = N >> 2, kmax = min(N / 2 - 1, Int((fmaxHz / (Double(rate) / Double(N))).rounded())), T = (x.count - N) / hop + 1
        guard T >= 8, x.count >= N else { return Map(peaks: [], hop: hop, N: N, T: max(0, T), rate: rate, kmax: kmax) }
        let K = kmax + 1
        let win = (0..<N).map { 0.5 - 0.5 * cos(2 * Double.pi * Double($0) / Double(N - 1)) }
        var S = [Float](repeating: 0, count: T * K), gmax: Float = -.infinity
        var re = [Double](repeating: 0, count: N), im = [Double](repeating: 0, count: N)
        for t in 0..<T {
            for i in 0..<N { re[i] = Double(x[t * hop + i]) * win[i]; im[i] = 0 }
            NoiseReduction.fft(&re, &im, inverse: false)
            for k in 0...kmax {
                let v = Float(10 * log10(re[k] * re[k] + im[k] * im[k] + 1e-12))
                S[t * K + k] = v; if v > gmax { gmax = v }
            }
        }
        var peaks: [Peak] = []
        for t in 0..<T {
            var fm: Float = -.infinity
            for k in 0..<K where S[t * K + k] > fm { fm = S[t * K + k] }
            var cand: [Peak] = []
            if kmax >= 3 {
                for k in 2...(kmax - 1) {
                    let v = S[t * K + k]
                    if v < gmax - peakDB || v < fm - frameDB { continue }
                    var ok = true
                    var tt = max(0, t - dtN)
                    while tt <= min(T - 1, t + dtN) && ok {
                        var kk = max(0, k - dfN)
                        while kk <= min(kmax, k + dfN) {
                            if (tt != t || kk != k) && S[tt * K + kk] >= v { ok = false; break }
                            kk += 1
                        }
                        tt += 1
                    }
                    if ok { cand.append(Peak(t: t, f: k, a: v)) }
                }
            }
            cand.sort { $0.a > $1.a }
            peaks.append(contentsOf: cand.prefix(maxPerFrame))                  // densidad pareja: como mucho `maxPerFrame` por cuadro
        }
        return Map(peaks: peaks, hop: hop, N: N, T: T, rate: rate, kmax: kmax)
    }
    private static func frameSec(_ c: Map) -> Double { Double(c.hop) / Double(c.rate) }

    /// Hashes combinatorios: cada ancla con hasta `fanOut` picos de su zona objetivo.
    static func hashes(_ c: Map) -> [Hash] {
        var byT: [Int: [Peak]] = [:]
        for p in c.peaks { byT[p.t, default: []].append(p) }
        var out: [Hash] = []
        for p in c.peaks {
            var n = 0
            var d = zoneMin
            while d <= zoneMax && n < fanOut {
                if let l = byT[p.t + d] {
                    for q in l {
                        if abs(q.f - p.f) > zoneBins { continue }
                        out.append(Hash(key: (p.f * 512 + q.f) * 128 + d, t: p.t)); n += 1
                        if n >= fanOut { break }
                    }
                }
                d += 1
            }
        }
        return out
    }

    /// Periodo en que se repite el sonido: histograma de desfases entre hashes iguales del propio audio. Vacío si no hay repetición clara.
    static func repetition(_ x: [Float], rate: Int, minSec: Double = 0.25, maxSec: Double = 20, maxCands: Int = 4) -> [Period] {
        let c = build(x, rate: rate), fs = frameSec(c), H = hashes(c)
        guard H.count >= 30 else { return [] }
        let minLag = max(2, Int((minSec / fs).rounded())), maxLag = min(c.T - 1, Int((maxSec / fs).rounded()))
        guard maxLag > minLag + 2 else { return [] }
        var groups: [Int: [Int]] = [:]
        for h in H { groups[h.key, default: []].append(h.t) }
        var hist = [Double](repeating: 0, count: maxLag + 2)
        for (_, ts) in groups {
            if ts.count < 2 || ts.count > 40 { continue }                   // las claves que aparecen en todas partes no informan
            let w = 1 / Double(ts.count).squareRoot()
            for i in 0..<ts.count { for j in (i + 1)..<ts.count { let lag = ts[j] - ts[i]; if lag >= minLag && lag <= maxLag { hist[lag] += w } } }
        }
        var sm = [Double](repeating: 0, count: hist.count)
        for i in 1..<(hist.count - 1) { sm[i] = hist[i - 1] * 0.5 + hist[i] + hist[i + 1] * 0.5 }
        var mean = 0.0, cnt = 0
        for i in minLag...maxLag { mean += sm[i]; cnt += 1 }
        mean /= Double(max(1, cnt))
        var sd = 0.0
        for i in minLag...maxLag { sd += (sm[i] - mean) * (sm[i] - mean) }
        sd = (sd / Double(max(1, cnt))).squareRoot() + 1e-9
        var picks: [(i: Int, score: Double, z: Double)] = []
        if maxLag - 1 > minLag + 1 {
            for i in (minLag + 1)..<maxLag where sm[i] >= sm[i - 1] && sm[i] > sm[i + 1] {
                let z = (sm[i] - mean) / sd
                if z > 4 && sm[i] >= 6 { picks.append((i, sm[i], z)) }
            }
        }
        picks.sort { $0.score > $1.score }
        var out: [Period] = []
        for p in picks {
            let den = 2 * (sm[p.i - 1] - 2 * sm[p.i] + sm[p.i + 1])
            let lag = Double(p.i) + (sm[p.i - 1] - sm[p.i + 1]) / (den == 0 ? 1e9 : den)
            if out.allSatisfy({ abs($0.sec - lag * fs) > 0.05 }) { out.append(Period(sec: lag * fs, score: p.score, z: p.z)) }
            if out.count >= maxCands { break }
        }
        return out
    }

    /// Cuánto se parecen los picos de dos ventanas (0–1): coinciden en casilla de frecuencia (±1) y en el mismo desfase relativo (±1 cuadro). nil si hay pocos picos.
    private static func windowMatch(_ c: Map, _ A: Int, _ B: Int, _ W: Int) -> Double? {
        let pa = c.peaks.filter { $0.t >= A && $0.t < A + W }, pb = c.peaks.filter { $0.t >= B && $0.t < B + W }
        guard pa.count >= 3, pb.count >= 3 else { return nil }
        var set = Set<Int>()
        for p in pb { set.insert(p.f * 1024 + (p.t - B)) }
        var hit = 0
        for p in pa {
            let r = p.t - A
            var ok = false
            for df in -1...1 where !ok { for dt in -1...1 where !ok { if set.contains((p.f + df) * 1024 + (r + dt)) { ok = true } } }
            if ok { hit += 1 }
        }
        return Double(hit) / Double(min(pa.count, pb.count))
    }

    /// Continuidad espectral de un empalme a→b: lo que sonaría después de b frente a lo que suena después de a, y lo que precede a ambos. 0–1; nil si no hay datos.
    static func seamScore(_ c: Map, _ a: Int, _ b: Int, winSec: Double = 0.3) -> Double? {
        let fs = frameSec(c), W = max(4, Int((winSec / fs).rounded())), fa = Int((Double(a) / Double(c.hop)).rounded()), fb = Int((Double(b) / Double(c.hop)).rounded())
        var r: [Double] = []
        if let v = windowMatch(c, fa, fb, W) { r.append(v) }
        if let v = windowMatch(c, fa - W, fb - W, W) { r.append(v) }
        return r.isEmpty ? nil : r.reduce(0, +) / Double(r.count)
    }

    /// Mejor punto final para un loop que arranca en `a`: busca cerca de `b` el de mayor continuidad espectral (a igual continuidad, el más cercano).
    static func refineLoopEnd(_ c: Map, _ a: Int, _ b: Int, rangeSec: Double = 0.12) -> (b: Int, score: Double) {
        let step = c.hop, R = Int((rangeSec * Double(c.rate) / Double(step)).rounded())
        var best = (b: b, score: seamScore(c, a, b) ?? -1)
        var bestAdj = best.score
        for i in -R...R {
            let bb = b + i * step
            guard let s = seamScore(c, a, bb) else { continue }
            let adj = s - 0.05 * Double(abs(i)) / Double(max(1, R))
            if adj > bestAdj + 0.002 { bestAdj = adj; best = (bb, s) }
        }
        return best
    }

    /// Cortes donde cambian las notas (el conjunto de picos). `sensitivity` 0–1. Devuelve inicios en muestras.
    static func noteChanges(_ x: [Float], rate: Int, sensitivity: Double = 0.5, minGapSec: Double = 0.25, maxCount: Int = 11) -> [Int] {
        let c = build(x, rate: rate, maxPerFrame: 8, dt: 0, df: 2, winSec: 0.08), fs = frameSec(c), W = max(3, Int((0.12 / fs).rounded()))
        guard c.T >= W * 4 else { return [] }
        var byT = [[Int]](repeating: [], count: c.T)
        for p in c.peaks { byT[p.t].append(p.f) }
        var nov = [Double](repeating: 0, count: c.T)
        for t in W..<(c.T - W) {
            var A = Set<Int>()
            for i in (t - W)..<t { for f in byT[i] { A.insert(f) } }
            var nb = 0, hit = 0, na = 0
            for i in t..<(t + W) { for f in byT[i] { nb += 1; if A.contains(f) || A.contains(f - 1) || A.contains(f + 1) { hit += 1 } } }
            for i in (t - W)..<t { na += byT[i].count }
            nov[t] = (na < 2 || nb < 2) ? 0 : 1 - Double(hit) / Double(nb)           // qué parte de lo que viene es nuevo respecto a lo que había
        }
        let thr = 0.2 + 0.4 * (1 - min(1, max(0, sensitivity))), gap = max(2, Int((minGapSec / fs).rounded()))
        var picks: [(t: Int, v: Double)] = []
        if c.T - W - 1 > W + 1 {
            for t in (W + 1)..<(c.T - W - 1) where nov[t] >= thr && nov[t] >= nov[t - 1] && nov[t] > nov[t + 1] { picks.append((t, nov[t])) }
        }
        var chosen: [Int] = []
        for p in picks.sorted(by: { $0.v > $1.v }) where chosen.allSatisfy({ abs($0 - p.t) >= gap }) { chosen.append(p.t) }
        return chosen.prefix(maxCount).sorted().map { max(0, $0 * c.hop + (c.N >> 1)) }          // el centro del cuadro, no su inicio
    }
}

import Foundation

/// Armonía: pulso, compases, acordes y loop sugerido de una toma. Todo es aproximado (acordes mayores y menores,
/// compás de 4 tiempos). Mismo algoritmo y mismos números que `harmony.js` en la PWA.
enum Harmony {
    struct Bar {
        var beat: Int
        var start: Int
        var end: Int
        var chords: [String?]
        var label: String
    }

    struct LoopSuggestion {
        var bar: Int
        var bars: Int
        var start: Int
        var end: Int
        var chords: [String]
        var want = 4
        var score = 0.0
    }

    struct Analysis {
        var bpm: Double
        var rate: Int
        var period: Double
        var first: Double
        var beats: [Double]
        var beatChroma: [[Double]]
        var beatRMS: [Double]
        var beatHit: [Double] = []
        var length: Int
        var confidence: Double
        var downbeat: Int
        var bars: [Bar] = []
        var loop: LoopSuggestion?
        var loops: [LoopSuggestion] = []
    }

    nonisolated static let notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    nonisolated private static let chN = 4096
    nonisolated private static let chHop = 2048
    nonisolated private static let hann: [Double] = (0..<4096).map { 0.5 - 0.5 * cos(2 * Double.pi * Double($0) / 4096) }

    /// Plantillas de acordes: 12 mayores y 12 menores, normalizadas.
    nonisolated private static let templates: [(name: String, v: [Double])] = {
        var out: [(name: String, v: [Double])] = []
        for (suffix, third) in [("", 4), ("m", 3)] {
            for r in 0..<12 {
                var v = [Double](repeating: 0, count: 12)
                v[r] = 1; v[(r + third) % 12] = 0.9; v[(r + 7) % 12] = 0.8
                let n = (v.reduce(0) { $0 + $1 * $1 }).squareRoot()
                out.append((name: notes[r] + suffix, v: v.map { $0 / n }))
            }
        }
        return out
    }()

    nonisolated private static func cos12(_ a: [Double], _ b: [Double]) -> Double {
        var d = 0.0, na = 0.0, nb = 0.0
        for i in 0..<12 { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
        return na > 1e-12 && nb > 1e-12 ? d / (na * nb).squareRoot() : 0
    }

    /// Chroma (12 notas) por ventana de 4096 muestras, de 110 a 1760 Hz, con compresión logarítmica.
    nonisolated static func chromaFrames(_ x: [Float], rate: Int) -> [(center: Int, chroma: [Double])] {
        let n = chN
        let kLo = Int((110.0 * Double(n) / Double(rate)).rounded(.up)), kHi = Int((1760.0 * Double(n) / Double(rate)).rounded(.down))
        var pc = [Int](repeating: 0, count: kHi + 1)
        if kLo <= kHi {
            for k in kLo...kHi {
                let m = Int((69 + 12 * log2(Double(k) * Double(rate) / Double(n) / 440)).rounded())
                pc[k] = ((m % 12) + 12) % 12
            }
        }
        var re = [Double](repeating: 0, count: n), im = [Double](repeating: 0, count: n)
        var out: [(center: Int, chroma: [Double])] = []
        var s = 0
        while s + n <= x.count {
            for i in 0..<n { re[i] = Double(x[s + i]) * hann[i]; im[i] = 0 }
            NoiseReduction.fft(&re, &im, inverse: false)
            var c = [Double](repeating: 0, count: 12)
            if kLo <= kHi { for k in kLo...kHi { c[pc[k]] += log1p(50 * (re[k] * re[k] + im[k] * im[k]).squareRoot() / Double(n / 4)) } }
            out.append((center: s + n / 2, chroma: c))
            s += chHop
        }
        return out
    }

    nonisolated private static func sumChroma(_ frames: [(center: Int, chroma: [Double])], _ a: Double, _ b: Double) -> [Double] {
        var c = [Double](repeating: 0, count: 12)
        var n = 0
        for f in frames where Double(f.center) >= a && Double(f.center) < b {
            for i in 0..<12 { c[i] += f.chroma[i] }
            n += 1
        }
        if n == 0, !frames.isEmpty {
            let mid = (a + b) / 2
            let best = frames.min { abs(Double($0.center) - mid) < abs(Double($1.center) - mid) }!
            c = best.chroma
        }
        return c
    }

    /// Mejor acorde para un chroma, o nil si no se parece a ninguno (ruido, percusión sola).
    nonisolated static func matchChord(_ chroma: [Double]) -> (name: String, score: Double)? {
        var best: String?, bestS = 0.0
        for t in templates { let s = cos12(chroma, t.v); if s > bestS { bestS = s; best = t.name } }
        if let b = best, bestS >= 0.6 { return (b, bestS) }
        return nil
    }

    /// Subida de energía con paso de 256 muestras.
    nonisolated private static func onsetFlux(_ x: [Float], hop: Int = 256) -> [Float] {
        let n = x.count / hop
        var e = [Float](repeating: 0, count: n), f = [Float](repeating: 0, count: n)
        for i in 0..<n {
            var s: Float = 0
            for j in (i * hop)..<((i + 1) * hop) { s += x[j] * x[j] }
            e[i] = (s / Float(hop)).squareRoot()
        }
        if n > 1 { for i in 1..<n { f[i] = max(0, e[i] - e[i - 1]) } }
        return f
    }

    nonisolated private static func fluxAt(_ flux: [Float], _ t: Double, hop: Double) -> Float {
        let i = Int((t / hop).rounded())
        var m = flux[i]
        if i > 0 { m = max(m, flux[i - 1]) }
        if i + 1 < flux.count { m = max(m, flux[i + 1]) }
        return m
    }

    /// Ajusta el periodo y la fase del pulso para que los tiempos caigan sobre los golpes.
    nonisolated private static func fitBeats(_ flux: [Float], hop: Int, period: Double) -> (T: Double, first: Double) {
        var best = (score: -1.0, T: period, first: 0.0)
        let h = Double(hop)
        for k in 0...40 {
            let T = period * (1 + (-0.012 + 0.0006 * Double(k)))
            var p = 0.0
            while p < T {
                var s = 0.0
                var t = p
                while t / h < Double(flux.count - 1) { s += Double(fluxAt(flux, t, hop: h)); t += T }
                if s > best.score { best = (s, T, p) }
                p += h
            }
        }
        return (best.T, best.first)
    }

    /// Analiza una toma: pulso (con `bpm` o el detectado), tiempo 1 del compás, acordes por medio compás y un loop sugerido.
    /// nil si no hay un pulso claro o la toma es muy corta (menos de 8 tiempos).
    nonisolated static func analyze(_ x: [Float], rate: Int, bpm given: Double? = nil) -> Analysis? {
        guard let bpm = given ?? Editing.estimateBPM(x, rate: rate)?.bpm else { return nil }
        let hop = 256, flux = onsetFlux(x, hop: hop)
        guard flux.count > 4 else { return nil }
        let fit = fitBeats(flux, hop: hop, period: Double(rate) * 60 / bpm), T = fit.T
        var beats: [Double] = []
        var t = fit.first
        while t + T <= Double(x.count) { beats.append(t); t += T }
        guard beats.count >= 8 else { return nil }
        let frames = chromaFrames(x, rate: rate)
        let beatChroma = beats.map { sumChroma(frames, $0, $0 + T) }
        let beatRMS: [Double] = beats.map { t in
            let a = Int(t.rounded()), b = min(x.count, Int((t + T).rounded()))
            var e = 0.0
            if b > a { for i in a..<b { e += Double(x[i]) * Double(x[i]) } }
            return (e / Double(max(1, b - a))).squareRoot()
        }
        var hit = [Double](repeating: 0, count: 4), change = hit, cnt = hit
        for (j, bt) in beats.enumerated() {
            hit[j % 4] += Double(fluxAt(flux, bt, hop: Double(hop))); cnt[j % 4] += 1
            if j > 0 { change[j % 4] += 1 - cos12(beatChroma[j], beatChroma[j - 1]) }
        }
        func norm(_ v: [Double]) -> [Double] { let s = v.reduce(0, +); return v.map { $0 / (s == 0 ? 1 : s) } }
        let nh = norm((0..<4).map { hit[$0] / cnt[$0] }), nc = norm((0..<4).map { change[$0] / cnt[$0] })
        let score = (0..<4).map { nh[$0] + nc[$0] }
        var downbeat = 0
        for i in 0..<4 where score[i] > score[downbeat] { downbeat = i }
        let second = score.sorted(by: >)[1]
        let confidence = min(1, max(0, (score[downbeat] - second) * 2 + 0.3))
        let beatHit = beats.map { Double(fluxAt(flux, $0, hop: Double(hop))) }
        let an = Analysis(bpm: 60 * Double(rate) / T, rate: rate, period: T, first: fit.first, beats: beats, beatChroma: beatChroma,
                          beatRMS: beatRMS, beatHit: beatHit, length: x.count, confidence: confidence, downbeat: downbeat)
        return layout(an, downbeat: downbeat)
    }

    /// Compases, acordes y loop sugerido para un tiempo 1 dado (0–3 tiempos desde el primero detectado). No vuelve a analizar el audio.
    nonisolated static func layout(_ an: Analysis, downbeat: Int, want: Int = 4) -> Analysis {
        let d = ((downbeat % 4) + 4) % 4, T = an.period
        var bars: [Bar] = []
        var j = d
        while j + 4 <= an.beats.count {
            var h1 = [Double](repeating: 0, count: 12), h2 = h1
            for i in 0..<12 {
                h1[i] = an.beatChroma[j][i] + an.beatChroma[j + 1][i]
                h2[i] = an.beatChroma[j + 2][i] + an.beatChroma[j + 3][i]
            }
            let c1 = matchChord(h1)?.name, c2 = matchChord(h2)?.name
            let x = c1 ?? "—", y = c2 ?? "—"
            let label = c1 == nil && c2 == nil ? "—" : (x == y ? x : "\(x) \(y)")
            bars.append(Bar(beat: j, start: Int(an.beats[j].rounded()), end: Int((an.beats[j] + 4 * T).rounded()), chords: [c1, c2], label: label))
            j += 4
        }
        var out = an
        out.downbeat = d; out.bars = bars
        out.loops = suggestLoops(an, bars, want: want, count: 3); out.loop = out.loops.first
        return out
    }

    /// Los `count` mejores tramos distintos (sin solaparse) de `want` compases (por defecto 4; si no caben, el mayor de 4, 2 o 1 que quepa), de mejor a peor.
    /// Puntúa cuánto se parece el final al principio (armonía), que las dos mitades suenen igual, que empiece sobre un golpe claro del tiempo 1
    /// y que el volumen no caiga entre el principio y el final; a igualdad, el que empieza antes.
    nonisolated static func suggestLoops(_ an: Analysis, _ bars: [Bar], want: Int, count: Int) -> [LoopSuggestion] {
        guard let L = [want, 4, 2, 1].first(where: { bars.count >= $0 }) else { return [] }
        let maxHit = max(1e-9, an.beatHit.max() ?? 0)
        var cands: [(score: Double, bar: Int)] = []
        for m in 0...(bars.count - L) {
            let j0 = bars[m].beat, jN = j0 + 4 * L
            var s = jN < an.beatChroma.count ? cos12(an.beatChroma[j0], an.beatChroma[jN]) : 0.5
            if L >= 2 {
                let half = (L / 2) * 4
                var a = [Double](repeating: 0, count: 12), b = a
                for k in 0..<half { for i in 0..<12 { a[i] += an.beatChroma[j0 + k][i]; b[i] += an.beatChroma[j0 + half + k][i] } }
                s += 0.5 * cos12(a, b)
            }
            let r0 = an.beatRMS[j0], r1 = jN - 1 < an.beatRMS.count ? an.beatRMS[jN - 1] : r0
            if r0 > 1e-6 && r1 > 1e-6 && abs(20 * log10(r0 / r1)) > 6 { s -= 0.3 }
            if j0 < an.beatHit.count { s += 0.25 * an.beatHit[j0] / maxHit }
            s -= 0.01 * Double(m)
            cands.append((s, m))
        }
        cands.sort { $0.score > $1.score }
        var out: [LoopSuggestion] = []
        for c in cands {
            if out.count >= count { break }
            if out.contains(where: { abs($0.bar - c.bar) < L }) { continue }       // que no se solapen
            let sel = Array(bars[c.bar..<(c.bar + L)])
            out.append(LoopSuggestion(bar: c.bar, bars: L, start: sel[0].start, end: sel[sel.count - 1].end, chords: sel.map(\.label), want: want, score: c.score))
        }
        return out
    }

    /// Más allá de este ajuste (en %) el BPM fijo se descarta: sería un cambio de tono audible, no una corrección.
    nonisolated static let maxStretchPct = 8.0

    /// BPM fijo para el loop: el detectado, redondeado a un entero (así el loop dura justo `compases × 4 × 60 / BPM` segundos).
    nonisolated static func fixedBpm(_ bpm: Double) -> Int { max(1, Int(bpm.rounded())) }

    /// Muestras que debe durar un loop de `bars` compases de 4 tiempos a `bpm`.
    nonisolated static func loopLength(rate: Int, bpm: Int, bars: Int) -> Int { Int((Double(bars * 4 * 60 * rate) / Double(bpm)).rounded()) }

    /// Cuánto hay que estirar o acortar (en %) un tramo de `len` muestras para que dure `target`. Positivo = se alarga.
    nonisolated static func stretchPct(_ len: Int, _ target: Int) -> Double { len > 0 ? 100 * Double(target - len) / Double(len) : 0 }

    /// Remuestrea `x` a exactamente `n` muestras (interpolación cúbica Catmull-Rom): cambios de duración de ±1 % no se oyen como tono.
    nonisolated static func fitLength(_ x: [Float], _ n: Int) -> [Float] {
        let len = x.count
        guard n > 0, len > 0 else { return [] }
        if n == len { return x }
        let k = Double(len) / Double(n)
        func at(_ i: Int) -> Double { Double(x[min(len - 1, max(0, i))]) }
        return (0..<n).map { i in
            let p = Double(i) * k, i0 = Int(p.rounded(.down)), t = p - Double(i0)
            let a = at(i0 - 1), b = at(i0), c = at(i0 + 1), d = at(i0 + 2)
            return Float(b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a))))
        }
    }

    /// Audio del loop: si hay sonido después del final, se funde por potencia constante con el principio (el salto de vuelta no se oye).
    /// Con `fix` el loop se ajusta a durar exactamente esos compases a ese BPM (para que encaje en una secuencia).
    nonisolated static func makeLoop(_ x: [Float], start: Int, end: Int, rate: Int, fadeMs: Double = 15, fix: (bpm: Int, bars: Int)? = nil) -> [Float] {
        let out = rawLoop(x, start: start, end: end, rate: rate, fadeMs: fadeMs)
        guard let f = fix, !out.isEmpty else { return out }
        let target = loopLength(rate: rate, bpm: f.bpm, bars: f.bars)
        return abs(stretchPct(out.count, target)) > maxStretchPct ? out : fitLength(out, target)
    }

    nonisolated private static func rawLoop(_ x: [Float], start: Int, end: Int, rate: Int, fadeMs: Double) -> [Float] {
        let len = end - start
        guard len > 0, start >= 0, end <= x.count else { return [] }
        var out = Array(x[start..<end])
        let f = min(Int((fadeMs / 1000 * Double(rate)).rounded()), len >> 2, max(0, x.count - end))
        if f < 8 {
            let c = Int((Double(rate) * 0.003).rounded())
            return Harmonize.cosFade(out, inSamples: c, outSamples: c)
        }
        for i in 0..<f {
            let th = Double.pi / 2 * (Double(i) + 0.5) / Double(f)
            out[i] = x[start + i] * Float(sin(th)) + x[end + i] * Float(cos(th))
        }
        return out
    }
}

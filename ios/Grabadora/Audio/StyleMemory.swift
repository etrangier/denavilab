import Foundation

/// Memoria de estilo: aprende, en el propio dispositivo y sin enviar nada, cómo recortas y cómo armas tus loops.
/// Mismo diseño y mismos números que `learn.js` de la PWA. No es una red neuronal: son estadísticas sencillas y explicables.
///  1) De cada sonido saca unos números (duración, ataque, caída, brillo, golpes por segundo).
///  2) De tus sonidos con tipo (textura, bajo, batería) aprende cómo suena cada tipo y reconoce los nuevos.
///  3) De cada recorte y cada loop aprende cuánto aire dejas, qué fundido usas, qué largo y qué empalme prefieres.
///  4) Con eso sugiere un recorte o un loop; tú lo corriges y la memoria aprende de la corrección.
enum StyleMemory {
    static let minSeen = 3                 // con menos ejemplos que esto se usan valores de fábrica
    private static let ema = 0.3           // cuánto pesa lo último que hiciste
    private static let key = "styleMemory"
    private static let factoryTrim: [String: (lead: Double, tail: Double, fade: Double)] = ["golpe": (8, 60, 4), "sostenido": (20, 250, 20)]

    struct Features {
        var dur = 0.0, onsetMs = 0.0, attackMs = 0.0, decayMs = 0.0, endMs = 0.0, crest = 0.0, centroid = 0.0, onsetsPerSec = 0.0
    }
    struct KindStat: Codable { var n = 0; var mean = [Double](repeating: 0, count: 5); var m2 = [Double](repeating: 0, count: 5) }
    struct TrimStat: Codable { var n = 0; var lead = 0.0; var tail = 0.0; var fade = 0.0 }
    struct LoopStat: Codable { var n = 0; var lenSec = 0.0; var refine = 0.0; var cross: [String: Int] = [:]; var beats: [String: Int] = [:] }
    struct Model: Codable {
        var v = 1
        var on = true
        var seen = 0
        var kinds: [String: KindStat] = [:]
        var trim: [String: TrimStat] = [:]
        var loop: [String: LoopStat] = [:]
        var ids: [String: Bool] = [:]
    }
    struct StyleGuess { let kind: String?; let group: String; let confidence: Double }
    struct TrimSuggestion { let a: Int; let b: Int; let fadeMs: Double; let group: String; let learned: Int; let why: String }
    struct LoopSuggestion { let a: Int; let b: Int; let crossSec: Double; let refine: Bool; let group: String; let learned: Int; let seam: Double?; let periodo: Double?; let why: String }

    // MARK: persistencia
    static func load() -> Model {
        guard let d = UserDefaults.standard.data(forKey: key), let m = try? JSONDecoder().decode(Model.self, from: d), m.v == 1 else { return Model() }
        return m
    }
    @discardableResult static func save(_ m: Model) -> Model {
        if let d = try? JSONEncoder().encode(m) { UserDefaults.standard.set(d, forKey: key) }
        return m
    }
    @discardableResult static func forget() -> Model { UserDefaults.standard.removeObject(forKey: key); return Model() }
    static func setEnabled(_ on: Bool) { var m = load(); m.on = on; save(m) }

    // MARK: rasgos
    private static func envelope(_ x: [Float], rate: Int, hopMs: Double = 5) -> (e: [Float], hop: Int) {
        let hop = max(32, Int((Double(rate) * hopMs / 1000).rounded())), n = x.count / hop
        var e = [Float](repeating: 0, count: n)
        for i in 0..<n { var s: Float = 0; for j in (i * hop)..<((i + 1) * hop) { s += x[j] * x[j] }; e[i] = (s / Float(hop)).squareRoot() }
        return (e, hop)
    }

    private static func centroid(_ x: [Float], rate: Int) -> Double {
        let N = 2048
        guard x.count >= N else { return 0 }
        let frames = 6
        var num = [Double](repeating: 0, count: N / 2), used = 0
        let win = (0..<N).map { 0.5 - 0.5 * cos(2 * Double.pi * Double($0) / Double(N - 1)) }
        for f in 0..<frames {
            let off = Int(Double(x.count - N) * Double(f) / Double(frames - 1))
            var re = [Double](repeating: 0, count: N), im = [Double](repeating: 0, count: N), en = 0.0
            for i in 0..<N { re[i] = Double(x[off + i]) * win[i]; en += re[i] * re[i] }
            if en < 1e-8 { continue }
            NoiseReduction.fft(&re, &im, inverse: false); used += 1
            for k in 1..<(N / 2) { num[k] += (re[k] * re[k] + im[k] * im[k]).squareRoot() }
        }
        guard used > 0 else { return 0 }
        var a = 0.0, b = 0.0
        for k in 1..<(N / 2) { a += Double(k) * Double(rate) / Double(N) * num[k]; b += num[k] }
        return b > 0 ? a / b : 0
    }

    /// Números que describen un sonido. nil si es casi silencio o dura menos de 50 ms.
    static func features(_ x: [Float], rate: Int) -> Features? {
        guard x.count >= Int(Double(rate) * 0.05) else { return nil }
        let (e, hop) = envelope(x, rate: rate), n = e.count
        guard n > 2 else { return nil }
        var pk: Float = 0, pi = 0
        for i in 0..<n where e[i] > pk { pk = e[i]; pi = i }
        guard pk >= 1e-4 else { return nil }
        var on = 0; while on < n && e[on] < pk * 0.1 { on += 1 }
        var dec = pi; while dec < n && e[dec] >= pk * 0.0316 { dec += 1 }
        var end = n - 1; while end > 0 && e[end] < pk * 0.0178 { end -= 1 }
        var peak: Float = 0, sq = 0.0
        for v in x { let a = abs(v); if a > peak { peak = a }; sq += Double(v) * Double(v) }
        let rms = max((sq / Double(x.count)).squareRoot(), 1e-9), dur = Double(x.count) / Double(rate)
        func ms(_ i: Int) -> Double { Double(i * hop) / Double(rate) * 1000 }
        var f = Features()
        f.dur = dur; f.onsetMs = ms(on); f.attackMs = ms(max(0, pi - on)); f.decayMs = ms(dec - pi); f.endMs = ms(end + 1)
        f.crest = 20 * log10(Double(peak) / rms); f.centroid = centroid(x, rate: rate)
        f.onsetsPerSec = Double(Editing.transients(x, sensitivity: 0.5, minGapSamples: Int(Double(rate) * 0.08)).count) / dur
        return f
    }

    private static func vec(_ f: Features) -> [Double] {
        [log10(f.dur + 0.01), log10(1 + f.decayMs), f.crest / 20, log10(1 + f.centroid), min(f.onsetsPerSec, 8) / 8]
    }

    /// ¿golpe (corto, de caída rápida) o sostenido (pad, textura)? Primero con lo que aprendió de tus tipos; si no, con una regla simple.
    static func styleOf(_ f: Features, _ model: Model) -> StyleGuess {
        let heur = f.decayMs < 500 && f.crest > 14 ? "golpe" : "sostenido"
        let cands = model.kinds.filter { $0.value.n >= minSeen }
        guard cands.count >= 2 else { return StyleGuess(kind: nil, group: heur, confidence: 0) }
        let v = vec(f)
        var best: (name: String, d: Double)?, second = Double.infinity
        for (name, k) in cands.sorted(by: { $0.key < $1.key }) {
            var d = 0.0
            for i in 0..<v.count { let sd = (k.m2[i] / Double(max(1, k.n - 1))).squareRoot() + 0.15; let z = (v[i] - k.mean[i]) / sd; d += z * z }
            d = (d / Double(v.count)).squareRoot()
            if let b = best { if d < b.d { second = b.d; best = (name, d) } else if d < second { second = d } } else { best = (name, d) }
        }
        guard let b = best else { return StyleGuess(kind: nil, group: heur, confidence: 0) }
        let conf = max(0, min(1, 1 - b.d / (second + 1e-9)))
        let group = b.name == "bateria" || b.name == "bajo" ? "golpe" : (b.name == "textura" ? "sostenido" : heur)
        return StyleGuess(kind: b.name, group: group, confidence: conf)
    }

    // MARK: aprender
    /// Un sonido con tipo (textura, bajo, batería) enseña cómo suena ese tipo. Cada sonido enseña una sola vez (`id`).
    @discardableResult static func learnSound(kind: String?, _ f: Features?, id: String? = nil, _ model: Model? = nil) -> Model {
        var m = model ?? load()
        guard m.on, let f, let kind, kind != "libre" else { return m }
        if let id { if m.ids[id] == true { return m }; m.ids[id] = true }
        let v = vec(f)
        var k = m.kinds[kind] ?? KindStat()
        k.n += 1
        for i in 0..<v.count { let d = v[i] - k.mean[i]; k.mean[i] += d / Double(k.n); k.m2[i] += d * (v[i] - k.mean[i]) }      // Welford
        m.kinds[kind] = k; m.seen += 1
        return save(m)
    }
    private static func mix(_ old: Double, _ v: Double, _ n: Int) -> Double { n == 0 ? v : old + ema * (v - old) }

    /// Un recorte enseña cuánto aire dejas antes del golpe (lead), después de la cola (tail) y qué fundido usas.
    @discardableResult static func learnTrim(_ f: Features, group: String, startMs: Double, endMs: Double, fadeMs: Double, _ model: Model? = nil) -> Model {
        var m = model ?? load()
        guard m.on else { return m }
        let lead = max(-50, min(400, f.onsetMs - startMs)), tail = max(-300, min(2000, endMs - f.endMs))
        var t = m.trim[group] ?? TrimStat()
        t.lead = mix(t.lead, lead, t.n); t.tail = mix(t.tail, tail, t.n); t.fade = mix(t.fade, max(0, min(200, fadeMs)), t.n); t.n += 1
        m.trim[group] = t; m.seen += 1
        return save(m)
    }

    /// Un loop enseña qué largo prefieres, cuántos tiempos dura, el fundido del empalme y si afinas el final.
    @discardableResult static func learnLoop(group: String, lenSec: Double, bpm: Double?, crossSec: Double, refine: Bool, _ model: Model? = nil) -> Model {
        var m = model ?? load()
        guard m.on, lenSec > 0 else { return m }
        var l = m.loop[group] ?? LoopStat()
        l.lenSec = mix(l.lenSec, lenSec, l.n); l.refine = mix(l.refine, refine ? 1 : 0, l.n)
        l.cross[crossKey(crossSec), default: 0] += 1
        if let bpm, bpm > 0 { let b = max(1, Int((lenSec * bpm / 60).rounded())); l.beats[String(b), default: 0] += 1 }
        l.n += 1; m.loop[group] = l; m.seen += 1
        return save(m)
    }
    private static func crossKey(_ c: Double) -> String { String(format: "%g", c) }
    private static func mode(_ d: [String: Int]) -> String? { d.max { $0.value < $1.value || ($0.value == $1.value && $0.key > $1.key) }?.key }

    // MARK: sugerir
    private static func snap(_ x: [Float], _ i: Int) -> Int { Editing.nearestZeroCross(x, to: max(0, min(i, x.count - 2)), window: 256) }
    private static func comma(_ v: Double, _ digits: Int = 1) -> String { String(format: "%.\(digits)f", v).replacingOccurrences(of: ".", with: ",") }

    /// Recorte sugerido: arranca un poco antes del ataque y acaba tras la cola, con el aire y el fundido que sueles dejar.
    static func suggestTrim(_ x: [Float], rate: Int, _ model: Model? = nil) -> TrimSuggestion? {
        let m = model ?? load()
        guard let f = features(x, rate: rate) else { return nil }
        let st = styleOf(f, m), learnedStat = m.on ? m.trim[st.group] : nil
        let l = (learnedStat?.n ?? 0) >= minSeen ? learnedStat : nil
        let d = l.map { (lead: $0.lead, tail: $0.tail, fade: $0.fade) } ?? factoryTrim[st.group]!
        let a = snap(x, Int((f.onsetMs - d.lead) / 1000 * Double(rate)).clampedZero), b = min(x.count, Int((f.endMs + d.tail) / 1000 * Double(rate)))
        guard b - a >= Int(Double(rate) * 0.02) else { return nil }
        let who = st.group == "golpe" ? "Golpe" : "Sonido sostenido"
        let src = l.map { " (aprendido de \($0.n) recortes tuyos)" } ?? " (valores de fábrica: aún aprendo de ti)"
        return TrimSuggestion(a: a, b: b, fadeMs: d.fade.rounded(), group: st.group, learned: l?.n ?? 0,
                              why: "\(who): \(Int(d.lead.rounded())) ms antes del ataque y \(Int(d.tail.rounded())) ms tras la cola, fundido \(Int(d.fade.rounded())) ms" + src)
    }

    /// Loop sugerido: parte la zona estable (después del ataque) en tiempos si hay pulso, o en el largo que sueles preferir.
    static func suggestLoop(_ x: [Float], rate: Int, bpm: Double?, bpmConfidence: Double, _ model: Model? = nil) -> LoopSuggestion? {
        let m = model ?? load()
        guard let f = features(x, rate: rate) else { return nil }
        let st = styleOf(f, m), stat = m.on ? m.loop[st.group] : nil
        let l = (stat?.n ?? 0) >= minSeen ? stat : nil
        let startMs = f.onsetMs + (st.group == "golpe" ? f.attackMs + 20 : min(300, f.attackMs + 40)), availMs = f.endMs - startMs
        guard availMs >= 500 else { return nil }
        var lenMs = 0.0, how = ""
        if let bpm, bpm > 0, bpmConfidence >= 0.25 {
            let beatMs = 60000 / bpm, pref = l.flatMap { mode($0.beats) }.flatMap { Int($0) } ?? 0
            let fit = [1, 2, 4, 8, 16, 32].filter { Double($0) * beatMs <= availMs }
            let beats = fit.contains(pref) ? pref : (fit.last ?? 0)
            if beats > 0 { lenMs = Double(beats) * beatMs; how = "\(beats) tiempos a \(Int(bpm.rounded())) BPM" + (fit.contains(pref) ? " (tu largo habitual)" : "") }
        }
        var periodo: Double?
        if lenMs == 0 {      // sin pulso: ¿el sonido se repite solo? (histograma de desfases entre picos iguales, como en Shazam)
            let z0 = max(0, Int(startMs / 1000 * Double(rate))), z1 = min(x.count, Int(f.endMs / 1000 * Double(rate)))
            if z1 - z0 > rate {
                let rep = Constellation.repetition(Array(x[z0..<z1]), rate: rate, minSec: 0.3, maxSec: min(20, availMs / 1000))
                if let best = rep.first(where: { $0.sec * 1000 <= availMs }) {
                    var k = 1
                    while best.sec * Double(k) < 1.0 && best.sec * Double(k + 1) * 1000 <= availMs { k += 1 }          // al menos ~1 s: se juntan periodos enteros
                    lenMs = best.sec * Double(k) * 1000; periodo = best.sec
                    how = "\(comma(lenMs / 1000)) s (\(k == 1 ? "un periodo" : "\(k) periodos"): se repite cada \(comma(best.sec, 2)) s)"
                }
            }
        }
        if lenMs == 0 {
            lenMs = min(availMs, l.map { $0.lenSec * 1000 } ?? availMs)
            how = "\(comma(lenMs / 1000)) s" + (l != nil ? " (tu largo habitual)" : " de la zona estable")
        }
        let a = snap(x, Int(startMs / 1000 * Double(rate)).clampedZero)
        var b = min(x.count, a + Int(lenMs / 1000 * Double(rate))), seam: Double?
        let cmap = Constellation.build(x, rate: rate)                          // el final se afina por continuidad espectral
        let rf = Constellation.refineLoopEnd(cmap, a, b, rangeSec: 0.1)
        if rf.score >= 0.3 { b = min(x.count, snap(x, rf.b)); seam = rf.score } else if rf.score >= 0 { seam = rf.score }
        var cross = l.flatMap { mode($0.cross) }.flatMap { Double($0) } ?? 1
        cross = max(0.5, min(cross, Double(b - a) / Double(rate) / 4))
        let snapped = [0.5, 1.0, 2.0, 4.0].min { abs($0 - cross) < abs($1 - cross) } ?? 1
        let src = l.map { " (aprendido de \($0.n) loops tuyos)" } ?? " (valores de fábrica)"
        return LoopSuggestion(a: a, b: b, crossSec: snapped, refine: l.map { $0.refine >= 0.5 } ?? true, group: st.group, learned: l?.n ?? 0, seam: seam, periodo: periodo,
                              why: "Loop de \(how)" + (seam.map { $0 >= 0 ? ", continuidad espectral \(Int(($0 * 100).rounded())) %" : "" } ?? "") + ", empalme de \(String(format: "%g", snapped).replacingOccurrences(of: ".", with: ",")) s" + src)
    }

    /// Frases para mostrar al usuario qué ha aprendido (transparencia).
    static func summary(_ m: Model) -> [String] {
        var out: [String] = []
        let kinds = m.kinds.filter { $0.value.n > 0 }.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value.n)" }
        if !kinds.isEmpty { out.append("Sonidos con tipo vistos: " + kinds.joined(separator: " · ")) }
        for (g, t) in m.trim.sorted(by: { $0.key < $1.key }) where t.n > 0 {
            out.append("Recortes de \(g == "golpe" ? "golpes" : "sonidos sostenidos") (\(t.n)): \(Int(t.lead.rounded())) ms antes del ataque, \(Int(t.tail.rounded())) ms tras la cola, fundido \(Int(t.fade.rounded())) ms")
        }
        for (g, l) in m.loop.sorted(by: { $0.key < $1.key }) where l.n > 0 {
            let beats = mode(l.beats).map { ", \($0) tiempos" } ?? ""
            out.append("Loops de \(g == "golpe" ? "golpes" : "sonidos sostenidos") (\(l.n)): ~\(comma(l.lenSec))s\(beats), empalme de \((mode(l.cross) ?? "1").replacingOccurrences(of: ".", with: ",")) s")
        }
        return out.isEmpty ? ["Aún no he aprendido nada: se llena solo cuando recortas, haces loops y guardas sonidos con tipo."] : out
    }
}

private extension Int { var clampedZero: Int { Swift.max(0, self) } }

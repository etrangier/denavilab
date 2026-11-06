import Foundation

/// Cadena de efectos: una lista (hasta 8) de casillas aplicadas en orden. La casilla especial «layer» mezcla otro sonido de la biblioteca.
/// Mismo cálculo y mismos números que `fxall.js` de la PWA.
struct FxSlot: Codable, Equatable, Identifiable {
    var id = UUID()
    var fx: String                       // raw value de Fx404.ID, o "layer"
    var params: Fx404.Params = [:]
    var bypass = false
    var ref: String?                     // layer: id del sonido
    var name: String?                    // layer: nombre del sonido
    var gain = 70.0                      // layer: nivel 0...100

    static let layerKey = "layer"
    var effect: Fx404.ID? { Fx404.ID(rawValue: fx) }
    var isLayer: Bool { fx == Self.layerKey }
    static func make(_ e: Fx404.ID, _ given: Fx404.Params = [:]) -> FxSlot { FxSlot(fx: e.rawValue, params: Fx404.params(e, given)) }
    static func layer(_ id: String, name: String, gain: Double = 70) -> FxSlot { FxSlot(fx: layerKey, ref: id, name: name, gain: gain) }
}

enum FxChain {
    nonisolated static let maxSlots = 8
    nonisolated static let maxSeconds = 60.0           // ninguna cadena produce más de un minuto

    /// Quita lo desconocido, acota los ajustes y limita a 8 casillas.
    nonisolated static func clean(_ chain: [FxSlot]) -> [FxSlot] {
        var out: [FxSlot] = []
        for var s in chain {
            if s.isLayer { s.gain = min(100, max(0, s.gain)); s.params = [:]; out.append(s) }
            else if let e = s.effect { s.params = Fx404.params(e, s.params); out.append(s) }
            if out.count == maxSlots { break }
        }
        return out
    }

    /// Mezcla otro sonido (repetido hasta cubrir la toma) con el actual.
    nonisolated static func layerIn(_ x: [Float], _ rate: Int, _ other: (audio: [Float], rate: Int)?, _ gain: Double) -> [Float] {
        guard let o = other, !o.audio.isEmpty else { return x }
        let r = Double(o.rate) / Double(rate), m = o.audio.count, g = Float(gain / 100)
        var y = x
        for i in x.indices {
            let p = (Double(i) * r).truncatingRemainder(dividingBy: Double(m)), k = Int(floor(p)), f = Float(p - Double(k))
            y[i] += (o.audio[k] * (1 - f) + o.audio[(k + 1) % m] * f) * g
        }
        return Fx404.finish(y)
    }

    nonisolated static func apply(_ chain: [FxSlot], _ x: [Float], rate: Int, layers: [String: (audio: [Float], rate: Int)] = [:]) -> [Float] {
        var y = x
        let cap = Int(maxSeconds * Double(rate))
        for s in clean(chain) where !s.bypass {
            if s.isLayer { y = layerIn(y, rate, s.ref.flatMap { layers[$0] }, s.gain) }
            else if let e = s.effect { y = Fx404.apply(e, y, rate: rate, s.params) }
            if y.count > cap {
                y = Array(y[0..<cap])
                let f = Int(Double(rate) * 0.2)
                for i in 0..<min(f, y.count) { y[cap - 1 - i] *= Float(i) / Float(f) }
            }
        }
        return y
    }

    nonisolated static func describe(_ chain: [FxSlot]) -> [String] {
        clean(chain).filter { !$0.bypass }.map { s in
            if s.isLayer { return "Mezcla con «\(s.name ?? "otro sonido")» (nivel \(Int(s.gain.rounded())) %)" }
            return s.effect.map { Fx404.describe($0, s.params) } ?? ""
        }
    }

    nonisolated static let presets: [(name: String, chain: [FxSlot])] = [
        ("Casete ancho", [.make(.cassette, ["tone": 55, "hiss": 20, "age": 10, "drive": 25, "wow": 25, "catch": 10]), .make(.chorus, ["depth": 65, "rate": 1.8, "balance": 55])]),
        ("Disco polvoriento", [.make(.vinyl303, ["comp": 55, "noise": 45, "wow": 50]), .make(.cassette, ["tone": 45, "hiss": 20, "age": 15, "drive": 30, "wow": 20, "catch": 10]), .make(.reverb, ["size": 25, "damping": 55, "predelay": 10, "mix": 20])]),
        ("Nube etérea", [.make(.granular, ["size": 160, "density": 36, "stretch": 1, "freeze": 0, "spray": 50, "jitter": 25]), .make(.chorus, ["depth": 60, "rate": 1.5, "balance": 50]), .make(.reverb, ["size": 80, "damping": 55, "predelay": 30, "mix": 45])]),
        ("Sucio y oscuro", [.make(.overdrive, ["drive": 55, "tone": 45, "asym": 35]), .make(.filterdrive, ["type": 0, "cutoff": 40, "resonance": 35, "drive": 20]), .make(.cassette, ["tone": 30, "hiss": 40, "age": 35, "drive": 40, "wow": 40, "catch": 30])]),
        ("Pulso con eco", [.make(.slicer, ["division": 2, "pattern": 2, "depth": 90]), .make(.tapeecho, ["time": 300, "feedback": 45, "tone": 40, "wow": 25, "mix": 40])]),
    ]

    // MARK: Variaciones al azar

    struct Style { let key: String, name: String, pool: [Fx404.ID]?, count: ClosedRange<Int> }
    nonisolated static let styles: [Style] = [
        Style(key: "libre", name: "Libre", pool: nil, count: 2...4),
        Style(key: "oscuro", name: "Oscuro", pool: [.cassette, .filterdrive, .overdrive, .reverb, .vinyl404], count: 2...3),
        Style(key: "sucio", name: "Sucio", pool: [.crusher, .overdrive, .distortion, .vinyl303, .ringmod, .cassette], count: 2...3),
        Style(key: "eterero", name: "Etéreo", pool: [.granular, .chorus, .phaser, .flanger, .reverb, .tapeecho, .filterdrive], count: 2...3),
        Style(key: "ritmico", name: "Rítmico", pool: [.slicer, .stutter, .tapeecho, .tremolo, .tapestop], count: 2...3),
    ]

    /// Ajustes al azar alrededor de los de fábrica; `intensity` 0–1 = cuánto se alejan. Determinista según el generador.
    nonisolated static func randomParams(_ id: Fx404.ID, _ g: inout Fx404.RNG, intensity: Double) -> Fx404.Params {
        var o = Fx404.Params()
        for q in Fx404.info(id).params {
            switch q.kind {
            case .range:
                let span = (q.max - q.min) * 0.5 * intensity, v = q.def + (g.next() * 2 - 1) * span, st = q.step > 0 ? q.step : 1
                o[q.key] = (min(q.max, max(q.min, v)) / st).rounded() * st
            case .bool: o[q.key] = g.next() < 0.3 * intensity ? 1 : 0
            case .choice: o[q.key] = g.next() < 0.4 + 0.5 * intensity ? floor(g.next() * Double(q.options.count)) : q.def
            }
        }
        return Fx404.params(id, o)
    }

    nonisolated static func randomChain(seed: UInt32, style: String = "libre", intensity: Double = 0.5, bpm: Double? = nil) -> [FxSlot] {
        var g = Fx404.RNG(seed)
        let st = styles.first { $0.key == style } ?? styles[0], pool = st.pool ?? Fx404.allOrder
        let n = st.count.lowerBound + Int(g.next() * Double(st.count.upperBound - st.count.lowerBound + 1))
        var chosen: [Fx404.ID] = []
        while chosen.count < min(n, pool.count) {
            let id = pool[Int(g.next() * Double(pool.count))]
            if !chosen.contains(id) && id != .autopitch { chosen.append(id) }
        }
        return chosen.map { id in
            var p = randomParams(id, &g, intensity: intensity)
            if let b = bpm, p["bpm"] != nil { p["bpm"] = min(240, max(40, b.rounded())) }
            return .make(id, p)
        }
    }
}

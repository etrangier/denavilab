import Foundation

/// Afinador en vivo: dice qué nota suena y cuántos cents le faltan (La = 440 Hz). Con ukelele o guitarra también la cuerda más cercana.
enum Tuner {
    struct Reading: Equatable {
        var f0: Double
        var note: String
        var cents: Double
        var string: String?
        var stringCents: Double?
        /// Cents que se muestran: respecto a la cuerda si hay una cerca, si no respecto a la nota.
        nonisolated var shownCents: Double { stringCents ?? cents }
        nonisolated var title: String { string ?? note }
    }

    enum Preset: String, CaseIterable {
        case cromatico, ukelele, guitarra
        nonisolated var label: String { switch self { case .cromatico: return "Cromático"; case .ukelele: return "Ukelele"; case .guitarra: return "Guitarra" } }
        nonisolated var strings: [(String, Int)] {
            switch self {
            case .cromatico: return []
            case .ukelele: return [("Sol4", 67), ("Do4", 60), ("Mi4", 64), ("La4", 69)]          // GCEA con la G aguda
            case .guitarra: return [("Mi2", 40), ("La2", 45), ("Re3", 50), ("Sol3", 55), ("Si3", 59), ("Mi4", 64)]
            }
        }
    }

    nonisolated static func midi(_ f: Double) -> Double { 69 + 12 * log2(f / 440) }

    /// Tono del último tramo de audio, o nil si es silencio o no hay un tono claro.
    nonisolated static func detect(_ x: [Float], rate: Int, preset: Preset = .cromatico) -> Reading? {
        guard x.count >= Int(Double(rate) * 0.12) else { return nil }
        var e = 0.0, n = 0.0
        var i = 0
        while i < x.count { e += Double(x[i] * x[i]); n += 1; i += 4 }
        guard (e / max(1, n)).squareRoot() >= 0.004 else { return nil }
        let tp = Fx404.trackPitch(x, rate, fmin: 55, fmax: 1100)
        let v = tp.f0.filter { $0 > 0 }.sorted()
        guard v.count >= 3, Double(v.count) >= Double(tp.f0.count) * 0.4 else { return nil }
        let f0 = v[v.count / 2], m = midi(f0), r = Int(m.rounded())
        var out = Reading(f0: f0, note: Pistorius.noteName(r), cents: (m - Double(r)) * 100, string: nil, stringCents: nil)
        var best: (String, Double)? = nil
        for (nm, mi) in preset.strings {
            let d = (m - Double(mi)) * 100
            if best == nil || abs(d) < abs(best!.1) { best = (nm, d) }
        }
        if let b = best, abs(b.1) <= 350 { out.string = b.0; out.stringCents = b.1 }
        return out
    }

    /// Suaviza lo que se muestra: mediana de las últimas lecturas y se mantiene un momento al callar.
    struct Smoother {
        private var hist: [Reading] = []
        private var last: Reading?
        private var lastAt = Date.distantPast
        var size = 3, hold = 0.6
        mutating func push(_ r: Reading?, now: Date = Date()) -> Reading? {
            if let r = r {
                hist.append(r); if hist.count > size { hist.removeFirst() }
                lastAt = now
                var m = hist[hist.count - 1]
                let c = hist.map { $0.cents }.sorted(), sc = hist.compactMap { $0.stringCents }.sorted()
                m.cents = c[c.count / 2]
                if m.stringCents != nil, !sc.isEmpty { m.stringCents = sc[sc.count / 2] }
                last = m
            } else if now.timeIntervalSince(lastAt) > hold { hist.removeAll(); last = nil }
            return last
        }
    }
}

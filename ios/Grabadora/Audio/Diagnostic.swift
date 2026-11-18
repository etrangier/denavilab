import Foundation

/// Diagnóstico: un resumen en texto (sin audio ni nombre) de lo que la app «entendió» de un sonido y de lo que sugirió,
/// para compararlo con lo que hiciste y ajustar los algoritmos con datos reales.
enum Diagnostic {
    nonisolated private static func r(_ v: Double, _ d: Int = 3) -> Double {
        guard v.isFinite else { return 0 }
        let p = pow(10.0, Double(d))
        return (v * p).rounded() / p
    }

    static func build(_ x: [Float], rate: Int, kind: String?, status: String, bpmSaved: Double?, selection: (a: Int, b: Int)?) -> String {
        var out: [String: Any] = ["v": 1, "seg": r(Double(x.count) / Double(rate), 2), "hz": rate, "estado": status]
        if let kind { out["tipo"] = kind }
        if let f = StyleMemory.features(x, rate: rate) {
            out["rasgos"] = ["dur": r(f.dur, 2), "onsetMs": r(f.onsetMs, 1), "attackMs": r(f.attackMs, 1), "decayMs": r(f.decayMs, 1), "endMs": r(f.endMs, 1),
                             "crest": r(f.crest, 2), "centroid": r(f.centroid, 1), "onsetsPerSec": r(f.onsetsPerSec, 2)]
        }
        let an = x.count > rate * 3 ? Beat.analyze(x, rate: rate) : nil
        var tempo: [String: Any] = [:]
        if let s = bpmSaved { tempo["guardado"] = r(s, 1) }
        if let v = Editing.estimateBPM(x, rate: rate) { tempo["antes"] = ["bpm": r(v.bpm, 1), "conf": r(v.confidence, 2)] }
        if let a = an {
            tempo["ahora"] = ["bpm": r(a.bpm, 1), "conf": r(a.confidence, 2), "compas": a.meter, "confCompas": r(a.meterConfidence, 2), "compasSeg": r(a.barSec, 3),
                              "primerTiempoFuerteSeg": r(a.firstDownbeat, 3), "tiemposFuertes": a.downbeats.prefix(8).map { r($0, 2) }, "alternativas": a.alternatives.map { r($0, 1) }]
        }
        out["tempo"] = tempo
        var sug: [String: Any] = [:]
        let rt = Double(rate)
        if let t = StyleMemory.suggestTrim(x, rate: rate) { sug["recorte"] = ["a": r(Double(t.a) / rt), "b": r(Double(t.b) / rt)] }
        if let l = StyleMemory.suggestLoop(x, rate: rate, bpm: an?.bpm, bpmConfidence: an?.confidence ?? 0) {
            var d: [String: Any] = ["a": r(Double(l.a) / rt), "b": r(Double(l.b) / rt), "porque": l.why]
            if let bars = l.bars { d["compases"] = bars }
            if let s = l.seam { d["continuidad"] = r(s, 2) }
            sug["loop"] = d
        }
        out["sugerencia"] = sug
        if let s = selection { out["mi_seleccion"] = ["a": r(Double(s.a) / rt), "b": r(Double(s.b) / rt), "seg": r(Double(s.b - s.a) / rt)] }
        if let a = an {
            let e = a.env, step = max(1, e.count / 160), mx = max(Double(e.max() ?? 1), 0.0001)
            var s = ""
            var i = 0
            while i < e.count {
                var m: Float = 0
                for j in i..<min(e.count, i + step) where e[j] > m { m = e[j] }
                s += String(min(9, Int((9 * Double(m) / mx).rounded())))
                i += step
            }
            out["golpes"] = s
        }
        guard let d = try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]), let text = String(data: d, encoding: .utf8) else { return "{}" }
        return text
    }
}

import Foundation

/// Pistorius: el asistente de sampling. Pregunta qué se grabó y qué se quiere hacer con ello, analiza el sonido (tramo estable, afinación, tempo, ruido),
/// explica si conviene cortar o chopear y aplica una receta hecha con las herramientas de la app. Mismo cálculo que `pistorius.js` de la PWA.
enum Pistorius {
    struct Source: Identifiable { let id: String; let label: String; let symbol: String }
    struct Goal: Identifiable { let id: String; let label: String; let hint: String; let symbol: String; let kind: String }

    nonisolated static let sources: [Source] = [
        Source(id: "musica", label: "Música (disco o canción)", symbol: "music.note"),
        Source(id: "instrumento", label: "Un instrumento", symbol: "guitars"),
        Source(id: "dialogo", label: "Diálogo de cine o serie", symbol: "film"),
        Source(id: "voz", label: "Voz o canto", symbol: "mic"),
        Source(id: "naturaleza", label: "Naturaleza", symbol: "leaf"),
        Source(id: "ambiente", label: "Sonido ambiente cualquiera", symbol: "waveform"),
        Source(id: "otro", label: "Otra cosa", symbol: "ellipsis"),
    ]
    nonisolated static let goals: [Goal] = [
        Goal(id: "pad", label: "Pad para teclado", hint: "Una textura que se sostiene: tramo parejo, colchón y loop sin clics", symbol: "pianokeys", kind: "textura"),
        Goal(id: "loopRitmico", label: "Loop rítmico", hint: "Para percusión: detecta el tempo y abre Chop para armar el loop", symbol: "metronome", kind: "bateria"),
        Goal(id: "golpe", label: "Golpe suelto", hint: "Un bombo, una caja o un hi-hat: ataque limpio y caída corta", symbol: "burst", kind: "bateria"),
        Goal(id: "acorde", label: "Acorde", hint: "Guitarra o teclas: arranque limpio, final natural y afinación", symbol: "music.note.list", kind: "textura"),
        Goal(id: "bajo", label: "Bajo", hint: "Una nota grave: sin rumble, afinada y con ataque", symbol: "waveform.path", kind: "bajo"),
        Goal(id: "nota", label: "Una nota", hint: "Una nota de un instrumento, afinada y lista para tocar", symbol: "music.quarternote.3", kind: "libre"),
        Goal(id: "frase", label: "Frase hablada o cantada", hint: "Recorte limpio de una frase, con bordes suaves", symbol: "text.bubble", kind: "libre"),
        Goal(id: "ambiente", label: "Loop de ambiente", hint: "Un fondo que se repite sin que se note el empalme", symbol: "repeat", kind: "textura"),
        Goal(id: "limpiar", label: "Solo limpiar", hint: "Quitar ruido y silencios, poner fundidos y nivelar", symbol: "sparkles", kind: "libre"),
    ]
    /// Qué se sugiere primero según lo que se grabó (el resto sigue disponible).
    nonisolated static let suggest: [String: [String]] = [
        "musica": ["pad", "loopRitmico", "acorde", "bajo", "nota", "golpe", "ambiente", "frase", "limpiar"],
        "instrumento": ["nota", "acorde", "bajo", "pad", "golpe", "loopRitmico", "ambiente", "frase", "limpiar"],
        "dialogo": ["frase", "golpe", "ambiente", "pad", "limpiar", "nota", "acorde", "bajo", "loopRitmico"],
        "voz": ["frase", "pad", "nota", "ambiente", "limpiar", "acorde", "golpe", "bajo", "loopRitmico"],
        "naturaleza": ["ambiente", "pad", "golpe", "limpiar", "frase", "nota", "acorde", "bajo", "loopRitmico"],
        "ambiente": ["pad", "ambiente", "golpe", "limpiar", "frase", "nota", "acorde", "bajo", "loopRitmico"],
        "otro": ["pad", "nota", "golpe", "loopRitmico", "acorde", "bajo", "ambiente", "frase", "limpiar"],
    ]
    nonisolated static func goalsFor(_ source: String) -> [Goal] {
        (suggest[source] ?? suggest["otro"]!).compactMap { id in goals.first { $0.id == id } }
    }

    // MARK: análisis
    private nonisolated static let noteNames = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"]
    nonisolated static func noteName(_ midi: Int) -> String { noteNames[((midi % 12) + 12) % 12] + String(Int((Double(midi) / 12).rounded(.down)) - 1) }
    private nonisolated static func midiOf(_ f: Double) -> Double { 69 + 12 * log2(f / 440) }

    struct Window { var a: Int; var b: Int; var score: Double }

    /// Tramo más parejo de `sec` segundos: el de menos cambio espectral, menos golpes y menos saltos de volumen.
    nonisolated static func stableWindow(_ x: [Float], rate: Int, sec: Double) -> Window {
        let W = Int((sec * Double(rate)).rounded())
        guard Double(x.count) > Double(W) * 1.05, x.count >= rate / 2 else { return Window(a: 0, b: x.count, score: 0) }
        guard x.count >= 2048 + 1024 * 6 else { return Window(a: 0, b: x.count, score: 0) }
        let N = 2048, hop = 1024, T = (x.count - N) / hop + 1, K = min(N / 2 - 1, Int((6000 / (Double(rate) / Double(N))).rounded()))
        let win = (0..<N).map { 0.5 - 0.5 * cos(2 * Double.pi * Double($0) / Double(N - 1)) }
        var re = [Double](repeating: 0, count: N), im = [Double](repeating: 0, count: N)
        var S = [Float](repeating: 0, count: T * K), lv = [Float](repeating: 0, count: T)
        for t in 0..<T {
            var e = 0.0
            for i in 0..<N { re[i] = Double(x[t * hop + i]) * win[i]; im[i] = 0; e += re[i] * re[i] }
            NoiseReduction.fft(&re, &im, inverse: false)
            for k in 0..<K { S[t * K + k] = Float(10 * log10(re[k + 1] * re[k + 1] + im[k + 1] * im[k + 1] + 1e-10)) }
            lv[t] = Float(10 * log10(e / Double(N) + 1e-12))
        }
        var flux = [Float](repeating: 0, count: T), rise = [Float](repeating: 0, count: T)
        for t in 1..<T {
            var a: Float = 0
            for k in 0..<K { a += abs(S[t * K + k] - S[(t - 1) * K + k]) }
            flux[t] = a / Float(K); rise[t] = max(0, lv[t] - lv[t - 1])
        }
        let Wf = max(4, Int((Double(W) / Double(hop)).rounded()))
        var best = (t: 0, score: Double.infinity)
        var t0 = 1
        while t0 + Wf <= T {
            var mf = 0.0, mr = 0.0, mu = 0.0
            for t in t0..<(t0 + Wf) { mf += Double(flux[t]); mu += Double(lv[t]); mr = max(mr, Double(rise[t])) }
            mf /= Double(Wf); mu /= Double(Wf)
            var sd = 0.0
            for t in t0..<(t0 + Wf) { sd += (Double(lv[t]) - mu) * (Double(lv[t]) - mu) }
            sd = (sd / Double(Wf)).squareRoot()
            let score = mf + 0.6 * sd + 1.5 * mr
            if score < best.score { best = (t0, score) }
            t0 += 1
        }
        let a0 = max(0, min(x.count - W, best.t * hop)), a = Editing.nearestZeroCross(x, to: a0, window: 256)
        return Window(a: a, b: min(x.count, a + W), score: best.score)
    }

    struct Tuning { var mode: String; var cents: Double; var note: String?; var confidence: Double }

    /// Afinación respecto a La = 440 Hz. Una nota sola se mide con su tono; un acorde, con sus picos graves.
    nonisolated static func estimateTuning(_ x: [Float], rate: Int) -> Tuning? {
        guard x.count >= Int(Double(rate) * 0.3) else { return nil }
        let tp = Fx404.trackPitch(x, rate, fmin: 40, fmax: 1000), voiced = tp.f0.filter { $0 > 0 }.sorted()
        if voiced.count >= max(5, Int(Double(tp.f0.count) * 0.5)) {
            let f = voiced[voiced.count / 2], m = midiOf(f), r = Int(m.rounded())
            return Tuning(mode: "nota", cents: (m - Double(r)) * 100, note: noteName(r), confidence: min(1, Double(voiced.count) / Double(tp.f0.count) + 0.2))
        }
        let N = 16384
        guard x.count >= N else { return nil }
        var mag = [Double](repeating: 0, count: N / 2)
        let frames = min(6, x.count / N), win = (0..<N).map { 0.5 - 0.5 * cos(2 * Double.pi * Double($0) / Double(N - 1)) }
        var re = [Double](repeating: 0, count: N), im = [Double](repeating: 0, count: N)
        for f in 0..<frames {
            let o = Int(Double(x.count - N) * (frames == 1 ? 0 : Double(f) / Double(frames - 1)))
            for i in 0..<N { re[i] = Double(x[o + i]) * win[i]; im[i] = 0 }
            NoiseReduction.fft(&re, &im, inverse: false)
            for k in 0..<(N / 2) { mag[k] += (re[k] * re[k] + im[k] * im[k]).squareRoot() }
        }
        let lo = Int((55 * Double(N) / Double(rate)).rounded()), hi = Int((1200 * Double(N) / Double(rate)).rounded())
        var mx = 0.0
        for k in lo...hi where mag[k] > mx { mx = mag[k] }
        var peaks: [(f: Double, w: Double)] = []
        for k in (lo + 1)..<hi where mag[k] > mx * 0.1 && mag[k] >= mag[k - 1] && mag[k] > mag[k + 1] {
            let a = log(mag[k - 1] + 1e-12), b = log(mag[k] + 1e-12), c = log(mag[k + 1] + 1e-12), d = a - 2 * b + c
            let off = abs(d) > 1e-12 ? 0.5 * (a - c) / d : 0
            peaks.append(((Double(k) + off) * Double(rate) / Double(N), mag[k]))
        }
        let top = Array(peaks.sorted { $0.w > $1.w }.prefix(6))
        guard top.count >= 2 else { return nil }
        var sx = 0.0, sy = 0.0, sw = 0.0
        for p in top { let m = midiOf(p.f), ang = (m - m.rounded()) * 2 * Double.pi; sx += p.w * cos(ang); sy += p.w * sin(ang); sw += p.w }
        return Tuning(mode: "acorde", cents: atan2(sy, sx) / (2 * Double.pi) * 100, note: nil, confidence: (sx * sx + sy * sy).squareRoot() / sw)
    }

    /// Corrige la afinación cambiando la velocidad de lectura (el largo cambia una fracción de %).
    nonisolated static func applyTuning(_ x: [Float], cents: Double) -> [Float] {
        abs(cents) < 0.5 ? x : WavIO.resample(x, from: 1_000_000, to: Int((1_000_000 * pow(2, cents / 1200)).rounded()))
    }

    struct Analysis { var sec: Double; var levelDB: Double; var noiseDB: Double; var feat: StyleMemory.Features?; var bpm: (bpm: Double, confidence: Double)?; var tuning: Tuning? }

    /// Lo que se sabe del sonido antes de elegir receta.
    nonisolated static func analyze(_ x: [Float], rate: Int) -> Analysis {
        Analysis(sec: Double(x.count) / Double(rate), levelDB: Level.levelDB(x, rate: rate), noiseDB: x.count > rate / 3 ? Double(NoiseReduction.noiseFloorDB(x, rate: rate)) : -120,
                 feat: StyleMemory.features(x, rate: rate), bpm: x.count > rate * 2 ? Editing.estimateBPM(x, rate: rate) : nil, tuning: estimateTuning(x, rate: rate))
    }

    // MARK: recetas
    struct Outcome {
        var audio: [Float]; var rate: Int; var notes: [String]; var name: String; var kind: String; var goal: String
        var bpm: Double?; var note: String?; var openChop: Bool; var source: String?; var process: [String]
    }
    private nonisolated static func r1(_ v: Double) -> String { (String(format: "%.1f", v)).replacingOccurrences(of: ".", with: ",") }
    private nonisolated static func slice(_ x: [Float], _ a: Int, _ b: Int) -> [Float] { let s = max(0, a), e = max(s, min(x.count, b)); return Array(x[s..<e]) }
    private nonisolated static func leveled(_ x: [Float], _ rate: Int, _ notes: inout [String]) -> [Float] {
        let r = Level.levelTo(x, rate: rate); notes.append("Volumen nivelado (\(Int(r.beforeDB.rounded())) → \(Int(r.afterDB.rounded())) dB)"); return r.audio
    }
    private nonisolated static func tune(_ x: [Float], _ t: Tuning?, _ notes: inout [String]) -> [Float] {
        guard let t, abs(t.cents) >= 8, t.confidence >= 0.5 else { return x }
        notes.append("Afinado: \(t.cents > 0 ? "+" : "−")\(Int(abs(t.cents).rounded())) centésimas corregidas")
        return applyTuning(x, cents: t.cents)
    }
    private nonisolated static func denoiseIfNoisy(_ x: [Float], _ rate: Int, _ a: Analysis, _ notes: inout [String]) -> [Float] {
        if a.noiseDB - a.levelDB > -38 && a.noiseDB > -75 { notes.append("Ruido reducido (suave)"); return NoiseReduction.clean(x, rate: rate, level: .soft) }
        return x
    }
    /// Recorta desde justo antes del ataque hasta el final audible (con un tope).
    private nonisolated static func oneShot(_ x: [Float], _ rate: Int, _ a: Analysis, lead: Double = 8, tail: Double = 80, maxSec: Double = 4) -> [Float] {
        guard let f = a.feat else { return x }
        let s = max(0, Int((f.onsetMs - lead) / 1000 * Double(rate))), e = min(x.count, s + Int(maxSec * Double(rate)), Int((f.endMs + tail) / 1000 * Double(rate)))
        return slice(x, Editing.nearestZeroCross(x, to: s, window: 256), e)
    }

    nonisolated static func run(goal id: String, _ x: [Float], rate: Int, source: String? = nil, base: String = "grabación", analysis: Analysis? = nil) -> Outcome {
        let g = goals.first { $0.id == id } ?? goals[0], a = analysis ?? analyze(x, rate: rate)
        var notes: [String] = []
        let ms = { (v: Double) in Int(v * Double(rate)) }
        var y = x
        switch id {
        case "pad":
            y = denoiseIfNoisy(y, rate, a, &notes)
            let total = Double(y.count) / Double(rate), sec = total >= 3 ? 3 : total, w = stableWindow(y, rate: rate, sec: sec), seg = slice(y, w.a, w.b)
            notes.append("Tramo más parejo: de \(r1(Double(w.a) / Double(rate))) a \(r1(Double(w.b) / Double(rate))) s")
            let segSec = Double(seg.count) / Double(rate), f: Double = segSec >= 3 ? 2 : (segSec * 2 >= 4 ? 2 : (segSec * 4 >= 4 ? 4 : 8))
            var z = Creative.padStretch(seg, factor: f, rate: rate, sustain: true); notes.append("Colchón ×\(Int(f)): se difumina en un sonido continuo")
            let cross = min(1.5, Double(z.count) / Double(rate) / 4)
            z = Creative.loopSeamless(z, from: 0, to: z.count, rate: rate, crossSec: cross, refine: true); notes.append("Loop sin clics (empalme de \(r1(cross)) s, sin fundidos para que el loop no se corte)")
            y = Harmonize.removeDC(leveled(z, rate, &notes))
        case "ambiente":
            y = denoiseIfNoisy(y, rate, a, &notes)
            let sec = min(6, Double(y.count) / Double(rate)), w = stableWindow(y, rate: rate, sec: sec), seg = slice(y, w.a, w.b)
            notes.append("Tramo más parejo: de \(r1(Double(w.a) / Double(rate))) a \(r1(Double(w.b) / Double(rate))) s")
            let cross = min(2, Double(seg.count) / Double(rate) / 3)
            let z = Creative.loopSeamless(seg, from: 0, to: seg.count, rate: rate, crossSec: cross, refine: true); notes.append("Loop sin clics (empalme de \(r1(cross)) s)")
            y = Harmonize.removeDC(leveled(z, rate, &notes))
        case "loopRitmico":
            y = Editing.trimSilence(y, thresholdDB: -45, pad: ms(0.01)); notes.append("Silencios de los bordes recortados")
            if let b = a.bpm, b.confidence > 0.2 { notes.append("Tempo ≈ \(Int(b.bpm.rounded())) BPM (confianza \(Int((b.confidence * 100).rounded())) %)") }
            else { notes.append("No encontré un pulso claro: en Chop podrás cortar por golpes") }
            y = Harmonize.removeDC(leveled(y, rate, &notes))
        case "golpe":
            y = oneShot(y, rate, a, lead: 3, tail: 40, maxSec: 2); notes.append("Recortado desde el ataque hasta que la caída se apaga")
            y = Harmonize.cosFade(NoiseReduction.highpass(y, rate: rate, hz: 30), inSamples: 0, outSamples: ms(0.012)); notes.append("Rumble bajo 30 Hz fuera y fundido de salida de 12 ms")
            y = Harmonize.removeDC(leveled(y, rate, &notes))
        case "acorde":
            y = denoiseIfNoisy(y, rate, a, &notes)
            y = oneShot(y, rate, a, lead: 10, tail: 120, maxSec: 5); notes.append("Recortado desde justo antes del ataque hasta el final audible")
            y = tune(y, a.tuning, &notes); y = NoiseReduction.highpass(y, rate: rate, hz: 50); notes.append("Rumble bajo 50 Hz fuera")
            y = Harmonize.cosFade(y, inSamples: 0, outSamples: ms(0.25)); notes.append("Fundido de salida de 250 ms: el final muere solo")
            y = Harmonize.removeDC(leveled(y, rate, &notes))
        case "bajo":
            y = denoiseIfNoisy(y, rate, a, &notes)
            y = oneShot(y, rate, a, lead: 5, tail: 60, maxSec: 3); notes.append("Recortado desde el ataque hasta el final audible")
            y = tune(y, a.tuning, &notes); y = NoiseReduction.highpass(y, rate: rate, hz: 28); notes.append("Rumble bajo 28 Hz fuera")
            y = Harmonize.cosFade(y, inSamples: 0, outSamples: ms(0.08)); notes.append("Fundido de salida de 80 ms")
            y = Harmonize.removeDC(leveled(y, rate, &notes))
        case "nota":
            y = denoiseIfNoisy(y, rate, a, &notes)
            y = oneShot(y, rate, a, lead: 8, tail: 100, maxSec: 4); notes.append("Recortada desde el ataque hasta el final audible")
            y = tune(y, a.tuning, &notes); y = Harmonize.cosFade(y, inSamples: 0, outSamples: ms(0.12)); notes.append("Fundido de salida de 120 ms")
            y = Harmonize.removeDC(leveled(y, rate, &notes))
        case "frase":
            y = denoiseIfNoisy(y, rate, a, &notes)
            y = Editing.trimSilence(y, thresholdDB: -42, pad: ms(0.04)); notes.append("Silencios de los bordes recortados (deja 40 ms de aire)")
            y = Harmonize.cosFade(NoiseReduction.highpass(y, rate: rate, hz: 80), inSamples: ms(0.01), outSamples: ms(0.04)); notes.append("Graves bajo 80 Hz fuera; fundidos de 10 ms y 40 ms")
            y = Harmonize.removeDC(leveled(y, rate, &notes))
        default:   // limpiar
            y = NoiseReduction.clean(y, rate: rate, level: .soft); notes.append("Ruido reducido (suave)")
            y = Editing.trimSilence(y, thresholdDB: -48, pad: ms(0.02)); notes.append("Silencios de los bordes recortados")
            y = Harmonize.cosFade(y, inSamples: ms(0.01), outSamples: ms(0.06)); notes.append("Fundidos de 10 ms y 60 ms")
            y = Harmonize.removeDC(leveled(y, rate, &notes))
        }
        let src = sources.first { $0.id == source }, tun = a.tuning
        let name: String
        if (id == "bajo" || id == "nota"), let n = tun?.note { name = (base + " · " + n + (id == "bajo" ? " bajo" : "")).trimmingCharacters(in: .whitespaces) }
        else { name = base + " · " + g.label.lowercased() }
        return Outcome(audio: y, rate: rate, notes: notes, name: name, kind: g.kind, goal: id, bpm: a.bpm.flatMap { $0.confidence > 0.2 ? $0.bpm : nil }, note: tun?.note, openChop: id == "loopRitmico",
                      source: src?.id, process: ["Pistorius: \(g.label)" + (src.map { " · " + $0.label.lowercased() } ?? "")] + notes)
    }

    // MARK: guía de corte y chop
    /// Reglas basadas en la literatura de sampling compartida: Martin Russ (empezar el sonido en el ataque, cortes en cruces por cero, loops sólo en la parte sostenida
    /// y con crossfade), Avery Wang (picos del espectrograma: aguantan el ruido; periodo de repetición) y lo reunido sobre Daft Punk (trozos cortos y tartamudeados).
    nonisolated static let refRuss = "Russ: el sonido debe empezar en el ataque, sin silencio antes; los cortes van en cruces por cero y los loops sólo en la parte sostenida, con crossfade"
    nonisolated static let refWang = "Wang (Shazam): los picos del espectrograma aguantan el ruido, y el periodo de repetición sale del histograma de desfases"
    nonisolated static let refDaft = "Daft Punk: trozos cortos y tartamudeados, repetidos en loop, a veces con una variación al final"

    struct Advice {
        var action = "cortar"          // cortar, chop o loop
        var chopMode: Int?             // 0 golpes, -2 notas, 8 partes iguales
        var title = ""
        var why: [String] = []
        var refs: [String] = []
        var markers: [Double] = []
        var facts: [String] = []
        var hits = 0, notes = 0
        var periodo: Double?
    }
    private nonisolated static func secs(_ n: Double) -> String { (String(format: "%.1f", n) + " s").replacingOccurrences(of: ".", with: ",") }

    /// Cuenta golpes y cambios de nota, busca repetición y propone: cortar un fragmento, chopear (por golpes, notas o partes) o hacer loop por el periodo detectado.
    nonisolated static func advise(_ x: [Float], rate: Int, _ a: Analysis, goal: String) -> Advice {
        let w30 = Int(Double(rate) * 0.03)
        func seg(_ i: Int, _ j: Int) -> Double {
            var q = 0.0, n = 0
            var k = max(0, i)
            while k < min(x.count, j) { q += Double(x[k] * x[k]); n += 1; k += 1 }
            return (q / Double(max(1, n))).squareRoot()
        }
        let hits = Editing.transients(x, sensitivity: 0.5, minGapSamples: rate / 10, maxCount: 11).filter { seg($0, $0 + w30) > 2 * seg($0 - w30, $0) + 1e-5 }
        let notes = Constellation.noteChanges(x, rate: rate, sensitivity: 0.5)
        let rep = Constellation.repetition(x, rate: rate, minSec: 0.4, maxSec: min(20, Double(x.count) / Double(rate) * 0.6)).first { $0.z >= 8 }
        let bpmOk = (a.bpm?.confidence ?? 0) > 0.2, total = Double(x.count) / Double(rate), n = Double(x.count)
        var out = Advice()
        out.facts = [hits.isEmpty ? "sin golpes marcados" : "\(hits.count + 1) golpes", "\(notes.count) cambio\(notes.count == 1 ? "" : "s") de nota"]
        if bpmOk, let b = a.bpm { out.facts.append("tempo ≈ \(Int(b.bpm.rounded())) BPM") }
        if let r = rep { out.facts.append("se repite cada \(secs(r.sec))") }
        out.hits = hits.count; out.notes = notes.count; out.periodo = rep?.sec
        func region() -> [Double] {
            guard let f = a.feat else { return [] }
            return [max(0, f.onsetMs / 1000 * Double(rate)) / n, min(n, f.endMs / 1000 * Double(rate)) / n]
        }
        let several = hits.count >= 3 || notes.count >= 2
        switch goal {
        case "golpe":
            out.title = "Un solo corte: del ataque al final de la caída"; out.markers = region()
            out.why.append(several ? "Hay \(hits.count + 1) golpes en la toma: me quedo con el primero. Si quieres todos, elige Chopear." : "Un golpe suelto no necesita chop: un corte desde justo antes del ataque hasta que la caída se apaga.")
            out.refs.append(refRuss)
        case "loopRitmico":
            if several || bpmOk {
                out.action = "chop"; out.chopMode = hits.count >= 3 ? 0 : 8; out.title = hits.count >= 3 ? "Chopear por golpes" : "Chopear en partes iguales"; out.markers = hits.map { Double($0) / n }
                out.why.append("Para armar un loop rítmico conviene tener cada golpe por separado" + (bpmOk ? ", y ya tengo el tempo para ajustarlos a la cuadrícula" : "") + "."); out.refs.append(refDaft)
            } else {
                out.title = "Recortar y probar en Chop"; out.markers = region(); out.why.append("No encuentro golpes ni tempo claros: recorto los bordes y en Chop pruebas cortes iguales."); out.refs.append(refRuss)
            }
        case "acorde", "bajo", "nota":
            if notes.count >= 2 || hits.count >= 3 {
                out.action = "chop"; out.chopMode = notes.count >= 2 ? -2 : 0; out.title = notes.count >= 2 ? "Chopear por cambio de nota" : "Chopear por golpes"
                out.markers = (notes.count >= 2 ? notes : hits).map { Double($0) / n }
                out.why.append(goal == "nota" || goal == "bajo" ? "Hay varias notas en la toma. Cada nota en su propio sample se toca mejor en el teclado." : "Hay más de un acorde en la toma: un corte por acorde, y los eliges después.")
                out.refs.append(contentsOf: [refWang, refRuss])
            } else {
                out.title = "Un solo corte: del ataque al final audible"; out.markers = region(); out.why.append("Es una sola nota o un solo acorde: se corta en el ataque y se deja morir la cola."); out.refs.append(refRuss)
            }
        case "pad", "ambiente":
            if let r = rep {
                out.action = "loop"; out.title = "Loop de \(secs(r.sec)): el periodo en que se repite"
                out.why.append("El sonido se repite cada \(secs(r.sec)): un loop de ese largo empalma casi sin que se note."); out.refs.append(contentsOf: [refWang, refRuss])
            } else {
                let w = stableWindow(x, rate: rate, sec: min(goal == "pad" ? 3 : 6, total))
                out.title = "Un corte del tramo más parejo, sin chop"; out.markers = [Double(w.a) / n, Double(w.b) / n]
                out.why.append("Una textura no se chopea: se toma el tramo más estable (sin golpes ni cambios) y se hace loop con crossfade."); out.refs.append(refRuss)
            }
        case "frase":
            if total > 6 && hits.count >= 3 {
                out.action = "chop"; out.chopMode = 0; out.title = "Chopear por sílabas o palabras"; out.markers = hits.map { Double($0) / n }
                out.why.append("La toma es larga y tiene varios golpes de voz: un corte por palabra te deja frases cortas para usar."); out.refs.append(refDaft)
            } else {
                out.title = "Un corte de la frase, con bordes suaves"; out.markers = [0, 1]; out.why.append("Una frase corta se deja entera: se recortan los silencios y se suavizan los bordes."); out.refs.append(refRuss)
            }
        default:
            out.title = "Solo limpiar, sin cortar"; out.why.append("Quito ruido y silencios y dejo los fundidos; el corte lo decides tú después."); out.refs.append(refRuss)
        }
        return out
    }
}

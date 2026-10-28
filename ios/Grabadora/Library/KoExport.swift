import Foundation

/// Exportación por lotes para el K.O. II: WAV mono de 16 bit, pico a −1 dBFS, silencio inicial fuera, fundidos cortos y nombres seguros.
enum KoExport {
    /// 46 875 Hz es la frecuencia que se cree nativa del K.O. II (por confirmar con el aparato); 44,1 kHz es la alternativa segura.
    nonisolated static let rates = [46_875, 44_100]
    nonisolated static let longFadeMs = 200.0
    nonisolated static let nameMax = 16

    struct Options: Codable, Equatable {
        var rate = 46_875
        var thresholdDB = -48.0
        var fadeInMs = 10.0
        var fadeOutMs = 30.0
        var longFade = false
        var hp = false
        var even = false             // nivel parejo en vez de pico

        static func load() -> Options {
            guard let d = UserDefaults.standard.data(forKey: "koExport"), let o = try? JSONDecoder().decode(Options.self, from: d) else { return Options() }
            return o.clamped
        }
        func save() { if let d = try? JSONEncoder().encode(self) { UserDefaults.standard.set(d, forKey: "koExport") } }
        var clamped: Options {
            var o = self
            if !KoExport.rates.contains(o.rate) { o.rate = KoExport.rates[0] }
            o.thresholdDB = max(-80, min(-20, o.thresholdDB)); o.fadeInMs = max(0, min(100, o.fadeInMs)); o.fadeOutMs = max(0, min(500, o.fadeOutMs))
            return o
        }
    }

    /// Procesa un sonido para el aparato.
    nonisolated static func process(_ x: [Float], rate: Int, _ opts: Options) -> (audio: [Float], rate: Int, silent: Bool) {
        let o = opts.clamped
        var y = x
        if o.hp { y = PadLab.biquad(y, rate: rate, hz: 90, highpass: true) }       // suave: 12 dB por octava
        let th = Float(pow(10.0, o.thresholdDB / 20))
        var a = 0
        while a < y.count && abs(y[a]) <= th { a += 1 }                            // sólo se recorta el silencio del inicio
        let silent = a >= y.count
        if !silent && a > 0 { y = Array(y[a...]) }
        y = WavIO.resample(y, from: rate, to: o.rate)
        y = o.even ? Level.levelTo(y, rate: o.rate).audio : Editing.normalize(y, peak: Float(pow(10.0, -1.0 / 20)))
        let outMs = o.longFade ? max(o.fadeOutMs, longFadeMs) : o.fadeOutMs
        y = Harmonize.cosFade(y, inSamples: Int(o.fadeInMs / 1000 * Double(o.rate)), outSamples: Int(outMs / 1000 * Double(o.rate)))
        return (y, o.rate, silent)
    }

    /// Texto seguro para el aparato: sin tildes, espacios ni símbolos; minúsculas.
    nonisolated static func slug(_ t: String, max m: Int = nameMax) -> String {
        let folded = t.folding(options: .diacriticInsensitive, locale: nil).lowercased()
        let mapped = String(folded.unicodeScalars.map { ($0.isASCII && CharacterSet.alphanumerics.contains($0)) ? Character($0) : "_" })
        let parts = mapped.split(separator: "_", omittingEmptySubsequences: true).joined(separator: "_")
        var s = String(parts.prefix(m))
        while s.hasSuffix("_") { s.removeLast() }
        return s.isEmpty ? "sonido" : s
    }
    /// «C#m» → «Csm»; vacío si no hay nada utilizable.
    nonisolated static func keyTag(_ k: String?) -> String {
        guard let k = k else { return "" }
        let s = k.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "s")
        return String(String(s.unicodeScalars.filter { $0.isASCII && CharacterSet.alphanumerics.contains($0) }.map { Character($0) }).prefix(5))
    }
    nonisolated static func bpmTag(_ b: Double?) -> String {
        guard let b = b, b >= 30, b <= 300 else { return "" }
        return "\(Int(b.rounded()))bpm"
    }

    /// NNN_nombre[_tonalidad][_NNNbpm].wav
    nonisolated static func fileName(_ s: Sample, number n: Int) -> String {
        let base = slug(s.name), key = keyTag(s.key), bpm = bpmTag(s.bpm)
        var tags: [String] = []
        if !key.isEmpty && !base.hasSuffix("_" + key.lowercased()) { tags.append(key) }
        if !bpm.isEmpty { tags.append(bpm) }
        return String(format: "%03d_", n) + ([base] + tags).joined(separator: "_") + ".wav"
    }

    nonisolated static func plan(_ samples: [Sample], start: Int = 1) -> [(sample: Sample, file: String)] {
        samples.enumerated().map { ($1, fileName($1, number: start + $0)) }
    }

    /// Arma los archivos del .zip (más `lista.txt` con el origen de cada uno). Los vacíos o en silencio se omiten sin dejar huecos.
    nonisolated static func build(_ samples: [Sample], audio: (Sample) -> [Float], opts: Options, start: Int = 1) -> (entries: [Zip.Entry], skipped: [String]) {
        var entries: [Zip.Entry] = [], skipped: [String] = []
        var lines = ["Lista de exportación · Archivo ← sonido | origen y datos", ""]
        for s in samples {
            let x = audio(s)
            if x.isEmpty { skipped.append(s.name + " (sin audio)"); continue }
            let r = process(x, rate: s.sampleRate, opts)
            if r.silent { skipped.append(s.name + " (silencio)"); continue }
            let file = fileName(s, number: start + entries.count)
            entries.append(Zip.Entry(name: file, data: WavIO.encode(r.audio, sampleRate: r.rate)))
            var extra = [s.origin.isEmpty ? "origen: (sin anotar)" : "origen: " + s.origin]
            if s.replaced { extra.append("reemplazado por versión propia") }
            if let k = s.key, !k.isEmpty { extra.append("tonalidad: " + k) }
            if let b = s.bpm { extra.append("BPM: \(Int(b.rounded()))") }
            if !s.process.isEmpty { extra.append("procesos: " + s.process.joined(separator: " → ")) }
            lines.append("\(file) ← \(s.name) | " + extra.joined(separator: " | "))
        }
        if !entries.isEmpty { entries.append(Zip.Entry(name: "lista.txt", data: Data((lines.joined(separator: "\n") + "\n").utf8))) }
        return (entries, skipped)
    }
}

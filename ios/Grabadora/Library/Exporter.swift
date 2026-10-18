import Foundation

/// Interruptores de funciones.
enum Features {
    /// Exportar con el formato del K.O. II (slot, 46 875 Hz, memoria) está en pausa: por ahora todos comparten WAV normales (correo, Bluetooth, Drive).
    static let koExport = false
}

enum Exporter {
    /// Nombre del archivo: con el formato K.O. II, por slot ("007_nombre.wav", convención por confirmar); si no, el nombre sin tildes ni símbolos.
    static func fileName(for s: Sample, ko: Bool = Features.koExport) -> String {
        let folded = s.name.folding(options: .diacriticInsensitive, locale: nil)
        let clean = String(folded.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? Character($0) : "_" })
        if ko {
            let slot = s.slot.map { String(format: "%03d_", $0) } ?? ""
            return slot + clean.prefix(24) + ".wav"
        }
        let trimmed = clean.split(separator: "_", omittingEmptySubsequences: true).joined(separator: "_")
        return (trimmed.isEmpty ? "sonido" : String(trimmed.prefix(60))) + ".wav"
    }

    /// Renderiza efectos, remuestrea al objetivo y escribe un WAV mono 16-bit en la carpeta temporal.
    static func export(_ s: Sample, audio: [Float], targetRate: Int? = nil, into dir: URL = FileManager.default.temporaryDirectory, unique: Bool = false) throws -> URL {
        let wet = try EffectRenderer.render(audio, sampleRate: s.sampleRate, params: s.effects)
        let rate = targetRate ?? (Features.koExport ? 46_875 : s.sampleRate)
        let out = WavIO.resample(wet, from: s.sampleRate, to: rate)
        let url = unique ? uniqueURL(dir.appendingPathComponent(fileName(for: s))) : dir.appendingPathComponent(fileName(for: s))
        try WavIO.encode(out, sampleRate: rate).write(to: url, options: .atomic)
        return url
    }

    /// Exporta un kit (varios samples) para compartir por AirDrop o Archivos.
    static func exportKit(_ samples: [Sample], targetRate: Int? = nil, store: @MainActor (Sample) -> [Float]) async throws -> [URL] {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Kit-\(Int(Date().timeIntervalSince1970))")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var urls: [URL] = []
        for s in samples {
            let url = try export(s, audio: await store(s), targetRate: targetRate ?? s.sampleRate, into: dir, unique: true)
            urls.append(url)
        }
        return urls
    }

    /// Si ya hay un archivo con ese nombre en la carpeta (dos sonidos que se llaman igual), añade _2, _3…
    private static func uniqueURL(_ url: URL) -> URL {
        let fm = FileManager.default
        guard fm.fileExists(atPath: url.path) else { return url }
        let base = url.deletingPathExtension().lastPathComponent, dir = url.deletingLastPathComponent()
        var n = 2
        while fm.fileExists(atPath: dir.appendingPathComponent("\(base)_\(n).wav").path) { n += 1 }
        return dir.appendingPathComponent("\(base)_\(n).wav")
    }
}

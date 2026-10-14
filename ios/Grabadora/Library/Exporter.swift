import Foundation

enum Exporter {
    /// Nombre por slot al estilo K.O. II: "007_nombre.wav" (convención por confirmar).
    static func fileName(for s: Sample) -> String {
        let clean = s.name.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? Character($0) : "_" }
        let slot = s.slot.map { String(format: "%03d_", $0) } ?? ""
        return slot + String(clean).prefix(24) + ".wav"
    }

    /// Renderiza efectos, remuestrea al objetivo y escribe un WAV mono 16-bit en la carpeta temporal.
    static func export(_ s: Sample, audio: [Float], targetRate: Int = 46_875, into dir: URL = FileManager.default.temporaryDirectory) throws -> URL {
        let wet = try EffectRenderer.render(audio, sampleRate: s.sampleRate, params: s.effects)
        let out = WavIO.resample(wet, from: s.sampleRate, to: targetRate)
        let url = dir.appendingPathComponent(fileName(for: s))
        try WavIO.encode(out, sampleRate: targetRate).write(to: url, options: .atomic)
        return url
    }

    /// Exporta un kit (varios samples) para compartir por AirDrop o Archivos.
    static func exportKit(_ samples: [Sample], store: @MainActor (Sample) -> [Float]) async throws -> [URL] {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Kit-\(Int(Date().timeIntervalSince1970))")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var urls: [URL] = []
        for s in samples { urls.append(try export(s, audio: await store(s), into: dir)) }
        return urls
    }
}

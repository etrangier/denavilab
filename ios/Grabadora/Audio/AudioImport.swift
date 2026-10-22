import AVFoundation

/// Importar sonidos de fuera (Archivos, Drive…): WAV, MP3, M4A, AIFF, FLAC… Se mezclan a mono y se conserva su frecuencia.
enum AudioImport {
    nonisolated static let maxSeconds = 300.0

    struct Item: Sendable { var name: String; var samples: [Float]; var rate: Int }
    enum Failure: Error { case tooLong, empty, unreadable }

    /// Nombre del sonido a partir del nombre del archivo (sin extensión, sin guiones bajos de más). Igual que `baseName` en la PWA.
    nonisolated static func baseName(_ fileName: String) -> String {
        var n = fileName
        if let dot = n.lastIndex(of: "."), dot != n.startIndex, !n[n.index(after: dot)...].contains("/") { n = String(n[..<dot]) }
        else if n.hasPrefix(".") { n = "" }
        let t = n.replacingOccurrences(of: "_", with: " ").split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
        return t.isEmpty ? "Sonido importado" : t
    }

    /// Lee un archivo de audio y lo devuelve en mono. Falla si no se entiende, está vacío o dura más de `maxSeconds`.
    nonisolated static func read(_ url: URL) throws -> Item {
        let file: AVAudioFile
        do { file = try AVAudioFile(forReading: url) } catch { throw Failure.unreadable }
        let fmt = file.processingFormat, frames = AVAudioFrameCount(max(0, file.length))
        guard frames > 0 else { throw Failure.empty }
        guard Double(frames) / fmt.sampleRate <= maxSeconds else { throw Failure.tooLong }
        guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: frames) else { throw Failure.unreadable }
        do { try file.read(into: buf) } catch { throw Failure.unreadable }
        guard let ch = buf.floatChannelData else { throw Failure.unreadable }
        let n = Int(buf.frameLength), c = Int(fmt.channelCount)
        guard n > 0, c > 0 else { throw Failure.empty }
        var out = [Float](repeating: 0, count: n)
        for k in 0..<c { let p = ch[k]; for i in 0..<n { out[i] += p[i] } }
        if c > 1 { let inv = 1 / Float(c); for i in 0..<n { out[i] *= inv } }
        return Item(name: baseName(url.lastPathComponent), samples: out, rate: Int(fmt.sampleRate.rounded()))
    }
}

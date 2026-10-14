import Foundation
import AVFoundation
import SoundAnalysis

struct Score: Sendable, Equatable {
    let label: String
    let confidence: Double
}

struct Suggestion: Equatable {
    let folder: String
    let sub: String?
    let confidence: Double
    let label: String
    var title: String { sub.map { "\(folder) › \($0)" } ?? folder }
}

/// Traduce las etiquetas del clasificador del sistema a carpetas de la app. Lógica pura.
enum FolderMapper {
    static let minimumConfidence = 0.30

    /// (palabras clave dentro de la etiqueta, carpeta, subcarpeta). Gana la primera regla que encaje.
    private static let rules: [(keys: [String], folder: String, sub: String?)] = [
        (["humming"], "Voz", "Tarareo"),
        (["singing", "choir", "yodel"], "Voz", "Canto"),
        (["speech", "conversation", "narration", "whisper", "talking"], "Voz", "Habla"),
        (["applause", "laughter", "cheer", "explosion", "gunshot", "boom"], "Cine y TV", "Efectos"),
        (["wind", "breeze"], "Naturaleza", "Viento"),
        (["rain", "thunder", "storm"], "Naturaleza", "Lluvia"),
        (["ocean", "wave", "water", "stream", "river", "sea", "waterfall", "splash"], "Naturaleza", "Mar y agua"),
        (["bird", "dog", "cat", "insect", "cricket", "frog", "rooster", "cow", "owl", "chirp", "crow", "animal", "bark", "meow"], "Naturaleza", "Animales"),
        (["forest", "leaves", "rustl"], "Naturaleza", "Bosque"),
        (["fire", "crackl"], "Naturaleza", "Otro"),
        (["car", "traffic", "siren", "horn", "vehicle", "truck", "motorcycle", "train", "bus", "street", "footstep"], "Ciudad y objetos", "Calle"),
        (["engine", "machine", "drill", "saw", "vacuum", "motor", "hammer", "tool"], "Ciudad y objetos", "Máquinas"),
        (["door", "knock", "dishes", "cutlery", "microwave", "keyboard", "typing", "clock", "faucet", "toilet", "shower", "blender", "appliance"], "Ciudad y objetos", "Hogar"),
        (["electronic", "synth", "techno"], "Música", "Electrónica"),
        (["hip_hop", "hiphop", "rap"], "Música", "Hip hop"),
        (["soul", "gospel", "blues"], "Música", "Soul"),
        (["ambient"], "Música", "Ambient"),
        (["music", "guitar", "piano", "drum", "bass", "violin", "trumpet", "saxophone", "organ", "percussion", "instrument", "beat"], "Música", nil),
    ]

    static func suggest(from scores: [Score]) -> Suggestion? {
        var best: Suggestion?
        for s in scores where s.confidence >= minimumConfidence {
            let label = s.label.lowercased()
            guard let rule = rules.first(where: { r in r.keys.contains { label.contains($0) } }) else { continue }
            if best == nil || s.confidence > best!.confidence {
                best = Suggestion(folder: rule.folder, sub: rule.sub, confidence: s.confidence, label: s.label)
            }
        }
        return best
    }
}

/// Clasificador de sonidos del sistema (SoundAnalysis, en el dispositivo).
enum SoundClassifier {
    private final class Collector: NSObject, SNResultsObserving {
        private let lock = NSLock()
        private var best: [String: Double] = [:]

        func request(_ request: SNRequest, didProduce result: SNResult) {
            guard let r = result as? SNClassificationResult else { return }
            lock.lock(); defer { lock.unlock() }
            for c in r.classifications { best[c.identifier] = max(best[c.identifier] ?? 0, c.confidence) }
        }
        func request(_ request: SNRequest, didFailWithError error: Error) {}
        func requestDidComplete(_ request: SNRequest) {}

        var scores: [Score] {
            lock.lock(); defer { lock.unlock() }
            return best.map { Score(label: $0.key, confidence: $0.value) }
        }
    }

    /// Mejor confianza por etiqueta en los primeros 30 s. Vacío si no se puede clasificar.
    static func classify(_ audio: [Float], rate: Int) async -> [Score] {
        await Task.detached(priority: .userInitiated) { () -> [Score] in
            guard !audio.isEmpty,
                  let format = AVAudioFormat(standardFormatWithSampleRate: Double(rate), channels: 1),
                  let request = try? SNClassifySoundRequest(classifierIdentifier: .version1) else { return [] }
            let analyzer = SNAudioStreamAnalyzer(format: format)
            let collector = Collector()
            do { try analyzer.add(request, withObserver: collector) } catch { return [] }
            let samples = Array(audio.prefix(rate * 30))
            let chunk = 8_192
            var pos = 0
            while pos < samples.count {
                let n = min(chunk, samples.count - pos)
                guard let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(n)) else { break }
                buf.frameLength = AVAudioFrameCount(n)
                samples.withUnsafeBufferPointer { src in
                    buf.floatChannelData![0].update(from: src.baseAddress! + pos, count: n)
                }
                analyzer.analyze(buf, atAudioFramePosition: AVAudioFramePosition(pos))
                pos += n
            }
            analyzer.completeAnalysis()
            return collector.scores
        }.value
    }
}

import Foundation

struct Sample: Identifiable, Codable, Equatable {
    var id = UUID()
    var name: String
    var folder: String = "Sin carpeta"
    var tags: [String] = []
    var slot: Int?                    // 1...999 en el K.O. II (rango por confirmar)
    var sampleRate: Int
    var effects = EffectParams()
    var created = Date()
    var duration: Double = 0
    var fileName: String { "\(id.uuidString).wav" }
}

/// Biblioteca local: audio original en Documents/Samples + índice JSON (los efectos no tocan el original).
@MainActor
final class LibraryStore: ObservableObject {
    @Published private(set) var samples: [Sample] = []
    @Published var query = ""
    @Published var errorMessage: String?

    private let dir: URL
    private var indexURL: URL { dir.appendingPathComponent("index.json") }

    init(directory: URL? = nil) {
        dir = directory ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Samples", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let d = try? Data(contentsOf: indexURL),
           let s = try? JSONDecoder().decode([Sample].self, from: d) { samples = s }
    }

    var folders: [String] { Array(Set(samples.map(\.folder))).sorted() }

    var filtered: [Sample] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return samples }
        return samples.filter {
            $0.name.lowercased().contains(q) || $0.tags.contains { $0.lowercased().contains(q) }
        }
    }

    @discardableResult
    func add(name: String, audio: [Float], sampleRate: Int) -> Sample? {
        var s = Sample(name: name, sampleRate: sampleRate)
        s.duration = Double(audio.count) / Double(sampleRate)
        do {
            try WavIO.encode(audio, sampleRate: sampleRate).write(to: url(s), options: .atomic)
            samples.insert(s, at: 0); save()
            return s
        } catch {
            errorMessage = "No se pudo guardar (¿poco espacio en el dispositivo?)"
            return nil
        }
    }

    func audio(for s: Sample) -> [Float] {
        guard let d = try? Data(contentsOf: url(s)), let w = WavIO.decode(d) else { return [] }
        return w.samples
    }

    func replaceAudio(_ s: Sample, with audio: [Float]) {
        guard let i = samples.firstIndex(of: s) else { return }
        try? WavIO.encode(audio, sampleRate: s.sampleRate).write(to: url(s), options: .atomic)
        samples[i].duration = Double(audio.count) / Double(s.sampleRate)
        save()
    }

    func update(_ s: Sample) {
        guard let i = samples.firstIndex(where: { $0.id == s.id }) else { return }
        samples[i] = s; save()
    }

    func delete(_ s: Sample) {
        try? FileManager.default.removeItem(at: url(s))
        samples.removeAll { $0.id == s.id }; save()
    }

    func url(_ s: Sample) -> URL { dir.appendingPathComponent(s.fileName) }
    private func save() {
        do { try JSONEncoder().encode(samples).write(to: indexURL, options: .atomic) }
        catch { errorMessage = "No se pudo guardar el índice" }
    }
}

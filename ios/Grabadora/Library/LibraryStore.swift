import Foundation

struct FolderInfo: Sendable, Hashable {
    let name: String
    let subs: [String]
    var detail: String { subs.isEmpty ? "Por revisar" : subs.joined(separator: " · ") }
}

struct Sample: Identifiable, Codable, Equatable {
    var id = UUID()
    var name: String
    var folder: String = "Sin clasificar"
    var subfolder: String?
    var bpm: Double?
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
    nonisolated static let unsorted = "Sin clasificar"
    nonisolated static let folderInfo: [FolderInfo] = [
        FolderInfo(name: "Música", subs: ["Ambient", "Soul", "Hip hop", "Electrónica"]),
        FolderInfo(name: "Naturaleza", subs: ["Viento", "Mar y agua", "Lluvia", "Animales", "Bosque", "Otro"]),
        FolderInfo(name: "Cine y TV", subs: ["Diálogos", "Banda sonora", "Efectos"]),
        FolderInfo(name: "Voz", subs: ["Habla", "Canto", "Tarareo"]),
        FolderInfo(name: "Ciudad y objetos", subs: ["Calle", "Máquinas", "Hogar"]),
        FolderInfo(name: unsorted, subs: []),
    ]

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

    /// Carpeta efectiva: las que no están en la lista caen en «Sin clasificar».
    func folder(of s: Sample) -> String { Self.folderInfo.contains { $0.name == s.folder } ? s.folder : Self.unsorted }
    func samples(in folder: String) -> [Sample] { filtered.filter { self.folder(of: $0) == folder } }

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
        guard let i = samples.firstIndex(where: { $0.id == s.id }) else { return }
        try? WavIO.encode(audio, sampleRate: s.sampleRate).write(to: url(s), options: .atomic)
        samples[i].duration = Double(audio.count) / Double(s.sampleRate)
        save()
    }

    /// Nombres para un cambio de nombre: uno solo tal cual; varios, numerados («nombre 01», «nombre 02»…).
    nonisolated static func names(base: String, count: Int) -> [String] {
        guard count > 1 else { return count == 1 ? [base] : [] }
        let width = max(2, String(count).count)
        return (1...count).map { "\(base) \(String(format: "%0\(width)d", $0))" }
    }

    /// Cambia el nombre de las grabaciones elegidas (de la más antigua a la más reciente si son varias).
    func rename(ids: Set<UUID>, to base: String) {
        let name = base.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        let targets = samples.filter { ids.contains($0.id) }.sorted { $0.created < $1.created }
        for (t, n) in zip(targets, Self.names(base: name, count: targets.count)) {
            if let i = samples.firstIndex(where: { $0.id == t.id }) { samples[i].name = n }
        }
        save()
    }

    func move(ids: Set<UUID>, folder: String, sub: String?) {
        for i in samples.indices where ids.contains(samples[i].id) {
            samples[i].folder = folder; samples[i].subfolder = sub
        }
        save()
    }

    func delete(ids: Set<UUID>) {
        for s in samples where ids.contains(s.id) { try? FileManager.default.removeItem(at: url(s)) }
        samples.removeAll { ids.contains($0.id) }
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

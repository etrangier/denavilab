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
    var kind: String?                 // tipo de sonido al grabar: textura, bajo, bateria (nil = libre)
    var favorite = false
    var status = SampleStatus.crudo   // crudo → procesado → listo (para el K.O. II)
    var origin = ""                   // de dónde salió: artista, disco, minuto o «mi balcón»
    var replaced = false              // ya tengo una versión propia: no dependo de la fuente ajena
    var key: String?                  // nota o tonalidad aproximada (opcional)
    var comment = ""
    var process: [String] = []        // qué se le aplicó en el laboratorio de pads
    var fileName: String { "\(id.uuidString).wav" }

    enum CodingKeys: String, CodingKey {
        case id, name, folder, subfolder, bpm, tags, slot, sampleRate, effects, created, duration, kind
        case favorite, status, origin, replaced, key, comment, process
    }
}

extension Sample {
    /// Lee también los índices guardados antes de existir los campos nuevos: lo que falte toma su valor por defecto.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        name = try c.decode(String.self, forKey: .name)
        folder = try c.decodeIfPresent(String.self, forKey: .folder) ?? "Sin clasificar"
        subfolder = try c.decodeIfPresent(String.self, forKey: .subfolder)
        bpm = try c.decodeIfPresent(Double.self, forKey: .bpm)
        tags = try c.decodeIfPresent([String].self, forKey: .tags) ?? []
        slot = try c.decodeIfPresent(Int.self, forKey: .slot)
        sampleRate = try c.decode(Int.self, forKey: .sampleRate)
        effects = try c.decodeIfPresent(EffectParams.self, forKey: .effects) ?? EffectParams()
        created = try c.decodeIfPresent(Date.self, forKey: .created) ?? Date()
        duration = try c.decodeIfPresent(Double.self, forKey: .duration) ?? 0
        kind = try c.decodeIfPresent(String.self, forKey: .kind)
        favorite = try c.decodeIfPresent(Bool.self, forKey: .favorite) ?? false
        let st = try c.decodeIfPresent(String.self, forKey: .status) ?? SampleStatus.crudo
        status = SampleStatus.all.contains { $0.key == st } ? st : SampleStatus.crudo
        origin = try c.decodeIfPresent(String.self, forKey: .origin) ?? ""
        replaced = try c.decodeIfPresent(Bool.self, forKey: .replaced) ?? false
        key = try c.decodeIfPresent(String.self, forKey: .key)
        comment = try c.decodeIfPresent(String.self, forKey: .comment) ?? ""
        process = try c.decodeIfPresent([String].self, forKey: .process) ?? []
    }
}

/// Estado de trabajo de un sonido: materia prima → ya trabajada → lista para llevar al K.O. II.
enum SampleStatus {
    static let crudo = "crudo", procesado = "procesado", listo = "listo"
    static let all: [(key: String, title: String)] = [("crudo", "Crudo"), ("procesado", "Procesado"), ("listo", "Listo para K.O.")]
    static func title(_ key: String) -> String { all.first { $0.key == key }?.title ?? "Crudo" }
}

/// Etiquetas de carácter: las de fábrica más las que añade el usuario (lista editable, se recuerda).
enum CharTags {
    static let factory = ["cálido", "oscuro", "brillante", "granular", "metálico", "etéreo", "suave", "áspero", "cuerdas", "teclas", "ambiente"]
    static var list: [String] {
        get { (UserDefaults.standard.array(forKey: "charTags") as? [String]).flatMap { $0.isEmpty ? nil : $0 } ?? factory }
        set { UserDefaults.standard.set(newValue, forKey: "charTags") }
    }
}

enum SampleSort: String, CaseIterable {
    case fecha, nombre, duracion, favoritos
    var title: String {
        switch self {
        case .fecha: return "Fecha (recientes primero)"
        case .nombre: return "Nombre (A–Z)"
        case .duracion: return "Duración (largos primero)"
        case .favoritos: return "Favoritos primero"
        }
    }
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
    // Vista de la biblioteca (se recuerda entre sesiones)
    @Published var onlyFavorites = false { didSet { UserDefaults.standard.set(onlyFavorites, forKey: "fOnlyFav") } }
    @Published var statusFilter = "" { didSet { UserDefaults.standard.set(statusFilter, forKey: "fStatus") } }
    @Published var tagFilter: Set<String> = [] { didSet { UserDefaults.standard.set(Array(tagFilter), forKey: "fTags") } }
    @Published var originFilter = "" { didSet { UserDefaults.standard.set(originFilter, forKey: "fOrigin") } }
    @Published var sort = SampleSort.fecha { didSet { UserDefaults.standard.set(sort.rawValue, forKey: "fSort") } }

    private let dir: URL
    private var indexURL: URL { dir.appendingPathComponent("index.json") }

    init(directory: URL? = nil) {
        dir = directory ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Samples", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let d = try? Data(contentsOf: indexURL),
           let s = try? JSONDecoder().decode([Sample].self, from: d) { samples = s }
        let u = UserDefaults.standard
        onlyFavorites = u.bool(forKey: "fOnlyFav"); statusFilter = u.string(forKey: "fStatus") ?? ""
        tagFilter = Set(u.stringArray(forKey: "fTags") ?? []); originFilter = u.string(forKey: "fOrigin") ?? ""
        sort = SampleSort(rawValue: u.string(forKey: "fSort") ?? "") ?? .fecha
    }

    /// ¿Hay algún filtro puesto además de la búsqueda?
    var filterActive: Bool { onlyFavorites || !statusFilter.isEmpty || !tagFilter.isEmpty || !originFilter.trimmingCharacters(in: .whitespaces).isEmpty }
    func clearFilters() { onlyFavorites = false; statusFilter = ""; tagFilter = []; originFilter = "" }

    /// Carpeta efectiva: las que no están en la lista caen en «Sin clasificar».
    func folder(of s: Sample) -> String { Self.folderInfo.contains { $0.name == s.folder } ? s.folder : Self.unsorted }
    func samples(in folder: String) -> [Sample] { filtered.filter { self.folder(of: $0) == folder } }

    private func matches(_ s: Sample, query q: String, origin o: String) -> Bool {
        if onlyFavorites && !s.favorite { return false }
        if !statusFilter.isEmpty && s.status != statusFilter { return false }
        if !tagFilter.isSubset(of: Set(s.tags)) { return false }
        if !o.isEmpty && !s.origin.lowercased().contains(o) { return false }
        if q.isEmpty { return true }
        return s.name.lowercased().contains(q) || s.tags.contains { $0.lowercased().contains(q) } || (s.key ?? "").lowercased() == q
    }

    /// Lo que se ve: búsqueda y filtros aplicados, en el orden elegido.
    var filtered: [Sample] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let o = originFilter.trimmingCharacters(in: .whitespaces).lowercased()
        return arranged(samples.filter { matches($0, query: q, origin: o) })
    }

    func arranged(_ list: [Sample]) -> [Sample] {
        switch sort {
        case .fecha: return list.sorted { $0.created > $1.created }
        case .nombre: return list.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        case .duracion: return list.sorted { $0.duration != $1.duration ? $0.duration > $1.duration : $0.created > $1.created }
        case .favoritos: return list.sorted { $0.favorite != $1.favorite ? $0.favorite : $0.created > $1.created }
        }
    }

    func toggleFavorite(_ s: Sample) { setFavorite(ids: [s.id], to: !s.favorite) }
    func setFavorite(ids: Set<UUID>, to value: Bool) {
        for i in samples.indices where ids.contains(samples[i].id) { samples[i].favorite = value }
        save()
    }

    /// Bytes que ocupa la biblioteca en el dispositivo.
    func usedBytes() -> Int64 {
        let keys: [URLResourceKey] = [.fileSizeKey]
        guard let en = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: keys) else { return 0 }
        var total: Int64 = 0
        for case let u as URL in en { total += Int64((try? u.resourceValues(forKeys: Set(keys)).fileSize) ?? 0) }
        return total
    }
    /// Espacio libre en el dispositivo (nil si no se puede saber).
    nonisolated static func freeBytes() -> Int64? {
        let v = try? URL(fileURLWithPath: NSHomeDirectory()).resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return v?.volumeAvailableCapacityForImportantUsage
    }

    /// Restaura sonidos de un respaldo: guarda su audio y los suma al índice (los que ya están no se tocan).
    func restore(_ items: [(sample: Sample, wav: Data)]) throws {
        var added: [Sample] = []
        for it in items where !samples.contains(where: { $0.id == it.sample.id }) {
            try it.wav.write(to: url(it.sample), options: .atomic)
            added.append(it.sample)
        }
        samples.append(contentsOf: added); samples.sort { $0.created > $1.created }
        save()
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

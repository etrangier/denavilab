import Foundation

/// Respaldo de toda la biblioteca en un solo .zip: un índice `biblioteca.json` y un WAV por sonido en `audio/`.
enum Backup {
    struct Index: Codable {
        var formato = 2
        var app = "denavilab-sounds-ios"
        var fecha = Date()
        var samples: [Sample]
    }
    struct Report: Equatable { var added = 0, skipped = 0, bad = 0 }
    enum BackupError: Error, LocalizedError {
        case notBackup, empty
        var errorDescription: String? {
            switch self {
            case .notBackup: return "no es un respaldo de DenaviLab: Sounds"
            case .empty: return "no hay nada que guardar todavía"
            }
        }
    }

    static func fileName(_ d: Date = Date()) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return "denavilab-sounds-respaldo-\(f.string(from: d)).zip"
    }

    @MainActor static func make(_ lib: LibraryStore) throws -> URL {
        guard !lib.samples.isEmpty else { throw BackupError.empty }
        let enc = JSONEncoder(); enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        var entries = [Zip.Entry(name: "biblioteca.json", data: try enc.encode(Index(samples: lib.samples)))]
        for s in lib.samples {
            guard let d = try? Data(contentsOf: lib.url(s)) else { continue }
            entries.append(Zip.Entry(name: "audio/\(s.id.uuidString).wav", data: d))
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName())
        try Zip.make(entries).write(to: url, options: .atomic)
        return url
    }

    @MainActor static func restore(from url: URL, into lib: LibraryStore) throws -> Report {
        let entries = try Zip.read(try Data(contentsOf: url))
        guard let meta = entries.first(where: { $0.name == "biblioteca.json" }) else { throw BackupError.notBackup }
        let dec = JSONDecoder()
        guard let index = try? dec.decode(Index.self, from: meta.data) else { throw BackupError.notBackup }
        var rep = Report(), items: [(sample: Sample, wav: Data)] = []
        let have = Set(lib.samples.map(\.id))
        for s in index.samples {
            if have.contains(s.id) { rep.skipped += 1; continue }
            guard let w = entries.first(where: { $0.name == "audio/\(s.id.uuidString).wav" }), WavIO.decode(w.data) != nil else { rep.bad += 1; continue }
            items.append((s, w.data)); rep.added += 1
        }
        try lib.restore(items)
        return rep
    }
}

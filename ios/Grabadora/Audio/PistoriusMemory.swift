import Foundation

/// Memoria de Pistorius: aprende en el propio dispositivo (sin enviar nada) qué sueles grabar, qué quieres hacer con cada tipo de sonido
/// y qué camino prefieres. Con 2 o más ejemplos empieza a reordenar y a ofrecer lo habitual.
enum PistoriusMemory {
    nonisolated static let minUses = 2
    nonisolated private static let key = "pistoriusMem"

    struct Model: Codable, Equatable {
        var n = 0
        var last: String?
        var src: [String: Int] = [:]
        var goal: [String: [String: Int]] = [:]
        var act: [String: [String: Int]] = [:]
    }

    nonisolated static func load() -> Model {
        guard let d = UserDefaults.standard.data(forKey: key), let m = try? JSONDecoder().decode(Model.self, from: d) else { return Model() }
        return m
    }
    nonisolated private static func save(_ m: Model) { if let d = try? JSONEncoder().encode(m) { UserDefaults.standard.set(d, forKey: key) } }
    nonisolated static func forget() { UserDefaults.standard.removeObject(forKey: key) }

    /// Anota un resultado que el usuario aceptó.
    @discardableResult
    nonisolated static func record(source: String, goal: String, action: String, in m0: Model? = nil, persist: Bool = true) -> Model {
        var m = m0 ?? load()
        m.n += 1; m.last = source
        m.src[source, default: 0] += 1
        m.goal[source, default: [:]][goal, default: 0] += 1
        m.act[goal, default: [:]][action, default: 0] += 1
        if persist { save(m) }
        return m
    }

    /// Orígenes con el que más usas primero (solo si ya hay ejemplos). `top` es el que merece la ★.
    nonisolated static func rankSources(_ sources: [Pistorius.Source], _ m: Model) -> (list: [Pistorius.Source], top: String?) {
        guard m.n >= minUses else { return (sources, nil) }
        let ord = sources.enumerated().sorted { a, b in
            let ca = m.src[a.element.id] ?? 0, cb = m.src[b.element.id] ?? 0
            return ca != cb ? ca > cb : a.offset < b.offset
        }.map { $0.element }
        return (ord, (m.src[ord[0].id] ?? 0) >= minUses ? ord[0].id : nil)
    }

    /// Pasa al frente la meta que más has elegido para ese tipo de sonido.
    nonisolated static func rankGoals(_ source: String, _ goals: [Pistorius.Goal], _ m: Model) -> (list: [Pistorius.Goal], top: String?) {
        guard let best = (m.goal[source] ?? [:]).max(by: { $0.value < $1.value }), best.value >= minUses, let top = goals.first(where: { $0.id == best.key }) else { return (goals, nil) }
        return ([top] + goals.filter { $0.id != top.id }, top.id)
    }

    /// La acción que sueles elegir para esa meta, si es clara (al menos 2 veces y 60 %).
    nonisolated static func usualAction(_ goal: String, _ m: Model) -> String? {
        let c = m.act[goal] ?? [:], tot = c.values.reduce(0, +)
        guard let best = c.max(by: { $0.value < $1.value }), best.value >= minUses, Double(best.value) / Double(max(1, tot)) >= 0.6 else { return nil }
        return best.key
    }

    nonisolated static func summary(_ m: Model) -> String {
        m.n == 0 ? "Pistorius aún no te conoce: aprende con lo que elijas" : "Pistorius ha aprendido de \(m.n) \(m.n == 1 ? "sonido" : "sonidos") tuyos"
    }
}

import Foundation

/// Grilla de chops: cada casilla lleva un corte; se copian, cortan y pegan casillas y se renderiza a un loop de duración exacta a un BPM fijo.
/// Mismo algoritmo y mismos números que `grid.js` en la PWA.
enum GridSeq {
    nonisolated static let stepOptions = [4, 8, 16]            // casillas por compás

    /// Casillas copiadas: posiciones relativas a la primera (las vacías dentro de la selección también cuentan).
    struct Clip: Equatable {
        var items: [Item]
        struct Item: Equatable { var offset: Int; var cell: Int? }
    }

    nonisolated static func emptyCells(bars: Int, steps: Int) -> [Int?] { [Int?](repeating: nil, count: bars * steps) }

    /// Cambia el tamaño de la grilla conservando lo que cabe (se reubica por posición en el tiempo).
    nonisolated static func resizeCells(_ cells: [Int?], bars: Int, steps: Int, oldBars: Int, oldSteps: Int) -> [Int?] {
        var out = emptyCells(bars: bars, steps: steps)
        for (i, v) in cells.enumerated() {
            guard let v = v else { continue }
            let t = Double(i) / Double(oldBars * oldSteps), j = Int((t * Double(bars * steps)).rounded())
            if j >= 0 && j < out.count { out[j] = v }
        }
        return out
    }

    /// Audio de la grilla: `chops[i]` es el audio del corte i, `cells[k]` el corte de la casilla k. Cada corte suena hasta la siguiente casilla
    /// con corte (como un pad que corta al anterior) o hasta el final; el loop dura exactamente `bars` compases a `bpm`.
    nonisolated static func renderGrid(_ chops: [[Float]], cells: [Int?], bars: Int, bpm: Int, rate: Int) -> [Float] {
        let total = Harmony.loopLength(rate: rate, bpm: bpm, bars: bars), n = cells.count
        var out = [Float](repeating: 0, count: total)
        func at(_ k: Int) -> Int { Int((Double(k) * Double(total) / Double(n)).rounded()) }
        let used = cells.indices.filter { cells[$0] != nil }
        for (u, k) in used.enumerated() {
            guard let ci = cells[k], ci >= 0, ci < chops.count, !chops[ci].isEmpty else { continue }
            let c = chops[ci], a = at(k), end = u + 1 < used.count ? at(used[u + 1]) : total
            let len = min(c.count, end - a), cut = len < c.count
            guard len > 0 else { continue }
            let fi = min(Int((Double(rate) * 0.001).rounded()), len >> 2), fo = min(Int((Double(rate) * (cut ? 0.004 : 0.002)).rounded()), len >> 2)
            for i in 0..<len {
                var g: Float = 1
                if i < fi { g = Float(i) / Float(fi) } else if i >= len - fo { g = Float(len - 1 - i) / Float(fo) }
                out[a + i] += c[i] * g
            }
        }
        return out
    }

    nonisolated static func copyCells(_ cells: [Int?], _ sel: Set<Int>) -> Clip? {
        let ids = sel.sorted().filter { $0 >= 0 && $0 < cells.count }
        guard let first = ids.first else { return nil }
        return Clip(items: ids.map { Clip.Item(offset: $0 - first, cell: cells[$0]) })
    }

    /// Pega `clip` empezando en la casilla `at`, pisando lo que haya; lo que se sale de la grilla se descarta.
    nonisolated static func pasteCells(_ cells: [Int?], _ clip: Clip?, at: Int) -> [Int?] {
        var out = cells
        guard let clip = clip else { return out }
        for it in clip.items { let k = at + it.offset; if k >= 0 && k < out.count { out[k] = it.cell } }
        return out
    }

    nonisolated static func clearCells(_ cells: [Int?], _ sel: Set<Int>) -> [Int?] {
        var out = cells
        for i in sel where i >= 0 && i < out.count { out[i] = nil }
        return out
    }
}

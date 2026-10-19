import SwiftUI

/// Grilla para armar chops: cada casilla lleva un corte; se copian, cortan y pegan casillas y se guarda como loop a BPM fijo.
struct GridPanel: View {
    let chopCount: Int
    let bpm: Int
    let rate: Int
    @Binding var brush: Int
    let isPlaying: Bool
    let render: ([Int?], Int) -> [Float]          // casillas, compases → audio
    let onPlay: ([Float]) -> Void
    let onStop: () -> Void
    let onSave: ([Float], Int) -> Void            // audio, compases
    let onAudition: (Int) -> Void

    @State private var on = false
    @State private var bars = 2
    @State private var steps = 8
    @State private var cells: [Int?] = GridSeq.emptyCells(bars: 2, steps: 8)
    @State private var selectMode = false
    @State private var sel: Set<Int> = []
    @State private var clip: GridSeq.Clip?

    private var filled: Bool { cells.contains { $0 != nil } }
    private func barsWord(_ n: Int) -> String { n == 1 ? "1 compás" : "\(n) compases" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ToggleRow(title: "Armar en grilla", subtitle: "Pon cada corte en una casilla; copia, corta y pega casillas, y guárdalo como loop a BPM fijo",
                      isOn: Binding(get: { on }, set: { on = $0; if !$0 { sel = []; onStop() } }))
            if on { content }
        }
    }

    @ViewBuilder private var content: some View {
        sizeChips
        modeChips
        if !selectMode { brushChips }
        cellGrid
        if selectMode { editButtons }
        Text(hint)
            .font(Theme.font(12)).foregroundColor(Theme.muted)
        Text("\(barsWord(bars)) · \(bpm) BPM fijos").font(Theme.font(12)).foregroundColor(Theme.muted)
        Button(isPlaying ? "Parar la grilla" : "Escuchar grilla") { if isPlaying { onStop() } else { onPlay(render(cells, bars)) } }
            .buttonStyle(OutlineButton(selected: isPlaying)).disabled(!filled).opacity(filled ? 1 : 0.4)
        Button("Guardar grilla como loop") { onSave(render(cells, bars), bars) }
            .buttonStyle(OutlineButton(selected: true)).disabled(!filled).opacity(filled ? 1 : 0.4)
        Button("Vaciar grilla") { cells = GridSeq.emptyCells(bars: bars, steps: steps); sel = []; onStop() }
            .buttonStyle(OutlineButton()).font(Theme.font(13)).disabled(!filled).opacity(filled ? 1 : 0.4)
    }

    private var hint: String {
        if !selectMode { return "Toca una casilla para poner el corte elegido; tócala otra vez para vaciarla. Cada corte suena hasta el siguiente." }
        if let c = clip { return "Copiadas \(c.items.count) casillas: elige la casilla donde empieza el pegado y pulsa Pegar" }
        return "Toca las casillas que quieras copiar o cortar (se conserva el ritmo entre ellas)"
    }

    private func resize(_ b: Int, _ s: Int) {
        cells = GridSeq.resizeCells(cells, bars: b, steps: s, oldBars: bars, oldSteps: steps)
        bars = b; steps = s; sel = []; onStop()
    }

    private var sizeChips: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) { ForEach([1, 2, 4], id: \.self) { b in Chip(title: barsWord(b), selected: bars == b) { resize(b, steps) } } }
            HStack(spacing: 8) { ForEach(GridSeq.stepOptions, id: \.self) { n in Chip(title: "\(n) por compás", selected: steps == n) { resize(bars, n) } } }
        }
    }

    private var modeChips: some View {
        HStack(spacing: 8) {
            Chip(title: "Pintar", selected: !selectMode) { selectMode = false }
            Chip(title: "Seleccionar casillas", selected: selectMode) { selectMode = true }
        }
    }

    private var brushChips: some View {
        let n = max(chopCount, 1)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) { ForEach(0..<n, id: \.self) { i in Chip(title: "Pincel \(i + 1)", selected: brush == i) { brush = i } } }
        }
    }

    private var cellGrid: some View {
        let cols = Array(repeating: GridItem(.flexible(), spacing: 4), count: min(8, steps))
        return LazyVGrid(columns: cols, spacing: 4) {
            ForEach(0..<cells.count, id: \.self) { k in cellButton(k) }
        }
    }

    private func cellButton(_ k: Int) -> some View {
        let v = cells[k], picked = sel.contains(k)
        return Button { tap(k) } label: {
            Text(v.map { String($0 + 1) } ?? "·").font(Theme.font(15, weight: .bold))
                .foregroundColor(v != nil ? Theme.amber : Theme.muted)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(v != nil ? Theme.surface2 : Theme.surface)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(picked ? Theme.amber : (k % steps == 0 ? Theme.amber.opacity(0.5) : Theme.line), lineWidth: picked ? 3 : 1.5))
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .accessibilityLabel("Casilla \(k + 1)" + (v.map { ", corte \($0 + 1)" } ?? ", vacía") + (picked ? ", seleccionada" : ""))
    }

    private func tap(_ k: Int) {
        if selectMode { if sel.contains(k) { sel.remove(k) } else { sel.insert(k) }; return }
        guard brush < chopCount else { return }
        if cells[k] == brush { cells[k] = nil } else { cells[k] = brush; onAudition(brush) }
        onStop()
    }

    private var editButtons: some View {
        let has = !sel.isEmpty, first = sel.min() ?? 0
        return VStack(spacing: 8) {
            HStack(spacing: 8) {
                Button("Copiar") { clip = GridSeq.copyCells(cells, sel) }.disabled(!has)
                Button("Cortar") { clip = GridSeq.copyCells(cells, sel); cells = GridSeq.clearCells(cells, sel); onStop() }.disabled(!has)
                Button("Pegar") { cells = GridSeq.pasteCells(cells, clip, at: first); onStop() }.disabled(clip == nil || !has)
            }
            HStack(spacing: 8) {
                Button("Borrar") { cells = GridSeq.clearCells(cells, sel); onStop() }.disabled(!has)
                Button("Quitar selección") { sel = [] }.disabled(!has)
            }
        }.buttonStyle(OutlineButton()).font(Theme.font(13))
    }
}

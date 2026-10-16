import SwiftUI

/// Edición precisa (pantalla 15): zoom 1×, 4×, 16× y a nivel de muestra, marcadores arrastrables,
/// cruce por cero opcional y fundidos de entrada y salida por separado.
struct PreciseEditSheet: View {
    let audio: [Float]
    let rate: Int
    let onApply: (Range<Int>, Int, Int) -> Void
    @Environment(\.dismiss) private var dismiss

    enum Zoom: CaseIterable {
        case x1, x4, x16, sample
        var title: String {
            switch self { case .x1: return "1×"; case .x4: return "4×"; case .x16: return "16×"; case .sample: return "Muestra" }
        }
        func width(count: Int) -> Int {
            switch self { case .x1: return count; case .x4: return count / 4; case .x16: return count / 16; case .sample: return 160 }
        }
    }

    @State private var startS: Int
    @State private var endS: Int
    @State private var zoom = Zoom.x1
    @State private var center: Int
    @State private var zeroCross = true
    @State private var fadeIn = 5.0
    @State private var fadeOut = 12.0
    @State private var undo: [[Int]] = []
    @State private var redo: [[Int]] = []
    @State private var dragOrigin: [Int]?
    @State private var peaks: [Float] = []

    init(audio: [Float], rate: Int, start: Int, end: Int, onApply: @escaping (Range<Int>, Int, Int) -> Void) {
        self.audio = audio; self.rate = rate; self.onApply = onApply
        let s = min(max(start, 0), max(audio.count - 2, 0))
        let e = min(max(end, s + 1), audio.count)
        _startS = State(initialValue: s); _endS = State(initialValue: e); _center = State(initialValue: s)
    }

    private var win: Range<Int> { Editing.window(count: audio.count, width: zoom.width(count: audio.count), center: center) }
    private func frac(_ s: Int) -> Double { Double(s - win.lowerBound) / Double(max(win.count, 1)) }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenTitle(title: "Edición precisa", trailing: AnyView(TextLink(title: "Cerrar") { dismiss() }))
                    waveArea
                    HStack {
                        Text(label(startS)).foregroundColor(Theme.amber)
                        Spacer()
                        Text(label(endS)).foregroundColor(Theme.amber)
                    }.font(Theme.font(12, weight: .bold))
                    HStack(spacing: 8) {
                        ForEach(Zoom.allCases, id: \.self) { z in
                            Chip(title: z.title, selected: zoom == z) {
                                zoom = z
                                if z != .x1 { center = startS }
                                refreshPeaks()
                            }
                        }
                    }
                    if zoom != .x1 {
                        HStack(spacing: 8) {
                            Button("◉ Inicio") { center = startS; refreshPeaks() }.buttonStyle(OutlineButton())
                            Button("◉ Final") { center = endS; refreshPeaks() }.buttonStyle(OutlineButton())
                        }.font(Theme.font(13))
                        Slider(value: Binding(get: { Double(center) / Double(max(audio.count, 1)) },
                                              set: { center = Int($0 * Double(audio.count)); refreshPeaks() }))
                            .tint(Theme.amber)
                    }
                    ToggleRow(title: "Cortar en cruce por cero", subtitle: "Evita clics en los cortes", isOn: $zeroCross)
                    SliderRow(title: "Fundido de entrada", valueText: "\(Int(fadeIn)) ms", value: $fadeIn, range: 0...200)
                    SliderRow(title: "Fundido de salida", valueText: "\(Int(fadeOut)) ms", value: $fadeOut, range: 0...200)
                    HStack(spacing: 10) {
                        Button("Deshacer") { step(&undo, &redo) }.disabled(undo.isEmpty)
                        Button("Rehacer") { step(&redo, &undo) }.disabled(redo.isEmpty)
                    }.buttonStyle(OutlineButton()).font(Theme.font(13))
                    Button("Aplicar corte") { apply() }.buttonStyle(AmberButton())
                }.padding(16)
            }
        }
        .onAppear { refreshPeaks() }
    }

    // MARK: onda y marcadores

    private var waveArea: some View {
        GeometryReader { g in
            let w = g.size.width
            ZStack(alignment: .topLeading) {
                if zoom == .sample { sampleLine } else {
                    WaveBars(peaks: peaks, range: selection).padding(.horizontal, 0)
                }
                marker(startS, isEnd: false, width: w, height: g.size.height) { startS = min(max(0, $0), endS - 1) }
                marker(endS, isEnd: true, width: w, height: g.size.height) { endS = max(min(audio.count, $0), startS + 1) }
            }
        }
        .frame(height: 170)
        .background(Theme.surface).overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var selection: ClosedRange<Double> {
        let lo = max(0, min(1, frac(startS)))
        return lo...max(lo, min(1, frac(endS)))
    }

    /// Onda muestra a muestra (zoom máximo).
    private var sampleLine: some View {
        Canvas { ctx, size in
            let w = win
            guard w.count > 1 else { return }
            let mid = size.height / 2
            var line = Path()
            for (k, i) in w.enumerated() {
                let pt = CGPoint(x: size.width * CGFloat(k) / CGFloat(w.count - 1), y: mid - CGFloat(audio[i]) * mid * 0.9)
                if k == 0 { line.move(to: pt) } else { line.addLine(to: pt) }
            }
            let sel = selection
            ctx.fill(Path(CGRect(x: size.width * CGFloat(sel.lowerBound), y: 0, width: size.width * CGFloat(sel.upperBound - sel.lowerBound), height: size.height)),
                     with: .color(Theme.amber.opacity(0.12)))
            ctx.fill(Path(CGRect(x: 0, y: mid - 0.5, width: size.width, height: 1)), with: .color(Theme.line))
            ctx.stroke(line, with: .color(Theme.amber), lineWidth: 2)
        }
    }

    private func marker(_ index: Int, isEnd: Bool, width: CGFloat, height: CGFloat, set: @escaping (Int) -> Void) -> some View {
        let f = frac(index)
        return Group {
            if f >= 0 && f <= 1 {
                ZStack {
                    Rectangle().fill(Theme.text).frame(width: 2, height: height)
                    Circle().fill(Theme.amber).frame(width: 26, height: 26).overlay(Circle().stroke(Theme.bg, lineWidth: 2))
                }
                .frame(width: 44, height: height).contentShape(Rectangle())
                .position(x: width * CGFloat(f), y: height / 2)
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        if dragOrigin == nil { dragOrigin = [startS, endS] }
                        let x = min(max(Double(v.location.x / max(width, 1)), 0), 1)
                        // el punto de agarre está en la posición actual del marcador; se mueve con el dedo
                        set(win.lowerBound + Int(x * Double(win.count)))
                    }
                    .onEnded { _ in
                        if zeroCross {
                            if isEnd { endS = max(Editing.snapMarker(audio, to: endS, zeroCross: true), startS + 1) }
                            else { startS = min(Editing.snapMarker(audio, to: startS, zeroCross: true), endS - 1) }
                        }
                        if let o = dragOrigin, o != [startS, endS] { undo.append(o); redo = [] }
                        dragOrigin = nil
                        refreshPeaks()
                    })
                .accessibilityLabel(isEnd ? "Marcador de final" : "Marcador de inicio")
            }
        }
    }

    // MARK: acciones

    private func label(_ s: Int) -> String {
        zoom == .sample ? "muestra \(s)" : String(format: "%.2f s", Double(s) / Double(rate)).replacingOccurrences(of: ".", with: ",")
    }

    private func refreshPeaks() {
        guard zoom != .sample, !audio.isEmpty else { peaks = []; return }
        peaks = Editing.peaks(Array(audio[win]), buckets: 56)
    }

    private func step(_ from: inout [[Int]], _ to: inout [[Int]]) {
        guard let prev = from.popLast() else { return }
        to.append([startS, endS])
        startS = prev[0]; endS = prev[1]
        refreshPeaks()
    }

    private func apply() {
        let lo = zeroCross ? Editing.snapMarker(audio, to: startS, zeroCross: true) : startS
        let hi = zeroCross ? min(audio.count, Editing.snapMarker(audio, to: endS, zeroCross: true) + 1) : endS
        guard hi - lo >= 8 else { return }
        onApply(lo..<hi, Int(fadeIn / 1000 * Double(rate)), Int(fadeOut / 1000 * Double(rate)))
        dismiss()
    }
}

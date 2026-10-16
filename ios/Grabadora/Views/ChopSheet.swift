import SwiftUI
import AVFoundation

/// Chop en pads (pantallas 12 y 13): corta la toma y reparte los trozos en 12 pads.
struct ChopSheet: View {
    let sample: Sample
    let audio: [Float]
    @EnvironmentObject var lib: LibraryStore
    @Environment(\.dismiss) private var dismiss
    @State private var mode = 8            // 4, 8, 12 o 0 = automático
    @State private var sensitivity = 0.5
    @State private var selected: Set<Int> = []     // cortes elegidos (0 = el primero)
    @State private var player: AVAudioPlayer?
    @State private var previewing = false                  // suena «Escuchar selección»
    @State private var playingIndex: Int?                  // corte que suena ahora (nil en los huecos)
    @State private var plan: [(index: Int, start: Int, end: Int)] = []
    private let tick = Timer.publish(every: 0.04, on: .main, in: .common).autoconnect()
    @State private var sharing: [URL] = []
    @State private var showShare = false
    @State private var message: String?

    @State private var ranges: [Range<Int>] = []
    @State private var peaks: [Float] = []
    @State private var grid = false
    @State private var bpm: Double?
    @State private var harmonize = true                   // centra la onda, suaviza bordes y, al unir, iguala el volumen

    private func recompute() {
        var starts = mode == 0 ? Editing.transients(audio, sensitivity: sensitivity, minGapSamples: sample.sampleRate / 10, maxCount: 11)
                               : Editing.evenSlices(audio, count: mode)
        if grid, let b = bpm { starts = Editing.snapToGrid(starts, step: Double(sample.sampleRate) * 60 / b / 4) }
        ranges = Array(Editing.slices(starts: starts, total: audio.count).prefix(12))
        stopPreview()
        selected = []                                   // al cambiar los cortes, los números ya no significan lo mismo
    }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenTitle(title: "Chop en pads", subtitle: "\(ranges.count) cortes · \(selected.count) seleccionado\(selected.count == 1 ? "" : "s")",
                                trailing: AnyView(TextLink(title: "Cerrar") { stopPreview(); dismiss() }))
                    wave
                    HStack(spacing: 8) {
                        ForEach([4, 8, 12, 0], id: \.self) { m in
                            Chip(title: m == 0 ? "Auto" : "\(m)", selected: mode == m) { mode = m }
                        }
                    }
                    if mode == 0 {
                        SliderRow(title: "Sensibilidad de golpes", valueText: sensitivity < 0.34 ? "Baja" : sensitivity < 0.67 ? "Media" : "Alta", value: $sensitivity)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle(isOn: $grid) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Ajustar a la cuadrícula").font(Theme.font(15, weight: .medium)).foregroundColor(Theme.text)
                                Text(bpm.map { "\(Int($0.rounded())) BPM · 1/16" } ?? "BPM sin detectar: usa Detectar BPM en Editar")
                                    .font(Theme.font(12)).foregroundColor(Theme.muted)
                            }
                        }.tint(Theme.amber).disabled(bpm == nil)
                        Text("Funciona mejor si grabaste con compás.").font(Theme.font(12)).foregroundColor(Theme.muted)
                    }.card()
                    ToggleRow(title: "Armonizar cortes", subtitle: "Centra la onda y suaviza bordes, y al unir iguala el volumen: sin clics ni saltos", isOn: $harmonize)
                    Text("Toca los pads que quieras quedarte: se escuchan y se marcan. Puedes elegir los que quieras, juntos o no (por ejemplo, el 1 y el 3).")
                        .font(Theme.font(12)).foregroundColor(Theme.muted)
                    HStack(spacing: 8) {
                        Button("Todos") { stopPreview(); selected = Set(ranges.indices) }.buttonStyle(OutlineButton()).disabled(selected.count == ranges.count)
                        Button("Ninguno") { stopPreview(); selected = [] }.buttonStyle(OutlineButton()).disabled(selected.isEmpty)
                    }.font(Theme.font(13))
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                        ForEach(0..<12, id: \.self) { i in
                            let live = i < ranges.count, on = selected.contains(i)
                            Button {
                                guard live else { return }
                                stopPreview()
                                if on { selected.remove(i) } else { selected.insert(i) }
                                play(i)
                            } label: {
                                Text("\(i + 1)").font(Theme.font(20, weight: .bold))
                                    .foregroundColor(!live ? Theme.line : (on ? Theme.amber : Theme.text))
                                    .frame(maxWidth: .infinity, minHeight: 64)
                                    .background(playingIndex == i ? Theme.amber.opacity(0.28) : (on ? Theme.surface2 : Theme.surface))
                                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(on && live ? Theme.amber : Theme.line, lineWidth: playingIndex == i ? 3 : 1.5))
                                    .clipShape(RoundedRectangle(cornerRadius: 14))
                            }
                            .disabled(!live)
                            .accessibilityLabel("Pad \(i + 1)" + (on ? ", seleccionado" : ""))
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                    if ranges.count < 12 { Text("Pads \(ranges.count + 1)–12 libres").font(Theme.font(12)).foregroundColor(Theme.muted).frame(maxWidth: .infinity, alignment: .center) }
                    Button(previewing ? "Parar" : (selected.isEmpty ? "Escuchar selección" : "Escuchar selección · \(previewSeconds)")) {
                        if previewing { stopPreview() } else { startPreview() }
                    }
                    .buttonStyle(OutlineButton(selected: previewing)).disabled(selected.isEmpty).opacity(selected.isEmpty ? 0.4 : 1)
                    .accessibilityLabel(previewing ? "Parar la escucha de la selección" : "Escuchar selección")
                    Button(selected.isEmpty ? "Elige al menos un corte" : "Guardar \(selected.count) en la Biblioteca") { saveSelected() }
                        .buttonStyle(AmberButton()).disabled(selected.isEmpty).opacity(selected.isEmpty ? 0.4 : 1)
                    Button("Guardar unidos en un solo sonido") { saveJoined() }
                        .buttonStyle(OutlineButton(selected: true)).disabled(selected.count < 2).opacity(selected.count < 2 ? 0.4 : 1)
                    Button(selected.isEmpty ? "Exportar cortes" : "Exportar \(selected.count) para el K.O. II") { exportSelected() }
                        .buttonStyle(OutlineButton(selected: true)).disabled(selected.isEmpty).opacity(selected.isEmpty ? 0.4 : 1)
                    if let m = message { Text(m).font(Theme.font(13)).foregroundColor(Theme.muted).frame(maxWidth: .infinity, alignment: .center) }
                }.padding(16)
            }
        }
        .sheet(isPresented: $showShare) { ShareSheet(items: sharing) }
        .onAppear { peaks = Editing.peaks(audio, buckets: 56); bpm = sample.bpm ?? Editing.estimateBPM(audio, rate: sample.sampleRate)?.bpm; recompute() }
        .onChange(of: grid) { _ in recompute() }
        .onChange(of: mode) { _ in recompute() }
        .onChange(of: sensitivity) { _ in recompute() }
        .onReceive(tick) { _ in updatePreview() }
        .onDisappear { stopPreview() }
    }

    private var wave: some View {
        ZStack {
            WaveBars(peaks: peaks, highlights: selected.isEmpty ? nil : Editing.highlightRanges(ranges, total: audio.count, selected: selected)).padding(12)
            Canvas { ctx, size in
                for r in ranges.dropFirst() {
                    let x = size.width * CGFloat(r.lowerBound) / CGFloat(max(audio.count, 1))
                    ctx.fill(Path(CGRect(x: x - 1, y: 8, width: 2, height: size.height - 16)), with: .color(Theme.text))
                }
            }.padding(12).allowsHitTesting(false)
        }
        .frame(height: 120)
        .background(Theme.surface).overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    /// Duración de la escucha de la selección, p. ej. «2,2 s».
    private var previewSeconds: String {
        let seg = Editing.previewSegments(ranges, selected: selected, rate: sample.sampleRate)
        let secs = Double(seg.last?.end ?? 0) / Double(sample.sampleRate)
        return String(format: "%.1f s", secs).replacingOccurrences(of: ".", with: ",")
    }

    /// Escuchar la selección: los cortes elegidos uno tras otro, en su orden original; el pad que suena se ilumina.
    private func startPreview() {
        stopPreview()
        let pre = Editing.previewAudio(audio, ranges: ranges, selected: selected, rate: sample.sampleRate)
        guard !pre.isEmpty else { return }
        plan = Editing.previewSegments(ranges, selected: selected, rate: sample.sampleRate)
        do {
            try AudioSessionConfig.activate()
            var s = sample; s.id = UUID(); s.slot = nil; s.effects = EffectParams(); s.name = "seleccion_\(sample.name)"
            let url = try Exporter.export(s, audio: pre, targetRate: sample.sampleRate)
            let p = try AVAudioPlayer(contentsOf: url); p.play(); player = p
            previewing = true
        } catch { message = "No se pudo reproducir: \(error.localizedDescription)" }
    }

    private func stopPreview() {
        player?.stop(); previewing = false; playingIndex = nil
    }

    private func updatePreview() {
        guard previewing else { return }
        guard let p = player, p.isPlaying else { previewing = false; playingIndex = nil; return }   // terminó solo
        let pos = Int(p.currentTime * Double(sample.sampleRate))
        playingIndex = plan.first { pos >= $0.start && pos < $0.end }?.index                       // en un hueco: ninguno
    }

    private func piece(_ i: Int) -> Sample {
        var s = sample; s.id = UUID(); s.slot = nil; s.effects = EffectParams()
        s.name = Editing.pieceName(i, base: sample.name)
        return s
    }

    private func play(_ i: Int) {
        do {
            try AudioSessionConfig.activate()
            let url = try Exporter.export(piece(i), audio: Array(audio[ranges[i]]), targetRate: sample.sampleRate)
            let p = try AVAudioPlayer(contentsOf: url); p.play(); player = p
        } catch { message = "No se pudo reproducir: \(error.localizedDescription)" }
    }

    /// El audio de un corte, armonizado si el interruptor está encendido.
    private func pieceAudio(_ i: Int) -> [Float] {
        let x = Array(audio[ranges[i]])
        return harmonize ? Harmonize.harmonize(x, rate: sample.sampleRate) : x
    }

    /// Los cortes elegidos, en su orden original, pegados en un solo sonido nuevo.
    private func saveJoined() {
        let chosen = selected.sorted().filter { $0 < ranges.count }
        guard chosen.count >= 2 else { return }
        let raw = chosen.map { Array(audio[ranges[$0]]) }
        let joined = harmonize ? Harmonize.join(raw, rate: sample.sampleRate) : raw.flatMap { $0 }
        let name = "\(sample.name) · " + chosen.map { String($0 + 1) }.joined(separator: "+")
        if var x = lib.add(name: name, audio: joined, sampleRate: sample.sampleRate) {
            x.folder = lib.folder(of: sample); x.subfolder = sample.subfolder; lib.update(x)
            message = String(format: "%d cortes unidos en un sonido nuevo (%.1f s)", chosen.count, Double(joined.count) / Double(sample.sampleRate)).replacingOccurrences(of: ".", with: ",")
        }
    }

    private func saveSelected() {
        let chosen = selected.sorted().filter { $0 < ranges.count }
        for i in chosen {
            if var x = lib.add(name: "\(sample.name) · corte \(i + 1)", audio: pieceAudio(i), sampleRate: sample.sampleRate) {
                x.folder = lib.folder(of: sample); x.subfolder = sample.subfolder; lib.update(x)
            }
        }
        message = chosen.count == 1 ? "1 corte guardado en la Biblioteca" : "\(chosen.count) cortes guardados en la Biblioteca"
    }

    private func exportSelected() {
        let chosen = selected.sorted().filter { $0 < ranges.count }
        let pieces = chosen.map { piece($0) }
        var audioByID: [UUID: [Float]] = [:]
        for (k, i) in chosen.enumerated() { audioByID[pieces[k].id] = pieceAudio(i) }
        Task {
            do { sharing = try await Exporter.exportKit(pieces) { audioByID[$0.id] ?? [] }; showShare = true; message = nil }
            catch { message = "No se pudo exportar: \(error.localizedDescription)" }
        }
    }
}

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
    @State private var selected = 0
    @State private var player: AVAudioPlayer?
    @State private var sharing: [URL] = []
    @State private var showShare = false
    @State private var message: String?

    @State private var ranges: [Range<Int>] = []
    @State private var peaks: [Float] = []

    private func recompute() {
        let starts = mode == 0 ? Editing.transients(audio, sensitivity: sensitivity, minGapSamples: sample.sampleRate / 10, maxCount: 11)
                               : Editing.evenSlices(audio, count: mode)
        ranges = Array(Editing.slices(starts: starts, total: audio.count).prefix(12))
        if selected >= ranges.count { selected = 0 }
    }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenTitle(title: "Chop en pads", subtitle: "\(ranges.count) cortes · toca un pad para escucharlo",
                                trailing: AnyView(TextLink(title: "Cerrar") { player?.stop(); dismiss() }))
                    wave
                    HStack(spacing: 8) {
                        ForEach([4, 8, 12, 0], id: \.self) { m in
                            Chip(title: m == 0 ? "Auto" : "\(m)", selected: mode == m) { mode = m; selected = 0 }
                        }
                    }
                    if mode == 0 {
                        SliderRow(title: "Sensibilidad de golpes", valueText: sensitivity < 0.34 ? "Baja" : sensitivity < 0.67 ? "Media" : "Alta", value: $sensitivity)
                    }
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                        ForEach(0..<12, id: \.self) { i in
                            let live = i < ranges.count
                            Button { if live { selected = i; play(i) } } label: {
                                Text("\(i + 1)").font(Theme.font(20, weight: .bold))
                                    .foregroundColor(!live ? Theme.line : (selected == i ? Theme.amber : Theme.text))
                                    .frame(maxWidth: .infinity, minHeight: 64)
                                    .background(Theme.surface)
                                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(selected == i && live ? Theme.amber : Theme.line, lineWidth: 1.5))
                                    .clipShape(RoundedRectangle(cornerRadius: 14))
                            }.disabled(!live)
                        }
                    }
                    if ranges.count < 12 { Text("Pads \(ranges.count + 1)–12 libres").font(Theme.font(12)).foregroundColor(Theme.muted).frame(maxWidth: .infinity, alignment: .center) }
                    Button("Guardar cortes en la Biblioteca") { saveAll() }.buttonStyle(AmberButton())
                    Button("Exportar cortes para el K.O. II") { exportAll() }.buttonStyle(OutlineButton(selected: true))
                    if let m = message { Text(m).font(Theme.font(13)).foregroundColor(Theme.muted).frame(maxWidth: .infinity, alignment: .center) }
                }.padding(16)
            }
        }
        .sheet(isPresented: $showShare) { ShareSheet(items: sharing) }
        .onAppear { peaks = Editing.peaks(audio, buckets: 56); recompute() }
        .onChange(of: mode) { _ in recompute() }
        .onChange(of: sensitivity) { _ in recompute() }
        .onDisappear { player?.stop() }
    }

    private var wave: some View {
        ZStack {
            WaveBars(peaks: peaks, range: sliceRange).padding(12)
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

    private var sliceRange: ClosedRange<Double> {
        guard selected < ranges.count, !audio.isEmpty else { return 0...1 }
        let r = ranges[selected]
        return (Double(r.lowerBound) / Double(audio.count))...(Double(r.upperBound) / Double(audio.count))
    }

    private func piece(_ i: Int) -> Sample {
        var s = sample; s.id = UUID(); s.slot = nil; s.effects = EffectParams()
        s.name = "corte\(String(format: "%02d", i + 1))_\(sample.name)"
        return s
    }

    private func play(_ i: Int) {
        do {
            try AudioSessionConfig.activate()
            let url = try Exporter.export(piece(i), audio: Array(audio[ranges[i]]), targetRate: sample.sampleRate)
            let p = try AVAudioPlayer(contentsOf: url); p.play(); player = p
        } catch { message = "No se pudo reproducir: \(error.localizedDescription)" }
    }

    private func saveAll() {
        for (i, r) in ranges.enumerated() {
            if var x = lib.add(name: "\(sample.name) · corte \(i + 1)", audio: Array(audio[r]), sampleRate: sample.sampleRate) {
                x.folder = lib.folder(of: sample); lib.update(x)
            }
        }
        message = "\(ranges.count) cortes guardados en la Biblioteca"
    }

    private func exportAll() {
        let pieces = ranges.indices.map { piece($0) }
        var audioByID: [UUID: [Float]] = [:]
        for (i, r) in ranges.enumerated() { audioByID[pieces[i].id] = Array(audio[r]) }
        Task {
            do { sharing = try await Exporter.exportKit(pieces) { audioByID[$0.id] ?? [] }; showShare = true; message = nil }
            catch { message = "No se pudo exportar: \(error.localizedDescription)" }
        }
    }
}

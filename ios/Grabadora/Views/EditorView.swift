import SwiftUI
import AVFoundation

struct EditorView: View {
    @EnvironmentObject var lib: LibraryStore
    @State var sample: Sample
    @State private var audio: [Float] = []
    @State private var start = 0.0      // fracción de la onda
    @State private var end = 1.0
    @State private var fadeMs = 10.0
    @State private var zoom = 1.0
    @State private var sharing: [URL] = []
    @State private var showShare = false
    @State private var tagText = ""
    @State private var player: AVAudioPlayer?
    @State private var error: String?

    init(sample: Sample) { _sample = State(initialValue: sample) }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    TextField("Nombre", text: $sample.name).font(Theme.font(18, weight: .bold)).foregroundColor(Theme.text)
                    WaveView(peaks: Editing.peaks(audio, buckets: Int(300 * zoom)), start: start, end: end)
                        .frame(height: 120)
                    Slider(value: $zoom, in: 1...8) { Text("Zoom") }.tint(Theme.amber)
                    Group {
                        Text("Inicio").font(Theme.font(13)).foregroundColor(Theme.muted)
                        Slider(value: $start, in: 0...max(0.001, end - 0.01)).tint(Theme.amber)
                        Text("Final").font(Theme.font(13)).foregroundColor(Theme.muted)
                        Slider(value: $end, in: min(0.999, start + 0.01)...1).tint(Theme.amber)
                        Text("Fundido: \(Int(fadeMs)) ms").font(Theme.font(13)).foregroundColor(Theme.muted)
                        Slider(value: $fadeMs, in: 0...200).tint(Theme.amber)
                    }
                    HStack {
                        Button("Recortar") { applyTrim() }.buttonStyle(AmberButton())
                        Button("Oír") { play() }.buttonStyle(AmberButton())
                    }
                    effectsSection
                    TextField("Etiqueta (kick, snare, loop…)", text: $tagText, onCommit: addTag)
                        .font(Theme.font(15)).foregroundColor(Theme.text)
                    Text(sample.tags.joined(separator: " · ")).font(Theme.font(13)).foregroundColor(Theme.muted)
                    Stepper(value: Binding(get: { sample.slot ?? 0 }, set: { sample.slot = $0 == 0 ? nil : $0 }), in: 0...999) {
                        Text(sample.slot.map { "Slot \($0)" } ?? "Sin slot").font(Theme.font(15)).foregroundColor(Theme.text)
                    }
                    Text("Exporta WAV mono 16-bit a 46 875 Hz (formato por confirmar con el dispositivo).")
                        .font(Theme.font(13)).foregroundColor(Theme.muted)
                    Button("Exportar WAV") { exportOne() }.buttonStyle(AmberButton())
                    if let e = error { Text(e).font(Theme.font(13)).foregroundColor(Theme.error) }
                }.padding(16)
            }
        }
        .onAppear { audio = lib.audio(for: sample) }
        .onDisappear { lib.update(sample) }
        .sheet(isPresented: $showShare) { ShareSheet(items: sharing) }
    }

    private var effectsSection: some View {
        VStack(alignment: .leading) {
            Text("Efectos (no destructivos)").font(Theme.font(16, weight: .bold)).foregroundColor(Theme.text)
            slider("Graves", $sample.effects.eqLowGain, -12...12)
            slider("Agudos", $sample.effects.eqHighGain, -12...12)
            slider("Reverb", $sample.effects.reverbMix, 0...100)
            slider("Tono (cents) · experimental", $sample.effects.pitchCents, -1200...1200)
            Toggle("Compresor", isOn: $sample.effects.compress).font(Theme.font(15)).tint(Theme.amber)
        }
    }

    private func slider(_ t: String, _ v: Binding<Float>, _ r: ClosedRange<Float>) -> some View {
        VStack(alignment: .leading) {
            Text(t).font(Theme.font(13)).foregroundColor(Theme.muted)
            Slider(value: v, in: r).tint(Theme.amber)
        }
    }

    private func applyTrim() {
        let a = Int(start * Double(audio.count)), b = Int(end * Double(audio.count))
        let fade = Int(fadeMs / 1000 * Double(sample.sampleRate))
        let cut = Editing.fade(Editing.trim(audio, from: a, to: b), inSamples: fade, outSamples: fade)
        guard !cut.isEmpty else { error = "Selección vacía"; return }
        audio = cut; start = 0; end = 1
        lib.replaceAudio(sample, with: cut)
    }

    private func play() {
        do {
            let url = try Exporter.export(sample, audio: audio, targetRate: sample.sampleRate)
            player = try AVAudioPlayer(contentsOf: url); player?.play()
        } catch { self.error = "No se pudo reproducir: \(error.localizedDescription)" }
    }

    private func exportOne() {
        do { sharing = [try Exporter.export(sample, audio: audio)]; showShare = true }
        catch { self.error = "No se pudo exportar: \(error.localizedDescription)" }
    }

    private func addTag() {
        let t = tagText.trimmingCharacters(in: .whitespaces)
        if !t.isEmpty, !sample.tags.contains(t) { sample.tags.append(t) }
        tagText = ""
    }
}

struct WaveView: View {
    let peaks: [Float]; let start: Double; let end: Double
    var body: some View {
        Canvas { ctx, size in
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Theme.surface))
            guard !peaks.isEmpty else { return }
            let w = size.width / CGFloat(peaks.count), mid = size.height / 2
            for (i, p) in peaks.enumerated() {
                let x = CGFloat(i) * w, h = CGFloat(p) * mid
                let inside = Double(i) / Double(peaks.count) >= start && Double(i) / Double(peaks.count) <= end
                ctx.fill(Path(CGRect(x: x, y: mid - h, width: max(1, w - 0.5), height: max(1, h * 2))),
                         with: .color(inside ? Theme.amber : Theme.line))
            }
        }.clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel("Forma de onda")
    }
}

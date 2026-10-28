import SwiftUI
import AVFoundation

/// Onda con dos marcadores arrastrables (también ajustables con VoiceOver) que eligen el fragmento.
struct FragmentSelector: View {
    let peaks: [Float]
    @Binding var start: Double
    @Binding var end: Double
    let total: Double
    var playhead: Double? = nil

    private var minGap: Double { Materia.minFragment / max(total, 0.1) }

    var body: some View {
        GeometryReader { g in
            let w = g.size.width
            ZStack(alignment: .topLeading) {
                WaveBars(peaks: peaks, range: start...end, playhead: playhead)
                marker(w: w, x: w * start, h: g.size.height, label: "Marcador de inicio", value: start) { f in start = max(0, min(f, end - minGap)) }
                marker(w: w, x: w * end, h: g.size.height, label: "Marcador de final", value: end) { f in end = min(1, max(f, start + minGap)) }
            }
            .coordinateSpace(name: "frag")
            .contentShape(Rectangle())
        }
        .frame(height: 120)
    }

    private func marker(w: CGFloat, x: CGFloat, h: CGFloat, label: String, value: Double, set: @escaping (Double) -> Void) -> some View {
        Capsule().fill(Theme.text).frame(width: 4, height: h)
            .overlay(Circle().fill(Theme.amber).frame(width: 22, height: 22).offset(y: -h / 2 + 11))
            .frame(width: 44, height: h)
            .position(x: x, y: h / 2)
            .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .named("frag")).onChanged { v in
                set(Double(v.location.x / max(1, w)))
            })
            .accessibilityElement()
            .accessibilityLabel(label)
            .accessibilityValue(stamp(value * total))
            .accessibilityAdjustableAction { dir in
                let step = max(0.01, 0.1 / max(total, 1))
                set(dir == .increment ? value + step : value - step)
            }
    }
}

/// Hoja «Elige el fragmento»: de una toma larga se queda con 2–5 s, se oye en bucle y se guarda como «crudo» con su origen.
struct MateriaSheet: View {
    let take: Take
    var onSaved: (String) -> Void = { _ in }
    @EnvironmentObject var lib: LibraryStore
    @Environment(\.dismiss) private var dismiss
    @AppStorage("soundKind") private var kindRaw = "libre"
    @State private var start = 0.0
    @State private var end = 1.0
    @State private var peaks: [Float] = []
    @State private var origin = ""
    @State private var name = ""
    @State private var player: AVAudioPlayer?
    @State private var playing = false
    @State private var lastRestart = Date.distantPast
    @State private var playhead: Double?
    private let tick = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()

    private var total: Double { Double(take.audio.count) / Double(take.rate) }
    private var duration: Double { (end - start) * total }
    private var kind: Level.Kind { Level.Kind(rawValue: kindRaw) ?? .libre }
    private var placeholder: String { QuickSave.autoName(count: lib.samples.count, prefix: kind.prefix) }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenTitle(title: "Elige el fragmento", subtitle: "Toma de \(stamp(total)) · arrastra los marcadores",
                                trailing: AnyView(TextLink(title: "Descartar") { stop(); dismiss() }))
                    FragmentSelector(peaks: peaks, start: $start, end: $end, total: total, playhead: playhead)
                        .padding(8).background(Theme.surface).overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.line, lineWidth: 1)).clipShape(RoundedRectangle(cornerRadius: 16))
                    HStack {
                        Text(stamp(start * total)).foregroundColor(Theme.amber)
                        Spacer()
                        Text("Fragmento: \(stamp(duration))").foregroundColor(Theme.text)
                        Spacer()
                        Text(stamp(end * total)).foregroundColor(Theme.amber)
                    }.font(Theme.font(12, weight: .bold)).monospacedDigit()
                    if let a = Materia.advice(seconds: duration) {
                        Text(a).font(Theme.font(13)).foregroundColor(duration > Materia.softLimit ? Theme.amber : Theme.muted).accessibilityAddTraits(.updatesFrequently)
                    }
                    Button(playing ? "■ Parar" : "▶ Escuchar en bucle") { toggle() }.buttonStyle(OutlineButton(selected: playing))
                    SectionLabel("Origen")
                    TextField("Artista, disco, minuto… o «mi balcón»", text: $origin).font(Theme.font(15)).foregroundColor(Theme.text).card()
                    SectionLabel("Nombre")
                    TextField(placeholder, text: $name).font(Theme.font(15)).foregroundColor(Theme.text).card()
                    Button("Guardar como crudo") { save() }.buttonStyle(AmberButton()).padding(.top, 6)
                    Text("Se guarda solo el fragmento, sin tocar su volumen. Queda como «crudo» para trabajarlo después.")
                        .font(Theme.font(12)).foregroundColor(Theme.muted)
                }.padding(16)
            }
        }
        .onAppear {
            peaks = Editing.peaks(take.audio, buckets: 120)
            let w = Materia.bestWindow(take.audio, rate: take.rate, seconds: min(4, total))
            start = w.start; end = w.end
        }
        .onDisappear { stop() }
        .onChange(of: start) { _ in restartIfPlaying() }
        .onChange(of: end) { _ in restartIfPlaying() }
        .onReceive(tick) { _ in
            guard playing, let p = player, duration > 0 else { playhead = nil; return }
            playhead = start + p.currentTime / total
        }
    }

    private func fragment() -> [Float] { Materia.cut(take.audio, rate: take.rate, start: start, end: end) }

    private func toggle() { playing ? stop() : play() }

    private func play() {
        do {
            try AudioSessionConfig.activate()
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("materia-\(UUID().uuidString).wav")
            try WavIO.encode(fragment(), sampleRate: take.rate).write(to: url, options: .atomic)
            let p = try AVAudioPlayer(contentsOf: url)
            p.numberOfLoops = -1
            p.play()
            player = p; playing = true; lastRestart = Date()
        } catch { lib.errorMessage = "No se pudo reproducir: \(error.localizedDescription)" }
    }

    private func stop() { player?.stop(); player = nil; playing = false; playhead = nil }

    private func restartIfPlaying() {
        guard playing, Date().timeIntervalSince(lastRestart) > 0.15 else { return }
        play()
    }

    private func save() {
        stop()
        let out = fragment()
        let nm = name.trimmingCharacters(in: .whitespaces).isEmpty ? placeholder : name.trimmingCharacters(in: .whitespaces)
        guard var x = lib.add(name: nm, audio: out, sampleRate: take.rate) else { return }
        x.origin = origin.trimmingCharacters(in: .whitespaces)
        x.status = SampleStatus.crudo
        x.kind = kind == .libre ? nil : kind.rawValue
        lib.update(x)
        onSaved("Guardada como crudo · \(stamp(Double(out.count) / Double(take.rate)))" + (x.origin.isEmpty ? " · falta el origen (Detalles)" : ""))
        dismiss()
    }
}

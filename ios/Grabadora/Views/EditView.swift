import SwiftUI
import AVFoundation

/// Pestaña Editar: la grabación elegida en la Biblioteca.
struct EditView: View {
    @EnvironmentObject var lib: LibraryStore
    @EnvironmentObject var state: AppState

    var body: some View {
        if let s = lib.samples.first(where: { $0.id == state.selectedID }) {
            EditorBody(sample: s).id(s.id)
        } else {
            Screen(scroll: false) {
                VStack(spacing: 12) {
                    Spacer()
                    LogoView(size: 56).opacity(0.35)
                    Text("Elige una grabación").font(Theme.font(20, weight: .bold)).foregroundColor(Theme.text)
                    Text("Abre una en la Biblioteca para recortarla y darle carácter.")
                        .font(Theme.font(14)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
                    Button("Ir a la Biblioteca") { state.tab = .biblioteca }.buttonStyle(AmberButton(full: false))
                    Spacer()
                }.frame(maxWidth: .infinity)
            }
        }
    }
}

private func floatBinding(_ b: Binding<Float>) -> Binding<Double> {
    Binding(get: { Double(b.wrappedValue) }, set: { b.wrappedValue = Float($0) })
}

struct EditorBody: View {
    @EnvironmentObject var lib: LibraryStore
    @EnvironmentObject var state: AppState
    @State var sample: Sample
    @State private var audio: [Float] = []
    @State private var undo: [[Float]] = []
    @State private var redo: [[Float]] = []
    @State private var start = 0.0
    @State private var end = 1.0
    @State private var fadeMs = 10.0
    @State private var player: AVAudioPlayer?
    @State private var playhead: Double?
    @State private var loop = false
    @State private var showEffects = false
    @State private var confirmDelete = false
    @State private var message: String?
    private let tick = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()

    init(sample: Sample) { _sample = State(initialValue: sample) }

    private var count: Int { audio.count }
    private var rate: Double { Double(sample.sampleRate) }
    private var total: Double { Double(count) / rate }

    var body: some View {
        Screen {
            VStack(alignment: .leading, spacing: 14) {
                ScreenTitle(title: "Escuchar y editar")
                VStack(alignment: .leading, spacing: 2) {
                    TextField("Nombre", text: $sample.name).font(Theme.font(16, weight: .bold)).foregroundColor(Theme.text)
                    Text("\(stamp(total)) · mono · \(sample.sampleRate) Hz").font(Theme.font(12)).foregroundColor(Theme.muted)
                }
                waveEditor
                HStack {
                    Text(stamp(start * total)).foregroundColor(Theme.amber)
                    Spacer()
                    Text("Dura \(stamp((end - start) * total))").foregroundColor(Theme.muted)
                    Spacer()
                    Text(stamp(end * total)).foregroundColor(Theme.amber)
                }.font(Theme.font(12, weight: .bold)).monospacedDigit()
                transport
                SectionLabel("Herramientas")
                HStack(spacing: 8) {
                    Button("Recortar") { apply { Editing.fade(Editing.trim($0, from: Int(start * Double(count)), to: Int(end * Double(count))), inSamples: fadeSamples, outSamples: fadeSamples) }; start = 0; end = 1 }
                    Button("Normalizar") { apply { Editing.normalize($0) } }
                    Button("Fundido") { apply { Editing.fade($0, inSamples: fadeSamples, outSamples: fadeSamples) } }
                    Button("Efectos") { showEffects = true }.buttonStyle(OutlineButton(selected: !sample.effects.isNeutral))
                }.buttonStyle(OutlineButton()).font(Theme.font(13))
                SliderRow(title: "Fundido", valueText: "\(Int(fadeMs)) ms", value: $fadeMs, range: 0...200)
                SectionLabel("¿Qué hacemos con esta toma?")
                HStack(spacing: 8) {
                    Button("Descartar") { confirmDelete = true }.buttonStyle(OutlineButton(danger: true))
                    Button("Grabar") { state.tab = .grabar }.buttonStyle(OutlineButton())
                    Button("Guardar") { save() }.buttonStyle(AmberButton())
                }
                if let m = message { Text(m).font(Theme.font(13)).foregroundColor(Theme.muted).frame(maxWidth: .infinity, alignment: .center) }
                HStack(spacing: 10) {
                    Button("Deshacer") { step(from: &undo, to: &redo) }.disabled(undo.isEmpty)
                    Button("Rehacer") { step(from: &redo, to: &undo) }.disabled(redo.isEmpty)
                }.buttonStyle(OutlineButton()).font(Theme.font(13))
                Button("Exportar al K.O. II") { state.tab = .exportar }.buttonStyle(OutlineButton(selected: true))
            }
        }
        .onAppear {
            if let s = lib.samples.first(where: { $0.id == sample.id }) { sample = s }
            if undo.isEmpty { audio = lib.audio(for: sample) }
        }
        .onDisappear { player?.stop(); lib.update(sample) }
        .onReceive(tick) { _ in updatePlayhead() }
        .sheet(isPresented: $showEffects) { EffectsSheet(sample: $sample).presentationDetents([.large]) }
        .confirmationDialog("¿Borrar esta grabación?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Borrar", role: .destructive) { player?.stop(); lib.delete(sample); state.selectedID = nil; state.tab = .biblioteca }
        }
    }

    private var fadeSamples: Int { Int(fadeMs / 1000 * rate) }

    // MARK: onda con dos agarradores

    private var waveEditor: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                WaveBars(peaks: Editing.peaks(audio, buckets: 56), range: start...end, playhead: playhead)
                handle(at: start, width: g.size.width) { start = min(max(0, $0), end - 0.02) }
                handle(at: end, width: g.size.width) { end = max(min(1, $0), start + 0.02) }
            }
        }
        .frame(height: 150).padding(.horizontal, 10)
        .background(Theme.surface).overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func handle(at f: Double, width: CGFloat, set: @escaping (Double) -> Void) -> some View {
        let inner = width
        return Circle().fill(Theme.amber).frame(width: 26, height: 26)
            .overlay(Circle().stroke(Theme.bg, lineWidth: 2))
            .frame(width: 44, height: 44).contentShape(Rectangle())
            .position(x: inner * CGFloat(f), y: 75)
            .gesture(DragGesture(minimumDistance: 0).onChanged { set(Double($0.location.x / max(inner, 1))) })
            .accessibilityLabel("Marcador")
    }

    // MARK: transporte

    private var transport: some View {
        HStack {
            circle("backward.end.fill", "Al inicio") { player?.currentTime = 0; playhead = nil; if player?.isPlaying != true { player = nil } }
            Spacer()
            Button { togglePlay() } label: {
                Image(systemName: player?.isPlaying == true ? "pause.fill" : "play.fill").font(.system(size: 30))
                    .foregroundColor(Theme.ink).frame(width: 84, height: 84).background(Theme.amber).clipShape(Circle())
            }.accessibilityLabel("Reproducir")
            Spacer()
            circle("repeat", "Repetir", on: loop) { loop.toggle(); player?.numberOfLoops = loop ? -1 : 0 }
        }
    }

    private func circle(_ icon: String, _ label: String, on: Bool = false, action: @escaping () -> Void) -> some View {
        VStack(spacing: 6) {
            Button(action: action) {
                Image(systemName: icon).font(.system(size: 20)).foregroundColor(on ? Theme.amber : Theme.muted)
                    .frame(width: 60, height: 60).background(Theme.surface2).clipShape(Circle())
            }
            Text(label).font(Theme.font(12)).foregroundColor(Theme.muted)
        }
    }

    // MARK: acciones

    private func apply(_ f: ([Float]) -> [Float]) {
        let out = f(audio)
        guard !out.isEmpty else { message = "La selección quedó vacía"; return }
        undo.append(audio); redo = []; audio = out; message = nil
    }

    private func step(from a: inout [[Float]], to b: inout [[Float]]) {
        guard let x = a.popLast() else { return }
        b.append(audio); audio = x
    }

    private func save() {
        lib.replaceAudio(sample, with: audio)
        lib.update(sample)
        message = "Guardado"
    }

    private func togglePlay() {
        if let p = player, p.isPlaying { p.stop(); player = nil; playhead = nil; return }
        let a = Int(start * Double(count)), b = Int(end * Double(count))
        guard b > a else { return }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetooth])
            try AVAudioSession.sharedInstance().setActive(true)
            let url = try Exporter.export(sample, audio: Array(audio[a..<b]), targetRate: sample.sampleRate)
            let p = try AVAudioPlayer(contentsOf: url)
            p.numberOfLoops = loop ? -1 : 0
            p.play(); player = p
        } catch { message = "No se pudo reproducir: \(error.localizedDescription)" }
    }

    private func updatePlayhead() {
        guard let p = player else { return }
        if !p.isPlaying { player = nil; playhead = nil; return }
        playhead = start + (end - start) * (p.currentTime / max(p.duration, 0.001))
    }
}

// MARK: Efectos (pantallas 14 y 16, con lo que ya renderiza la app)

struct EffectsSheet: View {
    @Binding var sample: Sample
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ScreenTitle(title: "Efectos", trailing: AnyView(TextLink(title: "Restaurar") { sample.effects = EffectParams() }))
                    SliderRow(title: "Tono", valueText: String(format: "%+.0f semitonos", Double(sample.effects.pitchCents) / 100),
                              value: Binding(get: { Double(sample.effects.pitchCents) / 100 }, set: { sample.effects.pitchCents = Float($0.rounded() * 100) }), range: -12...12)
                    Text("Calidad del cambio de tono por validar.").font(Theme.font(12)).foregroundColor(Theme.muted)
                    SliderRow(title: "Graves", valueText: String(format: "%+.0f dB", Double(sample.effects.eqLowGain)), value: floatBinding($sample.effects.eqLowGain), range: -12...12)
                    SliderRow(title: "Agudos", valueText: String(format: "%+.0f dB", Double(sample.effects.eqHighGain)), value: floatBinding($sample.effects.eqHighGain), range: -12...12)
                    SliderRow(title: "Reverb corta", valueText: "\(Int(sample.effects.reverbMix)) %", value: floatBinding($sample.effects.reverbMix), range: 0...100)
                    ToggleRow(title: "Compresor", subtitle: "Aplana los picos y sube el cuerpo", isOn: $sample.effects.compress)
                    Text("El original nunca se modifica.").font(Theme.font(13)).foregroundColor(Theme.muted).frame(maxWidth: .infinity, alignment: .center)
                    TextLink(title: "Volver al original") { sample.effects = EffectParams() }.frame(maxWidth: .infinity)
                    Button("Listo") { dismiss() }.buttonStyle(AmberButton())
                }.padding(16)
            }
        }
    }
}

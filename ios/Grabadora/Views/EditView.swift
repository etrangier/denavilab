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
    @EnvironmentObject var met: Metronome
    @State var sample: Sample
    @State private var audio: [Float] = []
    @State private var peaks: [Float] = []
    @State private var peakDB: Float = 0
    @State private var undo: [[Float]] = []
    @State private var redo: [[Float]] = []
    @State private var start = 0.0
    @State private var end = 1.0
    @State private var fadeMs = 10.0
    @State private var player: AVAudioPlayer?
    @State private var playhead: Double?
    @State private var loop = false
    @State private var showEffects = false
    @State private var showChop = false
    @State private var showPrecise = false
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
                    Text("\(stamp(total)) · mono · \(sample.sampleRate) Hz · pico \(Int(peakDB)) dB").font(Theme.font(12)).foregroundColor(Theme.muted)
                    if peakDB < -30 && !audio.isEmpty { Text("Nivel muy bajo: usa Normalizar para oírla bien.").font(Theme.font(12)).foregroundColor(Theme.amber) }
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
                Button("Edición precisa (zoom)") { showPrecise = true }.buttonStyle(OutlineButton(selected: true))
                Button("Chop en pads") { showChop = true }.buttonStyle(OutlineButton())
                SliderRow(title: "Fundido", valueText: "\(Int(fadeMs)) ms", value: $fadeMs, range: 0...200)
                bpmCard
                FolderPicker(
                    folder: Binding(get: { sample.folder }, set: { sample.folder = $0; lib.update(sample) }),
                    sub: Binding(get: { sample.subfolder }, set: { sample.subfolder = $0; lib.update(sample) }))
                Button("Sugerir carpeta") { suggestFolder() }.buttonStyle(OutlineButton())
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
            if undo.isEmpty { audio = lib.audio(for: sample); refreshPeaks() }
        }
        .onDisappear { player?.stop(); lib.update(sample) }
        .onReceive(tick) { _ in updatePlayhead() }
        .sheet(isPresented: $showPrecise) {
            PreciseEditSheet(audio: audio, rate: sample.sampleRate, start: Int(start * Double(count)), end: Int(end * Double(count))) { range, fadeIn, fadeOut in
                apply { Editing.fade(Array($0[range]), inSamples: fadeIn, outSamples: fadeOut) }
                start = 0; end = 1
            }.presentationDetents([.large])
        }
        .sheet(isPresented: $showChop) { ChopSheet(sample: sample, audio: audio).presentationDetents([.large]) }
        .sheet(isPresented: $showEffects, onDismiss: { lib.update(sample) }) { EffectsSheet(sample: $sample, audio: audio).presentationDetents([.large]) }
        .confirmationDialog("¿Borrar esta grabación?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Borrar", role: .destructive) { player?.stop(); lib.delete(sample); state.selectedID = nil; state.tab = .biblioteca }
        }
    }

    private var bpmCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Tempo").font(Theme.font(15, weight: .medium)).foregroundColor(Theme.text)
                Spacer()
                Text(sample.bpm.map { "≈ \(Int($0.rounded())) BPM" } ?? "sin detectar").font(Theme.font(14)).foregroundColor(sample.bpm == nil ? Theme.muted : Theme.amber)
            }
            HStack(spacing: 8) {
                Button("Detectar BPM") { detectBPM() }.buttonStyle(OutlineButton())
                if let b = sample.bpm {
                    Button("Usar en el metrónomo") { met.bpm = min(300, max(30, b.rounded())); message = "Metrónomo a \(Int(b.rounded())) BPM" }
                        .buttonStyle(OutlineButton(selected: true))
                }
            }.font(Theme.font(13))
            Text("Funciona mejor con pulso claro y al menos 2 segundos.").font(Theme.font(12)).foregroundColor(Theme.muted)
        }.card()
    }

    private func detectBPM() {
        guard let r = Editing.estimateBPM(audio, rate: sample.sampleRate) else {
            message = "No encuentro un pulso claro en esta toma"; return
        }
        sample.bpm = r.bpm; lib.update(sample)
        message = String(format: "≈ %.0f BPM · confianza %.0f %%", r.bpm, r.confidence * 100)
    }

    private func suggestFolder() {
        message = "Analizando el sonido…"
        let a = audio, rate = sample.sampleRate
        Task {
            guard let s = FolderMapper.suggest(from: await SoundClassifier.classify(a, rate: rate)) else {
                message = "Sin sugerencia clara: elige la carpeta a mano"; return
            }
            sample.folder = s.folder; sample.subfolder = s.sub; lib.update(sample)
            message = "Sugerida: \(s.title)"
        }
    }

    private var fadeSamples: Int { Int(fadeMs / 1000 * rate) }

    // MARK: onda con dos agarradores

    private var waveEditor: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                WaveBars(peaks: peaks, range: start...end, playhead: playhead)
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
        refreshPeaks()
    }

    private func refreshPeaks() { peaks = Editing.peaks(audio, buckets: 56); peakDB = Editing.peakDB(audio) }

    private func step(from a: inout [[Float]], to b: inout [[Float]]) {
        guard let x = a.popLast() else { return }
        b.append(audio); audio = x
        refreshPeaks()
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
            try AudioSessionConfig.activate()
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

// MARK: Efectos (pantallas 14 y 16)

struct EffectsSheet: View {
    @Binding var sample: Sample
    let audio: [Float]
    @EnvironmentObject var lib: LibraryStore
    @Environment(\.dismiss) private var dismiss
    @State private var tab = 0
    @State private var after = true          // Después (con efectos) / Antes (original)
    @State private var player: AVAudioPlayer?
    @State private var message: String?

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ScreenTitle(title: "Efectos", trailing: AnyView(TextLink(title: "Restaurar") { sample.effects = EffectParams() }))
                    HStack(spacing: 8) {
                        Button("Antes") { after = false }.buttonStyle(OutlineButton(selected: !after))
                        Button("Después") { after = true }.buttonStyle(OutlineButton(selected: after))
                    }
                    Button(player?.isPlaying == true ? "Parar" : (after ? "Escuchar con efectos" : "Escuchar el original")) { togglePlay() }
                        .buttonStyle(AmberButton())
                    Text("Cambia entre Antes y Después mientras suena para comparar. Se oyen los primeros 8 segundos.")
                        .font(Theme.font(12)).foregroundColor(Theme.muted)
                    HStack(spacing: 8) {
                        Button("Tono y EQ") { tab = 0 }.buttonStyle(OutlineButton(selected: tab == 0))
                        Button("Carácter") { tab = 1 }.buttonStyle(OutlineButton(selected: tab == 1))
                    }
                    if tab == 0 { toneTab } else { characterTab }
                    if let m = message { Text(m).font(Theme.font(12)).foregroundColor(Theme.muted) }
                    Text("El original nunca se modifica.").font(Theme.font(13)).foregroundColor(Theme.muted).frame(maxWidth: .infinity, alignment: .center)
                    TextLink(title: "Volver al original") { sample.effects = EffectParams() }.frame(maxWidth: .infinity)
                    Button("Guardar como copia") { saveCopy() }.buttonStyle(OutlineButton(selected: true)).disabled(sample.effects.isNeutral)
                    Button("Listo") { player?.stop(); dismiss() }.buttonStyle(OutlineButton())
                }.padding(16)
            }
        }
        .onChange(of: after) { _ in
            if player?.isPlaying == true { start(at: player?.currentTime ?? 0) }   // A/B sin perder el punto
        }
        .onDisappear { player?.stop() }
    }

    @ViewBuilder private var toneTab: some View {
        SliderRow(title: "Tono", valueText: String(format: "%+.0f semitonos", Double(sample.effects.pitchCents) / 100),
                  value: Binding(get: { Double(sample.effects.pitchCents) / 100 }, set: { sample.effects.pitchCents = Float($0.rounded() * 100) }), range: -12...12)
        Text("Calidad del cambio de tono por validar.").font(Theme.font(12)).foregroundColor(Theme.muted)
        SliderRow(title: "Graves", valueText: String(format: "%+.0f dB", Double(sample.effects.eqLowGain)), value: floatBinding($sample.effects.eqLowGain), range: -12...12)
        SliderRow(title: "Agudos", valueText: String(format: "%+.0f dB", Double(sample.effects.eqHighGain)), value: floatBinding($sample.effects.eqHighGain), range: -12...12)
        SliderRow(title: "Reverb corta", valueText: "\(Int(sample.effects.reverbMix)) %", value: floatBinding($sample.effects.reverbMix), range: 0...100)
    }

    @ViewBuilder private var characterTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: $sample.effects.compress) {
                Text("Compresor").font(Theme.font(15, weight: .bold)).foregroundColor(Theme.text)
            }.tint(Theme.amber)
            if sample.effects.compress {
                HStack(spacing: 8) {
                    ForEach([(0, "Suave"), (1, "Medio"), (2, "Fuerte")], id: \.0) { m in
                        Chip(title: m.1, selected: sample.effects.compressMode == m.0) { sample.effects.compressMode = m.0 }
                    }
                }
                let s = Dynamics.settings(sample.effects.compressMode)
                Text("Umbral \(Int(s.threshold)) dB · relación \(Int(s.ratio)):1").font(Theme.font(12)).foregroundColor(Theme.muted)
            }
        }.card()
        VStack(alignment: .leading, spacing: 10) {
            Text("Grit · estilo del sonido").font(Theme.font(15, weight: .bold)).foregroundColor(Theme.text)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(GritStyle.allCases, id: \.self) { g in
                    Button(g.title) { sample.effects.grit = g }.buttonStyle(OutlineButton(selected: sample.effects.grit == g)).font(Theme.font(13))
                }
            }
            if sample.effects.grit != .ninguno {
                Text("Cantidad  \(Int(sample.effects.gritAmount)) %").font(Theme.font(13)).foregroundColor(Theme.amber)
                Slider(value: floatBinding($sample.effects.gritAmount), in: 0...100).tint(Theme.amber)
            }
        }.card()
    }

    private func togglePlay() {
        if player?.isPlaying == true { player?.stop(); player = nil } else { start(at: 0) }
    }

    /// Primeros 8 s, con o sin efectos, desde el punto indicado.
    private func start(at t: TimeInterval) {
        guard !audio.isEmpty else { return }
        do {
            try AudioSessionConfig.activate()
            var s = sample
            if !after { s.effects = EffectParams() }
            let url = try Exporter.export(s, audio: Array(audio.prefix(sample.sampleRate * 8)), targetRate: sample.sampleRate)
            let p = try AVAudioPlayer(contentsOf: url)
            p.currentTime = min(t, max(0, p.duration - 0.05))
            p.play(); player = p
            message = nil
        } catch { message = "No se pudo reproducir: \(error.localizedDescription)" }
    }

    /// Renderiza la toma entera con los efectos y la guarda como grabación nueva; el original no cambia.
    private func saveCopy() {
        let a = audio, rate = sample.sampleRate, params = sample.effects
        let name = sample.name + " (copia)", folder = sample.folder, sub = sample.subfolder
        message = "Creando la copia…"
        Task {
            do {
                let out = try await Task.detached { try EffectRenderer.render(a, sampleRate: rate, params: params) }.value
                guard var x = lib.add(name: name, audio: out, sampleRate: rate) else { message = "No se pudo guardar la copia"; return }
                x.folder = folder; x.subfolder = sub; lib.update(x)
                message = "Copia guardada en la Biblioteca"
            } catch { message = "No se pudo crear la copia: \(error.localizedDescription)" }
        }
    }
}

import SwiftUI

struct Take: Identifiable { let id = UUID(); let audio: [Float]; let rate: Int }

func stamp(_ t: Double) -> String {
    let c = Int((t * 100).rounded())
    return String(format: "%02d:%02d.%02d", c / 6000, (c / 100) % 60, c % 100)
}

struct RecordView: View {
    @EnvironmentObject var rec: Recorder
    @EnvironmentObject var lib: LibraryStore
    @EnvironmentObject var met: Metronome
    @EnvironmentObject var state: AppState
    @State private var take: Take?
    @State private var showRetro = false
    @State private var showMetro = false
    @State private var showQuick = false
    @State private var savedNote: String?

    private var recording: Bool { rec.state == .recording }
    private var db: Double { rec.level > 0.0001 ? Double(20 * log10(rec.level)) : -60 }

    var body: some View {
        Screen {
            VStack(spacing: 14) {
                header
                HStack {
                    Text("Grabar sample").font(Theme.font(28, weight: .bold)).foregroundColor(Theme.text)
                    Spacer()
                    Button { showMetro = true } label: {
                        Text("\(Int(met.bpm)) BPM").font(Theme.font(13, weight: .bold)).foregroundColor(Theme.amber)
                            .padding(.horizontal, 12).frame(minHeight: 32)
                            .overlay(Capsule().stroke(Theme.amber, lineWidth: 1.5))
                    }
                }
                if rec.micDenied { deniedCard } else {
                    Text("Entrada · Micrófono del iPhone").font(Theme.font(14, weight: .medium)).foregroundColor(Theme.text).card()
                    levelCard
                    waveCard
                    Text(stamp(rec.elapsed)).font(Theme.font(44, weight: .bold)).foregroundColor(recording ? Theme.text : Theme.muted)
                        .monospacedDigit()
                    Text(bufferText).font(Theme.font(13)).foregroundColor(Theme.muted)
                    controls
                    Text("WAV · 16 bit · mono · 46 875 Hz").font(Theme.font(14, weight: .bold)).foregroundColor(Theme.amber)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.amber, lineWidth: 1.5))
                    if rec.clipped { Text("Clip: baja la ganancia de entrada").font(Theme.font(13)).foregroundColor(Theme.error) }
                }
                if let m = rec.errorMessage { Text(m).font(Theme.font(13)).foregroundColor(Theme.error) }
                if let n = savedNote { Text(n).font(Theme.font(13)).foregroundColor(Theme.amber).multilineTextAlignment(.center) }
            }
        }
        .task { await rec.startListening() }
        .sheet(item: $take) { t in SaveSheet(take: t) }
        .sheet(isPresented: $showRetro) {
            RetroSheet { audio in
                showRetro = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { take = Take(audio: audio, rate: rec.sampleRate) }
            }.presentationDetents([.large])
        }
        .sheet(isPresented: $showMetro) { MetronomeSheet().presentationDetents([.large]) }
        .sheet(isPresented: $showQuick) { QuickSaveSheet().presentationDetents([.large]) }
    }

    /// Al parar: guardado rápido si está activo; si no, hoja para elegir nombre y carpeta.
    private func finish(_ a: [Float]) {
        guard !a.isEmpty else { return }
        let s = QuickSave.Settings.load()
        guard s.enabled else { take = Take(audio: a, rate: rec.sampleRate); return }
        let out = QuickSave.process(a, rate: rec.sampleRate, s)
        let name = QuickSave.autoName(count: lib.samples.count)
        let rate = rec.sampleRate
        let before = Double(a.count) / Double(rate), after = Double(out.count) / Double(rate)
        Task {
            var sug: Suggestion?
            if s.suggest { sug = FolderMapper.suggest(from: await SoundClassifier.classify(out, rate: rate)) }
            guard var x = lib.add(name: name, audio: out, sampleRate: rate) else { return }
            x.folder = sug?.folder ?? LibraryStore.unsorted; x.subfolder = sug?.sub
            lib.update(x)
            savedNote = "Guardada: \(name) · \(stamp(before)) → \(stamp(after))" + (sug.map { " · \($0.title)" } ?? "")
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            savedNote = nil
        }
    }

    private var bufferText: String {
        rec.state == .idle ? "Búfer apagado" : "Búfer: últimos \(Int(min(rec.retroSeconds, max(rec.bufferedSeconds, 0)))) s"
    }

    private var header: some View {
        HStack {
            HStack(spacing: 8) {
                LogoView(size: 26)
                Text("DenaviLab").font(Theme.font(16, weight: .bold)).foregroundColor(Theme.text)
            }
            Spacer()
            Button { showQuick = true } label: {
                Image(systemName: "bolt.fill").font(.system(size: 14)).foregroundColor(Theme.amber)
                    .frame(width: 44, height: 44)
            }.accessibilityLabel("Guardado rápido")
            Button { state.tab = .exportar } label: {
                Text("→ K.O. II").font(Theme.font(13, weight: .bold)).foregroundColor(Theme.amber)
                    .padding(.horizontal, 12).frame(minHeight: 32)
                    .overlay(Capsule().stroke(Theme.amber, lineWidth: 1.5))
            }
        }
    }

    private var levelCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Nivel").font(Theme.font(13)).foregroundColor(Theme.muted)
                Spacer()
                Text(rec.state == .idle ? "—" : "\(Int(db)) dB").font(Theme.font(13, weight: .medium))
                    .foregroundColor(rec.clipped ? Theme.error : Theme.amber)
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surface2)
                    Capsule().fill(rec.clipped ? Theme.error : Theme.amber)
                        .frame(width: g.size.width * CGFloat(min(1, rec.level)))
                }
            }.frame(height: 10)
        }.card()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Nivel de entrada").accessibilityValue("\(Int(rec.level * 100)) por ciento")
    }

    private var waveCard: some View {
        ZStack {
            if rec.liveWave.isEmpty || rec.state == .idle {
                Text("Toca el botón para grabar tu primer sample").font(Theme.font(14)).foregroundColor(Theme.muted)
                    .multilineTextAlignment(.center).padding(.horizontal, 30)
            } else {
                WaveBars(peaks: rec.liveWave).padding(14)
            }
        }
        .frame(maxWidth: .infinity).frame(height: 170)
        .background(Theme.surface)
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var controls: some View {
        HStack(alignment: .center) {
            sideButton("Escuchar", icon: rec.monitoring ? "ear.fill" : "ear", on: rec.monitoring) { rec.setMonitoring(!rec.monitoring) }
            Spacer()
            Button {
                if recording { finish(rec.stopRecording()) }
                else { rec.startRecording() }
            } label: {
                ZStack {
                    Circle().stroke(Theme.amber, lineWidth: 4).frame(width: 96, height: 96)
                    if recording { RoundedRectangle(cornerRadius: 10).fill(Theme.amber).frame(width: 40, height: 40) }
                    else { Circle().fill(Theme.amber).frame(width: 72, height: 72) }
                }
            }
            .disabled(rec.state == .idle)
            .accessibilityLabel(recording ? "Parar grabación" : "Grabar")
            Spacer()
            sideButton("Retro", icon: "clock.arrow.circlepath", on: false) { showRetro = true }
        }.padding(.vertical, 4)
    }

    private func sideButton(_ label: String, icon: String, on: Bool, action: @escaping () -> Void) -> some View {
        VStack(spacing: 6) {
            Button(action: action) {
                Image(systemName: icon).font(.system(size: 22)).foregroundColor(on ? Theme.amber : Theme.muted)
                    .frame(width: 64, height: 64).background(Theme.surface2).clipShape(Circle())
            }
            Text(label).font(Theme.font(13)).foregroundColor(Theme.muted)
        }
    }

    private var deniedCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sin acceso al micrófono").font(Theme.font(16, weight: .bold)).foregroundColor(Theme.error)
            Text("Actívalo en Ajustes › Grabadora para poder grabar.").font(Theme.font(14)).foregroundColor(Theme.muted)
            Button("Abrir Ajustes") {
                if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
            }.buttonStyle(AmberButton())
        }.card()
    }
}

// MARK: Captura retroactiva (pantalla 9)

struct RetroSheet: View {
    @EnvironmentObject var rec: Recorder
    @Environment(\.dismiss) private var dismiss
    let onCapture: ([Float]) -> Void
    @State private var peaks: [Float] = []
    private let maxSeconds = 30.0

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenTitle(title: "Captura retroactiva", subtitle: "Guarda lo que acaba de sonar")
                    VStack(spacing: 6) {
                        WaveBars(peaks: peaks, range: (1 - rec.retroSeconds / maxSeconds)...1).frame(height: 120).padding(12)
                            .background(Theme.surface).overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.line, lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                        HStack { Text("−30 s"); Spacer(); Text("ahora") }.font(Theme.font(12)).foregroundColor(Theme.muted)
                    }
                    SliderRow(title: "Cuánto atrás", valueText: "Últimos \(Int(rec.retroSeconds)) s",
                              value: Binding(get: { rec.retroSeconds }, set: { rec.retroSeconds = $0.rounded() }), range: 1...30)
                    ToggleRow(title: "Búfer siempre activo", subtitle: "Escucha sin guardar hasta que lo pidas",
                              isOn: Binding(get: { rec.state != .idle },
                                            set: { on in if on { Task { await rec.startListening() } } else { rec.stopListening() } }))
                    Text("El búfer se borra al cerrar la app. No se envía a ningún lado.")
                        .font(Theme.font(13)).foregroundColor(Theme.muted).frame(maxWidth: .infinity, alignment: .center)
                    Button("Guardar los últimos \(Int(rec.retroSeconds)) s") {
                        let a = rec.captureRetro()
                        if a.isEmpty { return }
                        onCapture(a)
                    }.buttonStyle(AmberButton()).disabled(rec.state == .idle)
                    TextLink(title: "Cerrar") { dismiss() }.frame(maxWidth: .infinity)
                }.padding(16)
            }
        }
        .onAppear { refresh() }
        .onChange(of: rec.bufferedSeconds) { _ in refresh() }
    }

    private func refresh() {
        let samples = rec.sampleRate * Int(maxSeconds)
        peaks = Editing.peaks(rec.lastSamples(samples), buckets: 48)
    }
}

// MARK: Guardar grabación (pantalla 21)

struct SaveSheet: View {
    let take: Take
    @EnvironmentObject var lib: LibraryStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var folder = LibraryStore.unsorted
    @State private var sub: String?
    @State private var suggestion: Suggestion?
    @State private var analyzing = true
    @State private var showSuggestion = true

    private var seconds: Double { Double(take.audio.count) / Double(take.rate) }
    private var defaultName: String {
        let f = DateFormatter(); f.locale = Locale(identifier: "es_ES"); f.dateFormat = "d MMM · HH:mm"
        return "Grabación " + f.string(from: Date())
    }
    private var subs: [String] { LibraryStore.folderInfo.first { $0.name == folder }?.subs ?? [] }
    private var destination: String { sub.map { "\(folder) › \($0)" } ?? folder }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenTitle(title: "Guardar grabación", trailing: AnyView(TextLink(title: "Cancelar") { dismiss() }))
                    VStack(alignment: .leading, spacing: 6) {
                        Text(name.isEmpty ? defaultName : name).font(Theme.font(15, weight: .bold)).foregroundColor(Theme.text)
                        Text("\(stamp(seconds)) · WAV mono · \(take.rate) Hz").font(Theme.font(12)).foregroundColor(Theme.muted)
                        WaveBars(peaks: Editing.peaks(take.audio, buckets: 40)).frame(height: 50)
                    }.card()
                    suggestionCard
                    SectionLabel("Nombre")
                    TextField(defaultName, text: $name).font(Theme.font(15)).foregroundColor(Theme.text).card()
                    SectionLabel("Carpeta")
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                        ForEach(LibraryStore.folderInfo, id: \.name) { f in
                            Button(f.name) { folder = f.name; sub = nil }.buttonStyle(OutlineButton(selected: folder == f.name))
                                .font(Theme.font(13))
                        }
                    }
                    if !subs.isEmpty {
                        SectionLabel("Subcarpeta")
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                            ForEach(subs, id: \.self) { s in Chip(title: s, selected: sub == s) { sub = (sub == s) ? nil : s } }
                        }
                    }
                    Button("Guardar en \(destination)") { save() }.buttonStyle(AmberButton()).padding(.top, 6)
                    Text("La sugerencia es automática y puede fallar; siempre puedes cambiarla. Sin clasificar la deja en la bandeja.")
                        .font(Theme.font(13)).foregroundColor(Theme.muted).frame(maxWidth: .infinity, alignment: .center)
                }.padding(16)
            }
        }
        .task {
            let scores = await SoundClassifier.classify(take.audio, rate: take.rate)
            suggestion = FolderMapper.suggest(from: scores)
            analyzing = false
        }
    }

    @ViewBuilder private var suggestionCard: some View {
        if analyzing {
            Text("Analizando el sonido…").font(Theme.font(13)).foregroundColor(Theme.muted).card()
        } else if let s = suggestion, showSuggestion {
            VStack(alignment: .leading, spacing: 10) {
                Text("SUGERENCIA AUTOMÁTICA").font(Theme.font(12, weight: .medium)).foregroundColor(Theme.amber).tracking(0.8)
                HStack {
                    Text(s.title).font(Theme.font(20, weight: .bold)).foregroundColor(Theme.text)
                    Spacer()
                    Text("\(Int((s.confidence * 100).rounded())) %").font(Theme.font(12, weight: .bold)).foregroundColor(Theme.amber)
                        .padding(.horizontal, 10).frame(minHeight: 28).background(Theme.surface2).clipShape(Capsule())
                }
                HStack(spacing: 8) {
                    Button("Aceptar") { folder = s.folder; sub = s.sub; showSuggestion = false }.buttonStyle(AmberButton())
                    Button("Cambiar") { showSuggestion = false }.buttonStyle(OutlineButton())
                }
            }.card(highlight: true)
        } else if suggestion == nil {
            Text("Sin sugerencia: no reconozco el sonido con seguridad. Elige una carpeta o déjala en Sin clasificar.")
                .font(Theme.font(13)).foregroundColor(Theme.muted).card()
        }
    }

    private func save() {
        guard var x = lib.add(name: name.isEmpty ? defaultName : name,
                              audio: QuickSave.process(take.audio, rate: take.rate, QuickSave.Settings.load()), sampleRate: take.rate) else { return }
        x.folder = folder; x.subfolder = sub
        lib.update(x)
        dismiss()
    }
}

// MARK: Metrónomo (pantalla 10, simplificada)

struct MetronomeSheet: View {
    @EnvironmentObject var met: Metronome
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: "Metrónomo", trailing: AnyView(TextLink(title: "Listo") { dismiss() }))
                VStack(spacing: 10) {
                    HStack {
                        SectionLabel("Tempo"); Spacer()
                        TextLink(title: "Marcar con toques") { met.tap() }
                    }
                    HStack {
                        stepper("minus") { met.bpm = max(30, met.bpm - 1) }
                        Spacer()
                        Text("\(Int(met.bpm))").font(Theme.font(56, weight: .bold)).foregroundColor(Theme.text).monospacedDigit()
                        Spacer()
                        stepper("plus") { met.bpm = min(300, met.bpm + 1) }
                    }
                    Text("BPM · como en el K.O. II").font(Theme.font(13)).foregroundColor(Theme.muted)
                    Slider(value: $met.bpm, in: 30...300, step: 1).tint(Theme.amber)
                }.card()
                Button(met.running ? "Parar" : "Iniciar") { met.running ? met.stop() : met.start() }.buttonStyle(AmberButton())
                Text("El pulso suena por el altavoz o los auriculares.").font(Theme.font(13)).foregroundColor(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            }.padding(16)
        }
    }

    private func stepper(_ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 22, weight: .bold)).foregroundColor(Theme.text)
                .frame(width: 56, height: 56).background(Theme.surface2).clipShape(Circle())
        }
    }
}

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
    @State private var materiaTake: Take?
    @State private var tempoBusy = false
    @State private var tempoLeft = 0
    @State private var tempoCancel = false
    @State private var tempoResult: Tempo.Outcome?
    @AppStorage("captureMode") private var captureMode = "materia"        // materia (por defecto) o libre
    @State private var showRetro = false
    @State private var showMetro = false
    @State private var showQuick = false
    @State private var showManual = false
    @AppStorage("firstTakeDismissed") private var firstTakeDismissed = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var savedNote: String?
    @AppStorage("soundKind") private var kindRaw = "libre"          // tipo de sonido: libre, textura, bajo, batería

    private var kind: Level.Kind { Level.Kind(rawValue: kindRaw) ?? .libre }

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
                        Text(met.mode == .bar ? "Con compás · \(Int(met.bpm)) BPM" : "Libre").font(Theme.font(13, weight: .bold)).foregroundColor(Theme.amber)
                            .padding(.horizontal, 12).frame(minHeight: 32)
                            .overlay(Capsule().stroke(Theme.amber, lineWidth: 1.5))
                    }
                }
                if rec.micDenied { deniedCard } else {
                    Text("Entrada · Micrófono del iPhone").font(Theme.font(14, weight: .medium)).foregroundColor(Theme.text).card()
                    modeCard
                    kindCard
                    levelCard
                    tempoCard
                    waveCard
                    Text(timerText).font(Theme.font(44, weight: .bold)).foregroundColor(recording ? Theme.text : Theme.muted)
                        .monospacedDigit()
                    if met.running && met.mode == .bar { beatDots }
                    if let n = met.notice, met.mode == .bar { Text(n).font(Theme.font(12)).foregroundColor(Theme.muted).multilineTextAlignment(.center) }
                    Text(bufferText).font(Theme.font(13)).foregroundColor(Theme.muted)
                    if firstTime { Text("↓ Empieza aquí").font(Theme.font(13, weight: .bold)).foregroundColor(Theme.amber)
                        .padding(.horizontal, 14).frame(minHeight: 32).overlay(Capsule().stroke(Theme.amber, lineWidth: 1.5)) }
                    controls
                    TextLink(title: "Manual técnico") { showManual = true }.frame(maxWidth: .infinity)
                    Text("WAV · 16 bit · mono · 46 875 Hz").font(Theme.font(14, weight: .bold)).foregroundColor(Theme.amber)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.amber, lineWidth: 1.5))
                    if rec.clipped { Text("Clip: baja la ganancia de entrada").font(Theme.font(13)).foregroundColor(Theme.error) }
                    else if recording, kind.maxSec > 0, rec.elapsed > kind.maxSec {
                        Text("Ya pasa de \(Int(kind.maxSec)) s: para \(kind.title.lowercased()) conviene parar y grabar otra toma más corta")
                            .font(Theme.font(13)).foregroundColor(Theme.amber).multilineTextAlignment(.center)
                    }
                }
                if let m = rec.errorMessage { Text(m).font(Theme.font(13)).foregroundColor(Theme.error) }
                if lib.samples.count == 1 && !firstTakeDismissed && rec.state != .recording { firstTakeCard }
                if let n = savedNote { Text(n).font(Theme.font(13)).foregroundColor(Theme.amber).multilineTextAlignment(.center) }
            }
        }
        .task { await rec.startListening() }
        .onChange(of: scenePhase) { phase in
            if phase == .active { Task { await rec.startListening() } }   // p. ej. tras dar permiso en Ajustes
        }
        .onChange(of: rec.completedTake) { new in
            guard let a = new else { return }
            rec.completedTake = nil
            met.stop()
            finish(a)
        }
        .sheet(item: $take) { t in SaveSheet(take: t) }
        .sheet(item: $materiaTake) { t in
            MateriaSheet(take: t) { note in
                savedNote = note
                Task { try? await Task.sleep(nanoseconds: 5_000_000_000); savedNote = nil }
            }.presentationDetents([.large])
        }
        .sheet(isPresented: $showRetro) {
            RetroSheet { audio in
                showRetro = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    let t = Take(audio: audio, rate: rec.sampleRate)
                    if captureMode == "materia" { materiaTake = t } else { take = t }
                }
            }.presentationDetents([.large])
        }
        .sheet(isPresented: $showMetro) { MetronomeSheet().presentationDetents([.large]) }
        .sheet(isPresented: $showManual) { ManualView().presentationDetents([.large]) }
        .sheet(isPresented: $showQuick) { QuickSaveSheet().presentationDetents([.large]) }
    }

    /// Al parar: guardado rápido si está activo; si no, hoja para elegir nombre y carpeta.
    private func finish(_ a: [Float]) {
        guard !a.isEmpty else { return }
        if captureMode == "materia" { materiaTake = Take(audio: a, rate: rec.sampleRate); return }
        let s = QuickSave.Settings.load()
        guard s.enabled else { take = Take(audio: a, rate: rec.sampleRate); return }
        let out = QuickSave.process(a, rate: rec.sampleRate, s)
        let name = QuickSave.autoName(count: lib.samples.count, prefix: kind.prefix)
        let rate = rec.sampleRate, kindTag: String? = kind == .libre ? nil : kind.rawValue
        let before = Double(a.count) / Double(rate), after = Double(out.count) / Double(rate)
        Task {
            var sug: Suggestion?
            if s.suggest { sug = FolderMapper.suggest(from: await SoundClassifier.classify(out, rate: rate)) }
            guard var x = lib.add(name: name, audio: out, sampleRate: rate) else { return }
            x.folder = sug?.folder ?? LibraryStore.unsorted; x.subfolder = sug?.sub; x.kind = kindTag
            lib.update(x)
            savedNote = "Guardada: \(name) · \(stamp(before)) → \(stamp(after))" + (sug.map { " · \($0.title)" } ?? "")
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            savedNote = nil
        }
    }

    /// Escuchar tempo: 10 s por el micrófono, sin grabar, y dice el BPM.
    private var tempoCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Escuchar tempo").font(Theme.font(14, weight: .medium)).foregroundColor(Theme.text)
                Spacer()
                if case .bpm(let b, _)? = tempoResult { Text("≈ \(Int(b.rounded())) BPM").font(Theme.font(15, weight: .bold)).foregroundColor(Theme.amber) }
            }
            Text("Toca tu patrón sin grabar: la app oye \(Tempo.seconds) s por el micrófono y te dice el BPM.").font(Theme.font(12)).foregroundColor(Theme.muted)
            Button(tempoBusy ? "Escuchando… \(tempoLeft) s · tocar para cancelar" : "Escuchar tempo") { listenTempo() }
                .buttonStyle(AmberButton()).disabled(recording)
            switch tempoResult {
            case .failed(let m)?:
                Text(m).font(Theme.font(13)).foregroundColor(Theme.error)
            case .bpm(let b, let c)?:
                Text("Confianza \(Tempo.label(c)) (\(Int((c * 100).rounded())) %)." + (c < 0.15 ? " Escucha otra vez con un patrón más marcado." : ""))
                    .font(Theme.font(12)).foregroundColor(Theme.muted)
                HStack(spacing: 8) {
                    ForEach(Tempo.alternatives(b).prefix(1), id: \.self) { v in
                        Button("÷2 → \(Int(v.rounded()))") { tempoResult = .bpm(v, confidence: c) }.buttonStyle(OutlineButton())
                    }
                    Button("Usar en el metrónomo") { met.bpm = min(300, max(30, b.rounded())); savedNote = "Metrónomo a \(Int(met.bpm)) BPM" }.buttonStyle(OutlineButton(selected: true))
                    ForEach(Tempo.alternatives(b).dropFirst(), id: \.self) { v in
                        Button("×2 → \(Int(v.rounded()))") { tempoResult = .bpm(v, confidence: c) }.buttonStyle(OutlineButton())
                    }
                }.font(Theme.font(12))
                Text("Si suena a la mitad o al doble de lo que tocas, usa ÷2 o ×2.").font(Theme.font(12)).foregroundColor(Theme.muted)
            case nil:
                EmptyView()
            }
        }.card()
    }

    private func listenTempo() {
        if tempoBusy { tempoCancel = true; return }
        tempoBusy = true; tempoCancel = false; tempoResult = nil
        Task {
            if rec.state == .idle { await rec.startListening() }
            guard rec.state != .idle else {
                tempoResult = .failed(rec.micDenied ? "Sin acceso al micrófono. Actívalo en Ajustes." : "No se pudo encender el micrófono.")
                tempoBusy = false; return
            }
            var left = Tempo.seconds
            while left > 0 {
                tempoLeft = left
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if tempoCancel { tempoBusy = false; return }
                left -= 1
            }
            tempoResult = Tempo.analyze(rec.lastSamples(Tempo.seconds * rec.sampleRate), rate: rec.sampleRate)
            tempoBusy = false
        }
    }

    /// Modo de captura: «materia prima" (grabar 10–15 s y elegir un fragmento) o «captura libre» (la toma se guarda como sale).
    private var modeCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Modo de captura").font(Theme.font(14, weight: .medium)).foregroundColor(Theme.text)
            HStack(spacing: 8) {
                Chip(title: "Materia prima", selected: captureMode == "materia") { captureMode = "materia" }
                Chip(title: "Captura libre", selected: captureMode != "materia") { captureMode = "libre" }
            }
            Text(captureMode == "materia"
                 ? "Graba de 10 a \(Int(Materia.takeSeconds)) s (para sola a los \(Int(Materia.takeSeconds)) s), luego eliges un fragmento de 2 a 5 s y queda como «crudo»."
                 : "Como antes: la toma se guarda entera, con tu guardado rápido.")
                .font(Theme.font(12)).foregroundColor(Theme.muted)
        }.card()
    }

    /// Tipo de sonido: la app está pensada para sonidos cortos (texturas, bajos, baterías).
    private var kindCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tipo de sonido").font(Theme.font(14, weight: .medium)).foregroundColor(Theme.text)
            HStack(spacing: 8) {
                ForEach(Level.Kind.allCases, id: \.self) { k in Chip(title: k.title, selected: kind == k) { kindRaw = k.rawValue } }
            }
            Text(kind.hint).font(Theme.font(12)).foregroundColor(Theme.muted)
        }.card()
    }

    /// Aún no hay ninguna grabación: el diseño pide la burbuja y el halo del botón.
    private var firstTime: Bool { lib.samples.isEmpty && !recording && !rec.micDenied && rec.state != .idle }

    private var firstTakeCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Primera toma guardada").font(Theme.font(16, weight: .bold)).foregroundColor(Theme.text)
            Text("La encuentras en la Biblioteca. Desde ahí la recortas, le das carácter y la compartes en WAV.")
                .font(Theme.font(14)).foregroundColor(Theme.muted)
            Button("Ver la Biblioteca") { firstTakeDismissed = true; state.tab = .biblioteca }.buttonStyle(AmberButton())
            TextLink(title: "Entendido") { firstTakeDismissed = true }
        }.card(highlight: true)
    }

    private var timerText: String {
        guard rec.countInRemaining > 0 else { return stamp(rec.elapsed) }
        return "\(max(1, Int(ceil(rec.countInRemaining / (60 / met.bpm)))))"
    }

    private var beatDots: some View {
        HStack(spacing: 10) {
            ForEach(0..<met.beatsPerBar, id: \.self) { i in
                Circle().fill(i == met.beat ? Theme.amber : Theme.surface2).frame(width: 12, height: 12)
            }
        }.accessibilityHidden(true)
    }

    /// Con compás: arranca el metrónomo, la cuenta de entrada y el límite de compases; Libre: graba directamente.
    private func begin() {
        guard met.mode == .bar else {
            rec.startRecording(maxSamples: captureMode == "materia" ? Int(Materia.takeSeconds * Double(rec.sampleRate)) : nil)   // en materia prima la toma para sola a los 15 s
            return
        }
        let beat = 60 / met.bpm, rate = Double(rec.sampleRate)
        let lead = met.countIn ? Int(Double(met.beatsPerBar) * beat * rate) : 0
        met.start(forRecording: true)
        rec.startRecording(afterSamples: lead, maxSamples: Metronome.samples(bars: met.bars, beats: met.beatsPerBar, bpm: met.bpm, rate: rec.sampleRate))
    }

    private var bufferText: String {
        rec.state == .idle ? "Búfer apagado" : "Búfer: últimos \(Int(min(rec.retroSeconds, max(rec.bufferedSeconds, 0)))) s"
    }

    private var header: some View {
        HStack {
            Button { state.tab = .inicio } label: {
                HStack(spacing: 8) {
                    LogoView(size: 26)
                    Text("DenaviLab: Sounds").font(Theme.font(15, weight: .bold)).foregroundColor(Theme.text).lineLimit(1).minimumScaleFactor(0.8)
                }.frame(minHeight: 44)
            }.accessibilityLabel("Ir al inicio")
            Spacer()
            Button { showQuick = true } label: {
                Image(systemName: "bolt.fill").font(.system(size: 14)).foregroundColor(Theme.amber)
                    .frame(width: 44, height: 44)
            }.accessibilityLabel("Guardado rápido")
            Button { state.tab = .exportar } label: {
                Text("→ Compartir").font(Theme.font(13, weight: .bold)).foregroundColor(Theme.amber)
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
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(met.flash ? Theme.amber : Theme.line, lineWidth: met.flash ? 3 : 1))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var controls: some View {
        HStack(alignment: .center) {
            sideButton("Escuchar", icon: rec.monitoring ? "ear.fill" : "ear", on: rec.monitoring) { rec.setMonitoring(!rec.monitoring) }
            Spacer()
            Button {
                if recording { met.stop(); finish(rec.stopRecording()) }
                else if rec.state == .idle { Task { await rec.startListening() } }
                else { begin() }
            } label: {
                ZStack {
                    if firstTime { Circle().stroke(Theme.amber.opacity(0.25), lineWidth: 10).frame(width: 112, height: 112) }
                    Circle().stroke(Theme.amber, lineWidth: 4).frame(width: 96, height: 96)
                    if recording { RoundedRectangle(cornerRadius: 10).fill(Theme.amber).frame(width: 40, height: 40) }
                    else { Circle().fill(Theme.amber).frame(width: 72, height: 72) }
                }
            }
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
            Text("Actívalo en Ajustes › DenaviLab: Sounds para poder grabar.").font(Theme.font(14)).foregroundColor(Theme.muted)
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
    private let tick = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()

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
        .onReceive(tick) { _ in refresh() }
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
                    FolderPicker(folder: $folder, sub: $sub)
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

// MARK: Metrónomo (pantalla 10)

struct MetronomeSheet: View {
    @EnvironmentObject var met: Metronome
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenTitle(title: "Metrónomo", trailing: AnyView(TextLink(title: "Listo") { met.stop(); dismiss() }))
                    HStack(spacing: 8) {
                        Button("Libre") { met.mode = .free }.buttonStyle(OutlineButton(selected: met.mode == .free))
                        Button("Con compás") { met.mode = .bar }.buttonStyle(OutlineButton(selected: met.mode == .bar))
                    }
                    Text(met.mode == .bar
                         ? "Con compás, el metrónomo marca el tiempo 1 y la grabación empieza ahí. Libre graba tal como suena."
                         : "Libre graba tal como suena, sin metrónomo.")
                        .font(Theme.font(13)).foregroundColor(Theme.muted)
                    tempoCard
                    if met.mode == .bar { barCard; options }
                    Button(met.running ? "Parar prueba" : "Probar el pulso") { met.running ? met.stop() : met.start() }
                        .buttonStyle(OutlineButton(selected: met.running))
                    Button("Listo") { met.stop(); dismiss() }.buttonStyle(AmberButton())
                    Text("Los cambios valen para la próxima grabación.").font(Theme.font(13)).foregroundColor(Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .center)
                }.padding(16)
            }
        }
    }

    private var tempoCard: some View {
        VStack(spacing: 10) {
            HStack { SectionLabel("Tempo"); Spacer(); TextLink(title: "Marcar con toques") { met.tap() } }
            HStack {
                stepper("minus") { met.bpm = max(30, met.bpm - 1) }
                Spacer()
                Text("\(Int(met.bpm))").font(Theme.font(56, weight: .bold)).foregroundColor(Theme.text).monospacedDigit()
                Spacer()
                stepper("plus") { met.bpm = min(300, met.bpm + 1) }
            }
            Text("BPM · como en el K.O. II").font(Theme.font(13)).foregroundColor(Theme.muted)
        }.card()
    }

    private var barCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Compás")
            HStack(spacing: 8) {
                ForEach([(2, "2/4"), (3, "3/4"), (4, "4/4"), (6, "6/8")], id: \.0) { b in
                    Chip(title: b.1, selected: met.beatsPerBar == b.0) { met.beatsPerBar = b.0 }
                }
            }
            SectionLabel("Cuántos compases").padding(.top, 4)
            HStack(spacing: 8) {
                ForEach([(1, "1"), (2, "2"), (4, "4"), (8, "8"), (0, "Sin límite")], id: \.0) { b in
                    Chip(title: b.1, selected: met.bars == b.0) { met.bars = b.0 }
                }
            }
        }.card()
    }

    private var options: some View {
        VStack(spacing: 10) {
            ToggleRow(title: "Cuenta de entrada", subtitle: "\(met.beatsPerBar) clics antes de grabar", isOn: $met.countIn)
            ToggleRow(title: "Metrónomo en los audífonos", subtitle: "No queda dentro del audio", isOn: $met.headphonesOnly)
            ToggleRow(title: "Aviso visual", subtitle: "La pantalla late en cada tiempo", isOn: $met.visualFlash)
        }
    }

    private func stepper(_ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 22, weight: .bold)).foregroundColor(Theme.text)
                .frame(width: 56, height: 56).background(Theme.surface2).clipShape(Circle())
        }
    }
}

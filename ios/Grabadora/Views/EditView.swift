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
    @State private var savedAudio: [Float] = []           // lo último guardado: sirve para avisar de «no hay cambios»
    @State private var confirmOverwrite = false
    @State private var peaks: [Float] = []
    @State private var peakDB: Float = 0
    @State private var levelDBValue = -99                 // nivel típico (se calcula al cambiar la toma, no en cada dibujo)
    @State private var undo: [[Float]] = []
    @State private var redo: [[Float]] = []
    @State private var undoLabels: [String] = []         // nombre de cada cambio, para la barra de historial
    @State private var redoLabels: [String] = []
    @State private var sustainPad = true
    @State private var fxBusy: String?                    // acción trabajando (borde amarillo)
    @State private var fxFlash: String?                   // acción recién hecha (destello)
    @State private var loopCross = 1.0
    @State private var scratchKind: Scratch.Kind = .baby
    @State private var scratchBeats = 4
    @State private var scratchDepth = 0.6
    @State private var loopRefine = true
    @State private var start = 0.0
    @State private var end = 1.0
    @State private var fadeMs = 10.0
    @State private var noiseAmount = NoiseReduction.defaultAmount
    @State private var player: AVAudioPlayer?
    @State private var playhead: Double?
    @State private var loop = false
    @State private var showEffects = false
    @State private var showChop = false
    @State private var showPrecise = false
    @State private var showDetails = false
    @State private var showLab = false
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
                HStack(spacing: 8) {
                    Button { sample.favorite.toggle(); lib.update(sample) } label: {
                        Image(systemName: sample.favorite ? "star.fill" : "star").font(.system(size: 20, weight: .bold))
                            .foregroundColor(sample.favorite ? Theme.amber : Theme.muted).frame(width: 44, height: 44)
                    }
                    .keyboardShortcut("f", modifiers: [])
                    .accessibilityLabel((sample.favorite ? "Quitar de favoritos: " : "Marcar como favorito: ") + sample.name)
                    .accessibilityAddTraits(sample.favorite ? .isSelected : [])
                    Button("Detalles") { showDetails = true }.buttonStyle(OutlineButton()).font(Theme.font(13)).frame(width: 120)
                    Text(SampleStatus.title(sample.status)).font(Theme.font(12, weight: .medium)).foregroundColor(Theme.muted)
                    Spacer(minLength: 0)
                }
                VStack(alignment: .leading, spacing: 2) {
                    TextField("Nombre", text: $sample.name).font(Theme.font(16, weight: .bold)).foregroundColor(Theme.text)
                    Text("\(stamp(total)) · mono · \(sample.sampleRate) Hz · pico \(Int(peakDB)) dB · nivel \(levelDBValue) dB").font(Theme.font(12)).foregroundColor(Theme.muted)
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
                    Button("Recortar") { let a = Int(start * Double(count)), b = Int(end * Double(count)), f = fadeSamples; run("recortar", done: "Listo: recortado") { Editing.fade(Editing.trim($0, from: a, to: b), inSamples: f, outSamples: f) }; start = 0; end = 1 }
                        .actionFX("recortar", busy: fxBusy, flash: fxFlash)
                    Button("Normalizar") { run("normalizar", done: "Listo: normalizado a −1 dB") { Editing.normalize($0) } }
                        .actionFX("normalizar", busy: fxBusy, flash: fxFlash)
                    Button("Fundido") { let f = fadeSamples; run("fundido", done: "Listo: fundido aplicado") { Editing.fade($0, inSamples: f, outSamples: f) } }
                        .actionFX("fundido", busy: fxBusy, flash: fxFlash)
                    Button("Efectos") { showEffects = true }.buttonStyle(OutlineButton(selected: !sample.effects.isNeutral))
                }.buttonStyle(OutlineButton()).font(Theme.font(13))
                Button("Nivelar volumen (parejo)") { levelOut() }.buttonStyle(OutlineButton()).font(Theme.font(13))
                    .actionFX("nivelar", busy: fxBusy, flash: fxFlash)
                Text("Lleva el volumen típico de la toma a \(Int(Level.target)) dB (no el pico): así un golpe seco y un pad suenan igual de fuertes. El nivel se cambia en Compartir. Puedes deshacer.")
                    .font(Theme.font(12)).foregroundColor(Theme.muted)
                Button("Edición precisa (zoom)") { showPrecise = true }.buttonStyle(OutlineButton(selected: true))
                Button("Chop en pads") { showChop = true }.buttonStyle(OutlineButton())
                Button("Laboratorio de pads") { showLab = true }.buttonStyle(OutlineButton(selected: true))
                Text("Bucle sin clics, estirar, tono, filtros, reverb, capas y teclado (con MIDI).").font(Theme.font(12)).foregroundColor(Theme.muted)
                Button("Armonizar bordes (sin clics)") { let r = sample.sampleRate; run("armonizar", done: "Listo: bordes armonizados") { Harmonize.harmonize($0, rate: r) } }.buttonStyle(OutlineButton()).font(Theme.font(13))
                    .actionFX("armonizar", busy: fxBusy, flash: fxFlash)
                Text("Centra la onda y suaviza el inicio y el final a medida, para que un recorte no suene «cortado». Puedes deshacer.")
                    .font(Theme.font(12)).foregroundColor(Theme.muted)
                creativeTools
                loopTools
                noiseTools
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
                    Button("Guardar") { if audio == savedAudio { confirmOverwrite = true } else { save() } }.buttonStyle(AmberButton())
                        .actionFX("guardar", busy: fxBusy, flash: fxFlash)
                        .confirmationDialog("No hay cambios nuevos", isPresented: $confirmOverwrite, titleVisibility: .visible) {
                            Button("Sobrescribir") { save(overwriting: true) }
                            Button("Cancelar", role: .cancel) {}
                        } message: {
                            Text("«\(sample.name)» ya está guardada tal cual. Si sigues, se sobrescribe el mismo archivo.")
                        }
                }
                if let m = message { Text(m).font(Theme.font(13)).foregroundColor(Theme.muted).frame(maxWidth: .infinity, alignment: .center) }
                Button("Compartir") { state.tab = .exportar }.buttonStyle(OutlineButton(selected: true))
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) { historyBar }
        .onAppear {
            if let s = lib.samples.first(where: { $0.id == sample.id }) { sample = s }
            if undo.isEmpty { audio = lib.audio(for: sample); savedAudio = audio; refreshPeaks() }
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
        .sheet(isPresented: $showLab) { PadLabSheet(sample: sample).presentationDetents([.large]) }
        .sheet(isPresented: $showDetails) { DetailsSheet(sample: sample) { sample = $0; lib.update($0) }.presentationDetents([.large]) }
        .sheet(isPresented: $showEffects, onDismiss: { lib.update(sample) }) { EffectsSheet(sample: $sample, audio: audio).presentationDetents([.large]) }
        .confirmationDialog("¿Borrar esta grabación?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Borrar", role: .destructive) { player?.stop(); lib.delete(sample); state.selectedID = nil; state.tab = .biblioteca }
        }
    }

    private var selA: Int { Int(start * Double(audio.count)) }
    private var selB: Int { Int(end * Double(audio.count)) }

    private var creativeTools: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Creativo")
            Button("Invertir") { let a = selA, b = selB; run("invertir", done: "Listo: invertido") { Creative.reverseRange($0, from: a, to: b) } }.buttonStyle(OutlineButton()).font(Theme.font(13))
                .actionFX("invertir", busy: fxBusy, flash: fxFlash)
            Text("Da la vuelta a la selección (o a toda la toma): una cola que se apaga pasa a ser un crescendo que «chupa» hacia el golpe.")
                .font(Theme.font(12)).foregroundColor(Theme.muted)
            scratchTools
            SectionLabel("Colchón sostenido")
            HStack(spacing: 8) {
                ForEach([4, 8, 16], id: \.self) { f in
                    Button("Colchón ×\(f)") { makePad(f) }.actionFX("colchon\(f)", busy: fxBusy, flash: fxFlash)
                }
            }.buttonStyle(OutlineButton()).font(Theme.font(13))
            ToggleRow(title: "Sostener el nivel", subtitle: "Sube las colas que se apagan para que el colchón no se desvanezca", isOn: $sustainPad)
            Text("Estira la selección (o toda la toma) sin cambiar el tono y la difumina en un sonido continuo, ideal para notas de cuerda, pads y ambientes. Se queda sólo con lo estirado; puedes deshacer.")
                .font(Theme.font(12)).foregroundColor(Theme.muted)
        }
    }

    private var scratchTools: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Scratch")
            HStack(spacing: 8) { ForEach(Scratch.Kind.allCases, id: \.self) { k in Chip(title: k.title, selected: scratchKind == k) { scratchKind = k } } }
            HStack(spacing: 8) { ForEach([2, 4, 8], id: \.self) { n in Chip(title: "\(n) tiempos", selected: scratchBeats == n) { scratchBeats = n } } }
            SliderRow(title: "Recorrido de la aguja", valueText: "\(Int((scratchDepth * 100).rounded())) %", value: $scratchDepth, range: 0.2...1)
            Button("Scratchear") { makeScratch() }.buttonStyle(OutlineButton()).font(Theme.font(13))
                .actionFX("scratch", busy: fxBusy, flash: fxFlash)
            Text("Mueve la aguja sobre la selección (o toda la toma) como en un vinilo: el tono sube y baja con la velocidad y al volver suena hacia atrás. Dura los tiempos elegidos al BPM de la toma (\(Int((sample.bpm ?? 100).rounded()))\(sample.bpm == nil ? ", porque aún no está detectado" : "")). Se queda sólo con el scratch; puedes deshacer y guardarlo como cualquier sonido.")
                .font(Theme.font(12)).foregroundColor(Theme.muted)
        }
    }

    /// Lleva el nivel típico de la toma al objetivo (no el pico): un golpe seco y un pad quedan igual de fuertes.
    private func levelOut() {
        let r = Level.levelTo(audio, rate: sample.sampleRate)
        guard r.beforeDB >= -80 else { message = "La toma está casi en silencio: no hay nada que nivelar"; return }
        let g = (r.gainDB >= 0 ? "+" : "−") + String(format: "%.1f", abs(r.gainDB)).replacingOccurrences(of: ".", with: ",")
        let extra = r.short ? " · los picos no dejan subir más: queda algo bajo" : (r.limited ? " · picos suavizados" : "")
        run("nivelar", done: "Listo: nivel típico de \(Int(r.beforeDB.rounded())) a \(Int(r.afterDB.rounded())) dB (\(g) dB)\(extra)") { _ in r.audio }
    }

    private func makeScratch() {
        let a = selA, b = selB, rate = sample.sampleRate, kind = scratchKind, beats = scratchBeats, depth = scratchDepth, bpm = (sample.bpm ?? 100).rounded()
        guard Double(b - a) >= Double(rate) * 0.05 else { message = "Marca al menos 0,05 s (o no marques nada para usar toda la toma)"; return }
        let secs = String(format: "%.2f", Double(beats) * 60 / bpm).replacingOccurrences(of: ".", with: ",")
        run("scratch", done: "Listo: scratch de \(beats) tiempos a \(Int(bpm)) BPM · dura \(secs) s") { Scratch.scratch($0, from: a, to: b, rate: rate, kind: kind, bpm: bpm, beats: beats, depth: depth) }
    }

    private var loopTools: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Loop continuo (sin pulso)")
            HStack {
                Text("Empalme").font(Theme.font(15, weight: .medium)).foregroundColor(Theme.text)
                Spacer()
                Text("cuánto se funden final y principio").font(Theme.font(12)).foregroundColor(Theme.muted)
            }
            HStack(spacing: 8) {
                ForEach([0.5, 1.0, 2.0, 4.0], id: \.self) { c in
                    Chip(title: String(format: "%g s", c).replacingOccurrences(of: ".", with: ","), selected: loopCross == c) { loopCross = c }
                }
            }
            ToggleRow(title: "Afinar el final", subtitle: "Busca, hasta medio segundo cerca de tu marcador, el punto donde el sonido más se parece al del inicio", isOn: $loopRefine)
            Button("Hacer loop continuo") { makeLoop() }.buttonStyle(OutlineButton()).font(Theme.font(13))
                .actionFX("loop", busy: fxBusy, flash: fxFlash)
            Text("Une el final con el principio para que el tramo se repita sin saltos, aunque no tenga ritmo: pads, cuerdas, ambientes. Se queda sólo con el loop; ya queda activado Repetir para oírlo. Puedes deshacer.")
                .font(Theme.font(12)).foregroundColor(Theme.muted)
        }
    }

    private func makeLoop() {
        let a = selA, b = selB
        guard b - a >= sample.sampleRate / 2 else { message = "Marca al menos 0,5 s (o no marques nada para usar toda la toma)"; return }
        let rate = sample.sampleRate, cross = loopCross, refine = loopRefine
        message = "Creando el loop…"
        run("loop", slow: true, done: "Listo: loop · pulsa ▶ para oírlo en bucle", onApplied: { loop = true }) { Creative.loopSeamless($0, from: a, to: b, rate: rate, crossSec: cross, refine: refine) }
    }

    private func makePad(_ factor: Int) {
        let a = selA, b = selB
        guard b - a >= sample.sampleRate / 10 else { message = "Marca al menos 0,1 s (o no marques nada para usar toda la toma)"; return }
        guard (b - a) * factor <= sample.sampleRate * 600 else { message = "Quedaría demasiado largo (más de 10 minutos): marca un tramo más corto"; return }
        message = "Creando el colchón…"
        let piece = Array(audio[a..<b]), rate = sample.sampleRate, sustain = sustainPad, key = "colchon\(factor)"
        fxBusy = key
        Task {
            let out = await Task.detached { Creative.padStretch(piece, factor: Double(factor), rate: rate, sustain: sustain) }.value
            let before = undo.count
            apply({ _ in out }, label: "Colchón ×\(factor)")
            fxBusy = nil
            if undo.count > before { flashFX(key); message = "Listo: colchón ×\(factor) · dura \(stamp(Double(audio.count) / self.rate))" }
        }
    }

    private var noiseTools: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Limpiar ruido")
            HStack(spacing: 8) {
                Button("Suave") { let r = sample.sampleRate; run("ruido-suave", slow: true, done: "Listo: ruido reducido (suave)") { NoiseReduction.clean($0, rate: r, level: .soft) } }
                    .actionFX("ruido-suave", busy: fxBusy, flash: fxFlash)
                Button("Fuerte") { let r = sample.sampleRate; run("ruido-fuerte", slow: true, done: "Listo: ruido reducido (fuerte)") { NoiseReduction.clean($0, rate: r, level: .strong) } }
                    .actionFX("ruido-fuerte", busy: fxBusy, flash: fxFlash)
            }.buttonStyle(OutlineButton()).font(Theme.font(13))
            HStack(spacing: 8) {
                Button("Quitar ruido de fondo") { denoiseAuto() }.actionFX("ruido-fondo", busy: fxBusy, flash: fxFlash)
                Button("Con la selección") { denoiseSelection() }.actionFX("ruido-sel", busy: fxBusy, flash: fxFlash)
            }.buttonStyle(OutlineButton()).font(Theme.font(13))
            SliderRow(title: "Intensidad", valueText: noiseAmount < 1.2 ? "Suave" : noiseAmount < 2.2 ? "Normal" : "Fuerte", value: $noiseAmount, range: 0.5...3)
            Text("Suave y Fuerte cortan graves (respiración, soplidos) y apagan lo que suena bajito entre sonidos. «Quitar ruido de fondo» aprende el ruido de la parte más tranquila; «Con la selección» lo aprende de lo que marques. Puedes deshacer.")
                .font(Theme.font(12)).foregroundColor(Theme.muted)
        }
    }

    private func denoiseAuto() {
        let w = NoiseReduction.quietestWindows(audio, rate: sample.sampleRate)
        guard !w.isEmpty else {
            message = "No hay una parte tranquila: marca una con los marcadores y usa «Con la selección»"; return
        }
        let noises = w.map { Array(audio[$0]) }, amount = noiseAmount
        run("ruido-fondo", slow: true, done: "Listo: ruido de fondo quitado") { NoiseReduction.denoise($0, noises: noises, amount: amount) }
    }

    private func denoiseSelection() {
        let a = Int(start * Double(audio.count)), b = Int(end * Double(audio.count))
        guard b - a >= sample.sampleRate / 10 else { message = "Marca una parte de solo ruido de al menos 0,1 s"; return }
        let noise = Array(audio[a..<b])
        let amount = noiseAmount
        run("ruido-sel", slow: true, done: "Listo: ruido de la selección quitado") { NoiseReduction.denoise($0, noise: noise, amount: amount) }
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
        .background(Theme.surface)
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(fxFlash != nil ? Theme.amber : Theme.line, lineWidth: fxFlash != nil ? 3 : 1))
        .animation(fxFlash != nil ? nil : .easeOut(duration: 0.9), value: fxFlash != nil)
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

    private func apply(_ f: ([Float]) -> [Float], label: String = "Cambio") {
        let out = f(audio)
        guard !out.isEmpty else { message = "La selección quedó vacía"; return }
        guard out != audio else { message = "No hay nada que cambiar: la selección es muy corta para eso"; return }
        undo.append(audio); undoLabels.append(label); Editing.trimHistory(&undo, &undoLabels); redo = []; redoLabels = []; audio = out; message = nil
        refreshPeaks()
    }

    /// Destello del botón al terminar una acción.
    private func flashFX(_ key: String) {
        fxFlash = key
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { if fxFlash == key { fxFlash = nil } }
    }

    /// Acción con respuesta visible: si es lenta, el botón se ilumina mientras trabaja; al terminar destella y avisa «Listo».
    private static let fxLabels: [String: String] = ["recortar": "Recortar", "normalizar": "Normalizar", "fundido": "Fundido", "armonizar": "Armonizar bordes",
        "invertir": "Invertir", "scratch": "Scratch", "nivelar": "Nivelar volumen", "loop": "Loop continuo", "ruido-suave": "Ruido (suave)", "ruido-fuerte": "Ruido (fuerte)", "ruido-fondo": "Quitar ruido de fondo",
        "ruido-sel": "Ruido de la selección"]

    /// Contenedor para pasar a otro hilo un cierre que sólo captura valores (números, listas): lo que ya hacían los cálculos largos.
    private struct Unchecked<T>: @unchecked Sendable { let v: T }

    /// Acción con respuesta visible. Las lentas (`slow`) se calculan fuera del hilo principal: la pantalla no se congela y el botón pulsa mientras trabaja.
    /// Si la toma cambió mientras tanto, el resultado no se aplica.
    private func run(_ key: String, slow: Bool = false, done: String, onApplied: (() -> Void)? = nil, _ f: @escaping ([Float]) -> [Float]) {
        let finish: ([Float]) -> Void = { out in
            let before = undo.count
            apply({ _ in out }, label: Self.fxLabels[key] ?? "Cambio")
            fxBusy = nil
            if undo.count > before { flashFX(key); message = done; onApplied?() }
        }
        guard slow else { finish(f(audio)); return }
        guard fxBusy == nil else { return }                                 // ya hay una acción trabajando
        fxBusy = key
        let input = audio, box = Unchecked(v: f)
        Task {
            let out = await Task.detached { box.v(input) }.value
            if audio != input { fxBusy = nil; message = "La toma cambió mientras trabajaba: no se aplicó"; return }
            finish(out)
        }
    }

    private func refreshPeaks() { peaks = Editing.peaks(audio, buckets: 56); peakDB = Editing.peakDB(audio); levelDBValue = max(-99, Int(Level.levelDB(audio, rate: sample.sampleRate))) }

    private func step(from a: inout [[Float]], to b: inout [[Float]], labelsFrom lf: inout [String], labelsTo lt: inout [String]) {
        guard let x = a.popLast() else { return }
        b.append(audio); lt.append(lf.popLast() ?? "Cambio"); audio = x
        refreshPeaks()
    }

    /// Vuelve a cómo estaba la toma al abrirla (Rehacer permite volver a todo lo hecho).
    private func toOriginal() {
        guard !undo.isEmpty else { return }
        while !undo.isEmpty { step(from: &undo, to: &redo, labelsFrom: &undoLabels, labelsTo: &redoLabels) }
        flashFX("original")
        message = "Volviste al original: la toma como estaba al abrirla"
    }

    /// Barra siempre a la vista: deshacer, rehacer y volver al original.
    private var historyBar: some View {
        VStack(spacing: 4) {
            HStack(spacing: 8) {
                Button("↶ Deshacer") { step(from: &undo, to: &redo, labelsFrom: &undoLabels, labelsTo: &redoLabels) }
                    .disabled(undo.isEmpty).opacity(undo.isEmpty ? 0.4 : 1)
                    .accessibilityLabel("Deshacer el último cambio")
                Button("↷ Rehacer") { step(from: &redo, to: &undo, labelsFrom: &redoLabels, labelsTo: &undoLabels) }
                    .disabled(redo.isEmpty).opacity(redo.isEmpty ? 0.4 : 1)
                    .accessibilityLabel("Rehacer")
                Button("⟲ Original") { toOriginal() }
                    .disabled(undo.isEmpty).opacity(undo.isEmpty ? 0.4 : 1)
                    .actionFX("original", busy: nil, flash: fxFlash)
                    .accessibilityLabel("Volver al original")
            }.buttonStyle(OutlineButton()).font(Theme.font(13, weight: .bold))
            Text(undo.isEmpty ? "Sin cambios todavía: aquí podrás deshacer o volver al original"
                              : "Último cambio: \(undoLabels.last ?? "Cambio") · \(undo.count) desde que abriste la toma")
                .font(Theme.font(12)).foregroundColor(Theme.muted)
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 6)
        .background(Theme.bg)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func save(overwriting: Bool = false) {
        lib.replaceAudio(sample, with: audio)
        lib.update(sample)
        savedAudio = audio
        flashFX("guardar")
        message = overwriting ? "Se sobrescribió «\(sample.name)» (sin cambios)" : "Guardado: «\(sample.name)»"
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

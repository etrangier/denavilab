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
    @State private var harmonyOn = false                   // detectar acordes y compases (opcional)
    @State private var base: Harmony.Analysis?
    @State private var lay: Harmony.Analysis?
    @State private var shift = 0
    @State private var perPad = 1
    @State private var wantBars = 4                        // compases del loop sugerido (4 por defecto)
    @State private var pick: Harmony.LoopSuggestion?       // el loop sugerido que está elegido (mientras no se elijan cortes a mano)
    @State private var style: Harmony.Style = .libre       // estilo de las sugerencias: libre, Daft Punk o Cerati
    @State private var pumpOn = false                      // bombeo (sidechain) del estilo Daft Punk
    @State private var fixOn = true                        // fijar el BPM: el loop dura justo sus compases a ese BPM
    @State private var fixBpmValue: Int?                   // BPM fijo elegido por el usuario (nil = el detectado, redondeado)
    @State private var loopPlayer: AVAudioPlayer?
    @State private var fxFlash: String?                    // botón recién usado (destello amarillo)
    @State private var harmonize = true                   // centra la onda, suaviza bordes y, al unir, iguala el volumen

    private func recompute() {
        if mode == -1, let b = base {
            let l = Harmony.layout(b, downbeat: b.downbeat + shift, want: wantBars, style: style)
            lay = l
            ranges = barRanges(l)
            stopPreview()
            selected = []
            return
        }
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
                    modeChips
                    if mode == 0 {
                        SliderRow(title: "Sensibilidad de golpes", valueText: sensitivity < 0.34 ? "Baja" : sensitivity < 0.67 ? "Media" : "Alta", value: $sensitivity)
                    }
                    ToggleRow(title: "Detectar acordes y compases", subtitle: "Aproximado: acordes mayores y menores, compás de 4 tiempos",
                              isOn: Binding(get: { harmonyOn }, set: { setHarmony($0) }))
                    if let l = lay { harmonyCard(l) }
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
                    padGrid
                    if ranges.count < 12 { Text("Pads \(ranges.count + 1)–12 libres").font(Theme.font(12)).foregroundColor(Theme.muted).frame(maxWidth: .infinity, alignment: .center) }
                    actionButtons
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

    private var modeChips: some View {
        let modes: [Int] = lay == nil ? [4, 8, 12, 0] : [4, 8, 12, 0, -1]
        return HStack(spacing: 8) {
            ForEach(modes, id: \.self) { m in
                Chip(title: modeTitle(m), selected: mode == m) { mode = m }
            }
        }
    }

    private func modeTitle(_ m: Int) -> String {
        if m == 0 { return "Auto" }
        if m == -1 { return "Compases" }
        return "\(m)"
    }

    private var padGrid: some View {
        let cols = Array(repeating: GridItem(.flexible(), spacing: 8), count: 4)
        return LazyVGrid(columns: cols, spacing: 8) {
            ForEach(0..<12, id: \.self) { i in padButton(i) }
        }
    }

    private func padButton(_ i: Int) -> some View {
        let live = i < ranges.count, on = selected.contains(i)
        let playing = playingIndex == i
        let chord: String? = (live && mode == -1) ? padChord(i) : nil
        return Button {
            guard live else { return }
            stopPreview()
            if on { selected.remove(i) } else { selected.insert(i) }
            play(i)
        } label: {
            VStack(spacing: 1) {
                Text("\(i + 1)").font(Theme.font(20, weight: .bold))
                if let c = chord { Text(c).font(Theme.font(11)).lineLimit(1).minimumScaleFactor(0.6) }
            }
            .foregroundColor(!live ? Theme.line : (on ? Theme.amber : Theme.text))
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(playing ? Theme.amber.opacity(0.28) : (on ? Theme.surface2 : Theme.surface))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(on && live ? Theme.amber : Theme.line, lineWidth: playing ? 3 : 1.5))
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .disabled(!live)
        .accessibilityLabel(padLabel(i, chord: chord, on: on))
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func padLabel(_ i: Int, chord: String?, on: Bool) -> String {
        var t = "Pad \(i + 1)"
        if let c = chord { t += ", " + c }
        if on { t += ", seleccionado" }
        return t
    }

    private var actionButtons: some View {
        VStack(alignment: .leading, spacing: 14) {
            previewButton
            saveButtons
            if lay != nil { loopButtons }
            Button("Guardar unidos en un solo sonido") { saveJoined() }
                .buttonStyle(OutlineButton(selected: true)).disabled(selected.count < 2).opacity(selected.count < 2 ? 0.4 : 1)
                .actionFX("guardar-unidos", busy: nil, flash: fxFlash)
            Button(selected.isEmpty ? "Compartir cortes (WAV)" : "Compartir \(selected.count) (WAV)") { exportSelected() }
                .buttonStyle(OutlineButton(selected: true)).disabled(selected.isEmpty).opacity(selected.isEmpty ? 0.4 : 1)
        }
    }

    private var previewButton: some View {
        let title = previewing ? "Parar" : (selected.isEmpty ? "Escuchar selección" : "Escuchar selección · \(previewSeconds)")
        return Button(title) { if previewing { stopPreview() } else { startPreview() } }
            .buttonStyle(OutlineButton(selected: previewing)).disabled(selected.isEmpty).opacity(selected.isEmpty ? 0.4 : 1)
            .accessibilityLabel(previewing ? "Parar la escucha de la selección" : "Escuchar selección")
    }

    private var saveButtons: some View {
        Button(selected.isEmpty ? "Elige al menos un corte" : "Guardar \(selected.count) en la Biblioteca") { saveSelected() }
            .buttonStyle(AmberButton()).disabled(selected.isEmpty).opacity(selected.isEmpty ? 0.4 : 1)
            .actionFX("guardar-cortes", busy: nil, flash: fxFlash)
    }

    private var loopButtons: some View {
        let can = loopRange != nil
        return VStack(spacing: 14) {
            Button(loopPlayer != nil ? "Parar el loop" : "Escuchar loop") { toggleLoop() }
                .buttonStyle(OutlineButton(selected: loopPlayer != nil)).disabled(!can).opacity(can ? 1 : 0.4)
            Button("Guardar selección como loop") { saveLoop() }
                .buttonStyle(OutlineButton(selected: true)).disabled(!can).opacity(can ? 1 : 0.4)
                .actionFX("guardar-loop", busy: nil, flash: fxFlash)
        }
    }

    private var waveHighlights: [ClosedRange<Double>]? {
        if selected.isEmpty {
            guard let p = pick, audio.count > 0 else { return nil }
            let spans = p.picks.isEmpty ? [p.start..<p.end] : p.ranges
            return spans.map { (Double($0.lowerBound) / Double(audio.count))...(Double($0.upperBound) / Double(audio.count)) }
        }
        return Editing.highlightRanges(ranges, total: audio.count, selected: selected)
    }

    private var wave: some View {
        ZStack {
            WaveBars(peaks: peaks, highlights: waveHighlights).padding(12)
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

    private func flashFX(_ key: String) {
        fxFlash = key
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { if fxFlash == key { fxFlash = nil } }
    }

    private func stopPreview() {
        loopPlayer?.stop(); loopPlayer = nil
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

    // MARK: acordes, compases y loop

    private func autoPer(_ l: Harmony.Analysis) -> Int { [1, 2, 4].first { Int((Double(l.bars.count) / Double($0)).rounded(.up)) <= 12 } ?? 4 }

    /// Cortes por compás (o por 2 / 4 compases) cuando se detectaron compases.
    private func barRanges(_ l: Harmony.Analysis) -> [Range<Int>] {
        var out: [Range<Int>] = []
        var i = 0
        while i * perPad < l.bars.count && out.count < 12 {
            let g = l.bars[(i * perPad)..<min(l.bars.count, i * perPad + perPad)]
            out.append(g.first!.start..<max(g.first!.start + 1, min(audio.count, g.last!.end)))
            i += 1
        }
        return out
    }

    private func padChord(_ i: Int) -> String? {
        guard let l = lay else { return nil }
        let g = l.bars[min(l.bars.count, i * perPad)..<min(l.bars.count, i * perPad + perPad)]
        return g.isEmpty ? nil : g.map(\.label).joined(separator: " · ")
    }

    private func setHarmony(_ on: Bool) {
        if !on {
            harmonyOn = false; base = nil; lay = nil; pick = nil; shift = 0
            if mode == -1 { mode = 8 }
            recompute(); return
        }
        analyzeWith(bpm)
    }

    private func analyzeWith(_ b: Double?) {
        guard let a = Harmony.analyze(audio, rate: sample.sampleRate, bpm: b) else {
            message = "No encuentro un pulso claro (o la toma tiene menos de 8 tiempos): no puedo detectar compases"
            harmonyOn = lay != nil; return
        }
        let laid = Harmony.layout(a, downbeat: a.downbeat, want: wantBars, style: style)
        base = a; shift = 0; lay = laid; pick = firstPick(laid); fixBpmValue = nil; harmonyOn = true
        perPad = autoPer(a)
        if mode == -1 { recompute() } else { mode = -1 }       // al cambiar `mode` se recalculan los cortes
    }

    private func harmonyCard(_ l: Harmony.Analysis) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Armonía").font(Theme.font(15, weight: .medium)).foregroundColor(Theme.text)
                Spacer()
                Text("≈ \(Int(l.bpm.rounded())) BPM · 4/4 · \(l.bars.count) compases").font(Theme.font(12)).foregroundColor(Theme.amber)
            }
            Text("Acordes: " + l.bars.prefix(12).map(\.label).joined(separator: " · ") + (l.bars.count > 12 ? " …" : "")).font(Theme.font(13)).foregroundColor(Theme.text)
            if let b = l.bars.first {
                Text("El compás 1 empieza en \(stamp(Double(b.start) / Double(l.rate))). Si no cae donde lo oyes, muévelo un tiempo.")
                    .font(Theme.font(12)).foregroundColor(Theme.muted)
            }
            HStack(spacing: 8) {
                Button("◀ 1 tiempo") { shift -= 1; recompute(); pick = lay.flatMap(firstPick) }
                Button("1 tiempo ▶") { shift += 1; recompute(); pick = lay.flatMap(firstPick) }
            }.buttonStyle(OutlineButton()).font(Theme.font(13))
            HStack(spacing: 8) {
                Button("Tempo ÷ 2") { analyzeWith(l.bpm / 2) }
                Button("Tempo × 2") { analyzeWith(l.bpm * 2) }
            }.buttonStyle(OutlineButton()).font(Theme.font(13))
            if mode == -1 {
                HStack(spacing: 8) {
                    ForEach([1, 2, 4], id: \.self) { p in
                        Chip(title: p == 1 ? "1 compás por corte" : "\(p) compases", selected: perPad == p) { perPad = p; recompute() }
                    }
                }
            }
            loopCard(l)
        }.card()
    }

    /// ¿Es éste el loop sugerido que está elegido (y no hay cortes elegidos a mano)?
    private func isPicked(_ c: Harmony.LoopSuggestion) -> Bool {
        guard let p = pick, selected.isEmpty else { return false }
        return p.kind == c.kind && p.name == c.name && p.start == c.start && p.bars == c.bars && p.picks == c.picks
    }

    /// Lo que se sugiere al abrir o cambiar de estilo: el loop de siempre, o el primer arreglo / patrón detectado del estilo.
    private func firstPick(_ l: Harmony.Analysis) -> Harmony.LoopSuggestion? {
        style == .libre ? l.loop : (l.arranged.first ?? l.bestPattern ?? l.loop)
    }

    private func setStyle(_ st: Harmony.Style) {
        style = st; wantBars = st.want; pumpOn = st.pump > 0; selected = []
        recompute(); stopPreview(); pick = lay.flatMap(firstPick)
    }

    private func loopBpm(_ l: Harmony.Analysis) -> Int { fixBpmValue ?? Harmony.fixedBpm(l.bpm) }

    /// Ajuste de duración para el loop elegido, o nil si no se fija el BPM o el cambio sería audible.
    private typealias LoopSel = (start: Int, end: Int, bars: Int, len: Int, spans: [Range<Int>]?)    // spans: compases sueltos combinados

    private func loopFix(_ r: LoopSel, _ l: Harmony.Analysis) -> (bpm: Int, bars: Int)? {
        guard fixOn else { return nil }
        let bpm = loopBpm(l), target = Harmony.loopLength(rate: sample.sampleRate, bpm: bpm, bars: r.bars)
        if abs(Harmony.stretchPct(r.len, target)) > Harmony.maxStretchPct { return nil }
        return (bpm: bpm, bars: r.bars)
    }

    private func secs(_ n: Int) -> String {
        var t = String(format: "%.2f", Double(n) / Double(sample.sampleRate))
        while t.hasSuffix("0") { t.removeLast() }
        if t.hasSuffix(".") { t.removeLast() }
        return t.replacingOccurrences(of: ".", with: ",") + " s"
    }

    private func barsWord(_ n: Int) -> String { n == 1 ? "1 compás" : "\(n) compases" }

    /// Loop de N compases sugerido (4 por defecto) sobre toda la toma, con alternativas y BPM fijo para pasarlo al K.O.
    private func loopCard(_ l: Harmony.Analysis) -> some View {
        let bpm = loopBpm(l), r = loopRange
        let stretch = r.map { Harmony.stretchPct($0.len, Harmony.loopLength(rate: sample.sampleRate, bpm: bpm, bars: $0.bars)) } ?? 0
        let okFix = r != nil && abs(stretch) <= Harmony.maxStretchPct
        let counts = [1, 2, 3, 4, 8].filter { $0 <= l.bars.count || $0 == wantBars }
        var fixText = "El loop conserva su duración original"
        if fixOn, let r = r {
            fixText = "\(bpm) BPM: el loop dura justo \(secs(Harmony.loopLength(rate: sample.sampleRate, bpm: bpm, bars: r.bars)))"
            fixText += okFix ? " (ajuste \(stretch >= 0 ? "+" : "")\(String(format: "%.2f", stretch).replacingOccurrences(of: ".", with: ",")) %)" : " · el ajuste sería muy grande: se deja sin fijar"
        } else if fixOn { fixText = "\(bpm) BPM" }
        var info = "No encontré un tramo que se repita bien."
        if let p = pick, selected.isEmpty, p.kind == "pattern" {
            info = "Patrón de \(barsWord(p.bars)) (compases " + p.picks.map { String($0 + 1) }.joined(separator: ", ") + " de la toma, los más típicos de cada posición) · " + p.chords.joined(separator: " · ")
        } else if let p = pick, selected.isEmpty, p.kind == "arreglo" {
            info = "Arreglo \(p.name): compases " + p.picks.map { String($0 + 1) }.joined(separator: ", ") + " de la toma · " + p.chords.joined(separator: " · ")
        } else if let p = pick, selected.isEmpty, !p.picks.isEmpty {
            info = "Combinado de \(p.bars) compases: los compases " + p.picks.map { String($0 + 1) }.joined(separator: ", ") + " de la toma · " + p.chords.joined(separator: " · ")
        } else if let p = pick, selected.isEmpty { info = "\(barsWord(p.bars)) de \(stamp(Double(p.start) / Double(l.rate))) a \(stamp(Double(p.end) / Double(l.rate))) · " + p.chords.joined(separator: " · ") }
        else if l.loop != nil { info = "Elegiste cortes a mano: el loop son esos compases, seguidos o combinados en su orden." }
        return VStack(alignment: .leading, spacing: 8) {
            Text("Loop sugerido").font(Theme.font(15, weight: .medium)).foregroundColor(Theme.text)
            styleChips
            patternBlock(l)
            HStack(spacing: 8) {
                ForEach(counts, id: \.self) { n in
                    Chip(title: barsWord(n), selected: wantBars == n) { wantBars = n; recompute(); pick = lay.flatMap(firstPick) }
                }
            }
            if !l.loops.isEmpty {
                HStack(spacing: 8) {
                    ForEach(Array(l.loops.enumerated()), id: \.offset) { i, c in
                        Chip(title: (i == 0 ? "Mejor" : "Opción \(i + 1)") + " · " + stamp(Double(c.start) / Double(l.rate)),
                             selected: isPicked(c)) { stopPreview(); selected = []; pick = c }
                    }
                }
            }
            if !l.combos.isEmpty {
                Text("Combinaciones: compases sueltos de la toma, en su orden, que juntos forman una progresión que empalma bien")
                    .font(Theme.font(12)).foregroundColor(Theme.muted)
                HStack(spacing: 8) {
                    ForEach(Array(l.combos.enumerated()), id: \.offset) { i, c in
                        Chip(title: "Combinado \(i + 1) · " + c.chords.joined(separator: " "), selected: isPicked(c)) { stopPreview(); selected = []; pick = c }
                    }
                }
            }
            Text(info).font(Theme.font(12)).foregroundColor(Theme.muted)
            ToggleRow(title: "Fijar BPM", subtitle: fixText, isOn: $fixOn)
            if fixOn {
                HStack(spacing: 8) {
                    Button("BPM −1") { fixBpmValue = max(30, bpm - 1) }
                    Button("BPM +1") { fixBpmValue = min(300, bpm + 1) }
                }.buttonStyle(OutlineButton()).font(Theme.font(13))
            }
        }.padding(.top, 6)
    }

    private var styleChips: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                ForEach(Harmony.Style.allCases, id: \.self) { st in Chip(title: st.title, selected: style == st) { setStyle(st) } }
            }
            if style == .daftpunk {
                Text("Daft Punk: trozos cortos con groove y golpe en el 1, cortes secos, repetidos en bucle con una variación al final y bombeo (sidechain)").font(Theme.font(12)).foregroundColor(Theme.muted)
            } else if style == .cerati {
                Text("Cerati: texturas largas que cambian de armonía con suavidad, empalmes largos y forma A B A C").font(Theme.font(12)).foregroundColor(Theme.muted)
            }
        }
    }

    /// Patrón detectado y sus opciones de 1 a 4 compases, más los arreglos del estilo elegido.
    @ViewBuilder
    private func patternBlock(_ l: Harmony.Analysis) -> some View {
        if let best = l.bestPattern {
            let pct = Int((max(0, min(1, best.strength)) * 100).rounded())
            Text("Patrón detectado: \(barsWord(best.period)) (se repite \(best.repeats) \(best.repeats == 1 ? "vez" : "veces"), similitud \(pct) %)")
                .font(Theme.font(13)).foregroundColor(Theme.text)
            HStack(spacing: 8) {
                ForEach(Array(l.patterns.enumerated()), id: \.offset) { _, c in
                    Chip(title: "Patrón de " + barsWord(c.period) + (c.period == best.period ? " ★" : ""), selected: isPicked(c)) { stopPreview(); selected = []; pick = c }
                }
            }
            if !l.arranged.isEmpty {
                Text("Arreglos del estilo, armados con compases de la toma").font(Theme.font(12)).foregroundColor(Theme.muted)
                HStack(spacing: 8) {
                    ForEach(Array(l.arranged.enumerated()), id: \.offset) { _, c in
                        Chip(title: "Arreglo " + c.name, selected: isPicked(c)) { stopPreview(); selected = []; pick = c }
                    }
                }
            }
            if style == .daftpunk {
                ToggleRow(title: "Bombeo (sidechain)", subtitle: "Baja el volumen en cada tiempo y lo recupera, como la compresión sobre el bombo", isOn: $pumpOn)
            }
        }
    }

    /// Rango de audio de la selección: compases seguidos o, si son cortes sueltos (1, 3 y 5…), los compases combinados en su orden.
    private var loopRange: LoopSel? {
        guard mode == -1, let l = lay else { return nil }
        if let p = pick, selected.isEmpty {
            return p.picks.isEmpty ? (p.start, p.end, p.bars, p.end - p.start, nil) : (p.start, p.end, p.bars, p.len, p.ranges.count > 1 ? p.ranges : nil)
        }
        let ids = selected.sorted().filter { $0 < ranges.count }
        guard let f = ids.first, let last = ids.last else { return nil }
        if ids.count != last - f + 1 {
            let rs = ids.map { ranges[$0] }, len = rs.reduce(0) { $0 + $1.count }
            return (rs[0].lowerBound, rs[rs.count - 1].upperBound, max(1, Int((Double(len) / (4 * l.period)).rounded())), len, rs)
        }
        return (ranges[f].lowerBound, ranges[last].upperBound, ids.count * perPad, ranges[last].upperBound - ranges[f].lowerBound, nil)
    }

    /// Audio del loop elegido: tramo seguido o, si son compases sueltos, los compases combinados.
    private func loopAudio(_ r: LoopSel, _ fix: (bpm: Int, bars: Int)?) -> [Float] {
        let base: [Float]
        if let sp = r.spans { base = Harmony.makeCombo(audio, ranges: sp, rate: sample.sampleRate, fix: fix, crossfadeMs: style.crossfadeMs) }
        else { base = Harmony.makeLoop(audio, start: r.start, end: r.end, rate: sample.sampleRate, fix: fix) }
        guard pumpOn, style.pump > 0, let l = lay else { return base }
        return Harmony.pump(base, rate: sample.sampleRate, bpm: fix.map { Double($0.bpm) } ?? l.bpm, depth: style.pump)
    }

    /// Cómo se llama lo que se guarda: loop, loop combinado, patrón o arreglo.
    private func pickName(_ r: LoopSel) -> String {
        if let p = pick, selected.isEmpty {
            if p.kind == "pattern" { return "Patrón" }
            if p.kind == "arreglo" { return "Arreglo \(p.name)" }
        }
        return r.spans != nil ? "Loop combinado" : "Loop"
    }

    private func toggleLoop() {
        if loopPlayer != nil { loopPlayer?.stop(); loopPlayer = nil; return }
        guard let r = loopRange else { return }
        stopPreview()
        let fix = lay.flatMap { loopFix(r, $0) }, lp = loopAudio(r, fix)
        guard !lp.isEmpty else { return }
        do {
            try AudioSessionConfig.activate()
            var s = sample; s.id = UUID(); s.slot = nil; s.effects = EffectParams(); s.name = "loop_\(sample.name)"
            let url = try Exporter.export(s, audio: lp, targetRate: sample.sampleRate)
            let p = try AVAudioPlayer(contentsOf: url); p.numberOfLoops = -1; p.play(); loopPlayer = p
        } catch { message = "No se pudo reproducir: \(error.localizedDescription)" }
    }

    private func saveLoop() {
        guard let r = loopRange, let l = lay else { return }
        let fix = loopFix(r, l), lp = loopAudio(r, fix)
        guard !lp.isEmpty else { return }
        let word = r.bars == 1 ? "1 compás" : "\(r.bars) compases"
        let spans = r.spans ?? [r.start..<r.end]
        let chords = l.bars.filter { b in spans.contains { b.start >= $0.lowerBound && b.end <= $0.upperBound + 1 } }.map(\.label).joined(separator: " · ")
        let nm = pickName(r), tag = style == .libre ? "" : " · " + style.title
        if var x = lib.add(name: "\(sample.name) · \(nm.lowercased()) \(word)\(tag)" + (fix.map { " · \($0.bpm) BPM" } ?? ""), audio: lp, sampleRate: sample.sampleRate) {
            x.folder = lib.folder(of: sample); x.subfolder = sample.subfolder; x.bpm = fix.map { Double($0.bpm) } ?? (l.bpm * 10).rounded() / 10; lib.update(x)
            flashFX("guardar-loop")
            message = "\(nm) de \(word) guardado (\(chords)) · " + (fix.map { "\($0.bpm) BPM fijos, dura \(secs(lp.count))" } ?? "≈ \(Int(l.bpm.rounded())) BPM")
        }
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
            flashFX("guardar-unidos")
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
        flashFX("guardar-cortes")
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

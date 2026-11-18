import SwiftUI
import AVFoundation

/// Después de grabar, con el asistente activo: ¿edición convencional o asistente Pistorius?
struct PistoriusAskSheet: View {
    let seconds: Double
    let onConventional: () -> Void
    let onAssistant: () -> Void
    let onTurnOff: () -> Void
    @Environment(\.dismiss) private var dismiss
    private let memory = PistoriusMemory.summary(PistoriusMemory.load())

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 14) {
                ScreenTitle(title: "¿Cómo seguimos?", subtitle: "Acabas de grabar \(stamp(seconds)) · \(memory)")
                tile("scissors", "Edición convencional", "Nombre, carpeta y recorte, como siempre") { dismiss(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { onConventional() } }
                tile("star", "Asistente Pistorius", "Te pregunto qué grabaste y qué quieres hacer") { dismiss(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { onAssistant() } }
                TextLink(title: "Apagar el asistente") { dismiss(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { onTurnOff() } }
                Spacer()
            }.padding(16)
        }
    }

    private func tile(_ symbol: String, _ title: String, _ sub: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: symbol).font(.system(size: 24)).foregroundColor(Theme.amber).frame(width: 40)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(Theme.font(17, weight: .bold)).foregroundColor(Theme.text)
                    Text(sub).font(Theme.font(13)).foregroundColor(Theme.muted)
                }
                Spacer()
            }.card()
        }.buttonStyle(.plain)
    }
}

/// El asistente: qué grabaste → qué quieres hacer → guía de corte o chop → resultado con vista previa → guardar.
struct PistoriusSheet: View {
    let audio: [Float]
    let rate: Int
    var base = "grabación"
    var origin = ""
    var folder: String? = nil
    var sub: String? = nil
    var fromSample = false

    enum Step { case source, goal, guide, busy, result }

    @EnvironmentObject var lib: LibraryStore
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var step = Step.source
    @State private var source = ""
    @State private var goal = ""
    @State private var analysis: Pistorius.Analysis?
    @State private var advice: Pistorius.Advice?
    @State private var result: Pistorius.Outcome?
    @State private var name = ""
    @State private var keepOriginal = true
    @State private var memory = PistoriusMemory.load()
    @State private var chosenAction = "seguir"
    @State private var playing: String?
    @State private var player: AVAudioPlayer?
    @State private var message: String?

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack { Text("Asistente Pistorius").font(Theme.font(14)).foregroundColor(Theme.muted); Spacer(); TextLink(title: "Cerrar") { player?.stop(); dismiss() } }
                    switch step {
                    case .source: sourceStep
                    case .goal: goalStep
                    case .guide: guideStep
                    case .busy: Text("Trabajando…").font(Theme.font(20, weight: .bold)).foregroundColor(Theme.text); Text("Aplicando la receta a tu sonido").font(Theme.font(13)).foregroundColor(Theme.muted)
                    case .result: resultStep
                    }
                    if let m = message { Text(m).font(Theme.font(13)).foregroundColor(Theme.error) }
                }.padding(16)
            }
        }
        .onAppear { keepOriginal = !fromSample }
        .onDisappear { player?.stop() }
    }

    // MARK: pasos

    private func tile(_ symbol: String, _ title: String, _ sub: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: symbol).font(.system(size: 24)).foregroundColor(Theme.amber)
                Text(title).font(Theme.font(14, weight: .bold)).foregroundColor(Theme.text).multilineTextAlignment(.center)
                if let sub { Text(sub).font(Theme.font(11)).foregroundColor(Theme.muted).multilineTextAlignment(.center) }
            }.frame(maxWidth: .infinity, minHeight: 104).padding(.horizontal, 6).padding(.vertical, 10)
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line, lineWidth: 1))
        }.buttonStyle(.plain)
    }
    private var cols: [GridItem] { [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)] }

    private var sourceStep: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("¿Qué grabaste?").font(Theme.font(22, weight: .bold)).foregroundColor(Theme.text)
            Text("Con eso decido qué te sugiero primero.").font(Theme.font(13)).foregroundColor(Theme.muted)
            LazyVGrid(columns: cols, spacing: 8) {
                let rs = PistoriusMemory.rankSources(Pistorius.sources, memory)
                ForEach(rs.list) { s in tile(s.symbol, s.label + (s.id == rs.top ? " ★" : ""), s.id == rs.top ? "Lo que sueles grabar" : nil) { source = s.id; step = .goal } }
            }
        }
    }

    private var goalStep: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { Text("¿Qué quieres hacer con ese sonido?").font(Theme.font(20, weight: .bold)).foregroundColor(Theme.text); Spacer(); TextLink(title: "‹ Atrás") { step = .source } }
            LazyVGrid(columns: cols, spacing: 8) {
                let rg = PistoriusMemory.rankGoals(source, Pistorius.goalsFor(source), memory)
                ForEach(Array(rg.list.enumerated()), id: \.element.id) { i, g in
                    tile(g.symbol, g.label + (i == 0 ? " ★" : ""), rg.top == g.id ? "Lo que sueles hacer con esto" : g.hint) { choose(g.id) }
                }
            }
        }
    }

    private func choose(_ id: String) {
        goal = id; analysis = nil; advice = nil; step = .guide
        let x = audio, r = rate
        Task {
            let (a, ad) = await Task.detached(priority: .userInitiated) { () -> (Pistorius.Analysis, Pistorius.Advice) in
                let a = Pistorius.analyze(x, rate: r); return (a, Pistorius.advise(x, rate: r, a, goal: id))
            }.value
            analysis = a; advice = ad
        }
    }

    private var guideStep: some View {
        let g = Pistorius.goals.first { $0.id == goal }
        return VStack(alignment: .leading, spacing: 10) {
            HStack { Text(g?.label ?? "").font(Theme.font(22, weight: .bold)).foregroundColor(Theme.text); Spacer(); TextLink(title: "‹ Atrás") { step = .goal } }
            if let a = analysis, let ad = advice {
                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel("Lo que escuché")
                    Text("\(stamp(a.sec)) · " + ad.facts.joined(separator: " · ")).font(Theme.font(13)).foregroundColor(Theme.text)
                    MarkedWave(audio: audio, markers: ad.markers, region: ad.action == "cortar" && ad.markers.count == 2 ? ad.markers : nil)
                }.card()
                VStack(alignment: .leading, spacing: 6) {
                    SectionLabel("Mi sugerencia")
                    Text(ad.title).font(Theme.font(16, weight: .bold)).foregroundColor(Theme.text)
                    ForEach(ad.why, id: \.self) { Text($0).font(Theme.font(13)).foregroundColor(Theme.text) }
                    DisclosureGroup("En qué me baso") {
                        VStack(alignment: .leading, spacing: 4) { ForEach(ad.refs, id: \.self) { Text($0).font(Theme.font(11)).foregroundColor(Theme.muted) } }
                    }.font(Theme.font(13)).foregroundColor(Theme.amber).tint(Theme.amber)
                }.card(highlight: true)
                Button(ad.action == "chop" ? "Seguir: guardar y abrir Chop" : "Seguir la sugerencia") { apply(ad.action == "loop" ? "cortar" : ad.action, ad.chopMode) }.buttonStyle(AmberButton())
                if let u = PistoriusMemory.usualAction(goal, memory), u != (ad.action == "loop" ? "cortar" : ad.action) {
                    Text("Con esta meta sueles preferir " + (u == "chop" ? "chopear" : "cortar un solo fragmento") + ": lo tienes en «Otra opción».").font(Theme.font(12)).foregroundColor(Theme.muted)
                }
                SectionLabel("Otra opción")
                VStack(spacing: 8) {
                    if ad.action != "cortar" { Button("Cortar un solo fragmento") { apply("cortar", nil) }.buttonStyle(OutlineButton()) }
                    if ad.action != "chop" {
                        Button("Chopear por golpes") { apply("chop", 0) }.buttonStyle(OutlineButton())
                        Button("Chopear por notas") { apply("chop", -2) }.buttonStyle(OutlineButton())
                    }
                }.font(Theme.font(13))
            } else {
                Text("Escuchando tu sonido…").font(Theme.font(14)).foregroundColor(Theme.muted).frame(maxWidth: .infinity)
            }
        }
    }

    private func apply(_ action: String, _ mode: Int?) {
        chosenAction = action
        step = .busy
        let x = audio, r = rate, g = goal, src = source, b = base, a = analysis
        Task {
            let out = await Task.detached(priority: .userInitiated) { Pistorius.run(goal: action == "chop" ? "limpiar" : g, x, rate: r, source: src, base: b, analysis: a) }.value
            if action == "chop" { saveForChop(out, mode: mode ?? 0) } else { result = out; name = out.name; step = .result }
        }
    }

    private var resultStep: some View {
        let g = Pistorius.goals.first { $0.id == goal }
        return VStack(alignment: .leading, spacing: 10) {
            HStack { Text("Resultado: " + (g?.label.lowercased() ?? "")).font(Theme.font(20, weight: .bold)).foregroundColor(Theme.text); Spacer(); TextLink(title: "‹ Atrás") { player?.stop(); playing = nil; step = .guide } }
            if let r = result {
                VStack(alignment: .leading, spacing: 6) {
                    SectionLabel("Lo que hice")
                    ForEach(r.notes, id: \.self) { Text("• " + $0).font(Theme.font(13)).foregroundColor(Theme.text) }
                    Text("\(stamp(Double(r.audio.count) / Double(r.rate)))" + (r.note.map { " · nota \($0)" } ?? "") + (r.bpm.map { " · ≈ \(Int($0.rounded())) BPM" } ?? "") + " · mono")
                        .font(Theme.font(11)).foregroundColor(Theme.muted)
                    MarkedWave(audio: r.audio, markers: [], region: nil)
                }.card()
                HStack(spacing: 8) {
                    Button(playing == "orig" ? "■ Original" : "▶ Original") { toggle("orig", audio) }.buttonStyle(OutlineButton())
                    Button(playing == "res" ? "■ Resultado" : "▶ Resultado") { toggle("res", r.audio) }.buttonStyle(OutlineButton(selected: true))
                }.font(Theme.font(13))
                SectionLabel("Nombre")
                TextField("Nombre", text: $name).font(Theme.font(15)).foregroundColor(Theme.text).card()
                if !fromSample { ToggleRow(title: "Guardar también la toma original", subtitle: "Queda como «crudo», por si quieres volver a empezar", isOn: $keepOriginal) }
                Button("Guardar") { save(r, then: .library) }.buttonStyle(AmberButton())
                HStack(spacing: 8) {
                    Button("Guardar y abrir Editar") { save(r, then: .editar) }.buttonStyle(OutlineButton())
                    if r.openChop { Button("Guardar y abrir Chop") { save(r, then: .chop) }.buttonStyle(OutlineButton()) }
                    else { Button("Probar otra meta") { player?.stop(); playing = nil; step = .goal }.buttonStyle(OutlineButton()) }
                }.font(Theme.font(13))
            }
        }
    }

    // MARK: acciones

    private func toggle(_ which: String, _ a: [Float]) {
        if playing == which { player?.stop(); playing = nil; return }
        player?.stop()
        do {
            try AudioSessionConfig.activate()
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("pist-\(UUID().uuidString).wav")
            try WavIO.encode(a, sampleRate: rate).write(to: url, options: .atomic)
            let p = try AVAudioPlayer(contentsOf: url); p.play(); player = p; playing = which
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(a.count) / Double(rate) + 0.2) { if playing == which { playing = nil } }
        } catch { message = "No se pudo reproducir: \(error.localizedDescription)" }
    }

    private func store(_ out: Pistorius.Outcome, name nm: String, status: String, extra: [String]) -> Sample? {
        guard var s = lib.add(name: nm, audio: out.audio, sampleRate: out.rate) else { return nil }
        s.folder = folder ?? LibraryStore.unsorted; s.subfolder = sub; s.status = status; s.origin = origin
        s.kind = out.kind == "libre" ? nil : out.kind; s.process = out.process + extra; s.bpm = out.bpm; s.key = out.note
        s.comment = "Hecho con el asistente Pistorius"
        lib.update(s); return s
    }
    private func storeOriginal() {
        guard var o = lib.add(name: base + " (original)", audio: audio, sampleRate: rate) else { return }
        o.folder = folder ?? LibraryStore.unsorted; o.subfolder = sub; o.status = SampleStatus.crudo; o.origin = origin
        lib.update(o)
    }

    private enum After { case library, editar, chop }
    private func save(_ r: Pistorius.Outcome, then: After) {
        player?.stop()
        let nm = name.trimmingCharacters(in: .whitespaces).isEmpty ? r.name : name.trimmingCharacters(in: .whitespaces)
        guard let s = store(r, name: nm, status: SampleStatus.procesado, extra: []) else { message = "No se pudo guardar (¿poco espacio?)"; return }
        if keepOriginal && !fromSample { storeOriginal() }
        PistoriusMemory.record(source: source, goal: goal, action: chosenAction)
        if then == .chop { state.pendingChop = (s.id, 0) }
        if then != .library { state.open(s) }
        dismiss()
    }
    private func saveForChop(_ out: Pistorius.Outcome, mode: Int) {
        let nm = base + " · para chop"
        guard let s = store(out, name: nm, status: SampleStatus.procesado, extra: ["Pistorius: preparado para chopear"]) else { message = "No se pudo guardar (¿poco espacio?)"; step = .guide; return }
        if keepOriginal && !fromSample { storeOriginal() }
        PistoriusMemory.record(source: source, goal: goal, action: "chop")
        state.pendingChop = (s.id, mode); state.open(s); dismiss()
    }
}

/// Onda sencilla con marcas de corte y, si se da, la zona que quedaría.
struct MarkedWave: View {
    let audio: [Float]
    let markers: [Double]
    let region: [Double]?
    var body: some View {
        let pk = Editing.peaks(audio, buckets: 56)
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                HStack(alignment: .center, spacing: 2) {
                    ForEach(pk.indices, id: \.self) { i in
                        let f = Double(i) / Double(max(1, pk.count)), lit = region.map { f >= $0[0] && f <= $0[1] } ?? true
                        RoundedRectangle(cornerRadius: 2).fill(lit ? Theme.text : Theme.surface2).frame(height: max(3, CGFloat(min(1, pk[i])) * geo.size.height * 0.9))
                    }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
                if region == nil || (region?.count ?? 0) != 2 {
                    ForEach(markers, id: \.self) { m in Rectangle().fill(Theme.muted).frame(width: 2, height: geo.size.height - 16).offset(x: geo.size.width * CGFloat(m)) }
                }
            }
        }.frame(height: 70).accessibilityHidden(true)
    }
}

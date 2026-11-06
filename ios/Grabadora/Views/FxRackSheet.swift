import SwiftUI
import AVFoundation

/// Cadena de efectos: ordena hasta 8 efectos, cambia sus ajustes, mezcla otro sonido, escucha original/procesado,
/// tira los dados para sacar variaciones y aplica el resultado (deshacible) o lo guarda como sonido nuevo.
struct FxRackSheet: View {
    struct Other: Identifiable { let id: String; let name: String }
    let audio: [Float]
    let rate: Int
    let bpm: Double?
    let name: String
    let others: [Other]
    let loadAudio: (String) -> ([Float], Int)?
    let onApply: ([Float], String, [String]) -> Void
    let onSaveNew: ([Float], [String]) -> Void
    let onSaveVariants: ([(out: [Float], notes: [String], style: String)]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var chain: [FxSlot] = []
    @State private var open = 0
    @State private var busy = false
    @State private var status = ""
    @State private var style = "libre"
    @State private var intensity = 50.0
    @State private var seed: UInt32 = UInt32(Date().timeIntervalSince1970) % 100_000
    @State private var user: [String: [FxSlot]] = [:]
    @State private var player: AVAudioPlayer?
    @State private var askName = false
    @State private var newName = ""
    @State private var showDelete = false

    private var maxed: Bool { chain.count >= FxChain.maxSlots }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ScreenTitle(title: "Cadena de efectos", subtitle: "Se aplican de arriba abajo · \(name)", trailing: AnyView(TextLink(title: "Cerrar") { player?.stop(); dismiss() }))
                    SectionLabel("La cadena (\(chain.count) de \(FxChain.maxSlots))")
                    if chain.isEmpty { Text("Vacía: añade un efecto abajo.").font(Theme.font(13)).foregroundColor(Theme.muted) }
                    ForEach(chain) { s in if let i = chain.firstIndex(where: { $0.id == s.id }) { slotCard(i) } }
                    SectionLabel("Añadir un efecto")
                    if maxed { Text("Máximo \(FxChain.maxSlots) efectos.").font(Theme.font(12)).foregroundColor(Theme.muted) } else { adders }
                    SectionLabel("Cadenas guardadas")
                    savedChains
                    SectionLabel("Sorpréndeme")
                    surprise
                    SectionLabel("Escuchar")
                    HStack(spacing: 8) {
                        Button("▶ Original") { play(original: true) }.buttonStyle(OutlineButton()).disabled(busy)
                        Button(busy ? "Procesando…" : "▶ Procesado") { play(original: false) }.buttonStyle(OutlineButton(selected: true)).disabled(busy)
                        Button("■ Parar") { player?.stop(); status = "" }.buttonStyle(OutlineButton())
                    }.font(Theme.font(13))
                    if !status.isEmpty { Text(status).font(Theme.font(13)).foregroundColor(Theme.amber).accessibilityAddTraits(.updatesFrequently) }
                    Button("Aplicar al sonido") { finalize { out, notes in
                        onApply(out, notes.count > 1 ? "Cadena de efectos" : (notes.first ?? "Efecto").components(separatedBy: " (").first ?? "Efecto", notes); dismiss() } }
                        .buttonStyle(AmberButton()).disabled(busy)
                    Button("Guardar como sonido nuevo") { finalize { out, notes in onSaveNew(out, notes); status = "Guardado como sonido nuevo (procesado) · \(lenText(out))" } }
                        .buttonStyle(OutlineButton()).disabled(busy)
                    Text("Aplicar cambia la toma actual (puedes deshacerlo en Editar). «Guardar como sonido nuevo» deja el original intacto y crea otro marcado «procesado», con su origen y la lista de efectos. Con delay, reverb o granular la toma puede alargarse.")
                        .font(Theme.font(12)).foregroundColor(Theme.muted)
                }.padding(16)
            }
        }
        .onAppear { load() }
        .onDisappear { player?.stop() }
        .alert("Guardar la cadena", isPresented: $askName) {
            TextField("Nombre", text: $newName)
            Button("Guardar") { saveChain() }
            Button("Cancelar", role: .cancel) {}
        } message: { Text("Ponle un nombre para encontrarla luego.") }
        .confirmationDialog("Borrar una cadena guardada", isPresented: $showDelete, titleVisibility: .visible) {
            ForEach(user.keys.sorted(), id: \.self) { n in Button("Borrar «\(n)»", role: .destructive) { user[n] = nil; save() } }
        }
    }

    // MARK: Piezas

    private func lenText(_ out: [Float]) -> String {
        let s = Double(out.count) / Double(rate)
        return stamp(s) + (s > Materia.softLimit + 0.05 ? " · dura más de \(Int(Materia.softLimit)) s" : "")
    }

    private func slotName(_ s: FxSlot) -> String { s.isLayer ? "Mezcla con «\(s.name ?? "otro sonido")»" : (s.effect.map { Fx404.info($0).name } ?? s.fx) }

    private func slotCard(_ i: Int) -> some View {
        let s = chain[i], nm = slotName(s), opened = open == i
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Button { open = opened ? -1 : i } label: {
                    HStack { Text("\(i + 1). \(nm)").font(Theme.font(15, weight: .bold)).foregroundColor(Theme.text); if s.bypass { Text("· apagado").font(Theme.font(12)).foregroundColor(Theme.muted) }; Spacer() }
                        .frame(minHeight: 44)
                }.buttonStyle(.plain).accessibilityLabel("\(i + 1). \(nm)\(s.bypass ? " (apagado)" : ""): \(opened ? "cerrar" : "ajustar")")
                iconButton(s.bypass ? "circle" : "circle.fill", (s.bypass ? "Encender " : "Apagar ") + nm) { chain[i].bypass.toggle(); save() }
                iconButton("arrow.up", "Subir " + nm) { move(i, -1) }.disabled(i == 0)
                iconButton("arrow.down", "Bajar " + nm) { move(i, 1) }.disabled(i == chain.count - 1)
                iconButton("xmark", "Quitar " + nm) { chain.remove(at: i); open = min(open, chain.count - 1); save() }
            }
            if opened { slotBody(i) }
        }.card().opacity(s.bypass ? 0.6 : 1)
    }

    private func iconButton(_ sys: String, _ label: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: sys).font(.system(size: 15, weight: .bold)).foregroundColor(Theme.amber).frame(width: 40, height: 44) }
            .buttonStyle(.borderless).accessibilityLabel(label)
    }

    @ViewBuilder private func slotBody(_ i: Int) -> some View {
        let s = chain[i]
        if s.isLayer {
            SliderRow(title: "Nivel del otro sonido", valueText: "\(Int(s.gain.rounded())) %", value: Binding(get: { chain[i].gain }, set: { chain[i].gain = $0; save() }), range: 0...100)
        } else if let e = s.effect {
            let inf = Fx404.info(e)
            VStack(alignment: .leading, spacing: 8) {
                Text(inf.about).font(Theme.font(13)).foregroundColor(Theme.text)
                DisclosureGroup("Cómo se produce") { Text(inf.how).font(Theme.font(12)).foregroundColor(Theme.muted) }.font(Theme.font(13, weight: .medium)).foregroundColor(Theme.amber).tint(Theme.amber)
                Text("Para tu estilo: " + inf.uso).font(Theme.font(12)).foregroundColor(Theme.muted)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                    ForEach(inf.presets.indices, id: \.self) { k in Chip(title: inf.presets[k].name, selected: false) { chain[i].params = Fx404.params(e, inf.presets[k].values); save() } }
                }
                ForEach(inf.params.indices, id: \.self) { k in control(i, inf.params[k]) }
                Button("Restablecer este efecto") { chain[i].params = Fx404.defaults(e); save() }.buttonStyle(OutlineButton()).font(Theme.font(13))
            }
        }
    }

    private func bound(_ i: Int, _ key: String) -> Binding<Double> {
        Binding(get: { chain[i].params[key] ?? 0 }, set: { chain[i].params[key] = $0; save() })
    }

    @ViewBuilder private func control(_ i: Int, _ q: Fx404.Param) -> some View {
        switch q.kind {
        case .range: SliderRow(title: q.label, valueText: Fx404.num(bound(i, q.key).wrappedValue) + q.unit, value: bound(i, q.key), range: q.min...q.max)
        case .bool: ToggleRow(title: q.label, subtitle: q.hint.isEmpty ? nil : q.hint, isOn: Binding(get: { bound(i, q.key).wrappedValue >= 0.5 }, set: { bound(i, q.key).wrappedValue = $0 ? 1 : 0 }))
        case .choice:
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(q.label)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 80), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                    ForEach(q.options.indices, id: \.self) { k in
                        Chip(title: q.options[k], selected: Int(bound(i, q.key).wrappedValue) == k) { bound(i, q.key).wrappedValue = Double(k) }
                            .accessibilityAddTraits(Int(bound(i, q.key).wrappedValue) == k ? .isSelected : [])
                    }
                }
            }
        }
    }

    private var adders: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Fx404.families, id: \.self) { f in
                let ids = Fx404.allOrder.filter { Fx404.family($0) == f }
                if !ids.isEmpty {
                    Text(f).font(Theme.font(12)).foregroundColor(Theme.muted)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                        ForEach(ids, id: \.self) { id in
                            Chip(title: Fx404.info(id).name, selected: false) {
                                var p = Fx404.Params()
                                if let b = bpm, Fx404.defaults(id)["bpm"] != nil { p["bpm"] = b.rounded() }
                                chain.append(.make(id, p)); open = chain.count - 1; save()
                            }
                        }
                    }
                }
            }
            if !others.isEmpty {
                Menu {
                    ForEach(others) { o in Button(o.name) { chain.append(.layer(o.id, name: o.name)); open = chain.count - 1; save() } }
                } label: {
                    Text("＋ Mezclar con otro sonido…").font(Theme.font(15, weight: .medium)).foregroundColor(Theme.text)
                        .frame(maxWidth: .infinity, minHeight: 48).overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line, lineWidth: 1.5))
                }
            }
        }
    }

    private var savedChains: some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                ForEach(FxChain.presets.indices, id: \.self) { k in Chip(title: FxChain.presets[k].name, selected: false) { chain = FxChain.presets[k].chain.map { var c = $0; c.id = UUID(); return c }; open = 0; save() } }
                ForEach(user.keys.sorted(), id: \.self) { n in Chip(title: "★ " + n, selected: false) { chain = (user[n] ?? []).map { var c = $0; c.id = UUID(); return c }; open = 0; save() } }
            }
            HStack(spacing: 8) {
                Button("Guardar esta cadena…") { newName = ""; askName = true }.buttonStyle(OutlineButton())
                if !user.isEmpty { Button("Borrar una guardada…") { showDelete = true }.buttonStyle(OutlineButton()) }
            }.font(Theme.font(13))
        }
    }

    private var surprise: some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                ForEach(FxChain.styles, id: \.key) { s in Chip(title: s.name, selected: style == s.key) { style = s.key }.accessibilityAddTraits(style == s.key ? .isSelected : []) }
            }
            SliderRow(title: "Cuánto cambiar", valueText: "\(Int(intensity)) %", value: $intensity, range: 10...100)
            HStack(spacing: 8) {
                Button("🎲 Generar una cadena") {
                    seed = (seed &* 31 &+ 7) % 1_000_003
                    chain = FxChain.randomChain(seed: seed, style: style, intensity: intensity / 100, bpm: bpm); open = 0; save()
                }.buttonStyle(OutlineButton()).disabled(busy)
                Button("Guardar 4 variantes") { saveVariants() }.buttonStyle(OutlineButton()).disabled(busy)
            }.font(Theme.font(13))
        }
    }

    // MARK: Acciones

    private func move(_ i: Int, _ d: Int) {
        let j = i + d
        guard chain.indices.contains(j) else { return }
        chain.swapAt(i, j); open = j; save()
    }

    private func layersFor(_ c: [FxSlot]) -> [String: ([Float], Int)] {
        var o: [String: ([Float], Int)] = [:]
        for s in c where s.isLayer && !s.bypass { if let r = s.ref, let a = loadAudio(r) { o[r] = a } }
        return o
    }

    private func render(_ c: [FxSlot]) async -> [Float] {
        let x = audio, r = rate, ls = layersFor(c).mapValues { (audio: $0.0, rate: $0.1) }
        return await Task.detached(priority: .userInitiated) { FxChain.apply(c, x, rate: r, layers: ls) }.value
    }

    private func play(original: Bool) {
        player?.stop(); busy = true; status = original ? "" : "Procesando…"
        let c = FxChain.clean(chain)
        Task {
            let out = original ? audio : await render(c)
            do {
                try AudioSessionConfig.activate()
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("rack-\(UUID().uuidString).wav")
                try WavIO.encode(out, sampleRate: rate).write(to: url, options: .atomic)
                let p = try AVAudioPlayer(contentsOf: url)
                p.play(); player = p
                status = original ? "Escuchando el original" : "Escuchando el procesado (\(lenText(out))) · aún no se ha aplicado"
            } catch { status = "No se pudo reproducir: \(error.localizedDescription)" }
            busy = false
        }
    }

    private func finalize(_ done: @escaping ([Float], [String]) -> Void) {
        let c = FxChain.clean(chain)
        guard c.contains(where: { !$0.bypass }) else { status = "Todos los efectos están apagados: no hay nada que aplicar"; return }
        player?.stop(); busy = true; status = "Procesando…"
        Task {
            let out = await render(c)
            busy = false
            done(out, FxChain.describe(c))
        }
    }

    private func saveVariants() {
        player?.stop(); busy = true
        Task {
            var list: [(out: [Float], notes: [String], style: String)] = []
            let sName = FxChain.styles.first { $0.key == style }?.name ?? "Libre"
            for i in 0..<4 {
                status = "Variante \(i + 1) de 4…"
                let c = FxChain.randomChain(seed: seed &+ UInt32(i) &* 977, style: style, intensity: intensity / 100, bpm: bpm)
                list.append((await render(c), FxChain.describe(c), sName))
            }
            onSaveVariants(list)
            status = "Guardadas 4 variantes como sonidos nuevos (procesados)"
            busy = false
        }
    }

    // MARK: Memoria

    private func load() {
        guard chain.isEmpty else { return }
        let d = UserDefaults.standard
        if let data = d.data(forKey: "fxChain"), let c = try? JSONDecoder().decode([FxSlot].self, from: data) { chain = FxChain.clean(c) }
        if let data = d.data(forKey: "fxChains"), let u = try? JSONDecoder().decode([String: [FxSlot]].self, from: data) { user = u }
        if chain.isEmpty { chain = [.make(.cassette)] }
    }
    private func save() { if let data = try? JSONEncoder().encode(chain) { UserDefaults.standard.set(data, forKey: "fxChain") } }
    private func saveChain() {
        let n = String(newName.trimmingCharacters(in: .whitespaces).prefix(30))
        guard !n.isEmpty else { return }
        user[n] = FxChain.clean(chain)
        if let data = try? JSONEncoder().encode(user) { UserDefaults.standard.set(data, forKey: "fxChains") }
        status = "Cadena guardada: \(n)"
    }
}

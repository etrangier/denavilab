import SwiftUI
import AVFoundation

/// Hoja «Efectos de carácter»: los cinco efectos estilo SP-404MKII, con explicación, ajustes, preajustes, escucha previa y aplicar (deshacible).
struct Fx404Sheet: View {
    let audio: [Float]
    let rate: Int
    let onApply: ([Float], String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var id: Fx404.ID = .cassette
    @State private var values: [String: Fx404.Params] = [:]
    @State private var busy = false
    @State private var status = ""
    @State private var player: AVAudioPlayer?

    private func bound(_ key: String) -> Binding<Double> {
        Binding(get: { values[id.rawValue]?[key] ?? Fx404.defaults(id)[key] ?? 0 },
                set: { var p = values[id.rawValue] ?? Fx404.defaults(id); p[key] = $0; values[id.rawValue] = p; save() })
    }
    private var current: Fx404.Params { Fx404.params(id, values[id.rawValue] ?? [:]) }

    var body: some View {
        let inf = Fx404.info(id)
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ScreenTitle(title: "Efectos de carácter", subtitle: "Inspirados en la SP-404MKII · se aplican antes de llevar el sonido al K.O. II",
                                trailing: AnyView(TextLink(title: "Cerrar") { player?.stop(); dismiss() }))
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                        ForEach(Fx404.order, id: \.self) { k in
                            Chip(title: Fx404.info(k).name, selected: k == id) { id = k; save() }
                                .accessibilityAddTraits(k == id ? .isSelected : [])
                        }
                    }
                    infoCard(inf)
                    SectionLabel("Preajustes")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                        ForEach(inf.presets.indices, id: \.self) { i in
                            Chip(title: inf.presets[i].name, selected: false) { values[id.rawValue] = Fx404.params(id, inf.presets[i].values); save() }
                        }
                    }
                    ForEach(inf.params.indices, id: \.self) { i in control(inf.params[i]) }
                    HStack(spacing: 8) {
                        Button(busy ? "Procesando…" : "▶ Escuchar") { preview() }.buttonStyle(OutlineButton()).disabled(busy)
                        Button("Restablecer") { values[id.rawValue] = Fx404.defaults(id); save() }.buttonStyle(OutlineButton()).font(Theme.font(13))
                    }
                    Button("Aplicar al sonido") { applyIt() }.buttonStyle(AmberButton()).disabled(busy)
                    if !status.isEmpty { Text(status).font(Theme.font(13)).foregroundColor(Theme.amber).accessibilityAddTraits(.updatesFrequently) }
                    Text("Se aplica a toda la toma (\(stamp(Double(audio.count) / Double(rate)))) y puedes deshacerlo desde el historial de Editar. Mismo largo que el original." + (id == .autopitch ? " Funciona con una sola voz o instrumento; en acordes sale mal." : ""))
                        .font(Theme.font(12)).foregroundColor(Theme.muted)
                }.padding(16)
            }
        }
        .onAppear { load() }
        .onDisappear { player?.stop() }
    }

    private func infoCard(_ inf: Fx404.Info) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(inf.name).font(Theme.font(15, weight: .bold)).foregroundColor(Theme.text)
            Text(inf.about).font(Theme.font(13)).foregroundColor(Theme.text)
            Text("Para tu estilo: " + inf.uso).font(Theme.font(12)).foregroundColor(Theme.muted)
            DisclosureGroup("Cómo se produce") { Text(inf.how).font(Theme.font(12)).foregroundColor(Theme.muted) }
                .font(Theme.font(13, weight: .medium)).foregroundColor(Theme.amber).tint(Theme.amber)
        }.card()
    }

    @ViewBuilder private func control(_ q: Fx404.Param) -> some View {
        switch q.kind {
        case .range:
            SliderRow(title: q.label, valueText: Fx404.num(bound(q.key).wrappedValue) + q.unit, value: bound(q.key), range: q.min...q.max)
        case .bool:
            ToggleRow(title: q.label, subtitle: "Deja la voz sin inflexión, siempre en la misma nota",
                      isOn: Binding(get: { bound(q.key).wrappedValue >= 0.5 }, set: { bound(q.key).wrappedValue = $0 ? 1 : 0 }))
        case .choice:
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(q.label)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 70), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                    ForEach(q.options.indices, id: \.self) { i in
                        Chip(title: q.options[i], selected: Int(bound(q.key).wrappedValue) == i) { bound(q.key).wrappedValue = Double(i) }
                            .accessibilityAddTraits(Int(bound(q.key).wrappedValue) == i ? .isSelected : [])
                    }
                }
            }
        }
    }

    // MARK: Ajustes recordados

    private func load() {
        guard values.isEmpty else { return }
        let d = UserDefaults.standard
        if let raw = d.string(forKey: "fx404Id"), let k = Fx404.ID(rawValue: raw) { id = k }
        if let data = d.data(forKey: "fx404Params"), let v = try? JSONDecoder().decode([String: Fx404.Params].self, from: data) { values = v }
    }
    private func save() {
        let d = UserDefaults.standard
        d.set(id.rawValue, forKey: "fx404Id")
        if let data = try? JSONEncoder().encode(values) { d.set(data, forKey: "fx404Params") }
    }

    // MARK: Acciones

    private func process() async -> [Float] {
        let k = id, p = current, x = audio, r = rate
        return await Task.detached(priority: .userInitiated) { Fx404.apply(k, x, rate: r, p) }.value
    }

    private func preview() {
        busy = true; status = "Procesando…"; player?.stop()
        Task {
            let out = await process()
            do {
                try AudioSessionConfig.activate()
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("fx404-\(UUID().uuidString).wav")
                try WavIO.encode(out, sampleRate: rate).write(to: url, options: .atomic)
                let p = try AVAudioPlayer(contentsOf: url)
                p.play(); player = p
                status = "Escuchando el resultado (no se ha aplicado)"
            } catch { status = "No se pudo reproducir: \(error.localizedDescription)" }
            busy = false
        }
    }

    private func applyIt() {
        busy = true; status = "Aplicando…"; player?.stop()
        Task {
            let out = await process()
            busy = false
            onApply(out, Fx404.info(id).name)
            dismiss()
        }
    }
}

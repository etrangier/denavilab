import SwiftUI

/// Laboratorio de pads: prueba y escucha en tiempo real; nada se guarda hasta pedirlo.
struct PadLabSheet: View {
    let sample: Sample
    @EnvironmentObject var lib: LibraryStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var player = PadPlayer()
    @StateObject private var midi = MIDIListener()
    @State private var layers: [PadLab.Layer] = []
    @State private var p = PadLab.Params()
    @State private var processed: [Float] = []
    @State private var busy = false
    @State private var hearing = false
    @State private var octave = 0
    @State private var name = ""
    @State private var note: String?
    @State private var saving = false

    private struct LayerKey: Equatable { var id: UUID; var vol: Double; var tune: Double }
    private struct RenderKey: Equatable { var p: PadLab.Params; var layers: [LayerKey] }
    private var renderKey: RenderKey { RenderKey(p: p, layers: layers.map { LayerKey(id: $0.id, vol: $0.volume, tune: $0.tune) }) }

    private func bind(_ kp: WritableKeyPath<PadLab.Params, Double>) -> Binding<Double> {
        Binding(get: { p[keyPath: kp] }, set: { p[keyPath: kp] = $0 })
    }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenTitle(title: "Laboratorio de pads", subtitle: "Prueba y escucha en tiempo real; nada se guarda hasta que lo pidas.",
                                trailing: AnyView(TextLink(title: "Cerrar") { player.allOff(); dismiss() }))
                    HStack(spacing: 10) {
                        Button(hearing ? "■ Parar" : "▶ Oír en bucle") { toggleHear() }.buttonStyle(AmberButton(full: false)).disabled(processed.isEmpty)
                        Text(busy ? "Procesando…" : (processed.isEmpty ? "Preparando…" : "Listo")).font(Theme.font(13)).foregroundColor(Theme.muted)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                    SectionLabel("Capas (hasta \(PadLab.maxLayers))")
                    ForEach(layers.indices, id: \.self) { i in layerCard(i) }
                    if layers.count < PadLab.maxLayers { addLayerMenu } else {
                        Text("Máximo \(PadLab.maxLayers) capas.").font(Theme.font(12)).foregroundColor(Theme.muted)
                    }
                    SectionLabel("Bucle sin clics")
                    SliderRow(title: "Fundido cruzado", valueText: "\(Int(p.loopMs)) ms", value: bind(\.loopMs), range: PadLab.loopRange)
                    seamCard
                    SectionLabel("Estirar (mantiene el tono)")
                    HStack(spacing: 8) {
                        ForEach(PadLab.stretches, id: \.self) { n in
                            Button("×\(n)") { p.stretch = n }.buttonStyle(OutlineButton(selected: p.stretch == n)).font(Theme.font(14))
                                .accessibilityAddTraits(p.stretch == n ? .isSelected : [])
                        }
                    }
                    Text("El estirado es granular con fases al azar: va muy bien en pads y texturas; los golpes pierden su ataque. Con ×8 y una toma larga puede tardar unos segundos.")
                        .font(Theme.font(12)).foregroundColor(Theme.muted)
                    SectionLabel("Tono")
                    SliderRow(title: "Cambio de tono", valueText: "\(p.pitch > 0 ? "+" : "")\(Int(p.pitch)) st", value: bind(\.pitch), range: PadLab.pitchRange)
                    Text("Es como cambiar la velocidad de un vinilo: al bajar el tono el sonido dura más.").font(Theme.font(12)).foregroundColor(Theme.muted)
                    SectionLabel("Filtros")
                    SliderRow(title: "Pasa-altos", valueText: PadLab.hpHz(p.hp) > 0 ? "\(PadLab.hpHz(p.hp)) Hz" : "apagado", value: bind(\.hp))
                    SliderRow(title: "Pasa-bajos", valueText: PadLab.lpHz(p.lp) > 0 ? "\(PadLab.lpHz(p.lp)) Hz" : "apagado", value: bind(\.lp))
                    SectionLabel("Reverb larga")
                    SliderRow(title: "Mezcla", valueText: "\(Int(p.mix)) %", value: bind(\.mix))
                    SliderRow(title: "Largo", valueText: String(format: "%g", p.decay).replacingOccurrences(of: ".", with: ",") + " s", value: bind(\.decay), range: 0.5...8)
                    SectionLabel("Saturación")
                    SliderRow(title: "Cantidad", valueText: "\(Int(p.sat)) %", value: bind(\.sat))
                    SectionLabel("Tocarlo como instrumento")
                    keyboard
                    HStack(spacing: 8) {
                        Button("Octava −") { octave = max(-2, octave - 1) }.buttonStyle(OutlineButton())
                        Text("Octava \(octave >= 0 ? "+" : "")\(octave)").font(Theme.font(13, weight: .bold)).foregroundColor(Theme.amber).frame(width: 90)
                        Button("Octava +") { octave = min(2, octave + 1) }.buttonStyle(OutlineButton())
                    }.font(Theme.font(13))
                    HStack(spacing: 8) {
                        Button("Activar MIDI") { midi.start() }.buttonStyle(OutlineButton()).font(Theme.font(13)).frame(width: 150)
                        Text(midi.status).font(Theme.font(12)).foregroundColor(Theme.muted)
                    }
                    SectionLabel("Guardar")
                    TextField("Nombre del resultado", text: $name).font(Theme.font(15)).foregroundColor(Theme.text).card()
                    Button(saving ? "Guardando…" : "Guardar como nuevo sonido") { save() }.buttonStyle(AmberButton()).disabled(processed.isEmpty || saving)
                    if let n = note { Text(n).font(Theme.font(13)).foregroundColor(Theme.amber) }
                    Text("Guarda un archivo nuevo y deja el original intacto. El resultado queda como «procesado», con el origen y la lista de procesos. Está pensado para bucle: no lleva fundidos en los bordes.")
                        .font(Theme.font(12)).foregroundColor(Theme.muted)
                }.padding(16)
            }
        }
        .onAppear {
            if layers.isEmpty {
                layers = [PadLab.Layer(id: sample.id, name: sample.name, audio: lib.audio(for: sample), rate: sample.sampleRate)]
                name = sample.name + " pad"
            }
            midi.onNote = { n, on in
                let semis = n - 60
                if on { player.noteOn(semis) } else { player.noteOff(semis) }
            }
        }
        .onDisappear { player.allOff() }
        .task(id: renderKey) { await rerender() }
    }

    // MARK: Piezas

    private func layerCard(_ i: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Capa \(i + 1): \(layers[i].name)").font(Theme.font(14, weight: .bold)).foregroundColor(Theme.text).lineLimit(1)
                Spacer()
                if i > 0 { TextLink(title: "Quitar") { layers.remove(at: i) } }
            }
            SliderRow(title: "Volumen", valueText: "\(Int((layers[i].volume * 100).rounded())) %", value: Binding(get: { layers[i].volume }, set: { layers[i].volume = $0 }))
            SliderRow(title: "Afinación", valueText: "\(layers[i].tune > 0 ? "+" : "")\(Int(layers[i].tune)) st",
                      value: Binding(get: { layers[i].tune }, set: { layers[i].tune = $0.rounded() }), range: -24...24)
        }.card()
    }

    private var addLayerMenu: some View {
        Menu {
            ForEach(lib.samples.filter { s in !layers.contains { $0.id == s.id } }) { s in
                Button(s.name) {
                    let a = lib.audio(for: s)
                    if a.isEmpty { note = "Esa grabación no tiene audio"; return }
                    layers.append(PadLab.Layer(id: s.id, name: s.name, audio: a, rate: s.sampleRate, volume: 0.8))
                }
            }
        } label: {
            Text("＋ Añadir una capa…").font(Theme.font(15, weight: .medium)).foregroundColor(Theme.text)
                .frame(maxWidth: .infinity, minHeight: 48).overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line, lineWidth: 1.5))
        }
    }

    private var seamCard: some View {
        let w = min(Int(0.4 * Double(PadLab.outRate)), processed.count / 2)
        let joint = w > 0 ? Array(processed.suffix(w)) + Array(processed.prefix(w)) : []
        let score = processed.count > 64 ? Creative.seamJump(processed) : 0
        return VStack(alignment: .leading, spacing: 6) {
            WaveBars(peaks: Editing.peaks(joint, buckets: 80), range: 0...1).frame(height: 56)
            Text(processed.isEmpty ? "" : (score < 0.6 ? String(format: "Empalme limpio (salto %.2f)", score) : String(format: "Se podría oír un clic (salto %.2f): sube el fundido cruzado", score)))
                .font(Theme.font(12)).foregroundColor(Theme.muted)
        }.card()
    }

    private var keyboard: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
            ForEach(0..<13, id: \.self) { i in
                let semis = octave * 12 + i
                let on = player.held.contains(semis)
                Text(PadLab.noteName(semis))
                    .font(Theme.font(11, weight: .bold)).foregroundColor(on ? Theme.ink : Theme.text)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(on ? Theme.amber : Theme.surface2).clipShape(RoundedRectangle(cornerRadius: 8))
                    .onLongPressGesture(minimumDuration: 0, maximumDistance: 60, pressing: { down in
                        if down { player.noteOn(semis) } else { player.noteOff(semis) }
                    }, perform: {})
                    .accessibilityElement()
                    .accessibilityLabel("Tocar " + PadLab.noteName(semis))
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction {
                        player.noteOn(semis)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { player.noteOff(semis) }
                    }
            }
        }
    }

    // MARK: Acciones

    private func toggleHear() {
        if hearing { player.noteOff(0); hearing = false } else { player.noteOn(0); hearing = true }
    }

    @MainActor private func rerender() async {
        try? await Task.sleep(nanoseconds: 350_000_000)           // espera a que se suelte el control
        if Task.isCancelled { return }
        busy = true
        let ls = layers, params = p
        let out = await Task.detached(priority: .userInitiated) { PadLab.process(ls, params) }.value
        if Task.isCancelled { busy = false; return }
        processed = out
        player.load(out, rate: PadLab.outRate)
        if hearing { player.noteOn(0) }
        busy = false
    }

    private func save() {
        saving = true
        let ls = layers, params = p
        Task {
            let out = await Task.detached(priority: .userInitiated) { PadLab.process(ls, params) }.value
            let nm = name.trimmingCharacters(in: .whitespaces).isEmpty ? sample.name + " pad" : name.trimmingCharacters(in: .whitespaces)
            if var x = lib.add(name: nm, audio: out, sampleRate: PadLab.outRate) {
                let srcs = ls.compactMap { l in lib.samples.first { $0.id == l.id } }
                x.folder = sample.folder; x.subfolder = sample.subfolder
                x.status = "procesado"
                x.origin = Array(NSOrderedSet(array: srcs.map(\.origin).filter { !$0.isEmpty })).compactMap { $0 as? String }.joined(separator: " + ")
                if x.origin.isEmpty { x.origin = sample.origin }
                x.tags = Array(NSOrderedSet(array: srcs.flatMap(\.tags))).compactMap { $0 as? String }
                x.key = sample.key; x.bpm = sample.bpm
                x.comment = "Laboratorio de pads. Original: " + sample.name + (sample.comment.isEmpty ? "" : " · " + sample.comment)
                x.process = sample.process + PadLab.describe(params, ls)
                lib.update(x)
                let secs = Double(out.count) / Double(PadLab.outRate)
                note = "Guardado como procesado: \(nm) · \(stamp(secs))" + (secs > Materia.softLimit ? " · dura más de \(Int(Materia.softLimit)) s" : "")
            }
            saving = false
        }
    }
}

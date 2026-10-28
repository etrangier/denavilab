import SwiftUI

/// Exportar para el K.O. II: alcance (favoritos, selección o todo), ajustes, vista previa de nombres y .zip.
struct KoExportSheet: View {
    let selection: [Sample]
    @EnvironmentObject var lib: LibraryStore
    @Environment(\.dismiss) private var dismiss
    private enum Scope { case favoritos, seleccion, todo }
    @State private var scope = Scope.todo
    @State private var o = KoExport.Options.load()
    @State private var onlyReady = UserDefaults.standard.bool(forKey: "koReady")
    @State private var start = 1
    @State private var busy = false
    @State private var note: String?
    @State private var shareItems: [Any] = []
    @State private var showShare = false

    private var favs: [Sample] { lib.samples.filter(\.favorite) }
    private var items: [Sample] {
        let base: [Sample]
        switch scope { case .favoritos: base = favs; case .seleccion: base = selection; case .todo: base = lib.samples }
        return base.filter { !onlyReady || $0.status == SampleStatus.listo }.sorted { $0.created < $1.created }
    }

    private func previewLine(_ file: String, _ name: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(file).font(.system(size: 13, design: .monospaced)).foregroundColor(Theme.amber)
            Text("← " + name).font(Theme.font(12)).foregroundColor(Theme.muted).lineLimit(1)
        }
    }

    private func num(_ title: String, _ unit: String, _ v: Binding<Double>) -> some View {
        HStack {
            Text(title).font(Theme.font(14, weight: .medium)).foregroundColor(Theme.text)
            Spacer()
            TextField("0", value: v, format: .number).keyboardType(.numbersAndPunctuation).multilineTextAlignment(.trailing)
                .font(Theme.font(15, weight: .bold)).foregroundColor(Theme.amber).frame(width: 70)
                .accessibilityLabel(title)
            Text(unit).font(Theme.font(12)).foregroundColor(Theme.muted)
        }.card()
    }

    var body: some View {
        let list = items, plan = KoExport.plan(list, start: start)
        let mbs = list.reduce(0.0) { $0 + $1.duration } * Double(o.rate) * 2 / 1e6
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ScreenTitle(title: "Exportar para el K.O. II", subtitle: "WAV mono 16 bit · pico a −1 dBFS · sin compresión",
                                trailing: AnyView(TextLink(title: "Cerrar") { dismiss() }))
                    SectionLabel("Qué exportar")
                    HStack(spacing: 8) {
                        Button("★ Favoritos (\(favs.count))") { scope = .favoritos }.buttonStyle(OutlineButton(selected: scope == .favoritos))
                        Button("Selección (\(selection.count))") { scope = .seleccion }.buttonStyle(OutlineButton(selected: scope == .seleccion)).disabled(selection.isEmpty)
                        Button("Todo (\(lib.samples.count))") { scope = .todo }.buttonStyle(OutlineButton(selected: scope == .todo))
                    }.font(Theme.font(13))
                    ToggleRow(title: "Solo los «listos para K.O.»", subtitle: "Entre lo elegido, deja fuera los que no tienen ese estado (\(lib.samples.filter { $0.status == SampleStatus.listo }.count) en total)",
                              isOn: Binding(get: { onlyReady }, set: { onlyReady = $0; UserDefaults.standard.set($0, forKey: "koReady") }))
                    SectionLabel("Frecuencia de muestreo")
                    HStack(spacing: 8) {
                        ForEach(KoExport.rates, id: \.self) { r in
                            Button(r == 46_875 ? "46 875 Hz" : "44,1 kHz") { o.rate = r; o.save() }.buttonStyle(OutlineButton(selected: o.rate == r))
                        }
                    }.font(Theme.font(14))
                    Text("46 875 Hz es lo que usa el K.O. II · por confirmar con el aparato. 44,1 kHz es la alternativa segura.").font(Theme.font(12)).foregroundColor(Theme.muted)
                    num("Umbral de silencio inicial", "dB", Binding(get: { o.thresholdDB }, set: { o.thresholdDB = $0; o = o.clamped; o.save() }))
                    num("Fundido de entrada", "ms", Binding(get: { o.fadeInMs }, set: { o.fadeInMs = $0; o = o.clamped; o.save() }))
                    num("Fundido de salida", "ms", Binding(get: { o.fadeOutMs }, set: { o.fadeOutMs = $0; o = o.clamped; o.save() }))
                    ToggleRow(title: "Fade-out largo para one-shots", subtitle: "\(Int(KoExport.longFadeMs)) ms de salida en vez del fundido corto",
                              isOn: Binding(get: { o.longFade }, set: { o.longFade = $0; o.save() }))
                    ToggleRow(title: "Filtro pasa-altos suave (90 Hz)", subtitle: "Quita rumor grave que el aparato no necesita", isOn: Binding(get: { o.hp }, set: { o.hp = $0; o.save() }))
                    ToggleRow(title: "Nivel parejo en vez de pico", subtitle: "Nivela por volumen típico (como en Compartir) en lugar de llevar el pico a −1 dBFS",
                              isOn: Binding(get: { o.even }, set: { o.even = $0; o.save() }))
                    num("Empezar a numerar en", "", Binding(get: { Double(start) }, set: { start = max(1, min(900, Int($0))) }))
                    SectionLabel("Vista previa de nombres (\(plan.count))")
                    VStack(alignment: .leading, spacing: 4) {
                        if plan.isEmpty {
                            Text(onlyReady ? "Ningún sonido de esta opción está «listo para K.O.». Cambia su estado en Detalles o apaga el filtro." : "Nada que exportar. Marca favoritos con la ☆ o elige otra opción.")
                                .font(Theme.font(13)).foregroundColor(Theme.muted)
                        }
                        ForEach(0..<min(plan.count, 60), id: \.self) { i in
                            previewLine(plan[i].file, plan[i].sample.name)
                        }
                        if plan.count > 60 { Text("… y \(plan.count - 60) más").font(Theme.font(12)).foregroundColor(Theme.muted) }
                    }.card().accessibilityElement(children: .contain)
                    Text("≈ \(String(format: "%.1f", mbs).replacingOccurrences(of: ".", with: ",")) MB · lista.txt dentro del .zip dice qué sonido es cada archivo y de dónde salió.")
                        .font(Theme.font(12)).foregroundColor(Theme.muted)
                    Button(busy ? "Preparando…" : (list.isEmpty ? "No hay sonidos en esta opción" : "Descargar .zip (\(list.count) \(list.count == 1 ? "sonido" : "sonidos"))")) { export(list) }
                        .buttonStyle(AmberButton()).disabled(list.isEmpty || busy)
                    if let n = note { Text(n).font(Theme.font(13)).foregroundColor(Theme.amber) }
                }.padding(16)
            }
        }
        .onAppear { scope = !selection.isEmpty ? .seleccion : (!favs.isEmpty ? .favoritos : .todo) }
        .sheet(isPresented: $showShare) { ShareSheet(items: shareItems) }
    }

    private func export(_ list: [Sample]) {
        busy = true; note = nil
        let opts = o, first = start
        let audios = Dictionary(uniqueKeysWithValues: list.map { ($0.id, lib.audio(for: $0)) })
        Task {
            let r = await Task.detached(priority: .userInitiated) { KoExport.build(list, audio: { audios[$0.id] ?? [] }, opts: opts, start: first) }.value
            guard !r.entries.isEmpty else {
                note = "No quedó ningún sonido para exportar: " + (r.skipped.joined(separator: ", ").isEmpty ? "lista vacía" : r.skipped.joined(separator: ", "))
                busy = false; return
            }
            do {
                let f = DateFormatter(); f.dateFormat = "yyyyMMdd"; f.locale = Locale(identifier: "en_US_POSIX")
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("ko2_\(scope == .favoritos ? "favoritos" : scope == .seleccion ? "seleccion" : "todo")_\(f.string(from: Date())).zip")
                try Zip.make(r.entries).write(to: url, options: .atomic)
                shareItems = [url]; showShare = true
                note = "\(r.entries.count - 1) sonidos listos para el K.O. II" + (r.skipped.isEmpty ? "" : " · omitidos: " + r.skipped.prefix(3).joined(separator: ", "))
            } catch { note = "No se pudo preparar la exportación: \(error.localizedDescription)" }
            busy = false
        }
    }
}

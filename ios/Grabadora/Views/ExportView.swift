import SwiftUI

/// Pestaña Compartir: manda la grabación como archivo WAV por correo, Bluetooth/AirDrop, Drive u otra app.
/// El formato K.O. II (slot, 46 875 Hz, memoria; pantalla 23) está en pausa: ver `Features.koExport`.
struct ExportView: View {
    @EnvironmentObject var lib: LibraryStore
    @EnvironmentObject var state: AppState
    @AppStorage("exportRate") private var rate = 46_875
    @AppStorage("shareRate") private var shareRate = 0          // 0 = la frecuencia original de la grabación
    @AppStorage("levelExport") private var levelExport = true    // nivelar el volumen al compartir
    @AppStorage("levelTarget") private var levelTarget = -30.0   // nivel típico objetivo (dB)
    @State private var sharing: [URL] = []
    @State private var showShare = false
    @State private var message: String?

    private var sample: Sample? { lib.samples.first(where: { $0.id == state.selectedID }) ?? lib.samples.first }

    var body: some View {
        Screen {
            VStack(alignment: .leading, spacing: 14) {
                ScreenTitle(title: Features.koExport ? "Formato K.O. II" : "Compartir")
                if let s = sample { if Features.koExport { koContent(s) } else { shareContent(s) } } else {
                    VStack(spacing: 12) {
                        Text("Aún no hay nada que compartir").font(Theme.font(18, weight: .bold)).foregroundColor(Theme.text)
                        Text("Graba un sample y vuelve aquí.").font(Theme.font(14)).foregroundColor(Theme.muted)
                        Button("Grabar") { state.tab = .grabar }.buttonStyle(AmberButton(full: false))
                    }.frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
        }
        .sheet(isPresented: $showShare) { ShareSheet(items: sharing) }
    }

    @ViewBuilder private func shareContent(_ s: Sample) -> some View {
        let outRate = shareRate == 0 ? s.sampleRate : shareRate
        VStack(alignment: .leading, spacing: 4) {
            Text("Grabación").font(Theme.font(13)).foregroundColor(Theme.muted)
            Text(s.name).font(Theme.font(15, weight: .bold)).foregroundColor(Theme.text)
            Text("WAV · mono · 16 bit · \(rateText(outRate)) · \(stamp(s.duration))").font(Theme.font(12)).foregroundColor(Theme.muted)
        }.card()
        SectionLabel("Frecuencia de muestreo")
        HStack(spacing: 8) {
            ForEach([(0, "Original"), (44_100, "44,1 kHz"), (48_000, "48 kHz")], id: \.0) { r in
                Button(r.1) { shareRate = r.0 }.buttonStyle(OutlineButton(selected: shareRate == r.0)).font(Theme.font(13))
            }
        }
        HStack {
            Text("Nombre").font(Theme.font(14)).foregroundColor(Theme.muted)
            Spacer()
            Text(Exporter.fileName(for: s)).font(Theme.font(13)).foregroundColor(Theme.text).lineLimit(1)
        }.card()
        levelControls
        Text("Se envía un archivo .wav (mono, 16 bit): por correo, Bluetooth o AirDrop, Drive u otra app que elijas.")
            .font(Theme.font(12)).foregroundColor(Theme.muted)
        Button("Compartir WAV") { share(s) }.buttonStyle(AmberButton()).padding(.top, 6)
        Button("Compartir todo (\(lib.samples.count)) en WAV") { shareAll() }
            .buttonStyle(OutlineButton()).disabled(lib.samples.isEmpty)
        if let m = message { Text(m).font(Theme.font(13)).foregroundColor(Theme.error) }
    }

    private var levelControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            ToggleRow(title: "Nivelar volumen", subtitle: "Lleva el sonido al mismo nivel que los demás (\(Int(levelTarget)) dB de nivel típico) para que no suene muy fuerte ni muy bajo; el pico queda bajo \(Int(Level.ceilingDB)) dB", isOn: $levelExport)
            if levelExport {
                SliderRow(title: "Nivel objetivo", valueText: "\(Int(levelTarget)) dB", value: $levelTarget, range: -36 ... -12)
                Text("Más a la izquierda, más bajo. Si en el aparato suenan más fuertes que sus sonidos de fábrica, baja este nivel hasta que igualen.")
                    .font(Theme.font(12)).foregroundColor(Theme.muted)
            }
        }
    }

    private func rateText(_ r: Int) -> String { r == 44_100 ? "44,1 kHz" : r % 1000 == 0 ? "\(r / 1000) kHz" : String(format: "%.1f kHz", Double(r) / 1000).replacingOccurrences(of: ".", with: ",") }

    /// Un WAV de la grabación, a la frecuencia elegida, para la hoja de compartir del sistema.
    private func share(_ s: Sample) {
        do { sharing = [try Exporter.export(s, audio: lib.audio(for: s), targetRate: shareRate == 0 ? nil : shareRate, level: levelExport)]; showShare = true; message = nil }
        catch { message = "No se pudo preparar el archivo: \(error.localizedDescription)" }
    }

    /// Todas las grabaciones, cada una como su propio WAV.
    private func shareAll() {
        let list = lib.samples
        Task {
            do { sharing = try await Exporter.exportKit(list, targetRate: shareRate == 0 ? nil : shareRate) { lib.audio(for: $0) }; showShare = true; message = nil }
            catch { message = "No se pudieron preparar los archivos: \(error.localizedDescription)" }
        }
    }

    @ViewBuilder private func koContent(_ s: Sample) -> some View {
        SectionLabel("Frecuencia de muestreo")
        HStack(spacing: 8) {
            ForEach([(46_875, "46 875 Hz"), (44_100, "44,1 kHz"), (48_000, "48 kHz")], id: \.0) { r in
                Button(r.1) { rate = r.0 }.buttonStyle(OutlineButton(selected: rate == r.0)).font(Theme.font(13))
            }
        }
        Text("46 875 Hz es lo que usa el K.O. II · por confirmar con el aparato").font(Theme.font(12)).foregroundColor(Theme.muted)
        SectionLabel("Canales")
        HStack(spacing: 8) {
            Button("Mono") {}.buttonStyle(OutlineButton(selected: true))
            Button("Estéreo · próximamente") {}.buttonStyle(OutlineButton()).disabled(true).opacity(0.45).font(Theme.font(12))
        }
        SectionLabel("Profundidad")
        HStack(spacing: 8) {
            Button("16 bit") {}.buttonStyle(OutlineButton(selected: true))
            Button("24 bit · por confirmar") {}.buttonStyle(OutlineButton()).disabled(true).opacity(0.45).font(Theme.font(12))
        }
        VStack(alignment: .leading, spacing: 4) {
            Text("Grabación").font(Theme.font(13)).foregroundColor(Theme.muted)
            Text(s.name).font(Theme.font(15, weight: .bold)).foregroundColor(Theme.text)
        }.card()
        Stepper(value: Binding(get: { s.slot ?? 600 }, set: { v in var x = s; x.slot = min(999, max(1, v)); lib.update(x) }), in: 1...999) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Slot de destino").font(Theme.font(15, weight: .bold)).foregroundColor(Theme.text)
                Text("Libres 600–999 · por confirmar").font(Theme.font(12)).foregroundColor(Theme.muted)
                Text("\(s.slot ?? 600)").font(Theme.font(30, weight: .bold)).foregroundColor(Theme.amber)
            }
        }.card()
        memory(s)
        HStack {
            Text("Nombre").font(Theme.font(14)).foregroundColor(Theme.muted)
            Spacer()
            Text(Exporter.fileName(for: s)).font(Theme.font(13)).foregroundColor(Theme.text).lineLimit(1)
        }.card()
        Text("Otras frecuencias y 24 bit no están confirmadas para el K.O. II.").font(Theme.font(12)).foregroundColor(Theme.muted)
        Button("Guardar con este formato") { export(s) }.buttonStyle(AmberButton()).padding(.top, 6)
        Button("Exportar kit (\(lib.samples.filter { $0.slot != nil }.count) con slot)") { exportKit() }
            .buttonStyle(OutlineButton()).disabled(lib.samples.allSatisfy { $0.slot == nil })
        if let m = message { Text(m).font(Theme.font(13)).foregroundColor(Theme.error) }
    }

    private func memory(_ s: Sample) -> some View {
        let mb = s.duration * Double(rate) * 2 / 1_000_000
        let left = max(0, 128 - mb)
        return VStack(alignment: .leading, spacing: 8) {
            Text("Memoria").font(Theme.font(15, weight: .bold)).foregroundColor(Theme.text)
            Text(String(format: "%.1f MB · quedan %.0f MB de 128 MB", mb, left).replacingOccurrences(of: ".", with: ","))
                .font(Theme.font(12)).foregroundColor(Theme.muted)
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surface2)
                    Capsule().fill(Theme.amber).frame(width: max(6, g.size.width * CGFloat(min(1, mb / 128))))
                }
            }.frame(height: 8)
        }.card()
    }

    private func export(_ s: Sample) {
        do { sharing = [try Exporter.export(s, audio: lib.audio(for: s), targetRate: rate)]; showShare = true; message = nil }
        catch { message = "No se pudo exportar: \(error.localizedDescription)" }
    }

    private func exportKit() {
        let list = lib.samples.filter { $0.slot != nil }
        Task {
            do { sharing = try await Exporter.exportKit(list, targetRate: rate) { lib.audio(for: $0) }; showShare = true; message = nil }
            catch { message = "No se pudo exportar: \(error.localizedDescription)" }
        }
    }
}

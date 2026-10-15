import SwiftUI

/// Pestaña Exportar: formato K.O. II (pantalla 23).
struct ExportView: View {
    @EnvironmentObject var lib: LibraryStore
    @EnvironmentObject var state: AppState
    @AppStorage("exportRate") private var rate = 46_875
    @State private var sharing: [URL] = []
    @State private var showShare = false
    @State private var message: String?

    private var sample: Sample? { lib.samples.first(where: { $0.id == state.selectedID }) ?? lib.samples.first }

    var body: some View {
        Screen {
            VStack(alignment: .leading, spacing: 14) {
                ScreenTitle(title: "Formato K.O. II")
                if let s = sample { content(s) } else {
                    VStack(spacing: 12) {
                        Text("Aún no hay nada que exportar").font(Theme.font(18, weight: .bold)).foregroundColor(Theme.text)
                        Text("Graba un sample y vuelve aquí.").font(Theme.font(14)).foregroundColor(Theme.muted)
                        Button("Grabar") { state.tab = .grabar }.buttonStyle(AmberButton(full: false))
                    }.frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
        }
        .sheet(isPresented: $showShare) { ShareSheet(items: sharing) }
    }

    @ViewBuilder private func content(_ s: Sample) -> some View {
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

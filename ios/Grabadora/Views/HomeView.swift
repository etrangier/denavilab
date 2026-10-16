import SwiftUI

/// Pantalla de inicio: nombre, descripción, acceso directo a grabar y atajos.
struct HomeView: View {
    @EnvironmentObject var lib: LibraryStore
    @EnvironmentObject var state: AppState
    @EnvironmentObject var met: Metronome
    @State private var showManual = false

    private var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0" }

    var body: some View {
        Screen {
            VStack(spacing: 18) {
                header
                Button("Grabar un sonido") { state.tab = .grabar }.buttonStyle(AmberButton())
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    shortcut("Biblioteca", detail: "\(lib.samples.count) \(lib.samples.count == 1 ? "grabación" : "grabaciones")", icon: "square.stack.fill") { state.tab = .biblioteca }
                    shortcut("Editar", detail: lib.samples.first?.name ?? "Sin grabaciones", icon: "scissors") {
                        if let s = lib.samples.first { state.open(s) } else { state.tab = .biblioteca }
                    }
                    shortcut("Exportar", detail: "Formato K.O. II", icon: "square.and.arrow.up") { state.tab = .exportar }
                    shortcut("Manual", detail: "Glosario técnico", icon: "book.fill") { showManual = true }
                }
                if !lib.samples.isEmpty { recents }
                Text("Beta \(version) · Desarrollado por: Rolando Chaparro Gehren")
                    .font(Theme.font(11)).foregroundColor(Theme.muted).multilineTextAlignment(.center).padding(.top, 6)
            }
        }
        .sheet(isPresented: $showManual) { ManualView().presentationDetents([.large]) }
    }

    private var header: some View {
        VStack(spacing: 6) {
            LogoView(size: 64)
                .frame(width: 112, height: 112)
                .overlay(RoundedRectangle(cornerRadius: 28).stroke(Theme.amber, lineWidth: 3))
                .padding(.top, 8)
            Text("DenaviLab: Sounds").font(Theme.font(30, weight: .bold)).foregroundColor(Theme.text).padding(.top, 10)
                .multilineTextAlignment(.center)
            Text("capturador de sonidos para sampling").font(Theme.font(13)).foregroundColor(Theme.muted)
        }.frame(maxWidth: .infinity)
    }

    private func shortcut(_ title: String, detail: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: icon).font(.system(size: 20)).foregroundColor(Theme.amber)
                Text(title).font(Theme.font(16, weight: .bold)).foregroundColor(Theme.text)
                Text(detail).font(Theme.font(12)).foregroundColor(Theme.muted).lineLimit(1)
            }.card()
        }.buttonStyle(.plain)
    }

    private var recents: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Recientes").frame(maxWidth: .infinity, alignment: .leading)
            ForEach(lib.samples.prefix(3)) { s in
                Button { state.open(s) } label: { SampleRow(sample: s) }.buttonStyle(.plain)
            }
        }
    }
}

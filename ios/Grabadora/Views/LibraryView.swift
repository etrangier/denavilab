import SwiftUI

struct LibraryView: View {
    @EnvironmentObject var lib: LibraryStore
    @State private var sharing: [URL] = []
    @State private var showShare = false

    var body: some View {
        Screen(title: "Biblioteca") {
            if lib.samples.isEmpty {
                VStack(spacing: 8) {
                    Text("Aún no hay samples").font(Theme.font(18, weight: .bold)).foregroundColor(Theme.text)
                    Text("Graba algo en la pestaña Grabar.").font(Theme.font(15)).foregroundColor(Theme.muted)
                }
            } else {
                List {
                    ForEach(lib.folders, id: \.self) { f in
                        Section(f) {
                            ForEach(lib.filtered.filter { $0.folder == f }) { s in
                                NavigationLink(value: s) {
                                    VStack(alignment: .leading) {
                                        Text(s.name).font(Theme.font(16)).foregroundColor(Theme.text)
                                        Text(String(format: "%.1f s", s.duration) + (s.tags.isEmpty ? "" : " · " + s.tags.joined(separator: ", ")))
                                            .font(Theme.font(13)).foregroundColor(Theme.muted)
                                    }
                                }.listRowBackground(Theme.surface)
                            }.onDelete { idx in
                                let items = lib.filtered.filter { $0.folder == f }
                                idx.map { items[$0] }.forEach(lib.delete)
                            }
                        }
                    }
                }.scrollContentBackground(.hidden)
                .searchable(text: $lib.query, prompt: "Buscar por nombre o etiqueta")
                .toolbar { Button("Exportar kit") { exportKit() } }
                .navigationDestination(for: Sample.self) { EditorView(sample: $0) }
            }
        }
        .sheet(isPresented: $showShare) { ShareSheet(items: sharing) }
        .alert("Error", isPresented: Binding(get: { lib.errorMessage != nil }, set: { _ in lib.errorMessage = nil })) {
            Button("OK", role: .cancel) {}
        } message: { Text(lib.errorMessage ?? "") }
    }

    private func exportKit() {
        let withSlot = lib.samples.filter { $0.slot != nil }
        let list = withSlot.isEmpty ? lib.samples : withSlot
        Task {
            do {
                sharing = try await Exporter.exportKit(list) { lib.audio(for: $0) }
                showShare = true
            } catch { lib.errorMessage = "No se pudo exportar: \(error.localizedDescription)" }
        }
    }
}

extension Sample: Hashable { func hash(into h: inout Hasher) { h.combine(id) } }

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { .init(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

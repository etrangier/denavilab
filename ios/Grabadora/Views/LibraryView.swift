import SwiftUI

struct LibraryView: View {
    @EnvironmentObject var lib: LibraryStore
    @EnvironmentObject var state: AppState
    @State private var toDelete: Sample?

    private var searching: Bool { !lib.query.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        NavigationStack {
            Screen {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenTitle(title: "Biblioteca", trailing: AnyView(
                        Text("\(lib.samples.count) \(lib.samples.count == 1 ? "grabación" : "grabaciones")")
                            .font(Theme.font(13)).foregroundColor(Theme.muted)))
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").foregroundColor(Theme.muted)
                        TextField("Buscar sonido…", text: $lib.query).font(Theme.font(15)).foregroundColor(Theme.text)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    }.card()
                    if lib.samples.isEmpty { empty }
                    else if searching { results }
                    else { folders; recents }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { FolderView(folder: $0) }
        }
        .confirmationDialog("¿Borrar esta grabación?", isPresented: Binding(get: { toDelete != nil }, set: { if !$0 { toDelete = nil } }), titleVisibility: .visible) {
            Button("Borrar", role: .destructive) { if let s = toDelete { lib.delete(s) }; toDelete = nil }
        }
        .alert("Error", isPresented: Binding(get: { lib.errorMessage != nil }, set: { _ in lib.errorMessage = nil })) {
            Button("OK", role: .cancel) {}
        } message: { Text(lib.errorMessage ?? "") }
    }

    private var empty: some View {
        VStack(spacing: 12) {
            LogoView(size: 56).opacity(0.35).padding(.top, 24)
            Text("Aún no hay samples").font(Theme.font(20, weight: .bold)).foregroundColor(Theme.text)
            Text("Graba tu primer sample y aparecerá aquí, ordenado por carpeta.")
                .font(Theme.font(14)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
            Button("Grabar") { state.tab = .grabar }.buttonStyle(AmberButton(full: false))
            SectionLabel("Carpetas").frame(maxWidth: .infinity, alignment: .leading).padding(.top, 24)
            FlowChips(items: LibraryStore.folderInfo.map(\.name))
        }.frame(maxWidth: .infinity)
    }

    private var folders: some View {
        VStack(spacing: 10) {
            ForEach(LibraryStore.folderInfo, id: \.name) { f in
                let n = lib.samples(in: f.name).count
                NavigationLink(value: f.name) {
                    HStack(spacing: 14) {
                        Circle().fill(Theme.amber).frame(width: 10, height: 10)
                            .frame(width: 36, height: 36).background(Theme.surface2).clipShape(RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(f.name).font(Theme.font(16, weight: .bold)).foregroundColor(f.name == LibraryStore.unsorted && n > 0 ? Theme.amber : Theme.text)
                            Text(f.detail).font(Theme.font(12)).foregroundColor(Theme.muted).lineLimit(1)
                        }
                        Spacer()
                        Text("\(n)").font(Theme.font(17, weight: .bold)).foregroundColor(Theme.amber)
                    }.card(highlight: f.name == LibraryStore.unsorted && n > 0)
                }.buttonStyle(.plain)
            }
        }
    }

    private var recents: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Recientes").padding(.top, 8)
            ForEach(lib.samples.prefix(5)) { s in row(s) }
        }
    }

    private var results: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Resultados")
            if lib.filtered.isEmpty { Text("Nada coincide con la búsqueda.").font(Theme.font(14)).foregroundColor(Theme.muted) }
            ForEach(lib.filtered) { s in row(s) }
        }
    }

    private func row(_ s: Sample) -> some View {
        Button { state.open(s) } label: { SampleRow(sample: s) }
            .buttonStyle(.plain)
            .contextMenu { Button(role: .destructive) { toDelete = s } label: { Label("Borrar", systemImage: "trash") } }
    }
}

struct SampleRow: View {
    let sample: Sample
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(sample.name).font(Theme.font(15, weight: .bold)).foregroundColor(Theme.text).lineLimit(1)
                Text(([sample.folder, sample.subfolder].compactMap { $0 }.joined(separator: " › ")) + " · \(stamp(sample.duration))" + (sample.tags.isEmpty ? "" : " · " + sample.tags.joined(separator: ", ")))
                    .font(Theme.font(12)).foregroundColor(Theme.muted).lineLimit(1)
            }
            Spacer()
            Text(sample.slot.map { "slot \($0)" } ?? "sin enviar").font(Theme.font(12, weight: .medium))
                .foregroundColor(sample.slot == nil ? Theme.muted : Theme.amber)
        }.card()
    }
}

/// Etiquetas que saltan de línea.
struct FlowChips: View {
    let items: [String]
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
            ForEach(items, id: \.self) { s in
                Text(s).font(Theme.font(13)).foregroundColor(Theme.text).padding(.horizontal, 12).frame(minHeight: 36)
                    .overlay(Capsule().stroke(Theme.line, lineWidth: 1.5))
            }
        }
    }
}

/// Lista de una carpeta, con borrado deslizando o con pulsación larga.
struct FolderView: View {
    let folder: String
    @EnvironmentObject var lib: LibraryStore
    @EnvironmentObject var state: AppState
    @State private var toDelete: Sample?

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            let items = lib.samples(in: folder)
            if items.isEmpty {
                Text("Esta carpeta está vacía").font(Theme.font(15)).foregroundColor(Theme.muted)
            } else {
                List {
                    ForEach(items) { s in
                        Button { state.open(s) } label: { SampleRow(sample: s) }
                            .buttonStyle(.plain)
                            .listRowBackground(Color.clear).listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) { toDelete = s } label: { Label("Borrar", systemImage: "trash") }
                            }
                            .contextMenu { Button(role: .destructive) { toDelete = s } label: { Label("Borrar", systemImage: "trash") } }
                    }
                }.listStyle(.plain).scrollContentBackground(.hidden)
            }
        }
        .navigationTitle(folder).navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("¿Borrar esta grabación?", isPresented: Binding(get: { toDelete != nil }, set: { if !$0 { toDelete = nil } }), titleVisibility: .visible) {
            Button("Borrar", role: .destructive) { if let s = toDelete { lib.delete(s) }; toDelete = nil }
        }
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { .init(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

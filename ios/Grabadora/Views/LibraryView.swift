import SwiftUI
import UniformTypeIdentifiers

struct LibraryView: View {
    @EnvironmentObject var lib: LibraryStore
    @EnvironmentObject var state: AppState
    @State private var toDelete: Sample?
    @State private var showImporter = false
    @State private var pickBackup = false
    @State private var importNote: String?
    @State private var shareItems: [Any] = []
    @State private var showShare = false
    @State private var details: Sample?
    @State private var showKo = false

    private var searching: Bool { !lib.query.trimmingCharacters(in: .whitespaces).isEmpty || lib.filterActive }

    var body: some View {
        NavigationStack {
            Screen {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenTitle(title: "Biblioteca", trailing: AnyView(
                        HStack(spacing: 12) {
                            Text("\(lib.samples.count) \(lib.samples.count == 1 ? "grabación" : "grabaciones")")
                                .font(Theme.font(13)).foregroundColor(Theme.muted)
                            if !lib.samples.isEmpty {
                                NavigationLink(value: FolderView.selectKey) {
                                    Text("Seleccionar").font(Theme.font(14, weight: .bold)).foregroundColor(Theme.amber).frame(minHeight: 44)
                                }
                            }
                        }))
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").foregroundColor(Theme.muted)
                        TextField("Buscar sonido…", text: $lib.query).font(Theme.font(15)).foregroundColor(Theme.text)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    }.card()
                    if !lib.samples.isEmpty { ViewBar() }
                    if lib.samples.isEmpty { empty }
                    else if searching { results }
                    else { folders; recents }
                    importSection
                    backupSection
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { FolderView(folder: $0) }
        }
        .confirmationDialog("¿Borrar esta grabación?", isPresented: Binding(get: { toDelete != nil }, set: { if !$0 { toDelete = nil } }), titleVisibility: .visible) {
            Button("Borrar", role: .destructive) { if let s = toDelete { lib.delete(s) }; toDelete = nil }
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: pickBackup ? [.zip] : [.audio], allowsMultipleSelection: !pickBackup) { result in
            guard case .success(let urls) = result else { return }
            if pickBackup { restoreBackup(urls.first) } else { importFiles(urls) }
        }
        .sheet(isPresented: $showShare) { ShareSheet(items: shareItems) }
        .sheet(isPresented: $showKo) { KoExportSheet(selection: []).presentationDetents([.large]) }
        .sheet(item: $details) { s in DetailsSheet(sample: s) { lib.update($0) }.presentationDetents([.large]) }
        .alert("Error", isPresented: Binding(get: { lib.errorMessage != nil }, set: { _ in lib.errorMessage = nil })) {
            Button("OK", role: .cancel) {}
        } message: { Text(lib.errorMessage ?? "") }
    }

    /// Importar sonidos desde Archivos: entran a Sin clasificar, en mono y a su frecuencia original.
    private var importSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button("Importar sonidos") { pickBackup = false; showImporter = true }.buttonStyle(OutlineButton()).font(Theme.font(13))
            Text("Trae WAV (también MP3, M4A…) desde Archivos o Drive. Entran a Sin clasificar, a su frecuencia original y en mono.")
                .font(Theme.font(12)).foregroundColor(Theme.muted)
            if let n = importNote { Text(n).font(Theme.font(13)).foregroundColor(Theme.amber) }
        }.padding(.top, 8)
    }

    /// Respaldo de toda la colección en un .zip y restauración desde uno.
    private var backupSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            StoragePanel()
            HStack(spacing: 8) {
                Button("Respaldo") { makeBackup() }.buttonStyle(OutlineButton()).accessibilityLabel("Respaldo: guardar toda la colección en un .zip")
                Button("Restaurar") { pickBackup = true; showImporter = true }.buttonStyle(OutlineButton())
            }.font(Theme.font(13))
            Button("Exportar para el K.O. II") { showKo = true }.buttonStyle(OutlineButton(selected: true)).font(Theme.font(13))
                .accessibilityLabel("Exportar para el K.O. II: favoritos, selección o todo")
        }.padding(.top, 8)
    }

    private func makeBackup() {
        do { let u = try Backup.make(lib); shareItems = [u]; showShare = true }
        catch { lib.errorMessage = "No se pudo hacer el respaldo: \(error.localizedDescription)" }
    }

    private func restoreBackup(_ url: URL?) {
        guard let u = url else { return }
        let access = u.startAccessingSecurityScopedResource()
        defer { if access { u.stopAccessingSecurityScopedResource() } }
        do {
            let r = try Backup.restore(from: u, into: lib)
            importNote = (r.added > 0 ? "Restauradas \(r.added) grabaciones" : "No había nada nuevo que restaurar")
                + (r.skipped > 0 ? " · \(r.skipped) ya estaban" : "") + (r.bad > 0 ? " · \(r.bad) con el audio dañado, omitidas" : "")
        } catch { lib.errorMessage = "No se pudo restaurar: \(error.localizedDescription)" }
    }

    private func importFiles(_ urls: [URL]) {
        importNote = urls.count == 1 ? "Importando…" : "Importando \(urls.count) archivos…"
        Task {
            var ok = 0
            var bad: [String] = []
            for u in urls {
                let access = u.startAccessingSecurityScopedResource()
                defer { if access { u.stopAccessingSecurityScopedResource() } }
                do {
                    let item = try await Task.detached { try AudioImport.read(u) }.value
                    if lib.add(name: item.name, audio: item.samples, sampleRate: item.rate) != nil { ok += 1 }
                } catch { bad.append(u.lastPathComponent) }
            }
            var msg = (ok == 1 ? "1 sonido importado" : "\(ok) sonidos importados") + " en Sin clasificar"
            if !bad.isEmpty { msg += " · no se pudo leer: " + bad.prefix(3).joined(separator: ", ") + (bad.count > 3 ? "…" : "") + " (sólo hasta 5 min)" }
            importNote = msg
        }
    }

    private var empty: some View {
        VStack(spacing: 12) {
            LogoView(size: 56).opacity(0.35).padding(.top, 24)
            Text("Aún no hay samples").font(Theme.font(20, weight: .bold)).foregroundColor(Theme.text)
            Text("Graba tu primer sample y aparecerá aquí, ordenado por carpeta.")
                .font(Theme.font(14)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
            Button("Grabar") { state.tab = .grabar }.buttonStyle(AmberButton(full: false))
            Button("Importar sonidos") { pickBackup = false; showImporter = true }.buttonStyle(OutlineButton()).font(Theme.font(13))
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
            SectionLabel(lib.filterActive && lib.query.trimmingCharacters(in: .whitespaces).isEmpty ? "Con filtros" : "Resultados")
            if lib.filtered.isEmpty { Text(lib.filterActive ? "Ningún sonido cumple los filtros. Prueba quitar alguno." : "Nada coincide con la búsqueda.").font(Theme.font(14)).foregroundColor(Theme.muted) }
            ForEach(lib.filtered) { s in row(s) }
        }
    }

    private func row(_ s: Sample) -> some View {
        HStack(spacing: 8) {
            Button { Auditioner.shared.stop(); state.open(s) } label: { SampleRow(sample: s) }.buttonStyle(.plain)
            StarButton(sample: s)
            ListenButton(sample: s)
        }
            .contextMenu {
                Button { details = s } label: { Label("Detalles", systemImage: "info.circle") }
                Button(role: .destructive) { toDelete = s } label: { Label("Borrar", systemImage: "trash") }
            }
    }
}

struct SampleRow: View {
    let sample: Sample

    /// Carpeta › subcarpeta · duración · estado · etiquetas (armado por partes para que el compilador no se pierda).
    private var subtitle: String {
        var parts: [String] = []
        parts.append([sample.folder, sample.subfolder].compactMap { $0 }.joined(separator: " › "))
        parts.append(stamp(sample.duration))
        if sample.status != SampleStatus.crudo { parts.append(SampleStatus.title(sample.status)) }
        if !sample.tags.isEmpty { parts.append(sample.tags.joined(separator: ", ")) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(sample.name).font(Theme.font(15, weight: .bold)).foregroundColor(Theme.text).lineLimit(1)
                Text(subtitle)
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

/// Lista de una carpeta (o de todas las grabaciones) con selección individual y múltiple:
/// cambiar nombre, mover de carpeta o eliminar.
struct FolderView: View {
    static let allKey = "__todas__"
    static let selectKey = "__seleccionar__"
    let folder: String
    @EnvironmentObject var lib: LibraryStore
    @EnvironmentObject var state: AppState
    @State private var selecting = false
    @State private var selected: Set<UUID> = []
    @State private var started = false
    @State private var newName = ""
    @State private var showRename = false
    @State private var showMove = false
    @State private var confirmDelete = false
    @State private var details: Sample?
    @State private var showKo = false

    private var isAll: Bool { folder == Self.allKey || folder == Self.selectKey }
    private var items: [Sample] { isAll ? lib.filtered : lib.samples(in: folder) }
    private var title: String { isAll ? "Todas las grabaciones" : folder }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                ViewBar().padding(.horizontal, 16).padding(.vertical, 6)
                if items.isEmpty {
                    Spacer()
                    Text(lib.filterActive ? "Ningún sonido de aquí cumple los filtros" : "Esta carpeta está vacía").font(Theme.font(15)).foregroundColor(Theme.muted)
                    Spacer()
                } else {
                    List {
                        ForEach(items) { s in row(s) }
                    }.listStyle(.plain).scrollContentBackground(.hidden)
                }
            }
        }
        .navigationTitle(selecting ? "\(selected.count) seleccionada\(selected.count == 1 ? "" : "s")" : title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(selecting ? "Cancelar" : "Seleccionar") { selecting.toggle(); selected = [] }
                    .disabled(items.isEmpty && !selecting)
            }
            if selecting {
                ToolbarItem(placement: .topBarLeading) {
                    Button(selected.count == items.count ? "Ninguna" : "Todas") {
                        selected = selected.count == items.count ? [] : Set(items.map(\.id))
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) { if selecting { actionBar } }
        .sheet(item: $details) { s in DetailsSheet(sample: s) { lib.update($0) }.presentationDetents([.large]) }
        .sheet(isPresented: $showKo) { KoExportSheet(selection: lib.samples.filter { selected.contains($0.id) }).presentationDetents([.large]) }
        .sheet(isPresented: $showKo) { KoExportSheet(selection: lib.samples.filter { selected.contains($0.id) }).presentationDetents([.large]) }
        .onAppear { if folder == Self.selectKey && !started { started = true; selecting = true } }
        .onDisappear { Auditioner.shared.stop() }
        .alert(selected.count > 1 ? "Cambiar nombre de \(selected.count) grabaciones" : "Cambiar nombre", isPresented: $showRename) {
            TextField("Nombre", text: $newName)
            Button("Guardar") { lib.rename(ids: selected, to: newName); finish() }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text(selected.count > 1
                 ? "Se numeran: " + LibraryStore.names(base: newName.isEmpty ? "nombre" : newName, count: min(selected.count, 3)).joined(separator: ", ") + (selected.count > 3 ? "…" : "")
                 : "")
        }
        .sheet(isPresented: $showMove) {
            MoveSheet(count: selected.count, initialFolder: commonFolder) { f, s in
                lib.move(ids: selected, folder: f, sub: s); finish()
            }.presentationDetents([.large])
        }
        .confirmationDialog(selected.count > 1 ? "¿Borrar \(selected.count) grabaciones?" : "¿Borrar esta grabación?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Borrar", role: .destructive) { lib.delete(ids: selected); finish() }
        }
    }

    private func row(_ s: Sample) -> some View {
        HStack(spacing: 8) {
            Button {
                if selecting { toggle(s.id) } else { Auditioner.shared.stop(); state.open(s) }
            } label: {
                HStack(spacing: 12) {
                    if selecting {
                        Image(systemName: selected.contains(s.id) ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 24)).foregroundColor(selected.contains(s.id) ? Theme.amber : Theme.muted)
                            .accessibilityLabel(selected.contains(s.id) ? "Seleccionada" : "No seleccionada")
                    }
                    SampleRow(sample: s)
                }
            }
            .buttonStyle(.plain)
            StarButton(sample: s)
            if !selecting { ListenButton(sample: s) }
        }
        .listRowBackground(Color.clear).listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if !selecting {
                Button(role: .destructive) { selected = [s.id]; confirmDelete = true } label: { Label("Borrar", systemImage: "trash") }
            }
        }
        .contextMenu {
            Button { details = s } label: { Label("Detalles", systemImage: "info.circle") }
            Button { selecting = true; selected = [s.id] } label: { Label("Seleccionar", systemImage: "checkmark.circle") }
            Button { selecting = true; selected = [s.id]; prepareRename() } label: { Label("Cambiar nombre", systemImage: "pencil") }
            Button { selecting = true; selected = [s.id]; showMove = true } label: { Label("Mover", systemImage: "folder") }
            Button(role: .destructive) { selected = [s.id]; confirmDelete = true } label: { Label("Borrar", systemImage: "trash") }
        }
    }

    private var actionBar: some View {
        VStack(spacing: 8) {
            Text(selected.isEmpty ? "Elige una o varias grabaciones" : "\(selected.count) seleccionada\(selected.count == 1 ? "" : "s")")
                .font(Theme.font(12)).foregroundColor(Theme.muted)
            HStack(spacing: 8) {
                Button("Cambiar nombre") { prepareRename() }.buttonStyle(OutlineButton())
                Button("Mover") { showMove = true }.buttonStyle(OutlineButton())
                Button("Borrar") { confirmDelete = true }.buttonStyle(OutlineButton(danger: true))
            }.font(Theme.font(13)).disabled(selected.isEmpty)
            Button("Exportar selección al K.O. II") { showKo = true }.buttonStyle(OutlineButton()).font(Theme.font(13)).disabled(selected.isEmpty)
        }
        .padding(12).frame(maxWidth: .infinity).background(Theme.surface)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func toggle(_ id: UUID) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
    }

    private func prepareRename() {
        newName = selected.count == 1 ? (lib.samples.first { selected.contains($0.id) }?.name ?? "") : ""
        showRename = true
    }

    /// Si todas las elegidas están en la misma carpeta, se propone esa.
    private var commonFolder: String? {
        let folders = Set(lib.samples.filter { selected.contains($0.id) }.map { lib.folder(of: $0) })
        return folders.count == 1 ? folders.first : nil
    }

    private func finish() { selected = []; selecting = false }
}

/// Elegir carpeta y subcarpeta de destino.
struct MoveSheet: View {
    let count: Int
    let initialFolder: String?
    let onMove: (String, String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var folder: String
    @State private var sub: String?

    init(count: Int, initialFolder: String?, onMove: @escaping (String, String?) -> Void) {
        self.count = count; self.initialFolder = initialFolder; self.onMove = onMove
        _folder = State(initialValue: initialFolder ?? LibraryStore.unsorted)
    }

    private var destination: String { sub.map { "\(folder) › \($0)" } ?? folder }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenTitle(title: "Mover", subtitle: "\(count) grabación\(count == 1 ? "" : "es")",
                                trailing: AnyView(TextLink(title: "Cancelar") { dismiss() }))
                    FolderPicker(folder: $folder, sub: $sub)
                    Button("Mover a \(destination)") { onMove(folder, sub); dismiss() }.buttonStyle(AmberButton()).padding(.top, 6)
                }.padding(16)
            }
        }
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { .init(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

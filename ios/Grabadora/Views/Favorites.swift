import SwiftUI

/// Estrella de favorito: visible en cada sonido y accesible con VoiceOver.
struct StarButton: View {
    let sample: Sample
    @EnvironmentObject var lib: LibraryStore
    var body: some View {
        Button { lib.toggleFavorite(sample) } label: {
            Image(systemName: sample.favorite ? "star.fill" : "star").font(.system(size: 18, weight: .bold))
                .foregroundColor(sample.favorite ? Theme.amber : Theme.muted)
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel((sample.favorite ? "Quitar de favoritos: " : "Marcar como favorito: ") + sample.name)
        .accessibilityAddTraits(sample.favorite ? .isSelected : [])
    }
}

/// Barra de vista de la Biblioteca: solo favoritos, orden y filtros.
struct ViewBar: View {
    @EnvironmentObject var lib: LibraryStore
    @State private var showFilters = false
    var body: some View {
        HStack(spacing: 8) {
            Chip(title: "★ Solo favoritos", selected: lib.onlyFavorites) { lib.onlyFavorites.toggle() }
                .accessibilityAddTraits(lib.onlyFavorites ? .isSelected : [])
            Menu {
                Picker("Ordenar por", selection: $lib.sort) {
                    ForEach(SampleSort.allCases, id: \.self) { Text($0.title).tag($0) }
                }
            } label: {
                Text("Orden").font(Theme.font(14)).foregroundColor(Theme.text).padding(.horizontal, 14).frame(minHeight: 40)
                    .overlay(Capsule().stroke(Theme.line, lineWidth: 1.5))
            }.accessibilityLabel("Ordenar por: " + lib.sort.title)
            Chip(title: lib.filterActive && (!lib.statusFilter.isEmpty || !lib.tagFilter.isEmpty || !lib.originFilter.isEmpty) ? "Filtros (activos)" : "Filtros",
                 selected: !lib.statusFilter.isEmpty || !lib.tagFilter.isEmpty || !lib.originFilter.isEmpty) { showFilters = true }
            Spacer(minLength: 0)
        }
        .sheet(isPresented: $showFilters) { FilterSheet().presentationDetents([.large]) }
    }
}

struct FilterSheet: View {
    @EnvironmentObject var lib: LibraryStore
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenTitle(title: "Filtros", trailing: AnyView(TextLink(title: "Listo") { dismiss() }))
                    SectionLabel("Estado")
                    HStack(spacing: 8) {
                        Chip(title: "Todos", selected: lib.statusFilter.isEmpty) { lib.statusFilter = "" }
                        ForEach(SampleStatus.all, id: \.key) { st in
                            Chip(title: st.title, selected: lib.statusFilter == st.key) { lib.statusFilter = lib.statusFilter == st.key ? "" : st.key }
                        }
                    }
                    SectionLabel("Etiquetas de carácter (deben estar todas)")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                        ForEach(Array(Set(CharTags.list).union(lib.tagFilter)).sorted(), id: \.self) { t in
                            Chip(title: t, selected: lib.tagFilter.contains(t)) { if lib.tagFilter.contains(t) { lib.tagFilter.remove(t) } else { lib.tagFilter.insert(t) } }
                        }
                    }
                    SectionLabel("Origen contiene")
                    TextField("Artista, disco, «balcón»…", text: $lib.originFilter).font(Theme.font(15)).foregroundColor(Theme.text)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().card()
                    Button("Quitar filtros") { lib.clearFilters() }.buttonStyle(OutlineButton()).disabled(!lib.filterActive)
                }.padding(16)
            }
        }
    }
}

/// Detalles de un sonido: estado, carácter, origen, tonalidad, BPM y comentario.
struct DetailsSheet: View {
    let sample: Sample
    let onSave: (Sample) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var s: Sample
    @State private var tagList = CharTags.list
    @State private var newTag = ""
    @State private var editList = false
    @State private var bpmText: String

    init(sample: Sample, onSave: @escaping (Sample) -> Void) {
        self.sample = sample; self.onSave = onSave
        _s = State(initialValue: sample)
        _bpmText = State(initialValue: sample.bpm.map { String(Int($0.rounded())) } ?? "")
    }

    private func addTag() {
        let t = newTag.trimmingCharacters(in: .whitespaces).lowercased()
        guard !t.isEmpty else { return }
        if !tagList.contains(t) { tagList.append(t); CharTags.list = tagList }
        if !s.tags.contains(t) { s.tags.append(t) }
        newTag = ""
    }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenTitle(title: "Detalles", subtitle: "\(s.name) · \(stamp(s.duration))", trailing: AnyView(TextLink(title: "Cancelar") { dismiss() }))
                    SectionLabel("Estado")
                    HStack(spacing: 8) {
                        ForEach(SampleStatus.all, id: \.key) { st in
                            Button(st.title) { s.status = st.key }.buttonStyle(OutlineButton(selected: s.status == st.key)).font(Theme.font(13))
                        }
                    }
                    SectionLabel("Carácter (se pueden combinar)")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                        ForEach(Array(Set(tagList).union(s.tags)).sorted(), id: \.self) { t in
                            if editList {
                                Chip(title: t + " ✕", selected: false) { tagList.removeAll { $0 == t }; CharTags.list = tagList; s.tags.removeAll { $0 == t } }
                                    .accessibilityLabel("Quitar de la lista: " + t)
                            } else {
                                Chip(title: t, selected: s.tags.contains(t)) { if s.tags.contains(t) { s.tags.removeAll { $0 == t } } else { s.tags.append(t) } }
                                    .accessibilityAddTraits(s.tags.contains(t) ? .isSelected : [])
                            }
                        }
                    }
                    HStack(spacing: 8) {
                        TextField("Nueva etiqueta…", text: $newTag).font(Theme.font(15)).foregroundColor(Theme.text)
                            .textInputAutocapitalization(.never).autocorrectionDisabled().onSubmit(addTag).card()
                        Button("Añadir") { addTag() }.buttonStyle(OutlineButton()).frame(width: 90)
                        Button(editList ? "Listo" : "Editar lista") { editList.toggle() }.buttonStyle(OutlineButton(selected: editList)).frame(width: 120)
                    }.font(Theme.font(13))
                    SectionLabel("Origen")
                    TextField("Artista, disco, minuto o «mi balcón»", text: $s.origin).font(Theme.font(15)).foregroundColor(Theme.text).card()
                    ToggleRow(title: "Reemplazado por versión propia", subtitle: "Ya no dependo de esta fuente ajena", isOn: $s.replaced)
                    SectionLabel("Nota o tonalidad (opcional)")
                    TextField("Am, C#, F…", text: Binding(get: { s.key ?? "" }, set: { s.key = $0.isEmpty ? nil : String($0.prefix(8)) }))
                        .font(Theme.font(15)).foregroundColor(Theme.text).textInputAutocapitalization(.never).autocorrectionDisabled().card()
                    SectionLabel("BPM (opcional)")
                    TextField("sin BPM", text: $bpmText).keyboardType(.numberPad).font(Theme.font(15)).foregroundColor(Theme.text).card()
                    SectionLabel("Comentario")
                    TextField("Cómo la grabé, para qué sirve…", text: $s.comment, axis: .vertical).lineLimit(2...5)
                        .font(Theme.font(15)).foregroundColor(Theme.text).card()
                    if !s.process.isEmpty {
                        Text("Procesos aplicados: " + s.process.joined(separator: " → ")).font(Theme.font(12)).foregroundColor(Theme.muted)
                    }
                    Button("Guardar detalles") {
                        if let b = Double(bpmText), (30...300).contains(b) { s.bpm = b } else if bpmText.isEmpty { s.bpm = nil }
                        onSave(s); dismiss()
                    }.buttonStyle(AmberButton()).padding(.top, 6)
                }.padding(16)
            }
        }
    }
}

/// Espacio que ocupa la biblioteca y cuánto queda en el dispositivo.
struct StoragePanel: View {
    @EnvironmentObject var lib: LibraryStore
    private func mb(_ n: Int64) -> String {
        let f = ByteCountFormatter(); f.countStyle = .file; return f.string(fromByteCount: n)
    }
    var body: some View {
        let used = lib.usedBytes(), free = LibraryStore.freeBytes()
        VStack(alignment: .leading, spacing: 2) {
            Text("Espacio usado: \(mb(used))" + (free.map { " · libre en el dispositivo: \(mb($0))" } ?? ""))
                .font(Theme.font(13, weight: .medium)).foregroundColor(Theme.text)
            Text("Los sonidos viven en la carpeta de la app y iOS no los borra solo; haz un respaldo de vez en cuando.")
                .font(Theme.font(12)).foregroundColor(Theme.muted)
        }.accessibilityElement(children: .combine)
    }
}

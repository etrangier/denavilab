import SwiftUI

/// Memoria de estilo: qué ha aprendido la app de tus recortes y loops (todo queda en este dispositivo).
struct StyleMemoryPanel: View {
    @EnvironmentObject var lib: LibraryStore
    @State private var model = StyleMemory.load()
    @State private var open = false
    @State private var note: String?
    @State private var confirmForget = false

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Aprende de cómo recortas, armas loops y clasificas tus sonidos para sugerirte recortes y loops. Todo queda en este dispositivo.")
                    .font(Theme.font(12)).foregroundColor(Theme.muted)
                ToggleRow(title: "Aprender de lo que hago", subtitle: "Apágalo y las sugerencias vuelven a valores de fábrica",
                          isOn: Binding(get: { model.on }, set: { StyleMemory.setEnabled($0); model = StyleMemory.load() }))
                ForEach(StyleMemory.summary(model), id: \.self) { Text($0).font(Theme.font(13)).foregroundColor(Theme.text) }
                HStack(spacing: 8) {
                    Button("Aprender de mi biblioteca") { learnLibrary() }.buttonStyle(OutlineButton())
                    Button("Olvidar todo") { confirmForget = true }.buttonStyle(OutlineButton(danger: true))
                }.font(Theme.font(13))
                if let n = note { Text(n).font(Theme.font(13)).foregroundColor(Theme.amber) }
            }.padding(.top, 8)
        } label: {
            Text("Memoria de estilo · " + (model.on ? (model.seen > 0 ? "\(model.seen) ejemplos" : "aún sin ejemplos") : "apagada"))
                .font(Theme.font(14)).foregroundColor(open ? Theme.text : Theme.muted)
        }
        .tint(Theme.muted)
        .onAppear { model = StyleMemory.load() }
        .confirmationDialog("¿Olvidar lo aprendido?", isPresented: $confirmForget, titleVisibility: .visible) {
            Button("Olvidar", role: .destructive) { StyleMemory.forget(); model = StyleMemory.load(); note = "Memoria de estilo borrada" }
        } message: { Text("Las sugerencias vuelven a valores de fábrica. Tus sonidos no se tocan.") }
    }

    private func learnLibrary() {
        var m = StyleMemory.load(), n = 0
        for s in lib.samples.filter({ ($0.kind ?? "libre") != "libre" }).prefix(80) where m.ids[s.id.uuidString] != true {
            if let f = StyleMemory.features(lib.audio(for: s), rate: s.sampleRate) { m = StyleMemory.learnSound(kind: s.kind, f, id: s.id.uuidString, m); n += 1 }
        }
        model = StyleMemory.load()
        note = n > 0 ? "Aprendí de \(n) sonidos con tipo" : "No hay sonidos nuevos con tipo (textura, bajo o batería) para aprender"
    }
}

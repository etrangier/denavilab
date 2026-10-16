import SwiftUI

/// Manual técnico con glosario, en tres páginas.
struct ManualView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var page = 0

    var body: some View {
        let section = ManualContent.all[page]
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenTitle(title: section.title, subtitle: "Manual técnico · \(page + 1) de \(ManualContent.all.count)",
                                trailing: AnyView(TextLink(title: "Cerrar") { dismiss() }))
                    HStack(spacing: 8) {
                        ForEach(ManualContent.all.indices, id: \.self) { i in
                            Chip(title: "\(i + 1)", selected: page == i) { page = i }
                        }
                    }
                    VStack(spacing: 0) {
                        ForEach(section.entries, id: \.term) { e in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(e.term).font(Theme.font(15, weight: .bold)).foregroundColor(Theme.amber)
                                Text(e.text).font(Theme.font(14)).foregroundColor(Theme.text)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 10)
                            Divider().overlay(Theme.line)
                        }
                    }
                    HStack {
                        if page > 0 { Button("← Anterior") { page -= 1 }.buttonStyle(OutlineButton()) }
                        if page < ManualContent.all.count - 1 { Button("Siguiente →") { page += 1 }.buttonStyle(OutlineButton(selected: true)) }
                    }
                }.padding(16)
            }
        }
    }
}

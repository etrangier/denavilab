import SwiftUI

/// Carpeta y subcarpeta (hoja de guardar y editor).
struct FolderPicker: View {
    @Binding var folder: String
    @Binding var sub: String?
    private var subs: [String] { LibraryStore.folderInfo.first { $0.name == folder }?.subs ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Carpeta")
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(LibraryStore.folderInfo, id: \.name) { f in
                    Button(f.name) { folder = f.name; sub = nil }.buttonStyle(OutlineButton(selected: folder == f.name))
                        .font(Theme.font(13))
                }
            }
            if !subs.isEmpty {
                SectionLabel("Subcarpeta").padding(.top, 4)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                    ForEach(subs, id: \.self) { s in Chip(title: s, selected: sub == s) { sub = (sub == s) ? nil : s } }
                }
            }
        }
    }
}

import SwiftUI

/// Navegación compartida: pestaña activa y grabación seleccionada.
@MainActor
final class AppState: ObservableObject {
    enum Tab: Hashable { case grabar, biblioteca, editar, exportar }
    @Published var tab: Tab = .grabar
    @Published var selectedID: UUID?

    func open(_ s: Sample, in tab: Tab = .editar) { selectedID = s.id; self.tab = tab }
}

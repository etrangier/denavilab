import SwiftUI

/// Navegación compartida: pestaña activa y grabación seleccionada.
@MainActor
final class AppState: ObservableObject {
    enum Tab: Hashable { case inicio, grabar, biblioteca, editar, exportar }
    @Published var tab: Tab = .inicio
    @Published var selectedID: UUID?

    func open(_ s: Sample, in tab: Tab = .editar) { selectedID = s.id; self.tab = tab }
}

import SwiftUI

/// Navegación compartida: pestaña activa y grabación seleccionada.
@MainActor
final class AppState: ObservableObject {
    enum Tab: Hashable { case inicio, grabar, biblioteca, editar, exportar }
    @Published var tab: Tab = .inicio
    @Published var selectedID: UUID?
    /// Chop pendiente: el asistente Pistorius guarda el sonido y pide abrir Chop en un modo (0 golpes, -2 notas, 8 partes iguales).
    @Published var pendingChop: (id: UUID, mode: Int)?

    func open(_ s: Sample, in tab: Tab = .editar) { selectedID = s.id; self.tab = tab }
}

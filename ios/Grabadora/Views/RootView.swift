import SwiftUI

struct RootView: View {
    @AppStorage("onboarded") private var onboarded = false
    @EnvironmentObject var state: AppState
    var body: some View {
        if onboarded { tabs } else { WelcomeView() }
    }

    private var tabs: some View {
        TabView(selection: $state.tab) {
            HomeView().tabItem { Label("Inicio", systemImage: "house.fill") }.tag(AppState.Tab.inicio)
            RecordView().tabItem { Label("Grabar", systemImage: "mic.fill") }.tag(AppState.Tab.grabar)
            LibraryView().tabItem { Label("Biblioteca", systemImage: "square.stack.fill") }.tag(AppState.Tab.biblioteca)
            EditView().tabItem { Label("Editar", systemImage: "scissors") }.tag(AppState.Tab.editar)
            ExportView().tabItem { Label("Exportar", systemImage: "square.and.arrow.up") }.tag(AppState.Tab.exportar)
        }
        .tint(Theme.amber)
    }
}

/// Pantalla con fondo del diseño y contenido que se desplaza.
struct Screen<Content: View>: View {
    var scroll = true
    @ViewBuilder var content: Content
    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            if scroll { ScrollView { content.padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24) } }
            else { content.padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 16) }
        }
    }
}

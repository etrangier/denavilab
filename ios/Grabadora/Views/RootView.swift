import SwiftUI

struct RootView: View {
    @AppStorage("onboarded") private var onboarded = false
    var body: some View {
        if onboarded { tabs } else { WelcomeView() }
    }

    private var tabs: some View {
        TabView {
            RecordView().tabItem { Label("Grabar", systemImage: "mic.fill") }
            LibraryView().tabItem { Label("Biblioteca", systemImage: "square.stack.fill") }
            ToolsView().tabItem { Label("Metrónomo", systemImage: "metronome.fill") }
        }
        .tint(Theme.amber)
        .background(Theme.bg.ignoresSafeArea())
    }
}

struct Screen<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        NavigationStack {
            ZStack { Theme.bg.ignoresSafeArea(); content.padding(16) }
                .navigationTitle(title)
        }
    }
}

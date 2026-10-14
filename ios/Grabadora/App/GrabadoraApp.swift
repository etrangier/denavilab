import SwiftUI

@main
struct GrabadoraApp: App {
    @StateObject private var recorder = Recorder()
    @StateObject private var library = LibraryStore()
    @StateObject private var metronome = Metronome()
    @StateObject private var state = AppState()

    init() {
        let a = UITabBarAppearance()
        a.configureWithOpaqueBackground()
        a.backgroundColor = UIColor(Theme.bg)
        a.shadowColor = UIColor(Theme.line)
        for item in [a.stackedLayoutAppearance, a.inlineLayoutAppearance, a.compactInlineLayoutAppearance] {
            item.normal.iconColor = UIColor(Theme.muted); item.normal.titleTextAttributes = [.foregroundColor: UIColor(Theme.muted)]
            item.selected.iconColor = UIColor(Theme.amber); item.selected.titleTextAttributes = [.foregroundColor: UIColor(Theme.amber)]
        }
        UITabBar.appearance().standardAppearance = a
        UITabBar.appearance().scrollEdgeAppearance = a
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(recorder)
                .environmentObject(library)
                .environmentObject(metronome)
                .environmentObject(state)
                .preferredColorScheme(.dark)
        }
    }
}

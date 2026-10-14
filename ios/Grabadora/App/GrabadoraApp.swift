import SwiftUI

@main
struct GrabadoraApp: App {
    @StateObject private var recorder = Recorder()
    @StateObject private var library = LibraryStore()
    @StateObject private var metronome = Metronome()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(recorder)
                .environmentObject(library)
                .environmentObject(metronome)
                .preferredColorScheme(.dark)
        }
    }
}

import AVFoundation
import SwiftUI

/// Escucha rápida desde la Biblioteca: una grabación a la vez, sin abrir la edición.
final class Auditioner: NSObject, ObservableObject, AVAudioPlayerDelegate {
    static let shared = Auditioner()
    @Published private(set) var playingID: UUID?
    private var player: AVAudioPlayer?

    @MainActor func toggle(_ s: Sample, lib: LibraryStore) {
        if playingID == s.id { stop(); return }
        stop()
        let audio = lib.audio(for: s)
        guard !audio.isEmpty else { lib.errorMessage = "Esta grabación no tiene audio"; return }
        do {
            try AudioSessionConfig.activate()
            let url = try Exporter.export(s, audio: audio, targetRate: s.sampleRate)
            let p = try AVAudioPlayer(contentsOf: url)
            p.delegate = self
            p.play()
            player = p; playingID = s.id
        } catch { lib.errorMessage = "No se pudo reproducir: \(error.localizedDescription)" }
    }

    func stop() {
        player?.stop(); player = nil; playingID = nil
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async {
            if self.player === player { self.player = nil; self.playingID = nil }
        }
    }
}

/// Botón redondo ▶ / ■ para cada fila de la Biblioteca.
struct ListenButton: View {
    let sample: Sample
    @EnvironmentObject var lib: LibraryStore
    @ObservedObject private var aud = Auditioner.shared

    var body: some View {
        let on = aud.playingID == sample.id
        Button { aud.toggle(sample, lib: lib) } label: {
            Image(systemName: on ? "stop.fill" : "play.fill").font(.system(size: 15, weight: .bold))
                .foregroundColor(on ? Theme.bg : Theme.amber)
                .frame(width: 44, height: 44)
                .background(on ? Theme.amber : Theme.surface2).clipShape(Circle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel((on ? "Parar " : "Escuchar ") + sample.name)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

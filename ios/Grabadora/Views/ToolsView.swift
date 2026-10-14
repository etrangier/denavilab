import SwiftUI

struct ToolsView: View {
    @EnvironmentObject var met: Metronome
    var body: some View {
        Screen(title: "Metrónomo") {
            VStack(spacing: 24) {
                Text("\(Int(met.bpm)) BPM").font(Theme.font(48, weight: .bold)).foregroundColor(Theme.amber)
                Slider(value: $met.bpm, in: 30...300, step: 1).tint(Theme.amber)
                Button(met.running ? "Parar" : "Iniciar") { met.running ? met.stop() : met.start() }.buttonStyle(AmberButton())
                Button("Tap tempo") { met.tap() }.buttonStyle(AmberButton())
                Spacer()
            }
        }
    }
}

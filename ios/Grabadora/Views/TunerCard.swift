import SwiftUI

/// Tarjeta del afinador de la pantalla Grabar: nota grande, aguja de cents y el modo (cromático, ukelele, guitarra).
struct TunerCard: View {
    @EnvironmentObject var rec: Recorder
    @AppStorage("tunerPreset") private var presetRaw = "cromatico"
    @State private var smoother = Tuner.Smoother()
    @State private var reading: Tuner.Reading?
    private let timer = Timer.publish(every: 0.2, on: .main, in: .common).autoconnect()

    private var preset: Tuner.Preset { Tuner.Preset(rawValue: presetRaw) ?? .cromatico }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Afinador").font(Theme.font(13)).foregroundColor(Theme.muted)
                Spacer()
                ForEach(Tuner.Preset.allCases, id: \.self) { p in
                    Chip(title: p.label, selected: p == preset) { presetRaw = p.rawValue }
                }
            }
            HStack(spacing: 14) {
                let cents = reading?.shownCents ?? 0, ok = abs(cents) <= 5 && reading != nil
                Text(reading?.title ?? "—").font(Theme.font(32, weight: .bold))
                    .foregroundColor(ok ? Theme.amber : Theme.text).frame(minWidth: 70, alignment: .leading)
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.surface2).frame(height: 10)
                        Rectangle().fill(Theme.muted).frame(width: 2, height: 16).offset(x: g.size.width / 2 - 1)
                        if reading != nil {
                            Capsule().fill(Theme.amber).frame(width: 4, height: 18)
                                .offset(x: g.size.width * CGFloat(0.5 + max(-0.5, min(0.5, cents / 100))) - 2)
                        }
                    }.frame(maxHeight: .infinity)
                }.frame(height: 20)
            }
            Text(infoText).font(Theme.font(13)).foregroundColor(Theme.muted)
        }.card()
        .onReceive(timer) { _ in
            let r = rec.state == .idle ? nil : Tuner.detect(rec.lastSamples(rec.sampleRate * 35 / 100), rate: rec.sampleRate, preset: preset)
            reading = smoother.push(r)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Afinador").accessibilityValue(reading.map { "\($0.title), \(Int($0.shownCents.rounded())) cents" } ?? "sin nota")
    }

    private var infoText: String {
        guard let r = reading else { return "Toca una nota" }
        let c = r.shownCents, ok = abs(c) <= 5
        return (ok ? "en tono · " : "") + (c > 0 ? "+" : "") + "\(Int(c.rounded())) cents" + (r.string != nil ? " · escucho \(r.note)" : "") + " · " + String(format: "%.1f Hz", r.f0)
    }
}

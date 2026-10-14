import AVFoundation

/// Pulso programado sobre el reloj de audio (no sobre Timer) para evitar deriva.
@MainActor
final class Metronome: ObservableObject {
    @Published var bpm: Double = 120 { didSet { if running { restart() } } }
    @Published var running = false
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var click: AVAudioPCMBuffer?
    private var tapTimes: [TimeInterval] = []

    func start() {
        guard !running else { return }
        do {
            let fmt = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
            if engine.attachedNodes.contains(player) == false {
                engine.attach(player); engine.connect(player, to: engine.mainMixerNode, format: fmt)
            }
            click = Self.makeClick(format: fmt, bpm: bpm)
            try AVAudioSession.sharedInstance().setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetooth])
            try engine.start()
            player.scheduleBuffer(click!, at: nil, options: .loops)
            player.play()
            running = true
        } catch { running = false }
    }

    func stop() { player.stop(); engine.stop(); running = false }
    private func restart() { stop(); start() }

    /// Un compás de un pulso: click corto + silencio hasta completar el periodo exacto del BPM.
    static func makeClick(format: AVAudioFormat, bpm: Double) -> AVAudioPCMBuffer {
        let n = AVAudioFrameCount(format.sampleRate * 60 / bpm)
        let b = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: n)!
        b.frameLength = n
        let ch = b.floatChannelData![0]
        let len = Int(format.sampleRate * 0.02)
        for i in 0..<Int(n) {
            ch[i] = i < len ? Float(sin(2 * .pi * 1_500 * Double(i) / format.sampleRate)) * (1 - Float(i) / Float(len)) * 0.8 : 0
        }
        return b
    }

    /// Tap tempo: media de los últimos intervalos; reinicia si pasan más de 2 s.
    func tap(at t: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        if let bpm = TapTempo.register(&tapTimes, at: t) { self.bpm = bpm }
    }
}

enum TapTempo {
    static func register(_ taps: inout [TimeInterval], at t: TimeInterval, maxTaps: Int = 6) -> Double? {
        if let last = taps.last, t - last > 2 { taps = [] }
        taps.append(t)
        if taps.count > maxTaps { taps.removeFirst() }
        guard taps.count >= 2 else { return nil }
        let intervals = zip(taps.dropFirst(), taps).map { $0 - $1 }
        let avg = intervals.reduce(0, +) / Double(intervals.count)
        return min(300, max(30, 60 / avg))
    }
}

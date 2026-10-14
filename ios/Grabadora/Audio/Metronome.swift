import AVFoundation

/// Metrónomo sobre el reloj de audio: un compás en bucle con acento en el tiempo 1.
@MainActor
final class Metronome: ObservableObject {
    enum Mode: String { case free, bar }

    @Published var mode: Mode { didSet { save(mode.rawValue, "metMode") } }
    @Published var bpm: Double { didSet { save(bpm, "metBPM"); if running { restart() } } }
    @Published var beatsPerBar: Int { didSet { save(beatsPerBar, "metBeats"); if running { restart() } } }
    @Published var bars: Int { didSet { save(bars, "metBars") } }            // 0 = sin límite
    @Published var countIn: Bool { didSet { save(countIn, "metCountIn") } }
    @Published var headphonesOnly: Bool { didSet { save(headphonesOnly, "metPhones") } }
    @Published var visualFlash: Bool { didSet { save(visualFlash, "metFlash") } }
    @Published private(set) var running = false
    @Published private(set) var beat = 0
    @Published private(set) var flash = false
    @Published private(set) var notice: String?

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var poller: Timer?
    private var lastIndex = -1
    private var silent = false
    private var tapTimes: [TimeInterval] = []

    init() {
        let d = UserDefaults.standard
        func flag(_ k: String, _ def: Bool) -> Bool { d.object(forKey: k) == nil ? def : d.bool(forKey: k) }
        func num(_ k: String, _ def: Int) -> Int { d.object(forKey: k) == nil ? def : d.integer(forKey: k) }
        mode = Mode(rawValue: d.string(forKey: "metMode") ?? "") ?? .free
        bpm = d.object(forKey: "metBPM") == nil ? 120 : d.double(forKey: "metBPM")
        beatsPerBar = num("metBeats", 4)
        bars = num("metBars", 4)
        countIn = flag("metCountIn", true)
        headphonesOnly = flag("metPhones", true)
        visualFlash = flag("metFlash", false)
    }

    private func save(_ v: Any, _ key: String) { UserDefaults.standard.set(v, forKey: key) }

    // MARK: Control

    /// `forRecording`: si «solo en auriculares» está activo y no hay auriculares, el pulso no suena (para que no entre en la toma).
    func start(forRecording: Bool = false) {
        guard !running else { return }
        do {
            let s = AVAudioSession.sharedInstance()
            if s.category != .playAndRecord { try s.setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetooth]) }
            try s.setActive(true)
            let rate = 44_100
            let fmt = AVAudioFormat(standardFormatWithSampleRate: Double(rate), channels: 1)!
            if !engine.attachedNodes.contains(player) {
                engine.attach(player); engine.connect(player, to: engine.mainMixerNode, format: fmt)
            }
            let data = Self.barSamples(bpm: bpm, beats: beatsPerBar, sampleRate: rate)
            guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(data.count)) else { return }
            buf.frameLength = AVAudioFrameCount(data.count)
            data.withUnsafeBufferPointer { buf.floatChannelData![0].update(from: $0.baseAddress!, count: data.count) }
            let audible = !(forRecording && headphonesOnly) || Self.outputIsPrivate()
            silent = !audible
            notice = audible ? nil : "Conecta auriculares para oír el metrónomo sin que entre en la grabación. Verás el pulso en pantalla."
            player.volume = audible ? 1 : 0
            if !engine.isRunning { try engine.start() }
            player.scheduleBuffer(buf, at: nil, options: .loops)
            player.play()
            running = true; lastIndex = -1
            poller = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.poll() }
            }
        } catch {
            running = false
            notice = "No se pudo iniciar el metrónomo"
        }
    }

    func stop() {
        poller?.invalidate(); poller = nil
        player.stop()
        if engine.isRunning { engine.stop() }
        running = false; flash = false
    }

    private func restart() { stop(); start() }

    /// Posición en el compás a partir del reloj del reproductor.
    private func poll() {
        guard running, let nt = player.lastRenderTime, let pt = player.playerTime(forNodeTime: nt), pt.sampleTime >= 0 else { return }
        let beatSamples = pt.sampleRate * 60 / bpm
        let idx = Int(Double(pt.sampleTime) / beatSamples)
        guard idx != lastIndex else { return }
        lastIndex = idx
        beat = idx % max(beatsPerBar, 1)
        if visualFlash || silent {
            flash = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in self?.flash = false }
        }
    }

    /// Tap tempo: media de los últimos intervalos; reinicia si pasan más de 2 s.
    func tap(at t: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        if let v = TapTempo.register(&tapTimes, at: t) { bpm = v.rounded() }
    }

    // MARK: Puro (probado)

    /// Un compás: `beats` clics, el primero más agudo y fuerte (en 6 pulsos, el cuarto con acento medio).
    nonisolated static func barSamples(bpm: Double, beats: Int, sampleRate: Int) -> [Float] {
        let beatLen = Int((Double(sampleRate) * 60 / bpm).rounded())
        var out = [Float](repeating: 0, count: beatLen * max(beats, 1))
        let clickLen = min(beatLen, Int(Double(sampleRate) * 0.02))
        for b in 0..<max(beats, 1) {
            let (freq, amp): (Double, Float) = b == 0 ? (1_800, 0.9) : (beats == 6 && b == 3 ? (1_500, 0.75) : (1_200, 0.6))
            for i in 0..<clickLen {
                out[b * beatLen + i] = Float(sin(2 * .pi * freq * Double(i) / Double(sampleRate))) * (1 - Float(i) / Float(clickLen)) * amp
            }
        }
        return out
    }

    /// Muestras de una toma de `bars` compases; nil si no hay límite.
    nonisolated static func samples(bars: Int, beats: Int, bpm: Double, rate: Int) -> Int? {
        bars > 0 ? Int((Double(bars * beats) * 60 / bpm * Double(rate)).rounded()) : nil
    }

    static func outputIsPrivate() -> Bool {
        let types: Set<AVAudioSession.Port> = [.headphones, .bluetoothA2DP, .bluetoothHFP, .bluetoothLE, .usbAudio, .airPlay, .lineOut]
        return AVAudioSession.sharedInstance().currentRoute.outputs.contains { types.contains($0.portType) }
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

import AVFoundation

/// Grabación con medidor, aviso de clip y captura retroactiva (la app debe estar abierta y escuchando).
@MainActor
final class Recorder: ObservableObject {
    enum State { case idle, listening, recording }
    @Published var state: State = .idle
    @Published var level: Float = 0          // 0...1 (pico reciente)
    @Published var clipped = false
    @Published var micDenied = false
    @Published var errorMessage: String?
    @Published var retroSeconds: Double = 30
    @Published var monitoring = false
    @Published var liveWave: [Float] = []   // últimos picos para dibujar
    @Published var elapsed: Double = 0
    @Published var bufferedSeconds: Double = 0

    private let engine = AVAudioEngine()
    private var ring = RingBuffer(capacity: 48_000 * 30)
    private var take: [Float] = []
    private(set) var sampleRate: Int = 48_000
    private var observers: [NSObjectProtocol] = []

    // MARK: Permisos y sesión
    func requestAccess() async -> Bool {
        let ok = await AVAudioApplication.requestRecordPermission()
        micDenied = !ok
        return ok
    }

    private func configureSession() throws {
        let s = AVAudioSession.sharedInstance()
        try s.setCategory(.playAndRecord, mode: .measurement, options: [.allowBluetooth, .defaultToSpeaker])
        try s.setActive(true)
        observers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
            guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
            Task { @MainActor in self?.interrupted() }
        })
        observers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.routeChanged() }
        })
    }

    // MARK: Control
    func startListening() async {
        guard state == .idle else { return }
        guard await requestAccess() else { return }
        do {
            try configureSession()
            installTap()
            try engine.start()
            state = .listening
        } catch { errorMessage = "No se pudo iniciar el audio: \(error.localizedDescription)" }
    }

    func stopListening() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        state = .idle; level = 0
    }

    func startRecording() { take = []; elapsed = 0; clipped = false; state = .recording }

    /// Termina la toma y la devuelve.
    func stopRecording() -> [Float] {
        state = .listening
        return take
    }

    /// Los últimos `retroSeconds` segundos escuchados, sin haber pulsado grabar.
    func captureRetro() -> [Float] { ring.last(Int(retroSeconds) * sampleRate) }

    /// Últimas `n` muestras del búfer (para dibujar la captura retroactiva).
    func lastSamples(_ n: Int) -> [Float] { ring.last(n) }

    func setMonitoring(_ on: Bool) {
        monitoring = on
        engine.mainMixerNode.outputVolume = on ? 1 : 0
    }

    // MARK: Interno
    private func installTap() {
        let input = engine.inputNode
        let fmt = input.outputFormat(forBus: 0)
        sampleRate = Int(fmt.sampleRate)
        ring = RingBuffer(capacity: sampleRate * 60)
        engine.connect(input, to: engine.mainMixerNode, format: fmt)
        engine.mainMixerNode.outputVolume = monitoring ? 1 : 0
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 2048, format: fmt) { [weak self] buf, _ in
            guard let ch = buf.floatChannelData?[0] else { return }
            let samples = Array(UnsafeBufferPointer(start: ch, count: Int(buf.frameLength)))
            let peak = samples.map(abs).max() ?? 0
            Task { @MainActor in self?.ingest(samples, peak: peak) }
        }
    }

    private func ingest(_ s: [Float], peak: Float) {
        ring.write(s)
        bufferedSeconds = Double(ring.count) / Double(sampleRate)
        liveWave.append(peak)
        if liveWave.count > 48 { liveWave.removeFirst(liveWave.count - 48) }
        if state == .recording { take.append(contentsOf: s); elapsed = Double(take.count) / Double(sampleRate) }
        level = max(peak, level * 0.85)
        if peak >= 0.99 { clipped = true }
    }

    private func interrupted() {
        // Llamada, Siri, etc.: conserva lo grabado y pasa a reposo.
        if state == .recording { _ = stopRecording() }
        stopListening()
        errorMessage = "Grabación interrumpida. Lo capturado hasta ahora se conservó."
    }

    private func routeChanged() {
        guard state != .idle else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        installTap()
        try? engine.start()
    }
}

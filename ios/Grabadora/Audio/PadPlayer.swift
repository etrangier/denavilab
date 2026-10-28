import AVFoundation
import CoreMIDI

/// Toca el pad como un instrumento: hasta 8 voces, cada una con su propia afinación; suena mientras se mantenga la tecla.
@MainActor
final class PadPlayer: ObservableObject {
    private final class Voice {
        let player = AVAudioPlayerNode()
        let speed = AVAudioUnitVarispeed()
        var note: Int?
        var gen = 0
        var started = Date()
    }

    @Published private(set) var held: Set<Int> = []
    @Published var errorMessage: String?
    private let engine = AVAudioEngine()
    private var voices: [Voice] = []
    private var buffer: AVAudioPCMBuffer?
    private var format: AVAudioFormat?

    /// Carga el pad (ya con su tono base). Para lo que suena y deja listas las voces.
    func load(_ audio: [Float], rate: Int) {
        allOff()
        guard !audio.isEmpty, let fmt = AVAudioFormat(standardFormatWithSampleRate: Double(rate), channels: 1),
              let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(audio.count)) else { buffer = nil; return }
        buf.frameLength = AVAudioFrameCount(audio.count)
        audio.withUnsafeBufferPointer { buf.floatChannelData![0].update(from: $0.baseAddress!, count: audio.count) }
        if format?.sampleRate != fmt.sampleRate { rebuild(fmt) }
        buffer = buf
    }

    private func rebuild(_ fmt: AVAudioFormat) {
        engine.stop()
        for v in voices { engine.detach(v.player); engine.detach(v.speed) }
        voices = (0..<8).map { _ in Voice() }
        for v in voices {
            engine.attach(v.player); engine.attach(v.speed)
            engine.connect(v.player, to: v.speed, format: fmt)
            engine.connect(v.speed, to: engine.mainMixerNode, format: fmt)
        }
        format = fmt
        do { try AudioSessionConfig.activate(); try engine.start() }
        catch { errorMessage = "No se pudo iniciar el audio: \(error.localizedDescription)" }
    }

    /// `semis` es la distancia en semitonos al sonido tal cual (0 = el pad sin transponer).
    func noteOn(_ semis: Int) {
        let n = max(-24, min(24, semis))
        guard let buf = buffer, !voices.isEmpty, !held.contains(n) else { return }
        if !engine.isRunning { try? engine.start() }
        let v = voices.first(where: { $0.note == nil }) ?? voices.min(by: { $0.started < $1.started })!
        v.gen += 1; v.player.stop()
        v.speed.rate = Float(pow(2.0, Double(n) / 12))
        v.player.volume = 1
        v.player.scheduleBuffer(buf, at: nil, options: .loops, completionHandler: nil)
        v.player.play()
        if let old = v.note { held.remove(old) }
        v.note = n; v.started = Date(); held.insert(n)
    }

    func noteOff(_ semis: Int) {
        let n = max(-24, min(24, semis))
        guard let v = voices.first(where: { $0.note == n }) else { return }
        v.note = nil; held.remove(n)
        v.gen += 1
        let g = v.gen
        Task { @MainActor in                                    // salida suave de 0,3 s
            for step in 1...6 {
                try? await Task.sleep(nanoseconds: 50_000_000)
                guard v.gen == g else { return }
                v.player.volume = 1 - Float(step) / 6
            }
            if v.gen == g { v.player.stop() }
        }
    }

    func allOff() {
        for v in voices { v.gen += 1; v.player.stop(); v.note = nil }
        held = []
    }
}

/// Entrada MIDI (por ejemplo un Akai MPK mini por USB o Bluetooth).
@MainActor
final class MIDIListener: ObservableObject {
    @Published var status = "MIDI desactivado"
    var onNote: ((Int, Bool) -> Void)?
    private var client = MIDIClientRef()
    private var port = MIDIPortRef()

    func start() {
        guard client == 0 else { connectAll(); return }
        var st = MIDIClientCreateWithBlock("DenaviLab" as CFString, &client) { [weak self] _ in
            Task { @MainActor in self?.connectAll() }
        }
        guard st == noErr else { status = "No se pudo usar MIDI (código \(st))"; return }
        st = MIDIInputPortCreateWithBlock(client, "Entrada" as CFString, &port) { [weak self] list, _ in
            var events: [(Int, Bool)] = []
            for packet in list.unsafeSequence() {
                let len = Int(packet.pointee.length)
                let bytes: [UInt8] = withUnsafeBytes(of: packet.pointee.data) { Array($0.prefix(len)) }
                var i = 0
                while i + 3 <= bytes.count {
                    let kind = bytes[i] & 0xF0
                    if kind == 0x90 || kind == 0x80 { events.append((Int(bytes[i + 1]), kind == 0x90 && bytes[i + 2] > 0)) }
                    i += 3
                }
            }
            guard !events.isEmpty else { return }
            let found = events
            Task { @MainActor in for e in found { self?.onNote?(e.0, e.1) } }
        }
        guard st == noErr else { status = "No se pudo abrir la entrada MIDI (código \(st))"; return }
        connectAll()
    }

    private func connectAll() {
        var names: [String] = []
        for i in 0..<MIDIGetNumberOfSources() {
            let src = MIDIGetSource(i)
            MIDIPortConnectSource(port, src, nil)
            var name: Unmanaged<CFString>?
            MIDIObjectGetStringProperty(src, kMIDIPropertyDisplayName, &name)
            if let n = name?.takeRetainedValue() { names.append(n as String) }
        }
        status = names.isEmpty ? "MIDI activo, pero no veo ningún teclado conectado" : "MIDI: " + names.joined(separator: ", ")
    }
}

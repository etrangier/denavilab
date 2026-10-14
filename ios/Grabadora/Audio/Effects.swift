import AVFoundation

/// Efectos no destructivos: se guarda el original + parámetros y se renderiza al exportar.
struct EffectParams: Codable, Equatable {
    var eqLowGain: Float = 0        // dB, shelf 100 Hz
    var eqHighGain: Float = 0       // dB, shelf 8 kHz
    var lowpassHz: Float = 20_000
    var reverbMix: Float = 0        // 0...100
    var pitchCents: Float = 0       // -1200...1200 (calidad por validar)
    var compress: Bool = false
    var isNeutral: Bool { self == EffectParams() }
}

enum EffectRenderer {
    /// Render offline con audio units del sistema.
    static func render(_ x: [Float], sampleRate: Int, params p: EffectParams) throws -> [Float] {
        if p.isNeutral || x.isEmpty { return x }
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        let eq = AVAudioUnitEQ(numberOfBands: 3)
        let pitch = AVAudioUnitTimePitch()
        let reverb = AVAudioUnitReverb()
        let fmt = AVAudioFormat(standardFormatWithSampleRate: Double(sampleRate), channels: 1)!

        eq.bands[0].filterType = .lowShelf; eq.bands[0].frequency = 100; eq.bands[0].gain = p.eqLowGain; eq.bands[0].bypass = false
        eq.bands[1].filterType = .highShelf; eq.bands[1].frequency = 8_000; eq.bands[1].gain = p.eqHighGain; eq.bands[1].bypass = false
        eq.bands[2].filterType = .lowPass; eq.bands[2].frequency = p.lowpassHz; eq.bands[2].bypass = p.lowpassHz >= 20_000
        pitch.pitch = p.pitchCents
        reverb.loadFactoryPreset(.mediumRoom); reverb.wetDryMix = p.reverbMix

        [player, eq, pitch, reverb].forEach { engine.attach($0) }
        engine.connect(player, to: eq, format: fmt)
        engine.connect(eq, to: pitch, format: fmt)
        engine.connect(pitch, to: reverb, format: fmt)
        engine.connect(reverb, to: engine.mainMixerNode, format: fmt)
        try engine.enableManualRenderingMode(.offline, format: fmt, maximumFrameCount: 4096)
        try engine.start()

        let src = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(x.count))!
        src.frameLength = AVAudioFrameCount(x.count)
        x.withUnsafeBufferPointer { src.floatChannelData![0].update(from: $0.baseAddress!, count: x.count) }
        player.scheduleBuffer(src, completionHandler: nil)
        player.play()

        // Cola para la reverb (0,5 s) si está activa.
        let total = x.count + (p.reverbMix > 0 ? sampleRate / 2 : 0)
        let out = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: 4096)!
        var result = [Float](); result.reserveCapacity(total)
        while result.count < total {
            let n = AVAudioFrameCount(min(4096, total - result.count))
            let status = try engine.renderOffline(n, to: out)
            guard status == .success else { break }
            result.append(contentsOf: UnsafeBufferPointer(start: out.floatChannelData![0], count: Int(out.frameLength)))
        }
        engine.stop()
        return p.compress ? Dynamics.softCompress(result) : result
    }
}

enum Dynamics {
    /// Compresor simple de pico (tanh) con ganancia de compensación.
    static func softCompress(_ x: [Float], drive: Float = 2) -> [Float] {
        let k = tanh(drive)
        return x.map { tanh($0 * drive) / k }
    }
}

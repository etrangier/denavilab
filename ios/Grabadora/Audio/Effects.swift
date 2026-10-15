import AVFoundation

/// Estilos de «grit» (carácter del sonido), pantalla 16 del diseño.
enum GritStyle: String, Codable, CaseIterable {
    case ninguno, vintage, vinilo, radio, tape, analogico, lofi, telefono
    var title: String {
        switch self {
        case .ninguno: return "Ninguno"
        case .vintage: return "Vintage"
        case .vinilo: return "Vinilo"
        case .radio: return "Radio"
        case .tape: return "Tape"
        case .analogico: return "Analógico"
        case .lofi: return "Lo-fi"
        case .telefono: return "Teléfono"
        }
    }
}

/// Efectos no destructivos: se guarda el original + parámetros y se renderiza al exportar.
struct EffectParams: Codable, Equatable {
    var eqLowGain: Float = 0        // dB, shelf 100 Hz
    var eqHighGain: Float = 0       // dB, shelf 8 kHz
    var lowpassHz: Float = 20_000
    var reverbMix: Float = 0        // 0...100
    var pitchCents: Float = 0       // -1200...1200 (calidad por validar)
    var compress = false
    var compressMode = 1            // 0 suave, 1 medio, 2 fuerte
    var grit = GritStyle.ninguno
    var gritAmount: Float = 40      // 0...100

    init() {}

    /// Lee también biblioteca guardada con versiones anteriores (campos nuevos con su valor por defecto).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let d = EffectParams()
        eqLowGain = try c.decodeIfPresent(Float.self, forKey: .eqLowGain) ?? d.eqLowGain
        eqHighGain = try c.decodeIfPresent(Float.self, forKey: .eqHighGain) ?? d.eqHighGain
        lowpassHz = try c.decodeIfPresent(Float.self, forKey: .lowpassHz) ?? d.lowpassHz
        reverbMix = try c.decodeIfPresent(Float.self, forKey: .reverbMix) ?? d.reverbMix
        pitchCents = try c.decodeIfPresent(Float.self, forKey: .pitchCents) ?? d.pitchCents
        compress = try c.decodeIfPresent(Bool.self, forKey: .compress) ?? d.compress
        compressMode = try c.decodeIfPresent(Int.self, forKey: .compressMode) ?? d.compressMode
        grit = try c.decodeIfPresent(GritStyle.self, forKey: .grit) ?? d.grit
        gritAmount = try c.decodeIfPresent(Float.self, forKey: .gritAmount) ?? d.gritAmount
    }

    private enum Keys: String, CodingKey {
        case eqLowGain, eqHighGain, lowpassHz, reverbMix, pitchCents, compress, compressMode, grit, gritAmount
    }

    /// Sin efectos audibles: el estilo «grit» no cuenta si es «ninguno» (la cantidad sola no hace nada).
    var isNeutral: Bool {
        eqLowGain == 0 && eqHighGain == 0 && lowpassHz >= 20_000 && reverbMix == 0 && pitchCents == 0 && !compress && grit == .ninguno
    }
    var needsEngine: Bool { eqLowGain != 0 || eqHighGain != 0 || lowpassHz < 20_000 || reverbMix > 0 || pitchCents != 0 }
}

enum EffectRenderer {
    /// Cadena completa: audio units del sistema (EQ, tono, reverb) y después compresor y carácter.
    static func render(_ x: [Float], sampleRate: Int, params p: EffectParams) throws -> [Float] {
        if p.isNeutral || x.isEmpty { return x }
        let wet = p.needsEngine ? try engineRender(x, sampleRate: sampleRate, params: p) : x
        return postProcess(wet, rate: sampleRate, params: p)
    }

    /// Compresor y carácter. Puro y determinista.
    nonisolated static func postProcess(_ x: [Float], rate: Int, params p: EffectParams) -> [Float] {
        var y = x
        if p.compress { y = Dynamics.compress(y, rate: rate, mode: p.compressMode) }
        if p.grit != .ninguno { y = Grit.apply(y, rate: rate, style: p.grit, amount: Double(p.gritAmount) / 100) }
        return y
    }

    private static func engineRender(_ x: [Float], sampleRate: Int, params p: EffectParams) throws -> [Float] {
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
        return result
    }
}

enum Dynamics {
    /// (umbral dB, relación) de Suave, Medio y Fuerte.
    nonisolated static func settings(_ mode: Int) -> (threshold: Double, ratio: Double) {
        switch mode { case 0: return (-18, 2); case 2: return (-24, 8); default: return (-18, 4) }
    }

    /// Compresor con seguidor de nivel (ataque 10 ms, relajación 120 ms) y media ganancia de compensación.
    nonisolated static func compress(_ x: [Float], rate: Int, mode: Int) -> [Float] {
        let (th, ratio) = settings(mode)
        let atk = exp(-1 / (0.010 * Double(rate))), rel = exp(-1 / (0.120 * Double(rate)))
        let makeup = Float(pow(10, -th * (1 - 1 / ratio) * 0.5 / 20))
        var env: Double = 0
        var y = x
        for i in y.indices {
            let a = Double(abs(x[i]))
            env = a > env ? atk * env + (1 - atk) * a : rel * env + (1 - rel) * a
            let db: Double = 20 * log10(max(env, 1e-6))
            let gainDB: Double = db > th ? (th - db) * (1 - 1 / ratio) : 0
            let gain = Float(pow(10.0, gainDB / 20))
            y[i] = max(-1, min(1, x[i] * gain * makeup))
        }
        return y
    }
}

/// Carácter del sonido con filtros simples, saturación y ruido determinista (misma entrada, misma salida).
enum Grit {
    nonisolated static func apply(_ x: [Float], rate: Int, style: GritStyle, amount: Double) -> [Float] {
        guard style != .ninguno, !x.isEmpty else { return x }
        let t = Float(min(max(amount, 0), 1))
        var rng = SeededRandom(seed: 0x5EED)
        var wet: [Float]
        switch style {
        case .ninguno:
            return x
        case .vintage:
            wet = lowpass(highpass(x, 60, rate), 6_500, rate)
            wet = saturate(wet, drive: 1 + 2 * t)
            wet = addNoise(wet, level: 0.004 * t, rng: &rng)
        case .vinilo:
            wet = lowpass(highpass(x, 40, rate), 9_000, rate)
            wet = addNoise(wet, level: 0.006 * t, rng: &rng)
            wet = addCrackle(wet, density: 0.0004 * Double(t) + 0.00002, level: 0.25 * t, rng: &rng)
        case .radio:
            wet = highpass(x, 400, rate, passes: 2)
            wet = lowpass(wet, 3_500, rate, passes: 2)
            wet = saturate(wet, drive: 1.5 + 3 * t)
        case .tape:
            wet = lowpass(x, 11_000, rate)
            wet = saturate(wet, drive: 1 + 1.5 * t)
            wet = addNoise(wet, level: 0.003 * t, rng: &rng)
        case .analogico:
            var even = x
            for i in even.indices { even[i] = x[i] + 0.3 * t * x[i] * abs(x[i]) }
            wet = lowpass(even, 12_000, rate)
            wet = saturate(wet, drive: 1 + t)
        case .lofi:
            let hold: Int = 1 + Int(5 * t)
            let levels = Float(pow(2.0, 8.0 - 4.0 * Double(t)))
            wet = x
            for i in wet.indices {
                let s: Float = x[i - i % hold]
                wet[i] = (s * levels).rounded() / levels
            }
        case .telefono:
            wet = highpass(x, 300, rate, passes: 2)
            wet = lowpass(wet, 3_000, rate, passes: 2)
            let gain: Float = 2 + 4 * t
            for i in wet.indices { wet[i] = max(-0.6, min(0.6, wet[i] * gain)) }
        }
        let mix: Float = min(1, 0.35 + 0.65 * t)
        var out = x
        for i in out.indices { out[i] = max(-1, min(1, x[i] * (1 - mix) + wet[i] * mix)) }
        return out
    }

    nonisolated static func saturate(_ x: [Float], drive: Float) -> [Float] {
        var y = x
        for i in y.indices { y[i] = tanh(x[i] * drive) }
        return y
    }

    nonisolated static func addNoise(_ x: [Float], level: Float, rng: inout SeededRandom) -> [Float] {
        var y = x
        for i in y.indices { y[i] = x[i] + rng.next() * level }
        return y
    }

    nonisolated static func addCrackle(_ x: [Float], density: Double, level: Float, rng: inout SeededRandom) -> [Float] {
        var y = x
        for i in y.indices where rng.unit() < density {
            let sign: Float = rng.next() > 0 ? 1 : -1
            y[i] += sign * level
        }
        return y
    }

    nonisolated static func lowpass(_ x: [Float], _ fc: Double, _ rate: Int, passes: Int = 1) -> [Float] {
        let a = Float(1 - exp(-2 * .pi * fc / Double(rate)))
        var y = x
        for _ in 0..<passes { var s: Float = 0; for i in y.indices { s += a * (y[i] - s); y[i] = s } }
        return y
    }

    nonisolated static func highpass(_ x: [Float], _ fc: Double, _ rate: Int, passes: Int = 1) -> [Float] {
        let low = lowpass(x, fc, rate, passes: passes)
        return zip(x, low).map { $0 - $1 }
    }
}

struct SeededRandom {
    private var state: UInt64
    init(seed: UInt64) { state = seed | 1 }
    mutating func unit() -> Double {                 // 0..<1
        state ^= state << 13; state ^= state >> 7; state ^= state << 17
        return Double(state % 1_000_000) / 1_000_000
    }
    mutating func next() -> Float { Float(unit() * 2 - 1) }   // -1..<1
}

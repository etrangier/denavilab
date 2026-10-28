import Foundation

/// Laboratorio de pads: bucle sin clics, estirar, tono, filtros, reverb, saturación y capas. Todo es cálculo puro (sin AVAudioEngine):
/// lo que se oye en el laboratorio es exactamente lo que se guarda. Mismos parámetros y rangos que la PWA.
enum PadLab {
    nonisolated static let outRate = 48_000
    nonisolated static let maxLayers = 3
    nonisolated static let loopRange = 50.0...500.0
    nonisolated static let stretches = [1, 2, 4, 8]
    nonisolated static let pitchRange = -24.0...12.0

    struct Params: Equatable, Hashable {
        var loopMs = 200.0
        var stretch = 1
        var pitch = 0.0          // semitonos, -24...+12 (como un vinilo: al bajar dura más)
        var hp = 0.0             // 0 = apagado; hasta 2 kHz
        var lp = 100.0           // 100 = apagado; desde 200 Hz
        var mix = 0.0            // reverb 0...100
        var decay = 3.0          // largo de la reverb, 0,5...8 s
        var sat = 0.0            // saturación 0...100
    }

    struct Layer: Identifiable {
        let id: UUID
        var name: String
        var audio: [Float]
        var rate: Int
        var volume = 1.0
        var tune = 0.0           // semitonos de la capa
    }

    nonisolated static func hpHz(_ v: Double) -> Int { v <= 0 ? 0 : Int((20 * pow(100, v / 100)).rounded()) }
    nonisolated static func lpHz(_ v: Double) -> Int { v >= 100 ? 0 : Int((200 * pow(100, v / 100)).rounded()) }

    /// Bucle sin clic: el final se funde (potencia constante) con el inicio durante `ms`. El resultado empalma consigo mismo.
    nonisolated static func crossLoop(_ x: [Float], rate: Int, ms: Double) -> [Float] {
        let f = min(Int(ms / 1000 * Double(rate)), x.count / 2)
        guard f >= 16, x.count >= 64 else { return x }
        let n = x.count - f
        var out = Array(x[0..<n])
        for i in 0..<f {
            let t = (Double(i) + 0.5) / Double(f)
            let wi = Float(sin(t * Double.pi / 2)), wo = Float(cos(t * Double.pi / 2))
            out[i] = x[i] * wi + x[n + i] * wo
        }
        return out
    }

    /// Filtro de segundo orden (Butterworth), pasa-altos o pasa-bajos.
    nonisolated static func biquad(_ x: [Float], rate: Int, hz: Double, highpass: Bool, passes: Int = 1) -> [Float] {
        let w0 = 2 * Double.pi * min(hz, Double(rate) * 0.45) / Double(rate)
        let c = cos(w0), al = sin(w0) / (2 * 0.70710678), a0 = 1 + al
        let b0: Double = highpass ? (1 + c) / 2 / a0 : (1 - c) / 2 / a0
        let b1: Double = highpass ? -(1 + c) / a0 : (1 - c) / a0
        let a1 = -2 * c / a0, a2 = (1 - al) / a0
        var y = x
        for _ in 0..<passes {
            var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
            for i in y.indices {
                let xi = Double(y[i])
                let yi = b0 * xi + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
                x2 = x1; x1 = xi; y2 = y1; y1 = yi
                y[i] = Float(yi)
            }
        }
        return y
    }

    /// Saturación suave (tanh). `amount` 0...100; compensa un poco la subida de nivel.
    nonisolated static func saturate(_ x: [Float], amount: Double) -> [Float] {
        guard amount > 0 else { return x }
        let k = Float(1 + amount / 100 * 12), norm = 1 / tanh(k), comp = Float(1 / (1 + amount / 100 * 0.6))
        return x.map { tanh($0 * k) * norm * comp }
    }

    /// Reverb algorítmica larga (peines amortiguados + dos difusores). `decay` es el tiempo en que cae 60 dB.
    nonisolated static func reverb(_ x: [Float], rate: Int, mix: Double, decay: Double) -> [Float] {
        guard mix > 0, !x.isEmpty else { return x }
        var wet = [Float](repeating: 0, count: x.count)
        let delays = [0.0297, 0.0371, 0.0411, 0.0437, 0.0533, 0.0617]
        for d in delays {
            let n = max(1, Int(d * Double(rate)))
            let g = Float(pow(10.0, -3.0 * d / max(decay, 0.1)))
            var buf = [Float](repeating: 0, count: n)
            var idx = 0
            var damp: Float = 0
            for i in x.indices {
                let out = buf[idx]
                damp = out * 0.6 + damp * 0.4
                buf[idx] = x[i] + damp * g
                idx += 1; if idx == n { idx = 0 }
                wet[i] += out
            }
        }
        for (d, g) in [(0.005, Float(0.7)), (0.0017, Float(0.7))] {
            let n = max(1, Int(d * Double(rate)))
            var buf = [Float](repeating: 0, count: n)
            var idx = 0
            for i in wet.indices {
                let inp = wet[i], bo = buf[idx]
                let y = -g * inp + bo
                buf[idx] = inp + g * y
                idx += 1; if idx == n { idx = 0 }
                wet[i] = y
            }
        }
        let m = Float(min(1, max(0, mix / 100)))
        let wetGain = m * 1.2 / 3
        var out = x
        for i in out.indices { out[i] = x[i] * (1 - m * 0.5) + wet[i] * wetGain }
        return out
    }

    /// Mezcla las capas ya trabajadas y devuelve un pad listo para bucle, normalizado a −1 dBFS.
    /// Suena dos vueltas y se queda con la segunda: así la cola de la reverb y los filtros empalman con el inicio.
    nonisolated static func process(_ layers: [Layer], _ p: Params, outRate: Int = outRate) -> [Float] {
        guard !layers.isEmpty else { return [] }
        var prepared: [[Float]] = []
        for l in layers {
            guard !l.audio.isEmpty else { prepared.append([]); continue }
            var x = l.audio
            if p.stretch > 1 { x = Creative.padStretch(x, factor: Double(p.stretch), rate: l.rate, sustain: true) }
            x = crossLoop(x, rate: l.rate, ms: p.loopMs)
            let ratio = pow(2.0, (p.pitch + l.tune) / 12)
            var y = WavIO.resample(x, from: max(1, Int((Double(l.rate) * ratio).rounded())), to: outRate)
            let g = Float(l.volume)
            for i in y.indices { y[i] *= g }
            prepared.append(y)
        }
        let len = prepared[0].count
        guard len > 64 else { return prepared[0] }
        var z = [Float](repeating: 0, count: len * 2)
        for y in prepared where !y.isEmpty { for i in 0..<(len * 2) { z[i] += y[i % y.count] } }
        z = Editing.normalize(z, peak: 0.7)
        z = saturate(z, amount: p.sat)
        if hpHz(p.hp) > 0 { z = biquad(z, rate: outRate, hz: Double(hpHz(p.hp)), highpass: true) }
        if lpHz(p.lp) > 0 { z = biquad(z, rate: outRate, hz: Double(lpHz(p.lp)), highpass: false) }
        z = reverb(z, rate: outRate, mix: p.mix, decay: p.decay)
        let out = Array(z[len...])
        return Editing.normalize(Harmonize.removeDC(out))
    }

    /// Qué se aplicó, en palabras, para anotarlo en el sonido guardado.
    nonisolated static func describe(_ p: Params, _ layers: [Layer]) -> [String] {
        var o = ["bucle \(Int(p.loopMs)) ms"]
        if p.stretch > 1 { o.append("estirar ×\(p.stretch)") }
        if p.pitch != 0 { o.append("tono \(p.pitch > 0 ? "+" : "")\(Int(p.pitch)) st") }
        if hpHz(p.hp) > 0 { o.append("pasa-altos \(hpHz(p.hp)) Hz") }
        if lpHz(p.lp) > 0 { o.append("pasa-bajos \(lpHz(p.lp)) Hz") }
        if p.mix > 0 { o.append("reverb \(Int(p.mix)) % (\(String(format: "%g", p.decay)) s)") }
        if p.sat > 0 { o.append("saturación \(Int(p.sat)) %") }
        if layers.count > 1 {
            let parts = layers.map { l -> String in
                let t = l.tune == 0 ? "" : ", \(l.tune > 0 ? "+" : "")\(Int(l.tune)) st"
                return "\(l.name) (vol \(Int((l.volume * 100).rounded())) %\(t))"
            }
            o.append("capas: " + parts.joined(separator: " + "))
        }
        return o
    }

    nonisolated static let noteNames = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"]
    nonisolated static func noteName(_ semis: Int, base: Int = 60) -> String {
        let n = base + semis
        return noteNames[((n % 12) + 12) % 12] + String(n / 12 - 1)
    }
}

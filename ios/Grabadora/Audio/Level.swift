import Foundation

/// Volumen parejo: lleva el nivel típico de un sonido (no el pico) a un objetivo, para que un golpe seco y un pad no suenen uno muy bajo y otro muy fuerte.
/// Mismo algoritmo y mismos números que `levelTo` en `dsp.js` de la PWA.
enum Level {
    nonisolated static let defaultTargetDB = -24.0           // por calibrar con el aparato (ajustable en Compartir)
    nonisolated static let ceilingDB = -3.0                  // techo del pico al nivelar

    /// Nivel objetivo elegido por el usuario (entre −40 y −6 dB).
    nonisolated static var target: Double {
        let v = UserDefaults.standard.object(forKey: "levelTarget") == nil ? defaultTargetDB : UserDefaults.standard.double(forKey: "levelTarget")
        return max(-40, min(-6, v))
    }
    /// ¿Nivelar al compartir? Encendido por defecto.
    nonisolated static var exportOn: Bool { UserDefaults.standard.object(forKey: "levelExport") == nil ? true : UserDefaults.standard.bool(forKey: "levelExport") }

    struct Result { var audio: [Float]; var beforeDB: Double; var afterDB: Double; var gainDB: Double; var limited: Bool; var short: Bool }

    /// Nivel típico en dB: energía de las partes activas (no cuenta silencios ni colas). −120 si es silencio.
    nonisolated static func levelDB(_ x: [Float], rate: Int) -> Double {
        let r = Double(Harmonize.activeRMS(x, rate: rate))
        return r > 1e-6 ? 20 * log10(r) : -120
    }

    /// Lleva el nivel típico a `targetDB`. Si subir pasaría el techo, deja subir hasta 6 dB más con un limitador suave (tanh sobre el 70 % del techo)
    /// y, si aun así no llega, queda por debajo del objetivo (`short`) en vez de distorsionar. Nunca sube más de 24 dB.
    nonisolated static func levelTo(_ x: [Float], rate: Int, targetDB: Double? = nil, ceilingDB ceil0: Double = ceilingDB) -> Result {
        let target = targetDB ?? Level.target
        let before = levelDB(x, rate: rate), p = Double(x.map { abs($0) }.max() ?? 0)
        guard before >= -80, p > 0 else { return Result(audio: x, beforeDB: before, afterDB: before, gainDB: 0, limited: false, short: false) }
        let ceil = pow(10, ceil0 / 20), want = min(pow(10, (target - before) / 20), pow(10, 24.0 / 20)), fit = ceil / p
        let g = want <= fit ? want : min(want, fit * 2), limited = g > fit, knee = ceil * 0.7
        let y: [Float] = x.map { s in
            let v = Double(s) * g, a = abs(v)
            if limited && a > knee { return Float((v < 0 ? -1.0 : 1.0) * (knee + (ceil - knee) * tanh((a - knee) / (ceil - knee)))) }
            return Float(v)
        }
        return Result(audio: y, beforeDB: before, afterDB: levelDB(y, rate: rate), gainDB: 20 * log10(g), limited: limited, short: g < want * 0.999)
    }

    /// Tipos de sonido para grabar: la app está pensada para sonidos cortos (texturas, bajos, baterías).
    enum Kind: String, CaseIterable {
        case libre, textura, bajo, bateria
        nonisolated var title: String { switch self { case .libre: return "Libre"; case .textura: return "Textura"; case .bajo: return "Bajo"; case .bateria: return "Batería" } }
        nonisolated var maxSec: Double { switch self { case .libre: return 0; case .textura: return 8; case .bajo: return 4; case .bateria: return 2 } }
        nonisolated var prefix: String { self == .libre ? "grabacion" : self.rawValue }
        nonisolated var hint: String {
            switch self {
            case .libre: return "Graba lo que quieras."
            case .textura: return "Textura para pad: 1 o 2 notas sostenidas, de 2 a 8 s, sin ruido de fondo."
            case .bajo: return "Bajo: una nota por toma, con ataque claro, de 1 a 4 s."
            case .bateria: return "Batería: un golpe por toma (bombo, caja, hi-hat), hasta 2 s."
            }
        }
    }
}

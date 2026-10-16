import AVFoundation

/// Una sola configuración de sesión para toda la app. Si cada pantalla cambiara el modo,
/// iOS reconfiguraría el micrófono a mitad de una toma. Se usa el modo por defecto: .measurement
/// desactiva el control automático de ganancia y deja el micrófono muy bajo.
enum AudioSessionConfig {
    static func activate() throws {
        let s = AVAudioSession.sharedInstance()
        if s.category != .playAndRecord || s.mode != .default {
            try s.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .defaultToSpeaker])
        }
        try s.setActive(true)
    }
}

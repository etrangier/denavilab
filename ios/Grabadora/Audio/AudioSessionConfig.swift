import AVFoundation

/// Una sola configuración de sesión para toda la app. Si cada pantalla cambiara el modo
/// (p. ej. de .measurement a .default), iOS reconfiguraría el micrófono a mitad de una toma.
enum AudioSessionConfig {
    static func activate() throws {
        let s = AVAudioSession.sharedInstance()
        if s.category != .playAndRecord || s.mode != .measurement {
            try s.setCategory(.playAndRecord, mode: .measurement, options: [.allowBluetooth, .defaultToSpeaker])
        }
        try s.setActive(true)
    }
}

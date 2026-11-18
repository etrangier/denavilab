import Foundation

/// «Listo para el K.O. II»: lo que se graba se guarda ya a la frecuencia del aparato y con el volumen nivelado. Mismo criterio que `koprep.js` de la PWA.
/// 46 875 Hz / 16 bit, mono o estéreo, según la ficha de Teenage Engineering y varias tiendas. Para el volumen no encontré una recomendación oficial:
/// se usa el nivel objetivo de la app (Compartir → Nivel objetivo), que se calibra comparando con un sonido de fábrica.
enum KoPrep {
    nonisolated static let rate = 46_875
    private nonisolated static let key = "koPrep"

    /// Encendido por defecto.
    nonisolated static var on: Bool {
        get { UserDefaults.standard.object(forKey: key) == nil ? true : UserDefaults.standard.bool(forKey: key) }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    /// Lleva la toma a 46 875 Hz (si está activo).
    nonisolated static func prepare(_ x: [Float], rate r: Int) -> (audio: [Float], rate: Int) {
        guard on, r != rate, x.count > 1 else { return (x, r) }
        return (WavIO.resample(x, from: r, to: rate), rate)
    }

    /// Nivela el volumen típico al objetivo de la app, con techo de pico (si está activo).
    nonisolated static func level(_ x: [Float], rate r: Int) -> [Float] {
        guard on, !x.isEmpty else { return x }
        return Level.levelTo(x, rate: r).audio
    }
}

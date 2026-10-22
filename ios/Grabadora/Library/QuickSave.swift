import Foundation

/// Guardado rápido (pantalla 22): ajustes en UserDefaults y procesado de la toma.
enum QuickSave {
    struct Settings {
        var enabled = false
        var trim = true
        var fades = true
        var normalize = true
        var level = true
        var suggest = true
        var thresholdDB = -48.0
        var denoise = NoiseReduction.Level.off

        static func load(_ d: UserDefaults = .standard) -> Settings {
            func flag(_ k: String, _ def: Bool) -> Bool { d.object(forKey: k) == nil ? def : d.bool(forKey: k) }
            return Settings(enabled: flag("qsEnabled", false), trim: flag("qsTrim", true), fades: flag("qsFades", true),
                            normalize: flag("qsNormalize", true), level: flag("qsLevel", true), suggest: flag("qsSuggest", true),
                            thresholdDB: d.object(forKey: "qsThreshold") == nil ? -48 : d.double(forKey: "qsThreshold"),
                            denoise: NoiseReduction.Level(rawValue: d.string(forKey: "qsDenoise") ?? "off") ?? .off)
        }
    }

    static func process(_ x: [Float], rate: Int, _ s: Settings) -> [Float] {
        var y = NoiseReduction.clean(x, rate: rate, level: s.denoise)
        if s.trim {
            // El umbral nunca queda por encima de 30 dB bajo el pico de la propia toma: una grabación baja
            // (p. ej. un ambiente de exterior) no debe quedar casi vacía por un umbral absoluto.
            let th = max(-90, min(Float(s.thresholdDB), Editing.peakDB(y) - 30))
            let trimmed = Editing.trimSilence(y, thresholdDB: th, pad: rate / 200)
            if trimmed.count >= rate / 10 { y = trimmed }   // si quedara menos de 0,1 s, no se recorta
        }
        if s.fades { let f = rate * 5 / 1000; y = Editing.fade(y, inSamples: f, outSamples: f) }
        if s.level { y = Level.levelTo(y, rate: rate).audio }          // volumen parejo (nivel típico), con techo de pico
        else if s.normalize { y = Editing.normalize(y) }
        return y
    }

    static func autoName(count: Int, prefix: String = "grabacion") -> String { String(format: "%@_%03d", prefix, count + 1) }
}

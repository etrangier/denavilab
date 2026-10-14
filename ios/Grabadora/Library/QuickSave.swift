import Foundation

/// Guardado rápido (pantalla 22): ajustes en UserDefaults y procesado de la toma.
enum QuickSave {
    struct Settings {
        var enabled = false
        var trim = true
        var fades = true
        var normalize = false
        var suggest = true
        var thresholdDB = -48.0

        static func load(_ d: UserDefaults = .standard) -> Settings {
            func flag(_ k: String, _ def: Bool) -> Bool { d.object(forKey: k) == nil ? def : d.bool(forKey: k) }
            return Settings(enabled: flag("qsEnabled", false), trim: flag("qsTrim", true), fades: flag("qsFades", true),
                            normalize: flag("qsNormalize", false), suggest: flag("qsSuggest", true),
                            thresholdDB: d.object(forKey: "qsThreshold") == nil ? -48 : d.double(forKey: "qsThreshold"))
        }
    }

    static func process(_ x: [Float], rate: Int, _ s: Settings) -> [Float] {
        var y = x
        if s.trim { y = Editing.trimSilence(y, thresholdDB: Float(s.thresholdDB), pad: rate / 200) }
        if s.fades { let f = rate * 5 / 1000; y = Editing.fade(y, inSamples: f, outSamples: f) }
        if s.normalize { y = Editing.normalize(y) }
        return y
    }

    static func autoName(count: Int) -> String { String(format: "grabacion_%03d", count + 1) }
}

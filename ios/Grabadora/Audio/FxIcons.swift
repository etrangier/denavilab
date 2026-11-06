import SwiftUI

extension Fx404 {
    /// Símbolo del sistema que ilustra cada efecto (los de la web son dibujos propios; aquí se usan los de SF Symbols).
    nonisolated static func symbol(_ id: ID) -> String {
        switch id {
        case .cassette: return "recordingtape"
        case .vinyl404: return "opticaldisc"
        case .vinyl303: return "circle.circle"
        case .chorus: return "waveform.path"
        case .autopitch: return "music.note"
        case .granular: return "sparkles"
        case .tapeecho: return "dot.radiowaves.left.and.right"
        case .flanger: return "airplane"
        case .phaser: return "arrow.triangle.2.circlepath"
        case .reverb: return "building.columns"
        case .filterdrive: return "slider.horizontal.3"
        case .overdrive: return "flame"
        case .distortion: return "bolt"
        case .crusher: return "chart.bar"
        case .ringmod: return "link"
        case .slicer: return "scissors"
        case .stutter: return "repeat"
        case .tremolo: return "waveform"
        case .tapestop: return "stop.circle"
        }
    }
    nonisolated static let layerSymbol = "square.stack.3d.up"
}

/// Icono de un efecto de la cadena (decorativo: el nombre va aparte).
struct FxIcon: View {
    let symbol: String
    var size: CGFloat = 18
    var body: some View { Image(systemName: symbol).font(.system(size: size, weight: .regular)).foregroundColor(Theme.amber).frame(width: size + 10).accessibilityHidden(true) }
}

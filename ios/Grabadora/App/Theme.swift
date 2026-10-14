import SwiftUI

/// Tokens del diseño de Canva (DAHX-TlarCw).
enum Theme {
    static let bg = Color(hex: 0x14131b)
    static let surface = Color(hex: 0x1d1b26)
    static let surface2 = Color(hex: 0x26232f)
    static let line = Color(hex: 0x322e3f)
    static let text = Color(hex: 0xede9f3)
    static let muted = Color(hex: 0x9b95ab)
    static let amber = Color(hex: 0xe8a94a)
    static let ink = Color(hex: 0x1a1207)
    static let error = Color(hex: 0xff8a8a)

    /// Ubuntu si está incluida en el bundle; si no, la fuente del sistema.
    static func font(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom("Ubuntu", size: size, relativeTo: .body).weight(weight)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255)
    }
}

struct AmberButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.font(16, weight: .bold))
            .foregroundColor(Theme.ink)
            .padding(.vertical, 14).padding(.horizontal, 20)
            .frame(minHeight: 48)
            .background(Theme.amber.opacity(configuration.isPressed ? 0.8 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

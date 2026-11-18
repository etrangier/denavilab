import SwiftUI

/// Apariencias: Atardecer (de fábrica, sale del icono), Cinta y madera, Solo movimiento y Clásico (negro y gris). `amber` es el color de acento: se conserva el nombre para no tocar toda la app.
enum Palette: String, CaseIterable, Identifiable {
    case atardecer, cinta, movimiento, clasico
    var id: String { rawValue }
    nonisolated var label: String { switch self { case .atardecer: return "Atardecer"; case .cinta: return "Cinta y madera"; case .movimiento: return "Solo movimiento"; case .clasico: return "Clásico" } }
}

enum Theme {
    nonisolated static var palette: Palette { Palette(rawValue: UserDefaults.standard.string(forKey: "theme") ?? "") ?? .atardecer }
    private static func pick(_ a: UInt32, _ c: UInt32, _ m: UInt32, _ k: UInt32) -> Color {
        switch palette { case .atardecer: return Color(hex: a); case .cinta: return Color(hex: c); case .movimiento: return Color(hex: m); case .clasico: return Color(hex: k) }
    }
    static var bg: Color { pick(0x0d1311, 0x17100b, 0x000000, 0x000000) }
    static var surface: Color { pick(0x141c19, 0x221810, 0x0d0d0d, 0x0d0d0d) }
    static var surface2: Color { pick(0x1e2a26, 0x2e2116, 0x1a1a1a, 0x1a1a1a) }
    static var line: Color { pick(0x31403a, 0x4a3628, 0x3a3a3a, 0x3a3a3a) }
    static var text: Color { pick(0xf4ede1, 0xf1e3c8, 0xf2f2f2, 0xf2f2f2) }
    static var muted: Color { pick(0x9aa89f, 0xa8927a, 0x9a9a9a, 0x9a9a9a) }
    static var amber: Color { pick(0xf2a65a, 0xe3a43a, 0xffffff, 0xffffff) }
    static var ink: Color { pick(0x1c1208, 0x1a1208, 0x000000, 0x000000) }
    static var error: Color { pick(0xff7a6b, 0xef6a4f, 0xff6b6b, 0xff6b6b) }
    /// Lo que está bien: «en tono» en el afinador.
    static var ok: Color { pick(0x8fd8c3, 0xb9d27a, 0x5fe0a8, 0x9ad9a0) }
    /// Franja de color por tipo de sonido (solo en los temas con color).
    static func kindColor(_ kind: String?) -> Color {
        if palette == .clasico || palette == .movimiento { return Color.clear }
        switch kind ?? "libre" {
        case "textura": return pick(0x7fb5ab, 0xb9d27a, 0, 0)
        case "bajo": return pick(0xf2a65a, 0xe3a43a, 0, 0)
        case "bateria": return pick(0xc98a9a, 0xef6a4f, 0, 0)
        default: return pick(0xd8c26a, 0x8fb0c8, 0, 0)
        }
    }

    /// Ubuntu (incluida en Fonts/); si faltara, SwiftUI usa la del sistema.
    static func font(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .bold, .heavy, .black, .semibold: name = "Ubuntu-Bold"
        case .medium: name = "Ubuntu-Medium"
        default: name = "Ubuntu-Regular"
        }
        return .custom(name, size: size, relativeTo: .body)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255)
    }
}

// MARK: Botones

struct AmberButton: ButtonStyle {
    var full = true
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.font(16, weight: .bold))
            .foregroundColor(Theme.ink)
            .padding(.vertical, 14).padding(.horizontal, 20)
            .frame(maxWidth: full ? .infinity : nil, minHeight: 52)
            .background(Theme.amber.opacity(configuration.isPressed ? 0.8 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

struct OutlineButton: ButtonStyle {
    var selected = false
    var danger = false
    func makeBody(configuration: Configuration) -> some View {
        let c = danger ? Theme.error : (selected ? Theme.amber : Theme.text)
        configuration.label
            .font(Theme.font(15, weight: .medium))
            .foregroundColor(c)
            .padding(.vertical, 12).padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(Theme.surface.opacity(configuration.isPressed ? 0.6 : 1))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(selected || danger ? c : Theme.line, lineWidth: 1.5))
            .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

struct TextLink: View {
    let title: String; let action: () -> Void
    var body: some View {
        Button(action: action) { Text(title).font(Theme.font(14)).foregroundColor(Theme.amber).frame(minHeight: 44) }
    }
}

// MARK: Contenedores y controles

extension View {
    func card(highlight: Bool = false, padding: CGFloat = 14) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface)
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(highlight ? Theme.amber : Theme.line, lineWidth: highlight ? 1.5 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

struct ScreenTitle: View {
    let title: String; var subtitle: String? = nil; var trailing: AnyView? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(Theme.font(30, weight: .bold)).foregroundColor(Theme.text)
                Spacer()
                if let t = trailing { t }
            }
            if let s = subtitle { Text(s).font(Theme.font(14)).foregroundColor(Theme.muted) }
        }
    }
}

struct SectionLabel: View {
    let text: String
    init(_ t: String) { text = t }
    var body: some View { Text(text.uppercased()).font(Theme.font(12, weight: .medium)).foregroundColor(Theme.muted).tracking(0.8) }
}

struct Chip: View {
    let title: String; var selected = false; let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(Theme.font(14, weight: selected ? .bold : .regular))
                .foregroundColor(selected ? Theme.amber : Theme.text)
                .padding(.horizontal, 14).frame(minHeight: 40)
                .background(selected ? Theme.surface2 : Color.clear)
                .overlay(Capsule().stroke(selected ? Theme.amber : Theme.line, lineWidth: 1.5))
                .clipShape(Capsule())
        }
    }
}

struct ToggleRow: View {
    let title: String; var subtitle: String? = nil; @Binding var isOn: Bool
    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Theme.font(15, weight: .medium)).foregroundColor(Theme.text)
                if let s = subtitle { Text(s).font(Theme.font(13)).foregroundColor(Theme.muted) }
            }
        }.tint(Theme.amber).card()
    }
}

struct SliderRow: View {
    let title: String; let valueText: String; @Binding var value: Double; var range: ClosedRange<Double> = 0...1
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(Theme.font(15, weight: .medium)).foregroundColor(Theme.text)
                Spacer()
                Text(valueText).font(Theme.font(14)).foregroundColor(Theme.amber)
            }
            Slider(value: $value, in: range).tint(Theme.amber)
        }.card()
    }
}

struct LogoView: View {
    var size: CGFloat = 96
    private let heights: [CGFloat] = [0.3, 0.6, 1, 0.7, 0.4, 0.8, 0.5]
    var body: some View {
        HStack(alignment: .center, spacing: size * 0.05) {
            ForEach(heights.indices, id: \.self) { i in
                Capsule().fill(Theme.amber).frame(width: size * 0.08, height: size * 0.8 * heights[i])
            }
        }
        .frame(width: size * 1.1, height: size * 0.95)
        .accessibilityHidden(true)
    }
}

/// Barras de onda a partir de picos (0...1); las del rango seleccionado en ámbar.
struct WaveBars: View {
    let peaks: [Float]
    var range: ClosedRange<Double> = 0...1
    var playhead: Double? = nil
    /// Si se da, sólo estos tramos van en ámbar (p. ej. los cortes elegidos); si no, el de `range`.
    var highlights: [ClosedRange<Double>]? = nil
    var body: some View {
        Canvas { ctx, size in
            guard !peaks.isEmpty else { return }
            let n = peaks.count
            let step = size.width / CGFloat(n)
            let w = max(2, step * 0.55), mid = size.height / 2
            for (i, p) in peaks.enumerated() {
                let f = Double(i) / Double(n)
                let h = max(3, CGFloat(min(1, p)) * size.height * 0.9)
                let r = CGRect(x: CGFloat(i) * step + (step - w) / 2, y: mid - h / 2, width: w, height: h)
                ctx.fill(Path(roundedRect: r, cornerRadius: w / 2), with: .color(isLit(f) ? Theme.amber : Theme.line))
            }
            if let ph = playhead {
                let x = size.width * CGFloat(ph)
                ctx.fill(Path(CGRect(x: x - 1, y: 0, width: 2, height: size.height)), with: .color(Theme.text))
            }
        }
        .accessibilityLabel("Forma de onda")
    }

    private func isLit(_ f: Double) -> Bool {
        if let hs = highlights { return hs.contains { $0.contains(f) } }
        return range.contains(f)
    }
}

/// Respuesta visible al tocar una acción: mientras trabaja, el borde se ilumina de amarillo y el botón se bloquea;
/// al terminar destella y se apaga poco a poco.
struct ActionFX: ViewModifier {
    let key: String
    let busy: String?
    let flash: String?
    func body(content: Content) -> some View {
        let isBusy = busy == key, isFlash = flash == key
        content
            .overlay(
                RoundedRectangle(cornerRadius: 14).stroke(Theme.amber, lineWidth: 3)
                    .opacity(isBusy || isFlash ? 1 : 0)
                    .animation(isBusy || isFlash ? nil : .easeOut(duration: 0.9), value: isBusy || isFlash)
                    .allowsHitTesting(false)
            )
            .shadow(color: Theme.amber.opacity(isFlash ? 0.75 : 0), radius: isFlash ? 10 : 0)
            .animation(isFlash ? nil : .easeOut(duration: 0.9), value: isFlash)
            .opacity(isBusy ? 0.85 : 1)
            .disabled(isBusy)
    }
}

extension View {
    func actionFX(_ key: String, busy: String?, flash: String?) -> some View {
        modifier(ActionFX(key: key, busy: busy, flash: flash))
    }
}

/// Explicación breve plegada: un «ⓘ» que se abre al tocarlo (en vez de un párrafo fijo bajo cada botón).
struct InfoTip: View {
    let text: String
    @State private var open = false
    init(_ t: String) { text = t }
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button { open.toggle() } label: { Text("ⓘ").font(Theme.font(14)).foregroundColor(Theme.muted).frame(minWidth: 44, minHeight: 28, alignment: .leading) }
                .accessibilityLabel("Qué hace").accessibilityValue(open ? "abierto" : "cerrado")
            if open { Text(text).font(Theme.font(12)).foregroundColor(Theme.muted) }
        }
    }
}

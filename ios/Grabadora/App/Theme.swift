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

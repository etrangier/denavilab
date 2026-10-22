import SwiftUI

struct QuickSaveSheet: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("qsEnabled") private var enabled = false
    @AppStorage("qsTrim") private var trim = true
    @AppStorage("qsFades") private var fades = true
    @AppStorage("qsNormalize") private var normalize = true
    @AppStorage("qsLevel") private var level = true
    @AppStorage("qsSuggest") private var suggest = true
    @AppStorage("qsThreshold") private var threshold = -48.0
    @AppStorage("qsDenoise") private var denoise = "off"

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ScreenTitle(title: "Guardado rápido", subtitle: "Una toma llega lista a la Biblioteca",
                                trailing: AnyView(TextLink(title: "Listo") { dismiss() }))
                    ToggleRow(title: "Guardado rápido", subtitle: "Un toque en parar y queda guardada", isOn: $enabled)
                    ToggleRow(title: "Recortar silencios", subtitle: "Quita el vacío al inicio y al final", isOn: $trim)
                    ToggleRow(title: "Carpeta sugerida", subtitle: "Usa la clasificación automática", isOn: $suggest)
                    ToggleRow(title: "Fundidos cortos", subtitle: "5 ms al inicio y al final, sin clics", isOn: $fades)
                    noiseRow
                    ToggleRow(title: "Nivelar volumen", subtitle: "Lleva el nivel típico a \(Int(Level.target)) dB, sin pasar de \(Int(Level.ceilingDB)) dB en el pico", isOn: $level)
                    ToggleRow(title: "Normalizar volumen", subtitle: "Sube el pico hasta −1 dB (si Nivelar está apagado)", isOn: $normalize)
                    SliderRow(title: "Umbral de silencio", valueText: "\(Int(threshold)) dB", value: $threshold, range: -80 ... -20)
                    Text("El nombre es automático (grabacion_001…) y va a la carpeta sugerida, o a Sin clasificar si no hay sugerencia. Puedes cambiar nombre, carpeta y recorte después.")
                        .font(Theme.font(13)).foregroundColor(Theme.muted).frame(maxWidth: .infinity, alignment: .center)
                    Button("Listo") { dismiss() }.buttonStyle(AmberButton())
                }.padding(16)
            }
        }
    }

    private var noiseRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Reducir ruido al guardar").font(Theme.font(15, weight: .medium)).foregroundColor(Theme.text)
                Spacer()
                Text(denoise == "strong" ? "Fuerte" : denoise == "soft" ? "Suave" : "Apagado").font(Theme.font(13)).foregroundColor(Theme.muted)
            }
            HStack(spacing: 8) {
                ForEach([("off", "Off"), ("soft", "Suave"), ("strong", "Fuerte")], id: \.0) { key, title in
                    Button(title) { denoise = key }.buttonStyle(OutlineButton(selected: denoise == key))
                }
            }.font(Theme.font(13))
            Text("Corta la respiración y los graves, y apaga lo que suena bajito entre sonidos. Se aplica a toda toma que guardes.")
                .font(Theme.font(12)).foregroundColor(Theme.muted)
        }
        .card()
    }
}

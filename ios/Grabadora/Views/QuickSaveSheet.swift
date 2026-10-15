import SwiftUI

struct QuickSaveSheet: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("qsEnabled") private var enabled = false
    @AppStorage("qsTrim") private var trim = true
    @AppStorage("qsFades") private var fades = true
    @AppStorage("qsNormalize") private var normalize = false
    @AppStorage("qsSuggest") private var suggest = true
    @AppStorage("qsThreshold") private var threshold = -48.0

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
                    ToggleRow(title: "Normalizar volumen", subtitle: "Sube el nivel hasta −1 dB", isOn: $normalize)
                    SliderRow(title: "Umbral de silencio", valueText: "\(Int(threshold)) dB", value: $threshold, range: -80 ... -20)
                    Text("El nombre es automático (grabacion_001…) y va a la carpeta sugerida, o a Sin clasificar si no hay sugerencia. Puedes cambiar nombre, carpeta y recorte después.")
                        .font(Theme.font(13)).foregroundColor(Theme.muted).frame(maxWidth: .infinity, alignment: .center)
                    Button("Listo") { dismiss() }.buttonStyle(AmberButton())
                }.padding(16)
            }
        }
    }
}

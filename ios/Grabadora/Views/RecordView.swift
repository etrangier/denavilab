import SwiftUI

struct RecordView: View {
    @EnvironmentObject var rec: Recorder
    @EnvironmentObject var lib: LibraryStore
    @State private var pending: [Float]?
    @State private var name = ""

    var body: some View {
        Screen(title: "Grabar") {
            VStack(spacing: 20) {
                if rec.micDenied {
                    Text("Sin acceso al micrófono. Actívalo en Ajustes › Grabadora.")
                        .font(Theme.font(15)).foregroundColor(Theme.error)
                    Button("Abrir Ajustes") {
                        if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
                    }.buttonStyle(AmberButton())
                } else {
                    LevelMeter(level: rec.level, clipped: rec.clipped)
                    if rec.clipped { Text("Clip: baja la ganancia de entrada").font(Theme.font(13)).foregroundColor(Theme.error) }
                    Toggle("Escuchar por el altavoz (monitorización)", isOn: Binding(get: { rec.monitoring }, set: rec.setMonitoring))
                        .font(Theme.font(15)).foregroundColor(Theme.text)
                    Text("Puede haber retardo; usa auriculares para evitar acople.").font(Theme.font(13)).foregroundColor(Theme.muted)
                    Spacer()
                    controls
                }
                if let m = rec.errorMessage { Text(m).font(Theme.font(13)).foregroundColor(Theme.error) }
            }
        }
        .task { await rec.startListening() }
        .alert("Guardar toma", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } })) {
            TextField("Nombre", text: $name)
            Button("Guardar") {
                if let p = pending { lib.add(name: name.isEmpty ? "Toma" : name, audio: Editing.normalize(p), sampleRate: rec.sampleRate) }
                pending = nil; name = ""
            }
            Button("Descartar", role: .cancel) { pending = nil }
        }
    }

    private var controls: some View {
        VStack(spacing: 14) {
            Button(rec.state == .recording ? "Parar" : "Grabar") {
                if rec.state == .recording { pending = rec.stopRecording() } else { rec.startRecording() }
            }.buttonStyle(AmberButton())
            Button("Capturar los últimos \(Int(rec.retroSeconds)) s") { pending = rec.captureRetro() }
                .font(Theme.font(15)).foregroundColor(Theme.amber)
                .disabled(rec.state == .idle)
            Text("Escucha mientras la app está abierta (iOS muestra el punto naranja del micrófono).")
                .font(Theme.font(13)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
        }
    }
}

struct LevelMeter: View {
    let level: Float; let clipped: Bool
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 8).fill(Theme.surface2)
                RoundedRectangle(cornerRadius: 8)
                    .fill(clipped ? Theme.error : Theme.amber)
                    .frame(width: g.size.width * CGFloat(min(1, level)))
            }
        }.frame(height: 24)
        .accessibilityLabel("Nivel de entrada").accessibilityValue("\(Int(level * 100)) por ciento")
    }
}

import SwiftUI

/// Logo de muestreo: ondas ámbar de altura variable.
struct LogoView: View {
    var size: CGFloat = 96
    private let heights: [CGFloat] = [0.3, 0.6, 1, 0.7, 0.4, 0.8, 0.5]
    var body: some View {
        HStack(alignment: .center, spacing: size * 0.05) {
            ForEach(heights.indices, id: \.self) { i in
                Capsule().fill(Theme.amber).frame(width: size * 0.08, height: size * heights[i])
            }
        }
        .frame(width: size * 1.1, height: size)
        .accessibilityHidden(true)
    }
}

/// Bienvenida → permiso del micrófono → app.
struct WelcomeView: View {
    @EnvironmentObject var rec: Recorder
    @AppStorage("onboarded") private var onboarded = false
    @State private var step = 0

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(spacing: 20) {
                Spacer()
                LogoView()
                if step == 0 { welcome } else { permission }
                Spacer()
                dots
            }.padding(24)
        }
    }

    private var welcome: some View {
        VStack(spacing: 14) {
            Text("DenaviLab Grabadora").font(Theme.font(28, weight: .bold)).foregroundColor(Theme.text)
            Text("Graba, recorta y manda tus samples al EP-133 K.O. II.")
                .font(Theme.font(16)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
            Button("Empezar") { step = 1 }.buttonStyle(AmberButton()).padding(.top, 12)
        }
    }

    private var permission: some View {
        VStack(spacing: 14) {
            Text("Necesitamos el micrófono").font(Theme.font(24, weight: .bold)).foregroundColor(Theme.text)
            Text("Solo se usa para grabar tus samples. Todo se queda en tu iPhone.")
                .font(Theme.font(16)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
            if rec.micDenied {
                Text("Sin acceso. Puedes activarlo después en Ajustes › Grabadora.")
                    .font(Theme.font(13)).foregroundColor(Theme.error).multilineTextAlignment(.center)
            }
            Button(rec.micDenied ? "Entrar igualmente" : "Permitir micrófono") {
                Task {
                    if !rec.micDenied { _ = await rec.requestAccess() }
                    onboarded = true
                }
            }.buttonStyle(AmberButton()).padding(.top, 12)
        }
    }

    private var dots: some View {
        HStack(spacing: 8) {
            ForEach(0..<2) { i in
                Circle().fill(i == step ? Theme.amber : Theme.line).frame(width: 8, height: 8)
            }
        }
    }
}

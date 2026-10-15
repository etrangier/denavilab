import SwiftUI

/// Bienvenida → permiso del micrófono → app (pantallas 2 y 3 del diseño).
struct WelcomeView: View {
    @EnvironmentObject var rec: Recorder
    @AppStorage("onboarded") private var onboarded = false
    @State private var step = 0

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer(minLength: 24)
                if step == 0 { welcome } else { permission }
                Spacer(minLength: 24)
            }.padding(.horizontal, 20)
        }
    }

    private func badge<C: View>(@ViewBuilder _ c: () -> C, round: Bool = false) -> some View {
        c().frame(width: 124, height: 124)
            .overlay(Group {
                if round { Circle().stroke(Theme.amber, lineWidth: 3) }
                else { RoundedRectangle(cornerRadius: 30).stroke(Theme.amber, lineWidth: 3) }
            })
    }

    private var welcome: some View {
        VStack(spacing: 14) {
            badge { LogoView(size: 70) }
            Text("DenaviLab").font(Theme.font(32, weight: .bold)).foregroundColor(Theme.text).padding(.top, 12)
            Text("Samplea con tu iPhone y manda al K.O. II").font(Theme.font(15)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
            VStack(spacing: 0) {
                ForEach(Array(["Graba con el micrófono", "Corta y dale carácter", "Envíalo al K.O. II"].enumerated()), id: \.offset) { i, s in
                    HStack(spacing: 16) {
                        Text("\(i + 1)").font(Theme.font(14, weight: .bold)).foregroundColor(Theme.amber).frame(width: 16)
                        Text(s).font(Theme.font(16)).foregroundColor(Theme.text)
                        Spacer()
                    }.frame(minHeight: 48)
                    Divider().overlay(Theme.line)
                }
            }.padding(.top, 20)
            Text("Rescata lo que acabas de tocar y mándalo al K.O. II.").font(Theme.font(13)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
            Button("Empezar") { step = 1 }.buttonStyle(AmberButton())
        }
    }

    private var permission: some View {
        VStack(spacing: 14) {
            badge({ Image(systemName: "mic.fill").font(.system(size: 52)).foregroundColor(Theme.amber) }, round: true)
            Text("Permitir el micrófono").font(Theme.font(26, weight: .bold)).foregroundColor(Theme.text).padding(.top, 12)
            Text("Para grabar samples necesitamos usar el micrófono del iPhone.")
                .font(Theme.font(15)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
            VStack(spacing: 0) {
                ForEach(["Solo graba mientras tú lo decides", "Nada sale del teléfono sin tu permiso", "Puedes cambiarlo luego en Ajustes"], id: \.self) { s in
                    HStack(spacing: 14) {
                        Circle().fill(Theme.amber).frame(width: 8, height: 8)
                        Text(s).font(Theme.font(15)).foregroundColor(Theme.text)
                        Spacer()
                    }.frame(minHeight: 48)
                    Divider().overlay(Theme.line)
                }
            }.padding(.top, 16)
            if rec.micDenied {
                Text("Sin acceso. Puedes activarlo luego en Ajustes › Grabadora.").font(Theme.font(13)).foregroundColor(Theme.error).multilineTextAlignment(.center)
            }
            Button("Permitir micrófono") { Task { _ = await rec.requestAccess(); onboarded = true } }
                .buttonStyle(AmberButton()).padding(.top, 20)
            TextLink(title: "Ahora no") { onboarded = true }
        }
    }
}

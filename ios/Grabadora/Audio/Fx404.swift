import Foundation

/// Efectos de carácter inspirados en los de la Roland SP-404MKII (manual de referencia, lista «MFX»):
/// 303 VinylSim, 404 VinylSim, Cassette Sim, Chorus y Auto Pitch. Se aplican al sonido antes de compartirlo o llevarlo a un sampler.
/// Mismo cálculo, mismos rangos y mismos números que `fx404.js` de la PWA. Deterministas y sin cambiar el largo de la toma.
/// Los rangos y nombres de parámetros son los del manual; cómo suena cada uno por dentro es una interpretación propia (por confirmar contra el aparato).
enum Fx404 {
    enum ID: String, CaseIterable { case cassette, vinyl404, vinyl303, chorus, autopitch }
    nonisolated static let order: [ID] = [.cassette, .vinyl404, .vinyl303, .chorus, .autopitch]

    enum Kind { case range, choice, bool }
    struct Param {
        let key: String, label: String, kind: Kind
        var min = 0.0, max = 100.0, def = 0.0, step = 1.0
        var unit = ""
        var options: [String] = []
    }
    struct Info {
        let name: String, about: String, how: String, uso: String
        let params: [Param]
        let presets: [(name: String, values: [String: Double])]
    }
    /// Ajustes de un efecto: clave → valor (los interruptores valen 0 o 1; las opciones, su posición).
    typealias Params = [String: Double]

    nonisolated static let keys = ["Cromática", "La", "Si♭", "Si", "Do", "Re♭", "Re", "Mi♭", "Mi", "Fa", "Sol♭", "Sol", "La♭"]

    nonisolated private static func rng(_ k: String, _ label: String, _ lo: Double, _ hi: Double, _ def: Double, unit: String = "", step: Double = 1) -> Param {
        Param(key: k, label: label, kind: .range, min: lo, max: hi, def: def, step: step, unit: unit)
    }

    nonisolated static func info(_ id: ID) -> Info {
        switch id {
        case .vinyl303:
            return Info(name: "303 VinylSim", about: "El disco de vinilo de la SP-303: compresión «de prensado», ruido de superficie y bamboleo de la vuelta del plato.",
                how: "Un retardo que se mueve con la vuelta del plato (33⅓ rpm = 0,55 Hz) mueve el tono unos centésimos de semitono (wow) y un temblor rápido (flutter). Un compresor suave y una saturación redondean los picos como un corte de vinilo. El ruido es siseo de banda ancha + rumor grave + chasquidos al azar.",
                uso: "Para ese sabor de disco gastado de soul y trip-hop; úsalo suave en pads y cuerdas.",
                params: [rng("comp", "Compresión", 0, 100, 55), rng("noise", "Ruido", 0, 100, 45), rng("wow", "Wow/flutter", 0, 100, 50), rng("level", "Nivel", 0, 100, 100)],
                presets: [("Sutil", ["comp": 30, "noise": 20, "wow": 25, "level": 100]), ("Disco gastado", ["comp": 55, "noise": 45, "wow": 50, "level": 100]), ("Extremo", ["comp": 80, "noise": 75, "wow": 85, "level": 100])])
        case .vinyl404:
            return Info(name: "404 VinylSim", about: "El vinilo de la SP-404SX: menos compresión, más «caja de tocadiscos» (ancho de banda recortado), ruido y bamboleo.",
                how: "Un filtro pasa-altos y uno pasa-bajos estrechan el espectro como el sistema de reproducción de un tocadiscos viejo (cuanto más FREQUENCY, más cerrado y «de radio»), con wow/flutter y ruido de superficie.",
                uso: "Para texturas lo-fi y bases de hip hop: baja el brillo y el grave sin ensuciar el medio, donde viven las voces y las teclas.",
                params: [rng("frequency", "Frecuencia", 0, 100, 55), rng("noise", "Ruido", 0, 100, 45), rng("wow", "Wow/flutter", 0, 100, 45)],
                presets: [("Sutil", ["frequency": 30, "noise": 25, "wow": 20]), ("Tocadiscos de sala", ["frequency": 55, "noise": 45, "wow": 45]), ("Radio vieja", ["frequency": 90, "noise": 60, "wow": 60])])
        case .cassette:
            return Info(name: "Cassette Sim", about: "Un casete reproduciéndose: tono, siseo, años de desgaste, saturación de cinta, bamboleo y cinta estirada.",
                how: "La cinta pierde agudos con la edad (filtro pasa-bajos que baja), satura de forma suave y redonda (tanh), suma siseo y tiene caídas de señal. El wow/flutter viene del cabrestante y el rodillo; «cinta estirada» agrega una deriva lenta e irregular de la velocidad.",
                uso: "El más útil para pads y ambientes: los vuelve cálidos, oscuros y un poco inestables, como una grabación de los 80 (Camel, Cerati).",
                params: [rng("tone", "Tono", 0, 100, 40), rng("hiss", "Siseo", 0, 100, 40), rng("age", "Edad", 0, 60, 25, unit: " años"), rng("drive", "Saturación", 0, 100, 45), rng("wow", "Wow/flutter", 0, 100, 45), rng("catch", "Cinta estirada", 0, 100, 30)],
                presets: [("Sutil", ["tone": 55, "hiss": 20, "age": 10, "drive": 25, "wow": 25, "catch": 10]), ("Casete de los 80", ["tone": 40, "hiss": 40, "age": 25, "drive": 45, "wow": 45, "catch": 30]), ("Cinta vieja del cajón", ["tone": 25, "hiss": 60, "age": 50, "drive": 70, "wow": 70, "catch": 60])])
        case .chorus:
            return Info(name: "Chorus", about: "Amplitud y riqueza: duplica el sonido con una copia ligeramente desafinada que se mueve.",
                how: "Dos copias con retardo de 7–12 ms que oscila lentamente cambian su tono un poquito (efecto Doppler); al sumarlas con el original aparece un batido que se oye como «varias fuentes». En mono, además, produce un filtro peine que da color. El periodo va de 0,33 a 2,30 s.",
                uso: "Para ensanchar pads, teclas y guitarras limpias antes de compartirlos (los samplers suelen traer poco procesamiento propio).",
                params: [rng("depth", "Profundidad", 0, 100, 60), rng("rate", "Periodo", 0.33, 2.3, 1.4, unit: " s", step: 0.01), rng("balance", "Mezcla (seco → efecto)", 0, 100, 55, unit: " %"),
                         rng("eqLow", "EQ grave", -15, 15, 0, unit: " dB"), rng("eqHigh", "EQ agudo", -15, 15, 0, unit: " dB"), rng("level", "Nivel", 0, 100, 100)],
                presets: [("Sutil", ["depth": 35, "rate": 1.1, "balance": 35, "eqLow": -3, "eqHigh": 2, "level": 100]), ("Pad ancho", ["depth": 65, "rate": 1.8, "balance": 55, "eqLow": 0, "eqHigh": 0, "level": 100]), ("Mareo", ["depth": 95, "rate": 0.7, "balance": 75, "eqLow": 0, "eqHigh": 0, "level": 100])])
        case .autopitch:
            return Info(name: "Auto Pitch", about: "Procesa una voz: la afina a una tonalidad, cambia su tono y su timbre (formante) y puede dejarla «robótica».",
                how: "Se mide la altura de la voz cada 8 ms (YIN) y se re-sintetiza con TD-PSOLA: se copian granos de un período de la voz original y se colocan más juntos o más separados para cambiar el tono; al leer cada grano más rápido o más lento cambia el formante. ROBOT fija todo a una sola nota.",
                uso: "Para trozos de voz (Sade, Cerati) que quieras afinar a tu tonalidad o volver instrumentos. Sólo funciona con una voz o un instrumento solo: en acordes o mezclas sale mal.",
                params: [rng("pitch", "Tono", -100, 100, 0), rng("formant", "Formante", -100, 100, 0), rng("balance", "Mezcla (seco → efecto)", 0, 100, 100, unit: " %"), rng("atPitch", "Fuerza de corrección", 0, 100, 70),
                         Param(key: "key", label: "Tonalidad", kind: .choice, min: 0, max: 12, def: 0, options: keys), Param(key: "robot", label: "Robot", kind: .bool, min: 0, max: 1, def: 0)],
                presets: [("Afinar (cromático)", ["pitch": 0, "formant": 0, "balance": 100, "atPitch": 100, "key": 0, "robot": 0]), ("Voz robótica", ["pitch": 0, "formant": 0, "balance": 100, "atPitch": 100, "key": 0, "robot": 1])])
        }
    }

    nonisolated static func defaults(_ id: ID) -> Params { Dictionary(uniqueKeysWithValues: info(id).params.map { ($0.key, $0.def) }) }

    /// Completa y acota unos ajustes (por ejemplo los guardados): lo que falte o no sirva toma su valor por defecto.
    nonisolated static func params(_ id: ID, _ given: Params = [:]) -> Params {
        var o = Params()
        for q in info(id).params {
            let v = given[q.key]
            switch q.kind {
            case .range: o[q.key] = (v != nil && v!.isFinite) ? min(q.max, max(q.min, v!)) : q.def
            case .bool: o[q.key] = v.map { $0 >= 0.5 ? 1 : 0 } ?? q.def
            case .choice: o[q.key] = (v != nil && v! >= 0 && v! < Double(q.options.count) && v! == v!.rounded()) ? v! : q.def
            }
        }
        return o
    }

    nonisolated static func num(_ v: Double) -> String {
        let x = (v * 100).rounded() / 100
        return (x == x.rounded() ? String(Int(x)) : String(x)).replacingOccurrences(of: ".", with: ",")
    }

    /// Texto corto de los ajustes, para anotar en el sonido.
    nonisolated static func describe(_ id: ID, _ given: Params) -> String {
        let p = params(id, given), inf = info(id)
        var parts: [String] = []
        for q in inf.params {
            let v = p[q.key] ?? q.def
            switch q.kind {
            case .range: parts.append("\(q.label) \(num(v))\(q.unit)")
            case .bool: if v >= 0.5 { parts.append(q.label) }
            case .choice: parts.append("\(q.label) \(q.options[Int(v)])")
            }
        }
        return "\(inf.name) (\(parts.joined(separator: ", ")))"
    }

    /// Aplica un efecto. Devuelve un audio nuevo del mismo largo.
    nonisolated static func apply(_ id: ID, _ x: [Float], rate: Int, _ given: Params = [:]) -> [Float] {
        guard !x.isEmpty else { return x }
        let p = params(id, given)
        switch id {
        case .vinyl303: return vinyl303(x, rate, p)
        case .vinyl404: return vinyl404(x, rate, p)
        case .cassette: return cassette(x, rate, p)
        case .chorus: return chorus(x, rate, p)
        case .autopitch: return autoPitch(x, rate, p)
        }
    }

    // MARK: Herramientas

    nonisolated private static let tau = 2 * Double.pi
    nonisolated private static func dB(_ v: Double) -> Double { pow(10, v / 20) }

    /// Aleatorio con semilla (LCG): [0, 1).
    struct RNG {
        var s: UInt32
        init(_ seed: UInt32) { s = seed == 0 ? 1 : seed }
        mutating func next() -> Double { s = s &* 1_664_525 &+ 1_013_904_223; return Double(s) / 4_294_967_296 }
    }

    nonisolated private static func whiteNoise(_ n: Int, _ g: inout RNG) -> [Float] { (0..<n).map { _ in Float(g.next() * 2 - 1) } }

    enum BQ { case lp, hp, lowShelf, highShelf }

    /// Biquad RBJ.
    nonisolated static func biquad(_ x: [Float], _ type: BQ, _ fc: Double, _ rate: Int, gainDB: Double = 0, q: Double = 0.70710678) -> [Float] {
        let w = tau * min(max(fc, 10), Double(rate) * 0.45) / Double(rate), c = cos(w), s = sin(w), al = s / (2 * q), A = dB(gainDB / 2)
        var b0 = 0.0, b1 = 0.0, b2 = 0.0, a0 = 1.0, a1 = 0.0, a2 = 0.0
        switch type {
        case .lp: b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al
        case .hp: b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al
        case .lowShelf:
            let k = 2 * A.squareRoot() * al
            b0 = A * ((A + 1) - (A - 1) * c + k); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - k)
            a0 = (A + 1) + (A - 1) * c + k; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - k
        case .highShelf:
            let k = 2 * A.squareRoot() * al
            b0 = A * ((A + 1) + (A - 1) * c + k); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - k)
            a0 = (A + 1) - (A - 1) * c + k; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - k
        }
        b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0
        var y = x
        var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
        for i in y.indices {
            let xi = Double(x[i]), yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = Float(yi)
        }
        return y
    }

    /// Lee `x` en la posición i − d[i] (d en muestras, con decimales): un retardo variable. Es lo que produce wow, flutter, chorus y desafinación.
    nonisolated static func varDelay(_ x: [Float], _ d: [Double]) -> [Float] {
        let n = x.count
        guard n > 0 else { return x }
        var y = [Float](repeating: 0, count: n)
        func at(_ k: Int) -> Double { Double(x[k < 0 ? 0 : (k >= n ? n - 1 : k)]) }
        for i in 0..<n {
            let p = Double(i) - d[i], k = Int(floor(p)), f = p - Double(k)
            let a = at(k - 1), b = at(k), c = at(k + 1), e = at(k + 2)
            y[i] = Float(b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - e + f * (3 * (b - c) + e - a))))      // Catmull-Rom
        }
        return y
    }

    /// Nivel típico de las partes activas (RMS de los bloques a menos de ~12 dB del más fuerte): referencia para el ruido y para igualar volumen.
    nonisolated static func activeLevel(_ x: [Float], _ rate: Int) -> Double {
        let blk = max(64, Int((Double(rate) * 0.05).rounded()))
        var r: [Double] = []
        var i = 0
        while i + blk <= x.count { var s = 0.0; for j in i..<(i + blk) { s += Double(x[j]) * Double(x[j]) }; r.append(s / Double(blk)); i += blk }
        guard let m = r.max(), m >= 1e-12 else { return 0 }
        var s = 0.0, c = 0
        for v in r where v > m * 0.06 { s += v; c += 1 }
        return (s / Double(c)).squareRoot()
    }

    nonisolated private static func matchLevel(_ y: [Float], _ x: [Float], _ rate: Int) -> [Float] {
        let a = activeLevel(y, rate), b = activeLevel(x, rate)
        guard a > 1e-9, b > 1e-9 else { return y }
        let g = Float(b / a)
        return y.map { $0 * g }
    }

    /// Curva de retardo (en muestras) que mueve el tono como un disco o una cinta irregulares. Cada componente se da como desviación de tono
    /// (fracción, 0,004 = 0,4 %): para un seno de frecuencia f, retardo D → desviación máxima 2π·f·D/rate.
    nonisolated static func wobbleDelay(_ n: Int, _ rate: Int, wow: Double = 0, wowHz: Double = 0.555, flutter: Double = 0, flutHz: Double = 7, drift: Double = 0, driftHz: Double = 0.22, seed: UInt32 = 7) -> [Double] {
        var g = RNG(seed), d = [Double](repeating: 0, count: n)
        var comps: [(Double, Double, Double)] = []
        let R = Double(rate)
        if wow > 0 {
            comps.append((wow * R / (tau * wowHz), wowHz, g.next() * tau))
            comps.append((wow * 0.35 * R / (tau * wowHz * 2.1), wowHz * 2.1, g.next() * tau))
        }
        if flutter > 0 {
            comps.append((flutter * R / (tau * flutHz), flutHz, g.next() * tau))
            comps.append((flutter * 0.5 * R / (tau * flutHz * 1.37), flutHz * 1.37, g.next() * tau))
        }
        if drift > 0 {
            for (w, m) in [(1.0, 1.0), (0.61, 0.6), (0.37, 0.45)] { comps.append((drift * m * R / (tau * driftHz * w), driftHz * w, g.next() * tau)) }
        }
        for (D, f, ph) in comps { for i in 0..<n { d[i] += D * sin(tau * f * Double(i) / R + ph) } }
        return d
    }

    /// Compresor sencillo (seguidor de nivel con ataque y relajación).
    nonisolated static func compress(_ x: [Float], _ rate: Int, thDB: Double, ratio: Double, atkMs: Double, relMs: Double) -> [Float] {
        let a = exp(-1 / (atkMs / 1000 * Double(rate))), r = exp(-1 / (relMs / 1000 * Double(rate)))
        var y = x, env = 0.0
        for i in x.indices {
            let v = Double(abs(x[i]))
            env = v > env ? a * env + (1 - a) * v : r * env + (1 - r) * v
            let lv = 20 * log10(max(env, 1e-6)), g = lv > thDB ? -(lv - thDB) * (1 - 1 / ratio) : 0
            y[i] = x[i] * Float(dB(g))
        }
        return y
    }

    /// Pico «típico» (percentil 99,5 de |x|): la saturación y la compresión se miden contra él, no contra el fondo de escala, para que suenen igual en un sonido bajo o alto.
    nonisolated static func peakRef(_ x: [Float]) -> Double {
        let step = max(1, x.count / 20000)
        var a: [Float] = []
        var i = 0
        while i < x.count { a.append(abs(x[i])); i += step }
        guard !a.isEmpty else { return 0 }
        a.sort()
        return Double(a[min(a.count - 1, Int(Double(a.count) * 0.995))])
    }

    /// Saturación suave (tanh) relativa al pico del propio sonido. drive 0–1: 0 = nada, 1 = muy saturado.
    nonisolated static func saturate(_ x: [Float], _ drive: Double) -> [Float] {
        let ref = peakRef(x)
        guard ref >= 1e-6, drive > 0 else { return x }
        let k = 1 + 6 * drive, t = tanh(k)
        return x.map { Float(ref * tanh(k * Double($0) / ref) / t) }
    }

    /// Ruido de superficie de disco: siseo de banda ancha, rumor grave y chasquidos (Poisson, de amplitud muy desigual). `ref` = nivel de la señal.
    nonisolated static func vinylNoise(_ n: Int, _ rate: Int, amt: Double, ref: Double, seed: UInt32, clicksPerSec: Double = 12) -> [Float] {
        var out = [Float](repeating: 0, count: n)
        guard amt > 0, ref > 0 else { return out }
        var g = RNG(seed)
        let hiss = biquad(biquad(whiteNoise(n, &g), .hp, 400, rate), .lp, 9000, rate), rumble = biquad(whiteNoise(n, &g), .lp, 55, rate)
        let hg = Float(ref * dB(-40 + 28 * amt) * 1.7), rg = Float(ref * dB(-50 + 22 * amt) * 6)
        for i in 0..<n { out[i] = hiss[i] * hg + rumble[i] * rg }
        let lam = clicksPerSec * pow(amt, 1.4) / Double(rate)
        for i in 0..<n {
            if g.next() >= lam { continue }
            let u = g.next(), pop = g.next() < 0.06
            let sign: Double = g.next() < 0.5 ? -1 : 1
            let amp = ref * dB(-14 + 10 * amt) * (0.25 + 2.2 * u * u * u) * (pop ? 2.5 : 1) * sign, tauS = Double(rate) * (pop ? 0.0022 : 0.0004)
            let m = min(n - i, Int((tauS * 6).rounded()))
            for k in 0..<m { out[i + k] += Float(amp * exp(-Double(k) / tauS)) }
        }
        return out
    }

    /// Protege del recorte sin tocar lo que ya cabe.
    nonisolated private static func finish(_ y: [Float]) -> [Float] {
        var p: Float = 0
        for v in y { p = max(p, abs(v)) }
        guard p > 0.98 else { return y }
        let g = 0.98 / p
        return y.map { $0 * g }
    }

    nonisolated private static func levelGain(_ lv: Double) -> Float { Float(dB(-40 * (1 - lv / 100))) }

    // MARK: Efectos

    nonisolated private static func vinyl303(_ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        let c = p["comp"]! / 100, w = p["wow"]! / 100, n = p["noise"]! / 100
        var y = varDelay(x, wobbleDelay(x.count, rate, wow: 0.012 * w, wowHz: 0.555, flutter: 0.003 * w, flutHz: 7.3, seed: 11))     // 33⅓ rpm = 0,555 vueltas por segundo
        if c > 0 {
            let pk = 20 * log10(max(peakRef(y), 1e-6))
            y = compress(y, rate, thDB: pk - (4 + 20 * c), ratio: 2 + 6 * c, atkMs: 5, relMs: 140)
            y = saturate(y, 0.6 * c)
            y = matchLevel(y, x, rate)
        }
        let noise = vinylNoise(x.count, rate, amt: n, ref: activeLevel(x, rate), seed: 21, clicksPerSec: 14)
        let g = levelGain(p["level"]!)
        for i in y.indices { y[i] = (y[i] + noise[i]) * g }
        return finish(y)
    }

    nonisolated private static func vinyl404(_ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        let f = p["frequency"]! / 100, w = p["wow"]! / 100, n = p["noise"]! / 100
        var y = varDelay(x, wobbleDelay(x.count, rate, wow: 0.010 * w, wowHz: 0.555, flutter: 0.004 * w, flutHz: 6.1, seed: 12))
        let q = 0.7 + 0.5 * f                                                                          // más resonancia al cerrar: color «de radio»
        y = biquad(biquad(y, .hp, 60 * pow(6.7, f), rate, q: q), .lp, 12000 * pow(0.183, f), rate, q: q)          // respuesta del tocadiscos: de amplia a «de radio»
        let noise = vinylNoise(x.count, rate, amt: n, ref: activeLevel(x, rate), seed: 22, clicksPerSec: 11)
        for i in y.indices { y[i] += noise[i] }
        return finish(y)
    }

    nonisolated private static func cassette(_ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        let tone = p["tone"]! / 100, hiss = p["hiss"]! / 100, a = p["age"]! / 60, drive = p["drive"]! / 100, wf = p["wow"]! / 100, catchv = p["catch"]! / 100
        let n = x.count, ref = activeLevel(x, rate)
        var g = RNG(33)
        var y = varDelay(x, wobbleDelay(n, rate, wow: 0.015 * wf * (1 + a), wowHz: 1.6, flutter: 0.004 * wf * (1 + a), flutHz: 9, drift: 0.03 * catchv, driftHz: 0.22, seed: 13))
        if drive > 0 { y = saturate(y, drive); y = matchLevel(y, x, rate) }
        y = biquad(biquad(y, .lp, 2500 * pow(14000.0 / 2500.0, tone) * (1 - 0.65 * a), rate), .hp, 30 + 60 * a, rate)
        y = biquad(y, .lowShelf, 120, rate, gainDB: 2.5)                                  // «joroba» de la cabeza de cinta: calidez en el grave
        if a > 0 {   // caídas de señal: cinta gastada
            var gain = [Float](repeating: 1, count: n)
            let lam = a * 0.6 / Double(rate)
            for i in 0..<n where g.next() < lam {
                let len = Int((Double(rate) * (0.02 + 0.07 * g.next())).rounded()), depth = dB(-(3 + 7 * g.next()) * (0.5 + 0.5 * a))
                var k = 0
                while k < len && i + k < n { gain[i + k] *= Float(1 - (1 - depth) * (0.5 - 0.5 * cos(tau * Double(k) / Double(len)))); k += 1 }
            }
            for i in 0..<n { y[i] *= gain[i] }
        }
        if hiss > 0 && ref > 0 {
            let h = biquad(biquad(whiteNoise(n, &g), .hp, 2000, rate), .lp, 12000, rate)
            let gn = ref * dB(min(-12, -42 + 30 * hiss + 8 * a)) * 2.2
            for i in 0..<n { y[i] += h[i] * Float(gn * (1 + 0.15 * sin(tau * 0.3 * Double(i) / Double(rate)))) }
        }
        return finish(y)
    }

    nonisolated private static func chorus(_ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        let n = x.count, depth = p["depth"]! / 100, period = p["rate"]!, bf = p["balance"]! / 100, b = Float(bf)
        let R = Double(rate), base = [0.0075 * R, 0.0115 * R, 0.0155 * R], mod = depth * 0.006 * R          // tres voces desfasadas 120°: más ancho que dos
        var d1 = [Double](repeating: 0, count: n), d2 = d1, d3 = d1
        for i in 0..<n {
            let ph = tau * Double(i) / (period * R)
            d1[i] = base[0] + mod * sin(ph); d2[i] = base[1] + mod * sin(ph + tau / 3); d3[i] = base[2] + mod * sin(ph + 2 * tau / 3)
        }
        let t1 = varDelay(x, d1), t2 = varDelay(x, d2), t3 = varDelay(x, d3)
        var wet = [Float](repeating: 0, count: n)
        for i in 0..<n { wet[i] = (t1[i] + t2[i] + t3[i]) / 3 }
        func mix(_ w: [Float]) -> [Float] { var y = [Float](repeating: 0, count: n); for i in 0..<n { y[i] = x[i] * (1 - b) + w[i] * b }; return y }
        // mezclar copias desfasadas con el original resta un poco de volumen: se compensa (antes del EQ, para que éste sí suba o baje el nivel)
        let a = activeLevel(x, rate), m0 = activeLevel(mix(wet), rate)
        let comp: Float = (a > 1e-9 && m0 > 1e-9 && bf > 0) ? Float(a / m0) : 1
        if p["eqLow"]! != 0 { wet = biquad(wet, .lowShelf, 200, rate, gainDB: p["eqLow"]!) }
        if p["eqHigh"]! != 0 { wet = biquad(wet, .highShelf, 4000, rate, gainDB: p["eqHigh"]!) }
        let g = levelGain(p["level"]!) * comp
        return finish(mix(wet).map { $0 * g })
    }

    // MARK: Auto Pitch (TD-PSOLA, monofónico)

    nonisolated private static let keyRoot: [Int?] = [nil, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8]     // nota (0 = Do) de cada tonalidad
    nonisolated private static let major = [0, 2, 4, 5, 7, 9, 11]

    /// Frecuencia fundamental por tramos (YIN simplificado sobre una copia a ~12 kHz). f0 = 0 si no hay voz.
    nonisolated static func trackPitch(_ x: [Float], _ rate: Int, fmin: Double = 70, fmax: Double = 800) -> (f0: [Double], hop: Int) {
        let dec = max(1, Int((Double(rate) / 12000).rounded())), r = Double(rate) / Double(dec), n = x.count / dec
        var s = [Float](repeating: 0, count: n)
        for i in 0..<n { var a: Float = 0; for k in 0..<dec { a += x[i * dec + k] }; s[i] = a / Float(dec) }
        let win = Int((r * 0.032).rounded()), hop = Int((r * 0.008).rounded()), lmin = Int(floor(r / fmax)), lmax = Int(floor(r / fmin))
        guard win > 0, hop > 0, lmin >= 1, lmax > lmin + 1 else { return ([], max(1, hop * dec)) }
        var out: [Double] = []
        let peak = s.reduce(Float(0)) { max($0, abs($1)) }
        var t = 0
        while t + win + lmax < n {
            var dfn = [Double](repeating: 0, count: lmax + 1)
            for l in 1...lmax { var a = 0.0; for i in 0..<win { let q = Double(s[t + i] - s[t + i + l]); a += q * q }; dfn[l] = a }
            var run = 0.0, best = 0, bv = 1.0
            var cm = [Double](repeating: 0, count: lmax + 1); cm[0] = 1
            for l in 1...lmax { run += dfn[l]; cm[l] = dfn[l] * Double(l) / (run == 0 ? 1 : run) }
            var l = lmin
            while l < lmax {
                if cm[l] < 0.15 {
                    while l + 1 < lmax && cm[l + 1] < cm[l] { l += 1 }
                    best = l; bv = cm[l]; break
                }
                if cm[l] < bv { bv = cm[l]; best = l }
                l += 1
            }
            var e = 0.0
            for i in 0..<win { e += Double(s[t + i] * s[t + i]) }
            let voiced = best > 0 && bv < 0.3 && (e / Double(win)).squareRoot() > Double(peak) * 0.03
            var lag = Double(best)
            if voiced && best > lmin && best < lmax - 1 {
                let a = cm[best - 1], b = cm[best], c = cm[best + 1], den = a - 2 * b + c
                if abs(den) > 1e-12 { lag += 0.5 * (a - c) / den }
            }
            out.append(voiced ? r / lag : 0)
            t += hop
        }
        return (out, hop * dec)
    }

    /// Semitono (MIDI, decimal) → nota de la escala más cercana.
    nonisolated private static func snap(_ semi: Double, _ key: Int) -> Double {
        guard key >= 0, key < keyRoot.count, let root = keyRoot[key] else { return semi.rounded() }
        var best = semi.rounded(), bd = 1e9
        let o0 = Int(floor(semi / 12))
        for o in (o0 - 1)...(o0 + 1) {
            for m in major {
                let v = Double(o * 12 + (m + root) % 12), dd = abs(v - semi)
                if dd < bd { bd = dd; best = v }
            }
        }
        return best
    }

    nonisolated private static func autoPitch(_ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        let n = x.count
        let (f0, hop) = trackPitch(x, rate)
        let shift = p["pitch"]! / 100 * 12, strength = p["atPitch"]! / 100, key = Int(p["key"]!), robot = p["robot"]! >= 0.5
        let rho = pow(2, p["formant"]! / 100 * 0.5)                                           // formante: ±½ octava de cambio del timbre
        let voicedF = f0.filter { $0 > 0 }.sorted()
        guard !voicedF.isEmpty, hop > 0 else { return x }
        let median = voicedF[voicedF.count >> 1], R = Double(rate)
        func midi(_ f: Double) -> Double { 69 + 12 * log2(f / 440) }
        func freq(_ m: Double) -> Double { 440 * pow(2, (m - 69) / 12) }
        func target(_ f: Double) -> Double {
            var m = midi(robot ? median : f) + shift
            let q = snap(m, key)
            m += (q - m) * (robot ? 1 : strength)
            return freq(m)
        }
        func at(_ i: Int) -> Int { min(f0.count - 1, max(0, Int((Double(i) / Double(hop)).rounded()))) }
        func per(_ i: Int) -> Double { let v = f0[at(i)]; return v > 0 ? R / v : 0 }
        var top: Float = 0, bot: Float = 0
        for v in x { if v > top { top = v }; if -v > bot { bot = -v } }
        let sgn: Float = top >= bot ? 1 : -1               // siempre el mismo tipo de pico (positivo o negativo): si no, los granos se anulan
        var marks: [(Int, Double)] = []
        var i = 0
        while i < n {
            let T = per(i)
            if T > 0 {
                let a = max(0, Int((Double(i) - T * 0.3).rounded())), b = min(n - 1, Int((Double(i) + T * 0.3).rounded()))
                var m = a, mv: Float = -1
                if a <= b { for k in a...b where sgn * x[k] > mv { mv = sgn * x[k]; m = k } }
                marks.append((m, T)); i = m + Int(T.rounded())
            } else { marks.append((i, R * 0.008)); i += Int((R * 0.008).rounded()) }
        }
        var out = [Float](repeating: 0, count: n)
        var ts = 0.0, mi = 0
        while Int(ts) < n {
            while mi + 1 < marks.count && abs(Double(marks[mi + 1].0) - ts) < abs(Double(marks[mi].0) - ts) { mi += 1 }
            let (m, Ta) = marks[mi], f = f0[at(Int(ts))]
            let Ps = f > 0 ? R / target(f) : Ta, L = max(8, Int(Ta.rounded())), g = Float(Ps / Ta)
            for k in -L...L {
                let src = Double(m) + Double(k) / rho, j = Int(floor(src)), fr = Float(src - Double(j))
                let v: Float = (j >= 0 && j + 1 < n) ? x[j] * (1 - fr) + x[j + 1] * fr : 0
                let w = Float(0.5 + 0.5 * cos(Double.pi * Double(k) / Double(L))), o = Int((ts + Double(k)).rounded())
                if o >= 0 && o < n { out[o] += v * w * g }
            }
            ts += max(8, Ps)
        }
        out = matchLevel(out, x, rate)                                                        // el solape de granos cambia el volumen: se iguala
        let b = Float(p["balance"]! / 100)
        var y = [Float](repeating: 0, count: n)
        for q in 0..<n { y[q] = x[q] * (1 - b) + out[q] * b }
        return finish(y)
    }
}

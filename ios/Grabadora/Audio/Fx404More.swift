import Foundation

/// Más efectos para convertir un sonido en otro: granular, destrucción y distorsión, delay y reverb, y efectos rítmicos.
/// Mismo cálculo, rangos y valores que `fxmore.js` de la PWA. No son de la SP-404MKII (salvo por el nombre de su familia):
/// son interpretaciones propias, por confirmar de oído contra el aparato.
extension Fx404 {
    nonisolated private static func rg(_ k: String, _ label: String, _ lo: Double, _ hi: Double, _ def: Double, unit: String = "", step: Double = 1) -> Param {
        Param(key: k, label: label, kind: .range, min: lo, max: hi, def: def, step: step, unit: unit)
    }
    nonisolated private static func ch(_ k: String, _ label: String, _ options: [String], _ def: Double = 0) -> Param {
        Param(key: k, label: label, kind: .choice, min: 0, max: Double(options.count - 1), def: def, options: options)
    }
    nonisolated private static func bl(_ k: String, _ label: String, _ def: Double = 0, hint: String = "") -> Param {
        Param(key: k, label: label, kind: .bool, min: 0, max: 1, def: def, hint: hint)
    }
    nonisolated static let divisions = ["1/4", "1/8", "1/16", "1/32"]
    nonisolated static let divBeats = [1.0, 0.5, 0.25, 0.125]
    nonisolated static let patterns = ["Alterno", "Síncopa", "Galope", "Golpes", "Aleatorio A", "Aleatorio B", "Charleston", "Respiración"]
    nonisolated static let stretches = [1, 2, 4, 8]

    nonisolated static func familyMore(_ id: ID) -> String {
        switch id {
        case .granular: return "Textura"
        case .tapeecho, .reverb: return "Espacio"
        case .filterdrive, .overdrive, .distortion, .crusher, .ringmod: return "Destruir"
        default: return "Ritmo"
        }
    }

    // MARK: Catálogo

    nonisolated static func infoMore(_ id: ID) -> Info {
        switch id {
        case .granular:
            return Info(name: "Granular", about: "Corta el sonido en granos de milésimas de segundo y los vuelve a lanzar en nube: sirve para congelar un instante, alargar un golpe hasta hacerlo pad o convertir una frase en una niebla.",
                how: "Cada grano es un trocito de 10–300 ms con una ventana (Hann) que evita clics. Densidad = granos por segundo; la posición decide de dónde se toman (fija = congelar; avanzando = recorrido); la dispersión mueve esa posición al azar; el tono de cada grano se cambia leyéndolo más rápido o más lento.",
                uso: "La herramienta más fuerte para volver un sonido en otro: un golpe de teclas se vuelve un pad; una voz, una niebla.",
                params: [rg("size", "Tamaño del grano", 10, 300, 90, unit: " ms"), rg("density", "Densidad", 4, 80, 24, unit: " granos/s"), ch("stretch", "Duración", ["×1", "×2", "×4", "×8"], 1), bl("freeze", "Congelar en una posición"),
                         rg("position", "Posición (al congelar)", 0, 100, 50, unit: " %"), rg("spray", "Dispersión", 0, 100, 30), rg("pitch", "Tono", -24, 24, 0, unit: " st"), rg("jitter", "Variación de tono", 0, 1200, 15, unit: " cent", step: 5),
                         rg("reverse", "Granos al revés", 0, 100, 0, unit: " %"), ch("shape", "Ventana", ["Suave", "Triangular", "Plana"]), rg("balance", "Mezcla (seco → efecto)", 0, 100, 100, unit: " %")],
                presets: [("Pad desde un golpe", ["size": 140, "density": 30, "stretch": 2, "freeze": 1, "position": 25, "spray": 25, "pitch": 0, "jitter": 12, "reverse": 0, "shape": 0, "balance": 100]),
                          ("Niebla", ["size": 220, "density": 50, "stretch": 1, "freeze": 0, "position": 50, "spray": 70, "pitch": 0, "jitter": 40, "reverse": 10, "shape": 0, "balance": 100]),
                          ("Polvo de estrellas", ["size": 30, "density": 60, "stretch": 0, "freeze": 0, "position": 50, "spray": 90, "pitch": 12, "jitter": 300, "reverse": 25, "shape": 1, "balance": 70])])
        case .crusher:
            return Info(name: "Crusher", about: "Baja los bits y la frecuencia de muestreo: sonido de sampler antiguo, áspero y digital.",
                how: "Se redondea cada muestra a pocos niveles (menos bits = más ruido de cuantización) y se repite el valor cada N muestras (menos frecuencia = aliasing metálico).",
                uso: "Para ensuciar baterías y teclas hasta el sabor de un sampler de los 90.",
                params: [rg("bits", "Bits", 1, 16, 8), rg("rateDiv", "Reducción de frecuencia", 1, 50, 6, unit: " ×"), rg("balance", "Mezcla (seco → efecto)", 0, 100, 100, unit: " %")],
                presets: [("Sampler de 12 bits", ["bits": 12, "rateDiv": 3, "balance": 100]), ("Radio rota", ["bits": 5, "rateDiv": 14, "balance": 100])])
        case .overdrive:
            return Info(name: "Overdrive", about: "Saturación cálida de válvula: engorda y comprime los picos.",
                how: "Una curva tanh asimétrica añade armónicos (también los pares, más musicales) y un filtro suaviza los agudos.",
                uso: "Para dar cuerpo a pads y bajos sin romperlos.",
                params: [rg("drive", "Ganancia", 0, 100, 50), rg("tone", "Tono", 0, 100, 60), rg("asym", "Asimetría", 0, 100, 20), rg("level", "Nivel", 0, 100, 100)],
                presets: [("Calidez", ["drive": 30, "tone": 55, "asym": 25, "level": 100]), ("Cálido sucio", ["drive": 75, "tone": 50, "asym": 45, "level": 100])])
        case .distortion:
            return Info(name: "Distortion", about: "Distorsión dura: recorta o dobla la onda hasta volverla agresiva.",
                how: "Se amplifica mucho la señal y se recorta de golpe (duro) o se dobla de vuelta (doblado, el «wavefolder»), lo que crea armónicos muy brillantes.",
                uso: "Para texturas industriales y golpes que cortan la mezcla.",
                params: [rg("drive", "Ganancia", 0, 100, 60), ch("mode", "Modo", ["Duro", "Doblado"]), rg("tone", "Tono", 0, 100, 55), rg("level", "Nivel", 0, 100, 100)],
                presets: [("Fuzz", ["drive": 70, "mode": 0, "tone": 45, "level": 100]), ("Metal fundido", ["drive": 90, "mode": 1, "tone": 60, "level": 100])])
        case .ringmod:
            return Info(name: "Ring Mod", about: "Multiplica el sonido por un tono: crea campanas y timbres metálicos que no estaban.",
                how: "Al multiplicar por una onda de frecuencia f, cada componente f₀ se reemplaza por f₀+f y f₀−f; el resultado es inarmónico (como una campana).",
                uso: "Para convertir un pad cálido en algo extraterrestre.",
                params: [rg("freq", "Frecuencia", 20, 2000, 220, unit: " Hz"), ch("shape", "Onda", ["Seno", "Cuadrada"]), rg("mix", "Mezcla", 0, 100, 50, unit: " %")],
                presets: [("Campana", ["freq": 440, "shape": 0, "mix": 60]), ("Robot", ["freq": 90, "shape": 1, "mix": 80])])
        case .filterdrive:
            return Info(name: "Filter+Drive", about: "Filtro con resonancia, saturación y movimiento: pasa-bajos, pasa-altos o pasa-banda que se desplazan solos.",
                how: "Un filtro de variables de estado que se puede resonar mucho; el barrido mueve el corte con una onda lenta (hasta ±2 octavas) y la saturación previa le da mordida.",
                uso: "Para oscurecer, abrir o «hacer hablar» una textura.",
                params: [ch("type", "Tipo", ["Pasa-bajos", "Pasa-altos", "Pasa-banda"]), rg("cutoff", "Corte", 0, 100, 55), rg("resonance", "Resonancia", 0, 100, 40), rg("drive", "Saturación", 0, 100, 30), rg("sweep", "Barrido", 0, 100, 0), rg("sweepRate", "Velocidad del barrido", 0.1, 4, 0.5, unit: " Hz", step: 0.05)],
                presets: [("Oscurecer", ["type": 0, "cutoff": 35, "resonance": 25, "drive": 20, "sweep": 0, "sweepRate": 0.5]), ("Wah lento", ["type": 2, "cutoff": 50, "resonance": 60, "drive": 30, "sweep": 60, "sweepRate": 0.4])])
        case .tapeecho:
            return Info(name: "Tape Echo", about: "Eco de cinta que se oscurece en cada repetición, con la cola que se extiende más allá del final.",
                how: "El sonido vuelve a entrar con un retardo; en cada vuelta pasa por un filtro y una saturación suave, y el tiempo tiembla un poco (wow).",
                uso: "Para dar profundidad y rastro a golpes y teclas.",
                params: [rg("time", "Tiempo", 40, 900, 320, unit: " ms"), rg("feedback", "Repeticiones", 0, 95, 45, unit: " %"), rg("tone", "Tono", 0, 100, 50), rg("wow", "Wow", 0, 100, 30), rg("mix", "Mezcla", 0, 100, 40, unit: " %")],
                presets: [("Eco corto", ["time": 140, "feedback": 30, "tone": 60, "wow": 15, "mix": 35]), ("Eco largo oscuro", ["time": 520, "feedback": 65, "tone": 25, "wow": 40, "mix": 50])])
        case .reverb:
            return Info(name: "Reverb", about: "Reverberación larga con cola: de un cuarto pequeño a una catedral.",
                how: "Seis filtros peine con distintos retardos, con amortiguación de agudos, más dos difusores: es el diseño clásico de Schroeder. El tamaño decide cuánto dura la cola (0,4 a 8 s).",
                uso: "Para convertir un golpe seco en una nota que se prolonga.",
                params: [rg("size", "Tamaño", 0, 100, 50), rg("damping", "Amortiguación", 0, 100, 50), rg("predelay", "Pre-retardo", 0, 120, 20, unit: " ms"), rg("mix", "Mezcla", 0, 100, 30, unit: " %")],
                presets: [("Cuarto", ["size": 15, "damping": 40, "predelay": 5, "mix": 25]), ("Catedral", ["size": 95, "damping": 55, "predelay": 40, "mix": 55])])
        case .slicer:
            return Info(name: "Slicer", about: "Corta el sonido con un patrón de pasos: lo vuelve rítmico.",
                how: "Un patrón de 16 pasos abre y cierra el volumen al ritmo del tempo, con rampas cortas para no hacer clics.",
                uso: "Para convertir una textura continua en un patrón.",
                params: [rg("bpm", "Tempo", 40, 240, 100, unit: " BPM"), ch("division", "Paso", divisions, 2), ch("pattern", "Patrón", patterns), rg("depth", "Profundidad", 0, 100, 100), rg("smooth", "Suavidad", 0, 100, 30)],
                presets: [("Galope", ["bpm": 100, "division": 2, "pattern": 2, "depth": 100, "smooth": 30]), ("Puntos", ["bpm": 100, "division": 1, "pattern": 3, "depth": 90, "smooth": 50])])
        case .tremolo:
            return Info(name: "Tremolo", about: "Sube y baja el volumen de forma periódica.",
                how: "Una onda lenta (seno, triángulo o cuadrada suave) multiplica el volumen.",
                uso: "Para dar pulso a un pad sin cortarlo.",
                params: [rg("rate", "Velocidad", 0.2, 20, 4, unit: " Hz", step: 0.1), rg("depth", "Profundidad", 0, 100, 60), ch("shape", "Onda", ["Seno", "Triángulo", "Cuadrada suave"])],
                presets: [("Suave", ["rate": 3, "depth": 40, "shape": 0]), ("Helicóptero", ["rate": 12, "depth": 90, "shape": 2])])
        case .stutter:
            return Info(name: "Tartamudeo", about: "Repite al azar el inicio de algunos pasos: el clásico «tartamudeo» de DJ.",
                how: "Cada paso tiene una probabilidad de repetir su primer trozo 2, 3, 4, 6 u 8 veces, con fundidos de 3 ms.",
                uso: "Para romper un patrón con repeticiones nerviosas.",
                params: [rg("bpm", "Tempo", 40, 240, 100, unit: " BPM"), ch("division", "Paso", divisions, 1), rg("chance", "Probabilidad", 0, 100, 40, unit: " %")],
                presets: [("Sutil", ["bpm": 100, "division": 1, "chance": 20]), ("Nervioso", ["bpm": 100, "division": 2, "chance": 70])])
        default:   // .tapestop
            return Info(name: "Parada de cinta", about: "La cinta se frena (o arranca): el tono y la velocidad caen en picada.",
                how: "La posición de lectura avanza a una velocidad que decrece (o crece); como baja la velocidad, baja también el tono, igual que un plato al que se le quita la corriente.",
                uso: "Para cerrar una frase o abrir una textura con un gesto.",
                params: [ch("where", "Dónde", ["Al final", "Arranque", "En el medio"]), rg("time", "Duración", 0.1, 2, 0.6, unit: " s", step: 0.05), rg("depth", "Profundidad", 0, 100, 100)],
                presets: [("Freno corto", ["where": 0, "time": 0.4, "depth": 100]), ("Arranque lento", ["where": 1, "time": 1.2, "depth": 90])])
        }
    }

    nonisolated static func applyMore(_ id: ID, _ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        switch id {
        case .granular: return granular(x, rate, p)
        case .tapeecho: return tapeEcho(x, rate, p)
        case .reverb: return finish(reverbTail(x, rate, size: p["size"]!, damp: p["damping"]!, preMs: p["predelay"]!, mix: p["mix"]!, tailSec: min(6, 0.4 + 7.6 * p["size"]! / 100 * 0.7)))
        case .filterdrive: return filterDrive(x, rate, p)
        case .overdrive: return drive(x, rate, p, hard: false)
        case .distortion: return drive(x, rate, p, hard: true)
        case .crusher: return crusher(x, rate, p)
        case .ringmod: return ringmod(x, rate, p)
        case .slicer: return slicer(x, rate, p)
        case .stutter: return stutter(x, rate, p)
        case .tremolo: return tremolo(x, rate, p)
        case .tapestop: return tapeStop(x, rate, p)
        default: return x
        }
    }

    nonisolated private static func grow(_ x: [Float], _ n: Int) -> [Float] {
        if n <= x.count { return x }
        return x + [Float](repeating: 0, count: n - x.count)
    }

    // MARK: Granular

    nonisolated static func grainWindow(_ G: Int, _ shape: Int) -> [Float] {
        (0..<G).map { k in
            let t = (Double(k) + 0.5) / Double(G)
            switch shape {
            case 1: return Float(1 - abs(2 * t - 1))
            case 2: return Float(min(1, min(t, 1 - t) / 0.2))
            default: return Float(0.5 - 0.5 * cos(tau * t))
            }
        }
    }

    nonisolated private static func granular(_ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        let N = x.count, stretch = stretches[min(3, max(0, Int(p["stretch"]!)))], M = Int((Double(N) * Double(stretch)).rounded())
        var g = RNG(77), out = [Double](repeating: 0, count: M)
        let G = max(16, Int((p["size"]! / 1000 * Double(rate)).rounded())), step = Double(rate) / p["density"]!, win = grainWindow(G, Int(p["shape"]!))
        let freeze = p["freeze"]! >= 0.5, position = p["position"]!, spray = p["spray"]!, pitch = p["pitch"]!, jitter = p["jitter"]!, rev = p["reverse"]!
        var t = 0.0
        while t < Double(M) {
            let base = freeze ? position / 100 * Double(N) : t / Double(M) * Double(N)
            let pos = base + (g.next() * 2 - 1) * spray * 0.005 * Double(rate)
            let gr = pow(2, (pitch + (g.next() * 2 - 1) * jitter / 100) / 12)
            let reversed = g.next() * 100 < rev
            let start = Int((t - Double(G) / 2).rounded())
            for k in 0..<G {
                let o = start + k
                if o < 0 || o >= M { continue }
                let src = pos + (Double(reversed ? G - 1 - k : k) - Double(G) / 2) * gr, j = Int(floor(src))
                if j < 0 || j + 1 >= N { continue }
                let f = src - Double(j)
                out[o] += (Double(x[j]) * (1 - f) + Double(x[j + 1]) * f) * Double(win[k])
            }
            t += step * (0.85 + 0.3 * g.next())
        }
        let wet = matchLevel(out.map { Float($0) }, x, rate), b = Float(p["balance"]! / 100), dry = grow(x, M)
        var y = [Float](repeating: 0, count: M)
        for i in 0..<M { y[i] = dry[i] * (1 - b) + wet[i] * b }
        return finish(y)
    }

    // MARK: Destrucción y distorsión

    nonisolated private static func crusher(_ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        let bits = p["bits"]!.rounded(), div = max(1, Int(p["rateDiv"]!.rounded())), L = pow(2, bits) - 1, b = Float(p["balance"]! / 100)
        var y = x, held: Float = 0
        for i in x.indices {
            if i % div == 0 { held = Float((Double(x[i]) * 0.5 + 0.5) * L).rounded() / Float(L) * 2 - 1 }
            y[i] = x[i] * (1 - b) + held * b
        }
        return finish(matchLevel(y, x, rate))
    }

    nonisolated private static func drive(_ x: [Float], _ rate: Int, _ p: Params, hard: Bool) -> [Float] {
        let ref = max(peakRef(x), 1e-6), k = 1 + (hard ? 24.0 : 14.0) * p["drive"]! / 100, bias = 0.3 * (p["asym"] ?? 0) / 100
        let fold = hard && (p["mode"] ?? 0) >= 0.5, pre = hard ? biquad(x, .hp, 90, rate) : x
        var y = [Float](repeating: 0, count: x.count)
        for i in x.indices {
            let v = Double(pre[i]) / ref
            if hard {
                var q = k * v
                if fold {
                    q = (q + 1).truncatingRemainder(dividingBy: 4)
                    if q < 0 { q += 4 }
                    q = q > 2 ? 3 - q : q - 1
                    y[i] = Float(q)
                } else { y[i] = Float(min(1, max(-1, q))) }
            } else { y[i] = Float(tanh(k * (v + bias)) - tanh(k * bias)) }
        }
        var o = matchLevel(biquad(y, .lp, 1200 * pow(10, p["tone"]! / 100), rate), x, rate)
        let g = levelGain(p["level"]!)
        for i in o.indices { o[i] *= g }
        return finish(o)
    }

    nonisolated private static func ringmod(_ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        let f = p["freq"]!, m = Float(p["mix"]! / 100), sq = (p["shape"] ?? 0) >= 0.5
        var car = [Float](repeating: 0, count: x.count)
        for i in x.indices { let s = sin(tau * f * Double(i) / Double(rate)); car[i] = Float(sq ? tanh(6 * s) : s) }
        let ring = matchLevel((0..<x.count).map { x[$0] * car[$0] }, x, rate)
        var y = x
        for i in x.indices { y[i] = x[i] * (1 - m) + ring[i] * m }
        return finish(y)
    }

    /// Filtro de variables de estado TPT (estable aunque se mueva el corte). Tipos: 0 pasa-bajos, 1 pasa-altos, 2 pasa-banda.
    nonisolated static func svfSweep(_ x: [Float], _ rate: Int, type: Int, cutoffAt: (Int) -> Double, q: Double) -> [Float] {
        var y = x
        let k = 1 / q
        var ic1 = 0.0, ic2 = 0.0, a1 = 0.0, a2 = 0.0, a3 = 0.0
        for i in x.indices {
            if i % 16 == 0 {
                let g = tan(Double.pi * min(max(cutoffAt(i), 20), Double(rate) * 0.45) / Double(rate))
                a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2
            }
            let xi = Double(x[i]), v3 = xi - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3
            ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2
            y[i] = Float(type == 0 ? v2 : (type == 1 ? xi - k * v1 - v2 : v1))
        }
        return y
    }

    nonisolated private static func filterDrive(_ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        let fc0 = 40 * pow(400, p["cutoff"]! / 100), q = 0.7 + 13 * pow(p["resonance"]! / 100, 2), sw = p["sweep"]! / 100, hz = p["sweepRate"]!, type = Int(p["type"]!)
        var sat = x
        if p["drive"]! > 0 {
            let ref = max(peakRef(x), 1e-6), k = 1 + 8 * p["drive"]! / 100
            sat = x.map { Float(ref * tanh(k * Double($0) / ref) / tanh(k)) }
        }
        let y = svfSweep(sat, rate, type: type, cutoffAt: { i in fc0 * pow(2, sw * 2 * sin(tau * hz * Double(i) / Double(rate))) }, q: q)
        return finish(matchLevel(y, x, rate))
    }

    // MARK: Delay y reverb (con cola)

    nonisolated private static func tapeEcho(_ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        let N = x.count, R = Double(rate), time = p["time"]! / 1000 * R, fb = p["feedback"]! / 100
        let reps = min(24.0, ceil(log(0.01) / log(max(fb, 0.05))) + 1)
        let tail = fb > 0.02 ? min(rate * 4, Int((time * reps).rounded())) : 0, M = N + tail
        var buf = [Float](repeating: 0, count: M + 2), y = [Float](repeating: 0, count: M)
        let mix = p["mix"]! / 100, a = exp(-tau * (1500 * pow(6, p["tone"]! / 100)) / R), wow = p["wow"]! / 100 * 0.004
        var lp = 0.0
        for i in 0..<M {
            let d = time * (1 + wow * sin(tau * 0.6 * Double(i) / R) + wow * 0.4 * sin(tau * 5.3 * Double(i) / R)), pos = Double(i) - d, k = Int(floor(pos)), f = pos - Double(k)
            let del = pos >= 0 ? Double(buf[k]) * (1 - f) + Double(buf[k + 1]) * f : 0
            lp = lp * a + del * (1 - a)                                       // el eco se oscurece en cada vuelta, como en una cinta
            let inp = i < N ? Double(x[i]) : 0
            buf[i] = Float(tanh(inp + fb * lp * 1.05))
            y[i] = Float(inp * (1 - mix * 0.5) + del * mix * 1.2)
        }
        return finish(y)
    }

    nonisolated static func reverbTail(_ x: [Float], _ rate: Int, size: Double, damp: Double, preMs: Double, mix: Double, tailSec: Double) -> [Float] {
        let N = x.count, M = N + Int((Double(rate) * tailSec).rounded()), inp = grow(x, M), decay = 0.4 + 7.6 * size / 100, pre = Int((preMs / 1000 * Double(rate)).rounded()), d = damp / 100
        var wet = [Float](repeating: 0, count: M)
        for dl in [0.0297, 0.0371, 0.0411, 0.0437, 0.0533, 0.0617] {
            let n = max(1, Int((dl * Double(rate)).rounded())), g = Float(pow(10.0, -3 * dl / decay))
            var buf = [Float](repeating: 0, count: n)
            var idx = 0
            var lp: Float = 0
            let k1 = Float(0.15 + 0.6 * d)
            for i in 0..<M {
                let o = buf[idx]
                lp = o * (1 - k1) + lp * k1
                buf[idx] = (i >= pre ? inp[i - pre] : 0) + lp * g
                idx += 1; if idx == n { idx = 0 }
                wet[i] += o
            }
        }
        for (dl, g) in [(0.005, Float(0.7)), (0.0017, Float(0.7))] {
            let n = max(1, Int((dl * Double(rate)).rounded()))
            var buf = [Float](repeating: 0, count: n)
            var idx = 0
            for i in 0..<M {
                let v = wet[i], bo = buf[idx], o = -g * v + bo
                buf[idx] = v + g * o
                idx += 1; if idx == n { idx = 0 }
                wet[i] = o
            }
        }
        let m = Float(mix / 100), gw = m * 1.2 / 3
        var y = [Float](repeating: 0, count: M)
        for i in 0..<M { y[i] = inp[i] * (1 - m * 0.5) + wet[i] * gw }
        return y
    }

    // MARK: Rítmicos

    nonisolated static func patternSteps(_ i: Int) -> [Int] {
        let fixed: [[Int]] = [[1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0], [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1], [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1]]
        if i < 4 { return fixed[max(0, i)] }
        if i == 6 { return [1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1] }
        if i == 7 { return [1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0] }
        var g = RNG(i == 4 ? 4242 : 9191)
        return (0..<16).map { _ in g.next() < 0.55 ? 1 : 0 }
    }

    nonisolated private static func slicer(_ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        let step = max(8, Int((60 / p["bpm"]! * divBeats[min(3, max(0, Int(p["division"]!)))] * Double(rate)).rounded())), pat = patternSteps(Int(p["pattern"]!)), depth = p["depth"]! / 100
        let ramp = max(2, Int((Double(rate) * (0.001 + 0.02 * p["smooth"]! / 100)).rounded())), k = min(1, 3 / Double(ramp))
        var y = x
        var cur = 1.0
        for i in x.indices {
            let tgt = pat[(i / step) % 16] != 0 ? 1.0 : 1 - depth
            cur += (tgt - cur) * k
            y[i] = x[i] * Float(cur)
        }
        return finish(y)
    }

    nonisolated private static func tremolo(_ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        let d = p["depth"]! / 100, shape = Int(p["shape"]!)
        var y = x
        for i in x.indices {
            let ph = (p["rate"]! * Double(i) / Double(rate)).truncatingRemainder(dividingBy: 1)
            let lfo = shape == 1 ? (ph < 0.5 ? 2 * ph : 2 - 2 * ph) : (shape == 2 ? 0.5 + 0.5 * tanh(4 * sin(tau * ph)) : 0.5 + 0.5 * sin(tau * ph))
            y[i] = x[i] * Float(1 - d * (1 - lfo))
        }
        return finish(y)
    }

    nonisolated private static func stutter(_ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        let S = max(64, Int((60 / p["bpm"]! * divBeats[min(3, max(0, Int(p["division"]!)))] * Double(rate)).rounded())), fade = Double(Int(Double(rate) * 0.003))
        var g = RNG(555), y = x
        var a = 0
        while a + S <= x.count {
            defer { a += S }
            if g.next() * 100 >= p["chance"]! { continue }
            let reps = [2, 3, 4, 6, 8][min(4, Int(g.next() * 5))], L = max(32, S / reps)
            for k in 0..<S {
                let m = k % L
                let e = min(min(1, Double(m) / max(fade, 1)), Double(L - 1 - m) / max(fade, 1))
                y[a + k] = x[a + m] * Float(e < 1 ? max(0, e) : 1)
            }
        }
        return finish(y)
    }

    nonisolated private static func tapeStop(_ x: [Float], _ rate: Int, _ p: Params) -> [Float] {
        let N = x.count, T = max(1, min(N, Int((p["time"]! * Double(rate)).rounded()))), depth = p["depth"]! / 100, where_ = Int(p["where"]!)
        let t0 = where_ == 0 ? N - T : (where_ == 1 ? 0 : Int((Double(N) / 2 - Double(T) / 2).rounded()))
        var pos = [Double](repeating: 0, count: N)
        var c = 0.0
        for i in 0..<N {
            let u = min(1, max(0, Double(i - t0) / Double(T)))
            let sp: Double
            switch where_ {
            case 0: sp = 1 - depth * (1 - pow(1 - u, 2))
            case 1: sp = i < T ? 1 - depth * pow(1 - Double(i) / Double(T), 2) : 1
            default: sp = 1 - depth * sin(Double.pi * u)
            }
            pos[i] = c; c += sp
        }
        var y = [Float](repeating: 0, count: N)
        for i in 0..<N {
            let q = pos[i], j = Int(floor(q)), f = Float(q - Double(j))
            y[i] = j + 1 < N ? x[j] * (1 - f) + x[j + 1] * f : (j < N ? x[j] : 0)
        }
        return finish(y)
    }
}

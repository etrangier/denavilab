import XCTest
@testable import DenaviGrabadora

final class LogicTests: XCTestCase {
    func testRingBufferKeepsLatest() {
        var r = RingBuffer(capacity: 4)
        r.write([1, 2, 3]); r.write([4, 5, 6])
        XCTAssertEqual(r.last(4), [3, 4, 5, 6])
        XCTAssertEqual(r.last(2), [5, 6])
        XCTAssertEqual(r.last(99).count, 4)
    }

    func testWavRoundTrip() {
        let x: [Float] = [0, 0.5, -0.5, 1, -1]
        let d = WavIO.encode(x, sampleRate: 46_875)
        XCTAssertEqual(d.count, 44 + 10)
        let back = WavIO.decode(d)!
        XCTAssertEqual(back.sampleRate, 46_875)
        for (a, b) in zip(x, back.samples) { XCTAssertEqual(a, b, accuracy: 0.001) }
    }

    func testResampleLength() {
        let x = [Float](repeating: 0.1, count: 48_000)
        XCTAssertEqual(WavIO.resample(x, from: 48_000, to: 46_875).count, 46_875)
    }

    func testZeroCrossSnap() {
        let x: [Float] = [0.5, 0.4, 0.2, -0.1, -0.3, -0.2, 0.1]
        XCTAssertEqual(Editing.nearestZeroCross(x, to: 4), 5)  // el cruce 5→6 está a 1; el 2→3 a 2
    }

    func testFadeEndpoints() {
        let y = Editing.fade([Float](repeating: 1, count: 10), inSamples: 5, outSamples: 5)
        XCTAssertEqual(y.first, 0); XCTAssertEqual(y.last, 0)
    }

    func testNormalizePeak() {
        let y = Editing.normalize([0.1, -0.2])
        XCTAssertEqual(y.map(abs).max()!, 0.891, accuracy: 0.001)
    }

    func testTapTempo() {
        var t: [TimeInterval] = []
        _ = TapTempo.register(&t, at: 0)
        _ = TapTempo.register(&t, at: 0.5)
        XCTAssertEqual(TapTempo.register(&t, at: 1.0)!, 120, accuracy: 0.01)
        XCTAssertNil(TapTempo.register(&t, at: 10)) // reinicia tras pausa
    }

    @MainActor func testLibraryAddSearchDelete() {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let lib = LibraryStore(directory: dir)
        let s = lib.add(name: "Bombo", audio: [0, 0.5, 0], sampleRate: 48_000)!
        var t = s; t.tags = ["kick"]; lib.update(t)
        lib.query = "kick"; XCTAssertEqual(lib.filtered.count, 1)
        lib.query = "xyz"; XCTAssertEqual(lib.filtered.count, 0)
        lib.delete(s); XCTAssertTrue(lib.samples.isEmpty)
    }

    func testExportFileName() {
        var s = Sample(name: "Mi bombo!", sampleRate: 48_000); s.slot = 7
        XCTAssertEqual(Exporter.fileName(for: s, ko: true), "007_Mi_bombo_.wav")        // formato K.O. II (en pausa)
        XCTAssertEqual(Exporter.fileName(for: s, ko: false), "Mi_bombo.wav")            // compartir: sin prefijo de slot ni símbolos sueltos
        XCTAssertEqual(Exporter.fileName(for: Sample(name: "Pájaros del río", sampleRate: 48_000), ko: false), "Pajaros_del_rio.wav")
        XCTAssertEqual(Exporter.fileName(for: Sample(name: "¡¡", sampleRate: 48_000), ko: false), "sonido.wav")
        XCTAssertFalse(Features.koExport)                                              // el botón y el formato del K.O. II no se ven
    }

    func testShareExportIsARealWavAtItsOwnRate() throws {
        let s = Sample(name: "Pájaros del río", sampleRate: 44_100)
        let x = (0..<44_100).map { Float(0.3 * sin(Double($0) * 0.05)) }
        let url = try Exporter.export(s, audio: x)
        XCTAssertEqual(url.lastPathComponent, "Pajaros_del_rio.wav")
        let d = try Data(contentsOf: url)
        XCTAssertEqual(String(decoding: d.prefix(4), as: UTF8.self), "RIFF")
        XCTAssertEqual(String(decoding: d[8..<12], as: UTF8.self), "WAVE")
        let rate = d[24..<28].enumerated().reduce(0) { $0 | Int($1.element) << (8 * $1.offset) }
        XCTAssertEqual(rate, 44_100)                                                    // su frecuencia original, no 46 875 Hz
        XCTAssertGreaterThanOrEqual(d.count, 44 + 44_100 * 2)                           // mono, 16 bit: 2 bytes por muestra
        XCTAssertEqual((d.count - 44) % 2, 0)
        // elegir otra frecuencia
        let u2 = try Exporter.export(s, audio: x, targetRate: 48_000)
        let d2 = try Data(contentsOf: u2)
        XCTAssertEqual(d2[24..<28].enumerated().reduce(0) { $0 | Int($1.element) << (8 * $1.offset) }, 48_000)
    }

    func testTrimSilence() {
        let x = [Float](repeating: 0, count: 100) + [0.5, -0.4, 0.3] + [Float](repeating: 0, count: 100)
        XCTAssertEqual(Editing.trimSilence(x, thresholdDB: -48), [0.5, -0.4, 0.3])
        XCTAssertEqual(Editing.trimSilence([0, 0, 0]).count, 3)   // todo silencio: no toca nada
    }

    func testTransientsFindsBursts() {
        let rate = 44_100
        var x = [Float](repeating: 0, count: rate)
        let starts = [4_410, 17_640, 30_870]
        for s in starts { for j in 0..<2_000 { x[s + j] = 0.8 * Float(sin(2 * .pi * 220 * Double(j) / Double(rate))) * (1 - Float(j) / 2_000) } }
        let found = Editing.transients(x, sensitivity: 0.5, minGapSamples: rate / 10)
        XCTAssertEqual(found.count, 3)
        for (f, s) in zip(found, starts) { XCTAssertLessThan(abs(f - s), 1_500) }
    }

    func testEvenSlices() {
        let x = [Float](repeating: 0.1, count: 8_000)
        let r = Editing.slices(starts: Editing.evenSlices(x, count: 8), total: x.count)
        XCTAssertEqual(r.count, 8)
        XCTAssertEqual(r.first?.lowerBound, 0); XCTAssertEqual(r.last?.upperBound, 8_000)
    }

    func testQuickSaveProcess() {
        var s = QuickSave.Settings(); s.trim = true; s.fades = true; s.normalize = false
        // 1 s de silencio, 1 s de sonido, 1 s de silencio: debe quedar más o menos el sonido
        let x = [Float](repeating: 0, count: 48_000) + [Float](repeating: 0.5, count: 48_000) + [Float](repeating: 0, count: 48_000)
        let y = QuickSave.process(x, rate: 48_000, s)
        XCTAssertLessThan(y.count, x.count)
        XCTAssertEqual(y.first, 0); XCTAssertEqual(y.last, 0)
        XCTAssertEqual(QuickSave.autoName(count: 13), "grabacion_014")
    }

    func testFolderMapperBestMappedLabel() {
        let s = FolderMapper.suggest(from: [Score(label: "ocean", confidence: 0.82), Score(label: "music", confidence: 0.2)])
        XCTAssertEqual(s?.folder, "Naturaleza"); XCTAssertEqual(s?.sub, "Mar y agua")
        XCTAssertEqual(s?.title, "Naturaleza › Mar y agua")
        XCTAssertEqual(FolderMapper.suggest(from: [Score(label: "Speech", confidence: 0.9)])?.folder, "Voz")
        XCTAssertEqual(FolderMapper.suggest(from: [Score(label: "rain", confidence: 0.4), Score(label: "wind", confidence: 0.7)])?.sub, "Viento")
    }

    func testFolderMapperIgnoresLowConfidenceAndUnknown() {
        XCTAssertNil(FolderMapper.suggest(from: [Score(label: "ocean", confidence: 0.1)]))
        XCTAssertNil(FolderMapper.suggest(from: [Score(label: "zzz_unknown", confidence: 0.9)]))
        XCTAssertNil(FolderMapper.suggest(from: []))
    }

    func testFolderMapperTargetsExist() {
        let labels = ["humming", "singing", "speech", "applause", "wind", "rain", "ocean", "dog", "forest", "fire",
                      "car", "engine", "door", "electronic", "hip_hop", "soul", "ambient", "guitar"]
        for l in labels {
            guard let s = FolderMapper.suggest(from: [Score(label: l, confidence: 0.9)]) else { return XCTFail("sin regla para \(l)") }
            let info = LibraryStore.folderInfo.first { $0.name == s.folder }
            XCTAssertNotNil(info, "carpeta inexistente: \(s.folder)")
            if let sub = s.sub { XCTAssertTrue(info?.subs.contains(sub) == true, "subcarpeta inexistente: \(sub)") }
        }
    }

    func testMetronomeBar() {
        let x = Metronome.barSamples(bpm: 120, beats: 4, sampleRate: 44_100)
        XCTAssertEqual(x.count, 4 * 22_050)                                   // 4 tiempos de 0,5 s
        let peak = { (r: Range<Int>) in x[r].map(abs).max() ?? 0 }
        XCTAssertGreaterThan(peak(0..<882), peak(22_050..<(22_050 + 882)))     // acento en el tiempo 1
        XCTAssertEqual(x[10_000], 0)                                           // silencio entre clics
    }

    func testRecordingLengthByBars() {
        XCTAssertEqual(Metronome.samples(bars: 2, beats: 4, bpm: 120, rate: 48_000), 192_000)  // 8 tiempos × 0,5 s
        XCTAssertNil(Metronome.samples(bars: 0, beats: 4, bpm: 120, rate: 48_000))
    }

    @MainActor func testReplaceAudioWorksAfterRename() {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let lib = LibraryStore(directory: dir)
        let s = lib.add(name: "Original", audio: [Float](repeating: 0.1, count: 1_000), sampleRate: 48_000)!
        var edited = s; edited.name = "Renombrada"; edited.effects.reverbMix = 30   // el editor guarda una copia distinta
        lib.replaceAudio(edited, with: [Float](repeating: 0.1, count: 400))
        XCTAssertEqual(lib.audio(for: s).count, 400)
    }

    private func clickTrack(bpm: Double, seconds: Double, rate: Int = 44_100) -> [Float] {
        var x = [Float](repeating: 0, count: Int(seconds * Double(rate)))
        let period = 60 / bpm
        var t = 0.1
        while t < seconds - 0.1 {
            let s = Int(t * Double(rate))
            for j in 0..<2_000 where s + j < x.count { x[s + j] = 0.8 * Float(sin(2 * .pi * 220 * Double(j) / Double(rate))) * (1 - Float(j) / 2_000) }
            t += period
        }
        return x
    }

    func testEstimateBPM() {
        for target in [100.0, 120.0] {
            let r = Editing.estimateBPM(clickTrack(bpm: target, seconds: 10), rate: 44_100)
            XCTAssertNotNil(r)
            XCTAssertEqual(r?.bpm ?? 0, target, accuracy: 3)
        }
        XCTAssertNil(Editing.estimateBPM([Float](repeating: 0, count: 100_000), rate: 44_100))   // silencio
        XCTAssertNil(Editing.estimateBPM([Float](repeating: 0.1, count: 1_000), rate: 44_100))   // demasiado corto
    }

    func testSnapToGrid() {
        XCTAssertEqual(Editing.snapToGrid([0, 1_020, 2_450, 2_500], step: 1_000), [0, 1_000, 2_000, 3_000])
        XCTAssertEqual(Editing.snapToGrid([10, 20], step: 1_000), [0])                              // sin repetidos
    }

    func testCompressorReducesDynamicRange() {
        let rate = 44_100
        let quiet = [Float](repeating: 0.05, count: rate / 2), loud = [Float](repeating: 0.8, count: rate / 2)
        let y = Dynamics.compress(quiet + loud, rate: rate, mode: 2)
        let before = 0.8 / 0.05
        let after = Double(y[rate / 2 + rate / 4 ..< y.count].map(abs).max()!) / Double(y[rate / 4 ..< rate / 2].map(abs).max()!)
        XCTAssertLessThan(after, before / 2)
    }

    func testGritStylesAreSafeAndDeterministic() {
        let x = (0..<20_000).map { Float(sin(2 * .pi * 440 * Double($0) / 44_100)) * 0.7 }
        for style in GritStyle.allCases {
            let a = Grit.apply(x, rate: 44_100, style: style, amount: 0.6), b = Grit.apply(x, rate: 44_100, style: style, amount: 0.6)
            XCTAssertEqual(a, b, "\(style) no es determinista")
            XCTAssertEqual(a.count, x.count)
            XCTAssertTrue(a.allSatisfy { $0.isFinite && abs($0) <= 1 }, "\(style) fuera de rango")
            if style == .ninguno { XCTAssertEqual(a, x) } else { XCTAssertNotEqual(a, x, "\(style) no cambia nada") }
        }
    }

    func testEffectParamsDecodeOldLibrary() throws {
        let old = #"{"eqLowGain":0,"eqHighGain":2,"lowpassHz":20000,"reverbMix":0,"pitchCents":0,"compress":true}"#
        let p = try JSONDecoder().decode(EffectParams.self, from: Data(old.utf8))
        XCTAssertTrue(p.compress); XCTAssertEqual(p.eqHighGain, 2)
        XCTAssertEqual(p.grit, .ninguno); XCTAssertEqual(p.compressMode, 1)
        XCTAssertTrue(EffectParams().isNeutral)
        var q = EffectParams(); q.grit = .lofi; XCTAssertFalse(q.isNeutral)
    }

    func testZoomWindow() {
        XCTAssertEqual(Editing.window(count: 1_000, width: 250, center: 500), 375..<625)
        XCTAssertEqual(Editing.window(count: 1_000, width: 250, center: 10), 0..<250)          // pegada al principio
        XCTAssertEqual(Editing.window(count: 1_000, width: 250, center: 990), 750..<1_000)      // pegada al final
        XCTAssertEqual(Editing.window(count: 1_000, width: 5_000, center: 500), 0..<1_000)      // nunca más que el audio
        XCTAssertEqual(Editing.window(count: 100, width: 0, center: 50).count, 2)               // mínimo 2 muestras
        XCTAssertTrue(Editing.window(count: 0, width: 10, center: 0).isEmpty)
    }

    func testSnapMarker() {
        let x: [Float] = [0.5, 0.4, 0.2, -0.1, -0.3, -0.2, 0.1]
        XCTAssertEqual(Editing.snapMarker(x, to: 4, zeroCross: false), 4)
        XCTAssertEqual(Editing.snapMarker(x, to: 4, zeroCross: true), 5)
        XCTAssertEqual(Editing.snapMarker(x, to: 99, zeroCross: false), 6)    // dentro del audio
        XCTAssertEqual(Editing.snapMarker(x, to: -5, zeroCross: false), 0)
    }

    func testManualHasAllTermsOnce() {
        let terms = ManualContent.all.flatMap { $0.entries.map(\.term) }
        XCTAssertEqual(ManualContent.all.count, 3)
        XCTAssertEqual(terms.count, 27)
        XCTAssertEqual(Set(terms).count, terms.count)
        XCTAssertTrue(ManualContent.all.flatMap(\.entries).allSatisfy { !$0.term.isEmpty && !$0.text.isEmpty })
    }

    func testQuietTakeIsNotEmptiedByTrimming() {
        // Ambiente de exterior muy bajo (≈ −54 dB) con un pico aislado: el umbral fijo de −48 dB lo dejaba en unas pocas muestras.
        var x = (0..<144_000).map { i in 0.002 * Float(sin(Double(i) * 0.37)) }
        x[70_000] = 0.01
        var s = QuickSave.Settings(); s.trim = true; s.fades = false; s.normalize = false; s.thresholdDB = -48
        let y = QuickSave.process(x, rate: 48_000, s)
        XCTAssertGreaterThan(y.count, x.count * 9 / 10)
    }

    func testTrimNeverLeavesLessThanTenthOfASecond() {
        var x = [Float](repeating: 0, count: 48_000)
        x[24_000] = 0.5                                     // un solo clic en un segundo de silencio
        var s = QuickSave.Settings(); s.trim = true; s.fades = false; s.normalize = false
        XCTAssertEqual(QuickSave.process(x, rate: 48_000, s).count, x.count)
    }

    func testQuietTakeIsNormalizedByDefault() {
        let x = [Float](repeating: 0.004, count: 48_000)    // ≈ −48 dB
        let y = QuickSave.process(x, rate: 48_000, QuickSave.Settings())
        XCTAssertGreaterThan(y.map(abs).max() ?? 0, 0.5)
    }

    @MainActor func testAppOpensOnHome() {
        let s = AppState()
        XCTAssertEqual(s.tab, .inicio)
        let sample = Sample(name: "x", sampleRate: 48_000)
        s.open(sample)
        XCTAssertEqual(s.tab, .editar); XCTAssertEqual(s.selectedID, sample.id)
    }

    func testRenameNames() {
        XCTAssertEqual(LibraryStore.names(base: "Bombo", count: 1), ["Bombo"])
        XCTAssertEqual(LibraryStore.names(base: "Bombo", count: 3), ["Bombo 01", "Bombo 02", "Bombo 03"])
        XCTAssertEqual(LibraryStore.names(base: "x", count: 100).last, "x 100")        // ancho según la cantidad
        XCTAssertTrue(LibraryStore.names(base: "x", count: 0).isEmpty)
    }

    @MainActor func testBatchRenameMoveDelete() {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let lib = LibraryStore(directory: dir)
        let a = lib.add(name: "a", audio: [0, 0.1, 0], sampleRate: 48_000)!
        let b = lib.add(name: "b", audio: [0, 0.1, 0], sampleRate: 48_000)!
        let c = lib.add(name: "c", audio: [0, 0.1, 0], sampleRate: 48_000)!

        lib.rename(ids: [a.id, b.id], to: "Kick")                                   // varias: numeradas, la más antigua primero
        XCTAssertEqual(lib.samples.first { $0.id == a.id }?.name, "Kick 01")
        XCTAssertEqual(lib.samples.first { $0.id == b.id }?.name, "Kick 02")
        XCTAssertEqual(lib.samples.first { $0.id == c.id }?.name, "c")
        lib.rename(ids: [c.id], to: "  Solo  ")                                      // una: tal cual, sin espacios sobrantes
        XCTAssertEqual(lib.samples.first { $0.id == c.id }?.name, "Solo")
        lib.rename(ids: [c.id], to: "   ")                                           // vacío: no cambia
        XCTAssertEqual(lib.samples.first { $0.id == c.id }?.name, "Solo")

        lib.move(ids: [a.id, c.id], folder: "Voz", sub: "Habla")
        XCTAssertEqual(lib.samples(in: "Voz").count, 2)
        XCTAssertEqual(lib.samples.first { $0.id == a.id }?.subfolder, "Habla")

        let reloaded = LibraryStore(directory: dir)                                  // todo se guardó en disco
        XCTAssertEqual(reloaded.samples.first { $0.id == b.id }?.name, "Kick 02")

        lib.delete(ids: [a.id, b.id])
        XCTAssertEqual(lib.samples.map(\.id), [c.id])
        XCTAssertFalse(FileManager.default.fileExists(atPath: lib.url(a).path))
    }

    func testChopPieceNamesKeepOriginalNumber() {
        XCTAssertEqual([0, 2].map { Editing.pieceName($0, base: "toma") }, ["corte01_toma", "corte03_toma"])   // el 1 y el 3, sin renumerar
        XCTAssertEqual(Editing.pieceName(11, base: "x"), "corte12_x")
    }

    func testHighlightRangesOnlyForSelectedPieces() {
        let ranges: [Range<Int>] = [0..<100, 100..<250, 250..<400, 400..<1_000]
        let h = Editing.highlightRanges(ranges, total: 1_000, selected: [3, 0])
        XCTAssertEqual(h.count, 2)
        XCTAssertEqual(h[0], 0...0.1); XCTAssertEqual(h[1], 0.4...1.0)                 // ordenados, sólo los elegidos
        XCTAssertTrue(Editing.highlightRanges(ranges, total: 1_000, selected: []).isEmpty)
        XCTAssertEqual(Editing.highlightRanges(ranges, total: 1_000, selected: [9]).count, 0)   // índice que ya no existe
        XCTAssertTrue(Editing.highlightRanges(ranges, total: 0, selected: [0]).isEmpty)
    }

    func testSelectionPreviewPlan() {
        let ranges: [Range<Int>] = [0..<100, 100..<250, 250..<400]
        let seg = Editing.previewSegments(ranges, selected: [2, 0], rate: 1_000, gap: 0.1)
        XCTAssertEqual(seg.map(\.index), [0, 2])                                   // en su orden original, no en el de elección
        XCTAssertEqual(seg.map(\.start), [0, 200]); XCTAssertEqual(seg.map(\.end), [100, 350])   // con un hueco entre ellos
        let x = [Float](repeating: 0.5, count: 400)
        let a = Editing.previewAudio(x, ranges: ranges, selected: [2, 0], rate: 1_000, gap: 0.1)
        XCTAssertEqual(a.count, 350)                                                // sin hueco al final
        XCTAssertEqual(a[150], 0); XCTAssertEqual(a[199], 0)                        // el hueco es silencio
        XCTAssertEqual(a[50], 0.5); XCTAssertEqual(a[275], 0.5)                     // cada corte en su sitio
        XCTAssertEqual(a[0], 0); XCTAssertEqual(a[349], 0)                          // fundido en los extremos
        XCTAssertTrue(Editing.previewAudio(x, ranges: ranges, selected: [], rate: 1_000).isEmpty)
        XCTAssertTrue(Editing.previewSegments(ranges, selected: [9], rate: 1_000).isEmpty)       // índice que ya no existe
    }

    // MARK: limpieza de ruido

    private func noisyTake(rate: Int = 48000, seconds: Int = 5) -> [Float] {
        var seed: UInt32 = 3
        func rnd() -> Float { seed = seed &* 1664525 &+ 1013904223; return Float(seed) / 4294967296 - 0.5 }
        return (0..<(rate * seconds)).map { i in
            let t = Double(i) / Double(rate)
            let tone: Float = (t > 2 && t < 3) ? Float(0.4 * sin(2 * Double.pi * 880 * t)) : 0
            return 0.04 * rnd() + Float(0.03 * sin(2 * Double.pi * 60 * t)) + tone
        }
    }

    private func rmsDB(_ x: [Float], _ a: Double, _ b: Double, rate: Int = 48000) -> Float {
        let lo = Int((a * Double(rate)).rounded()), hi = Int((b * Double(rate)).rounded())
        var e: Float = 0
        for i in lo..<hi { e += x[i] * x[i] }
        return 20 * log10((e / Float(hi - lo)).squareRoot())
    }

    func testNoiseGateAndHighpass() {
        let x = noisyTake()
        let soft = NoiseReduction.clean(x, rate: 48000, level: .soft), strong = NoiseReduction.clean(x, rate: 48000, level: .strong)
        XCTAssertLessThan(rmsDB(soft, 3.5, 4.5), rmsDB(x, 3.5, 4.5) - 6)
        XCTAssertLessThan(rmsDB(strong, 3.5, 4.5), rmsDB(soft, 3.5, 4.5))
        XCTAssertEqual(rmsDB(strong, 2.2, 2.8), rmsDB(x, 2.2, 2.8), accuracy: 1)      // el sonido real queda igual
        XCTAssertEqual(NoiseReduction.clean(x, rate: 48000, level: .off), x)
        XCTAssertEqual(NoiseReduction.clean(x, rate: 48000, level: .strong).count, x.count)
    }

    func testSpectralDenoise() {
        var seed: UInt32 = 7
        func rnd() -> Float { seed = seed &* 1664525 &+ 1013904223; return Float(seed) / 4294967296 - 0.5 }
        let x: [Float] = (0..<240000).map { i in
            let t = Double(i) / 48000
            return 0.05 * rnd() + ((t > 2 && t < 3) ? Float(0.4 * sin(2 * Double.pi * 880 * t)) : 0)
        }
        guard let w = NoiseReduction.quietestWindow(x, rate: 48000) else { return XCTFail("debería haber una parte tranquila") }
        let y = NoiseReduction.denoise(x, noise: Array(x[w]))
        XCTAssertEqual(y.count, x.count)
        XCTAssertLessThan(rmsDB(y, 3.5, 4.5), rmsDB(x, 3.5, 4.5) - 8)
        XCTAssertEqual(rmsDB(y, 2.2, 2.8), rmsDB(x, 2.2, 2.8), accuracy: 1)
        // una señal pareja no tiene parte tranquila, y con ruido nulo la resta no cambia nada
        let flat: [Float] = (0..<144000).map { 0.3 * Float(sin(Double($0) * 0.1)) }
        XCTAssertNil(NoiseReduction.quietestWindow(flat, rate: 48000))
        let same = NoiseReduction.denoise(flat, noise: [Float](repeating: 0, count: 48000))
        XCTAssertEqual(zip(same, flat).map { abs($0 - $1) }.max() ?? 1, 0, accuracy: 1e-5)
    }

    func testQuickSaveDenoiseTrimsNoise() {
        let x = noisyTake()
        var s = QuickSave.Settings(); s.normalize = false; s.fades = false
        let plain = QuickSave.process(x, rate: 48000, s)
        s.denoise = .strong
        let clean = QuickSave.process(x, rate: 48000, s)
        XCTAssertLessThan(clean.count, plain.count / 2)
        XCTAssertGreaterThan(clean.count, 43200)
    }

    // MARK: armonizar y unir

    private func hit(_ amp: Float, rate: Int = 48000) -> [Float] {
        (0..<(rate / 4)).map { amp * Float(sin(Double($0) * 0.2) * exp(-Double($0) / 4000)) }
    }

    func testHarmonizeCentersAndSoftensEdges() {
        let rate = 48000
        let a: [Float] = (0..<(rate / 2)).map { 0.5 * Float(sin(2 * Double.pi * 300 * Double($0) / Double(rate))) + 0.1 }
        let h = Harmonize.harmonize(a, rate: rate)
        XCTAssertEqual(h.count, a.count)
        XCTAssertLessThan(abs(h[0]), 1e-3)
        XCTAssertLessThan(abs(h[h.count - 1]), 1e-3)
        XCTAssertLessThan(abs(h.reduce(0, +) / Float(h.count)), 1e-3)
        XCTAssertGreaterThan(Double(Harmonize.endFadeSamples(Harmonize.removeDC(a), rate: rate)) / Double(rate) * 1000, 20)   // cortada en pleno sonido
        let tail: [Float] = (0..<(rate / 2)).map { 0.5 * Float(sin(Double($0) * 0.04) * exp(-Double($0) / 3000)) }
        XCTAssertLessThan(Double(Harmonize.endFadeSamples(tail, rate: rate)) / Double(rate) * 1000, 5)                     // ya acaba suave
    }

    func testJoinMatchesLevelAndHasNoJumps() {
        let rate = 48000
        let soft: [Float] = (0..<(rate / 4)).map { 0.3 * Float(sin(Double($0) * 0.05)) * min(1, Float($0) / 3000) }
        let j = Harmonize.join([hit(0.8), hit(0.2), soft], rate: rate)
        XCTAssertGreaterThan(j.count, 36000 - 1500); XCTAssertLessThanOrEqual(j.count, 36000)
        XCTAssertLessThan(j.map(abs).max() ?? 1, 0.99)
        var jump: Float = 0
        for i in 1..<j.count { jump = max(jump, abs(j[i] - j[i - 1])) }
        XCTAssertLessThan(jump, 0.2)
        XCTAssertEqual(Harmonize.join([hit(0.8), hit(0.2)], rate: rate, match: false).count, 24000)
        XCTAssertGreaterThan(j[12000..<12400].map(abs).max() ?? 0, 0.1)                       // el golpe que entra conserva su ataque
        XCTAssertTrue(Harmonize.join([], rate: rate).isEmpty)
        XCTAssertEqual(Harmonize.join([hit(0.5)], rate: rate).count, 12000)
        XCTAssertGreaterThan(20 * log10(Harmonize.activeRMS(hit(0.8), rate: rate)) - 20 * log10(Harmonize.activeRMS(hit(0.2), rate: rate)), 10)
    }

    // MARK: acordes, compases y loop

    /// Am F C G en 4/4 a 100 BPM, 10 compases, con 0,37 s de silencio previo y un bombo en cada tiempo (más fuerte en el 1).
    /// `hatBars`: compases con otro groove (hi-hat en semicorcheas y sin bombo).
    private func progression(sequence: [Int]? = nil, bars: Int = 10, hatBars: Range<Int> = 0..<0) -> (x: [Float], rate: Int) {
        let rate = 48000, T = Double(rate) * 60 / 100, off = Int(Double(rate) * 0.37)
        let n = Int(T * 4 * Double(bars)) + off
        let chords: [[Double]] = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [51, 55, 58]]       // Am F C G Eb
        var x = [Float](repeating: 0, count: n)
        for b in 0..<bars {
            for i in 0..<Int(4 * T) {
                let t = off + b * Int(4 * T) + i
                if t >= n { break }
                var s = 0.0
                for m in chords[sequence?[b] ?? b % 4] {
                    let w = 2 * Double.pi * 440 * pow(2, (m - 69) / 12) * Double(i) / Double(rate)
                    s += 0.12 * sin(w) + 0.05 * sin(2 * w)
                }
                x[t] += Float(s)
            }
        }
        var seed: UInt32 = 5
        func rnd() -> Double { seed = seed &* 1664525 &+ 1013904223; return Double(seed) / 4294967296.0 - 0.5 }
        for j in 0..<(bars * 4) {
            let t0 = Int((Double(off) + Double(j) * T).rounded())
            if hatBars.contains(j / 4) {
                for q in 0..<4 {
                    let t1 = Int((Double(t0) + Double(q) * T / 4).rounded())
                    for i in 0..<900 where t1 + i < n { x[t1 + i] += Float(0.35 * rnd() * exp(-Double(i) / 200)) }
                }
            } else {
                for i in 0..<3000 where t0 + i < n {
                    x[t0 + i] += Float((j % 4 == 0 ? 0.9 : 0.5) * sin(2 * Double.pi * 60 * Double(i) / Double(rate)) * exp(-Double(i) / 600))
                }
            }
        }
        return (x, rate)
    }

    func testChordMatching() {
        XCTAssertEqual(Harmony.matchChord([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0])?.name, "C")
        XCTAssertEqual(Harmony.matchChord([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0])?.name, "Cm")
        XCTAssertNil(Harmony.matchChord([Double](repeating: 0, count: 12)))
    }

    func testBarsChordsAndLoop() throws {
        let (x, rate) = progression()
        let a = try XCTUnwrap(Harmony.analyze(x, rate: rate, bpm: 100))
        XCTAssertEqual(a.bpm, 100, accuracy: 0.5)
        XCTAssertEqual(a.first / Double(rate), 0.37, accuracy: 0.02)
        XCTAssertEqual(a.downbeat, 0)
        XCTAssertEqual(a.bars.count, 10)
        XCTAssertEqual(a.bars.prefix(8).map(\.label), ["Am", "F", "C", "G", "Am", "F", "C", "G"])
        let lp = try XCTUnwrap(a.loop)
        XCTAssertEqual(lp.bars, 4)
        XCTAssertEqual(Set(lp.chords), Set(["Am", "F", "C", "G"]))
        XCTAssertEqual(Harmony.makeLoop(x, start: lp.start, end: lp.end, rate: rate).count, lp.end - lp.start)
        // mover el 1 un tiempo cambia los compases
        XCTAssertNotEqual(Harmony.layout(a, downbeat: a.downbeat + 1).bars.prefix(3).map(\.label), Array(a.bars.prefix(3).map(\.label)))
        // sin pulso claro (un tono fijo) o con una toma muy corta, no hay análisis
        let flat: [Float] = (0..<(rate * 6)).map { 0.3 * Float(sin(Double($0) * 0.05)) }
        XCTAssertNil(Harmony.analyze(flat, rate: rate))
        XCTAssertNil(Harmony.analyze(Array(x.prefix(rate * 2)), rate: rate, bpm: 100))
    }

    func testLoopByBarsAlternativesAndFixedBpm() throws {
        let (x, rate) = progression()
        let a = try XCTUnwrap(Harmony.analyze(x, rate: rate, bpm: 100))
        func lay(_ n: Int) -> Harmony.Analysis { Harmony.layout(a, downbeat: a.downbeat, want: n) }
        XCTAssertEqual([2, 4, 8, 16].map { lay($0).loop?.bars }, [2, 4, 8, 4])      // 16 no cabe en 10 compases
        let l4 = lay(4), l2 = lay(2)
        XCTAssertGreaterThanOrEqual(l4.loops.count, 1)
        for (i, p) in l2.loops.enumerated() { for q in l2.loops.dropFirst(i + 1) { XCTAssertGreaterThanOrEqual(abs(p.bar - q.bar), 2) } }
        XCTAssertEqual(l4.loops.map(\.score), l4.loops.map(\.score).sorted(by: >))
        let lp = try XCTUnwrap(l4.loop)
        // BPM fijo: dura justo compases × 4 × 60 / BPM
        XCTAssertEqual(Harmony.makeLoop(x, start: lp.start, end: lp.end, rate: rate, fix: (100, 4)).count, 460800)
        XCTAssertEqual(Harmony.makeLoop(x, start: lp.start, end: lp.end, rate: rate, fix: (98, 4)).count, Harmony.loopLength(rate: rate, bpm: 98, bars: 4))
        // 60 BPM exigiría estirar un 67 %: se deja sin fijar
        XCTAssertEqual(Harmony.makeLoop(x, start: lp.start, end: lp.end, rate: rate, fix: (60, 4)).count, lp.end - lp.start)
        XCTAssertEqual([Harmony.fixedBpm(99.6), Harmony.fixedBpm(100.4), Harmony.fixedBpm(0.2)], [100, 100, 1])
        XCTAssertEqual(Harmony.stretchPct(1000, 1010), 1, accuracy: 1e-9)
        let ramp = (0..<1000).map { Float($0) / 1000 }, r2 = Harmony.fitLength(ramp, 1500)
        XCTAssertEqual(r2.count, 1500); XCTAssertEqual(r2[0], 0); XCTAssertEqual(r2[750], 0.5, accuracy: 0.01)
        XCTAssertEqual(Harmony.fitLength(ramp, 1000)[500], 0.5, accuracy: 1e-6)
    }

    func testCombinedLoopSkipsTheWrongBar() throws {
        // Am F Eb G Am F C G Am F C G: el tercer compás es un acorde «equivocado»; el C bueno está en el compás 7
        let (x, rate) = progression(sequence: [0, 1, 4, 3, 0, 1, 2, 3, 0, 1, 2, 3], bars: 12)
        let a = try XCTUnwrap(Harmony.analyze(x, rate: rate, bpm: 100))
        XCTAssertEqual(Array(a.bars.prefix(4).map(\.label)), ["Am", "F", "D#", "G"])
        let l = Harmony.layout(a, downbeat: a.downbeat, want: 4)
        let c = try XCTUnwrap(l.combos.first)
        XCTAssertEqual(c.chords, ["Am", "F", "C", "G"])
        XCTAssertFalse(c.picks.contains(2))                                              // se salta el compás equivocado
        XCTAssertGreaterThan(c.picks[3] - c.picks[0], 3)                                 // no es un tramo seguido
        XCTAssertEqual(Set(l.combos.map(\.key)).count, l.combos.count)                  // progresiones distintas
        XCTAssertFalse(l.combos.contains { $0.picks.last! - $0.picks.first! == $0.picks.count - 1 })
        let fixed = Harmony.makeCombo(x, ranges: c.ranges, rate: rate, fix: (100, 4))
        XCTAssertEqual(fixed.count, Harmony.loopLength(rate: rate, bpm: 100, bars: 4))
        let free = Harmony.makeCombo(x, ranges: c.ranges, rate: rate)
        XCTAssertLessThanOrEqual(free.count, c.len); XCTAssertGreaterThan(free.count, c.len - 12 * 48 * 4)
        XCTAssertLessThan(fixed.prefix(40).map { abs($0) }.max() ?? 1, 0.05)               // entra suave
        XCTAssertTrue(Harmony.suggestCombos(a, Array(a.bars.prefix(2)), want: 4, count: 3).isEmpty)
        XCTAssertTrue(Harmony.layout(a, downbeat: a.downbeat, want: 2).combos.allSatisfy { $0.bars == 2 })
    }

    func testHistoryIsCappedAndKeepsTheOriginal() {
        var undo: [[Float]] = (0..<30).map { [Float($0)] }, labels = (0..<30).map { "c\($0)" }
        Editing.trimHistory(&undo, &labels)
        XCTAssertEqual(undo.count, Editing.historyMaxSteps); XCTAssertEqual(labels.count, Editing.historyMaxSteps)
        XCTAssertEqual(undo.first, [0]); XCTAssertEqual(undo.last, [29]); XCTAssertEqual(labels.last, "c29")
        var few: [[Float]] = [[1], [2]], fewL = ["a", "b"]
        Editing.trimHistory(&few, &fewL)
        XCTAssertEqual(few.count, 2)
    }

    func testComboCostPrefersSameGrooveAndBalance() throws {
        let (x, rate) = progression(sequence: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3], bars: 12, hatBars: 4..<8)
        let a = try XCTUnwrap(Harmony.analyze(x, rate: rate, bpm: 100))
        let l = Harmony.layout(a, downbeat: a.downbeat, want: 4)
        func sc(_ p: [Int]) -> Double { Harmony.scoreCombo(a, l.bars, picks: p) }
        XCTAssertGreaterThan(sc([0, 1, 2, 3]), sc([0, 5, 2, 3]) + 0.05)          // un F con otro ritmo puntúa peor que el F con bombo
        XCTAssertGreaterThan(sc([0, 1, 2, 3]), sc([0, 1, 6, 3]) + 0.05)
        XCTAssertEqual(l.bars[0].bal.count, 3); XCTAssertEqual(l.bars[0].rhy.count, 16)
        XCTAssertGreaterThan(abs(l.bars[1].bal[0] - l.bars[5].bal[0]), 0.03)     // mismo acorde, otro reparto de graves
        let best = try XCTUnwrap(l.combos.first)
        XCTAssertEqual(best.chords, ["Am", "F", "C", "G"]); XCTAssertTrue(best.picks.allSatisfy { $0 < 4 || $0 >= 8 })
    }

    func testPatternsFindPeriodAndIgnoreOddBar() throws {
        let (x, rate) = progression(bars: 10)
        let a = try XCTUnwrap(Harmony.analyze(x, rate: rate, bpm: 100))
        let best = try XCTUnwrap(a.bestPattern)
        XCTAssertEqual(best.period, 4); XCTAssertEqual(a.patterns.map(\.period), [1, 2, 3, 4])
        XCTAssertEqual(a.patterns[3].chords, ["Am", "F", "C", "G"]); XCTAssertEqual(a.patterns[0].chords.count, 1)
        XCTAssertGreaterThan(a.patterns[3].strength, a.patterns[0].strength + 0.05)
        XCTAssertGreaterThan(a.patterns[3].strength, a.patterns[1].strength + 0.05)
        XCTAssertGreaterThanOrEqual(best.repeats, 2)
        // Am F Eb G Am F C G Am F C G: el Eb queda fuera, manda el compás típico de cada posición
        let (y, r2) = progression(sequence: [0, 1, 4, 3, 0, 1, 2, 3, 0, 1, 2, 3], bars: 12)
        let e = try XCTUnwrap(Harmony.analyze(y, rate: r2, bpm: 100))
        XCTAssertEqual(e.bestPattern?.period, 4); XCTAssertEqual(e.patterns[3].chords, ["Am", "F", "C", "G"]); XCTAssertFalse(e.patterns[3].picks.contains(2))
        XCTAssertEqual(Harmony.mergeRanges([0..<10, 10..<20, 30..<40]), [0..<20, 30..<40])
        XCTAssertNil(Harmony.detectPatterns(a, Array(a.bars.prefix(1))).best)
    }

    func testStylesBuildArrangementsAndPump() throws {
        let (x, rate) = progression(sequence: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3], bars: 12, hatBars: 4..<8)
        let a = try XCTUnwrap(Harmony.analyze(x, rate: rate, bpm: 100))
        let dp = Harmony.layout(a, downbeat: a.downbeat, want: Harmony.Style.daftpunk.want, style: .daftpunk)
        let ce = Harmony.layout(a, downbeat: a.downbeat, want: Harmony.Style.cerati.want, style: .cerati)
        let li = Harmony.layout(a, downbeat: a.downbeat, want: 4, style: .libre)
        XCTAssertEqual(dp.arranged.map(\.name), ["A A A B", "A A B B"])
        let d = dp.arranged[0].picks
        XCTAssertEqual(d.count, 4); XCTAssertEqual(Array(d[0..<3]), [d[0], d[0], d[0]]); XCTAssertNotEqual(d[3], d[0])
        XCTAssertNotEqual(dp.bars[d[0]].rhy, dp.bars[d[3]].rhy)
        XCTAssertTrue(dp.combos.allSatisfy { $0.bars == 2 }); XCTAssertTrue(ce.combos.allSatisfy { $0.bars == 4 })
        let c = try XCTUnwrap(ce.arranged.first)
        XCTAssertEqual(c.name, "A B A C"); XCTAssertEqual(c.picks[0], c.picks[2]); XCTAssertEqual(Set([c.picks[0], c.picks[1], c.picks[3]]).count, 3)
        XCTAssertTrue(li.arranged.isEmpty); XCTAssertEqual(li.combos.first?.bars, 4)
        let env = Harmony.pump([Float](repeating: 1, count: 48_000), rate: 48_000, bpm: 120, depth: 0.6)
        XCTAssertEqual(Double(env[0]), 0.4, accuracy: 0.01); XCTAssertGreaterThan(env[12_000], 0.95); XCTAssertGreaterThan(env[23_999], 0.95); XCTAssertEqual(Double(env[24_000]), 0.4, accuracy: 0.01)
        let fixed = Harmony.makeCombo(x, ranges: dp.arranged[0].ranges, rate: rate, fix: (bpm: 100, bars: 4), crossfadeMs: 4)
        XCTAssertEqual(fixed.count, Harmony.loopLength(rate: rate, bpm: 100, bars: 4))
    }

    func testGridRendersExactLengthAndEditsCells() {
        let rate = 48_000
        let chops: [[Float]] = [[Float](repeating: 0.5, count: 20_000), [Float](repeating: -0.25, count: 100_000)]
        var cells = GridSeq.emptyCells(bars: 2, steps: 8)
        cells[0] = 0; cells[4] = 1; cells[8] = 0
        let out = GridSeq.renderGrid(chops, cells: cells, bars: 2, bpm: 120, rate: rate)
        let total = 2 * 4 * 60 * rate / 120, paso = Double(total) / 16
        XCTAssertEqual(out.count, total)
        XCTAssertEqual(Double(out[100]), 0.5, accuracy: 0.1)
        XCTAssertEqual(out[Int(paso * 3)], 0)                                   // el corte corto deja silencio hasta la siguiente casilla
        XCTAssertEqual(Double(out[Int(paso * 4) + 500]), -0.25, accuracy: 0.1)
        XCTAssertLessThan(abs(out[Int(paso * 8) - 1000]), 0.3)                  // el largo se corta donde entra el siguiente
        XCTAssertEqual(Double(out[Int(paso * 8) + 100]), 0.5, accuracy: 0.1)
        let clip = GridSeq.copyCells(cells, [0, 4])
        XCTAssertEqual(clip?.items, [GridSeq.Clip.Item(offset: 0, cell: 0), GridSeq.Clip.Item(offset: 4, cell: 1)])
        let pegada = GridSeq.pasteCells(cells, clip, at: 10), limite = GridSeq.pasteCells(cells, clip, at: 14)
        XCTAssertEqual(pegada[10], 0); XCTAssertEqual(pegada[14], 1); XCTAssertEqual(pegada[0], 0)
        XCTAssertEqual(limite[14], 0); XCTAssertNil(limite[15]); XCTAssertEqual(limite.count, 16)       // lo que se sale se descarta
        let corte = GridSeq.clearCells(cells, [4])
        XCTAssertNil(corte[4]); XCTAssertEqual(corte[0], 0)
        let gr = GridSeq.resizeCells(cells, bars: 2, steps: 16, oldBars: 2, oldSteps: 8)
        XCTAssertEqual(gr[0], 0); XCTAssertEqual(gr[8], 1); XCTAssertEqual(gr[16], 0)
        XCTAssertEqual(GridSeq.resizeCells(cells, bars: 1, steps: 8, oldBars: 2, oldSteps: 8).count, 8)
        XCTAssertNil(GridSeq.copyCells(cells, []))
    }

    func testScratchMovesTheNeedleLikeAVinyl() {
        let rate = 48_000
        let x = (0..<(rate * 2)).map { Float(0.5 * sin(2 * Double.pi * 440 * Double($0) / Double(rate))) }
        func zc(_ y: [Float], _ a: Int, _ b: Int) -> Double { var c = 0; for i in (a + 1)..<b where y[i - 1] < 0 && y[i] >= 0 { c += 1 }; return Double(c) / (Double(b - a) / Double(rate)) }
        func rms(_ y: [Float], _ a: Int, _ b: Int) -> Double { (y[a..<b].reduce(0.0) { $0 + Double($1) * Double($1) } / Double(b - a)).squareRoot() }
        let beat = Int((60.0 * Double(rate) / 120).rounded())
        func go(_ k: Scratch.Kind, depth: Double = 0.8) -> [Float] { Scratch.scratch(x, from: 0, to: x.count, rate: rate, kind: k, bpm: 120, beats: 4, depth: depth) }
        let baby = go(.baby), chirp = go(.chirp), tape = go(.tape), stut = go(.stutter)
        XCTAssertEqual([baby.count, chirp.count, tape.count, stut.count], [4 * beat, 4 * beat, 4 * beat, 4 * beat])
        let tonos = (0..<8).map { zc(baby, $0 * beat / 8, ($0 + 1) * beat / 8) }
        XCTAssertGreaterThan(tonos.max()!, tonos.min()! * 2)                      // el tono sube y baja con la velocidad de la aguja
        XCTAssertGreaterThan(rms(chirp, beat / 10, beat * 4 / 10), 0.1); XCTAssertLessThan(rms(chirp, beat * 6 / 10, beat * 9 / 10), 0.01)
        XCTAssertLessThan(zc(tape, beat * 3, beat * 38 / 10), zc(tape, 0, beat / 2) * 0.7)       // el plato se frena: el tono cae
        let q = beat / 4
        XCTAssertGreaterThan(rms(stut, q / 10, q * 6 / 10), 0.1); XCTAssertLessThan(rms(stut, q * 8 / 10, q * 97 / 100), 0.01)
        XCTAssertTrue(Scratch.scratch(x, from: 0, to: 500, rate: rate).isEmpty)
        XCTAssertEqual(Scratch.scratch(x, from: 1000, to: 30000, rate: rate, kind: .baby, bpm: 120, beats: 4).count, 4 * beat)
    }

    func testLevelingEqualizesTypicalLevelAndRespectsCeiling() {
        let rate = 48_000
        let pad = (0..<(rate * 3)).map { Float(0.5 * sin(2 * Double.pi * 220 * Double($0) / Double(rate))) }
        var golpe = [Float](repeating: 0, count: rate * 3)
        for i in 0..<4000 { golpe[i] = Float(0.9 * sin(2 * Double.pi * 120 * Double(i) / Double(rate)) * exp(-Double(i) / 700)) }
        let suave = (0..<(rate * 2)).map { Float(0.02 * sin(2 * Double.pi * 330 * Double($0) / Double(rate))) }
        let a = Level.levelTo(pad, rate: rate), b = Level.levelTo(golpe, rate: rate), c = Level.levelTo(suave, rate: rate)
        XCTAssertEqual(a.afterDB, Level.defaultTargetDB, accuracy: 0.6); XCTAssertEqual(c.afterDB, Level.defaultTargetDB, accuracy: 0.6)
        XCTAssertGreaterThan(b.afterDB, Level.defaultTargetDB - 10); XCTAssertLessThanOrEqual(b.afterDB, a.afterDB + 1)
        let ceil = Float(pow(10, Level.ceilingDB / 20))
        for r in [a, b, c] { XCTAssertLessThanOrEqual(r.audio.map { abs($0) }.max() ?? 0, ceil + 1e-3) }
        XCTAssertFalse(a.limited); XCTAssertFalse(c.limited); XCTAssertTrue(b.audio.allSatisfy { $0.isFinite })
        XCTAssertEqual(Level.levelTo([Float](repeating: 0, count: 1000), rate: rate).gainDB, 0)
        XCTAssertEqual(Level.levelTo(pad, rate: rate, targetDB: -30).afterDB, -30, accuracy: 0.6)
        XCTAssertEqual(Level.Kind.allCases.map(\.rawValue), ["libre", "textura", "bajo", "bateria"])
        XCTAssertEqual(QuickSave.autoName(count: 2, prefix: "textura"), "textura_003")
    }

    func testFixedBpmKeepsPitchWithWsola() {
        let rate = 48_000
        let x = (0..<(rate * 4)).map { Float(0.5 * sin(2 * Double.pi * 440 * Double($0) / Double(rate))) }
        func zc(_ y: [Float]) -> Double { var c = 0; for i in 1..<y.count where y[i - 1] < 0 && y[i] >= 0 { c += 1 }; return Double(c) / (Double(y.count) / Double(rate)) }
        func rms(_ y: [Float]) -> Double { (y.reduce(0.0) { $0 + Double($1) * Double($1) } / Double(y.count)).squareRoot() }
        for pct in [-6.0, -2.0, 2.0, 6.0] {
            let n = Int((Double(x.count) * (1 + pct / 100)).rounded())
            let w = Harmony.wsolaStretch(x, n, rate: rate), q = Harmony.fitLength(x, n)
            XCTAssertEqual(w.count, n)
            XCTAssertEqual(zc(w), 440, accuracy: 2)                               // el tono no cambia
            XCTAssertEqual(rms(w) / rms(x), 1, accuracy: 0.05)
            var jump: Float = 0
            for i in 1..<w.count { jump = max(jump, abs(w[i] - w[i - 1])) }
            XCTAssertLessThan(jump, 0.1)
            if pct == 6 { XCTAssertGreaterThan(abs(zc(q) - 440), 15) }            // remuestrear a +6 % desafina más de un semitono
        }
        let n2 = Int((Double(x.count) * 1.003).rounded()), t = Harmony.fitTempo(x, n2, rate: rate)
        XCTAssertEqual(t.count, n2); XCTAssertEqual(zc(t), 440, accuracy: 2)
        XCTAssertEqual(Harmony.wsolaStretch([Float](repeating: 0.1, count: 100), 150, rate: rate).count, 150)
        XCTAssertEqual(Harmony.wsolaStretch(x, x.count, rate: rate).count, x.count)
    }

    // MARK: invertir

    func testReverse() {
        XCTAssertEqual(Creative.reverseRange([1, 2, 3, 4, 5], from: 1, to: 4), [1, 4, 3, 2, 5])
        XCTAssertEqual(Creative.reverseRange(Creative.reverseRange([1, 2, 3, 4, 5])), [1, 2, 3, 4, 5])
        XCTAssertEqual(Creative.reverseRange([1, 2, 3], from: -5, to: 99), [3, 2, 1])
        XCTAssertTrue(Creative.reverseRange([]).isEmpty)
    }

    // MARK: colchón sostenido

    func testPadStretchKeepsPitchAndLevel() {
        let rate = 48000, n = rate * 2
        let x: [Float] = (0..<n).map { i in
            let t = Double(i) / Double(rate)
            return Float(0.4 * (sin(2 * Double.pi * 440 * t) + 0.4 * sin(2 * Double.pi * 880 * t)) * exp(-t * 2.5) * min(1, t * 50))
        }
        func rms(_ y: [Float], _ a: Int, _ b: Int) -> Double {
            var e = 0.0
            for i in a..<b { e += Double(y[i]) * Double(y[i]) }
            return (e / Double(b - a)).squareRoot()
        }
        let y = Creative.padStretch(x, factor: 8, rate: rate, sustain: true), flat = Creative.padStretch(x, factor: 8, rate: rate, sustain: false)
        XCTAssertEqual(y.count, n * 8)
        XCTAssertEqual(rms(y, 0, y.count) / rms(x, 0, n), 1, accuracy: 0.15)
        XCTAssertLessThan(y.map(abs).max() ?? 1, 0.99)
        XCTAssertEqual(Creative.padStretch(x, factor: 8, rate: rate, sustain: true), y)                  // determinista
        // el tono dominante sigue en ~440 Hz
        let N = 16384, st = y.count / 2
        var re = (0..<N).map { Double(y[st + $0]) * (0.5 - 0.5 * cos(2 * Double.pi * Double($0) / Double(N))) }, im = [Double](repeating: 0, count: N)
        NoiseReduction.fft(&re, &im, inverse: false)
        var bi = 1, bm = 0.0
        for k in 1..<(N / 2) { let m = (re[k] * re[k] + im[k] * im[k]).squareRoot(); if m > bm { bm = m; bi = k } }
        XCTAssertEqual(Double(bi) * Double(rate) / Double(N), 440, accuracy: 6)
        // «Sostener» deja el colchón más parejo: la caída entre el primer y el último cuarto es mucho menor
        func drop(_ v: [Float]) -> Double { rms(v, 0, v.count / 4) / rms(v, v.count * 3 / 4, v.count) }
        XCTAssertLessThan(drop(y), drop(flat) / 3)
        XCTAssertEqual(Creative.padStretch([Float](repeating: 0, count: 10), factor: 8, rate: rate).count, 10)
        XCTAssertEqual(Creative.padStretch(x, factor: 1, rate: rate), x)
    }

    // MARK: loop continuo sin pulso

    func testSeamlessLoop() {
        let rate = 48000, n = rate * 8
        let x: [Float] = (0..<n).map { i in
            let t = Double(i) / Double(rate)
            let s = sin(2 * Double.pi * 220 * t + 0.8 * sin(2 * Double.pi * 0.3 * t)) + 0.7 * sin(2 * Double.pi * 277.2 * t + 0.5 * sin(2 * Double.pi * 0.17 * t)) + 0.5 * sin(2 * Double.pi * 329.6 * t)
            return Float(0.25 * s * (0.8 + 0.2 * sin(2 * Double.pi * 0.23 * t)))
        }
        let a = rate, b = Int(Double(rate) * 6.3)
        let crudo = Array(x[a..<b]), afinado = Creative.loopSeamless(x, from: a, to: b, rate: rate, crossSec: 1, refine: true)
        let sinAfinar = Creative.loopSeamless(x, from: a, to: b, rate: rate, crossSec: 1, refine: false)
        XCTAssertGreaterThan(Creative.seamJump(crudo), 10)
        XCTAssertLessThan(Creative.seamJump(afinado), 2.5)
        XCTAssertLessThan(Creative.seamJump(sinAfinar), 6)
        XCTAssertEqual(sinAfinar.count, b - a - rate)
        XCTAssertGreaterThan(afinado.count, rate * 2)
        XCTAssertLessThan(afinado.map(abs).max() ?? 9, 1)
        // un seno estacionario conserva su nivel en el empalme (el afinado alinea las fases)
        let seno: [Float] = (0..<n).map { 0.4 * Float(sin(2 * Double.pi * 220.37 * Double($0) / Double(rate))) }
        let l = Creative.loopSeamless(seno, from: a, to: b, rate: rate, crossSec: 1, refine: true)
        func rms(_ v: ArraySlice<Float>) -> Double { (v.reduce(0.0) { $0 + Double($1) * Double($1) } / Double(v.count)).squareRoot() }
        XCTAssertEqual(rms(l[0..<rate]) / rms(l[rate...]), 1, accuracy: 0.07)
        // tramo muy corto o fuera de rango: no hace nada
        XCTAssertEqual(Creative.loopSeamless(x, from: 0, to: 1000, rate: rate), x)
    }
}

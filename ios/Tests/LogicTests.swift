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
        XCTAssertEqual(Exporter.fileName(for: s), "007_Mi_bombo_.wav")
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
}

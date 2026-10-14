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
        let x = [Float](repeating: 0, count: 2_000) + [Float](repeating: 0.5, count: 4_000) + [Float](repeating: 0, count: 2_000)
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
}

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
        XCTAssertEqual(Editing.nearestZeroCross(x, to: 4), 2)
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
}

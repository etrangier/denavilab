import Foundation

enum WavIO {
    /// WAV PCM mono 16-bit little-endian.
    static func encode(_ samples: [Float], sampleRate: Int) -> Data {
        var d = Data()
        func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
        let bytes = UInt32(samples.count * 2)
        d.append("RIFF".data(using: .ascii)!); u32(36 + bytes)
        d.append("WAVE".data(using: .ascii)!)
        d.append("fmt ".data(using: .ascii)!); u32(16); u16(1); u16(1)
        u32(UInt32(sampleRate)); u32(UInt32(sampleRate * 2)); u16(2); u16(16)
        d.append("data".data(using: .ascii)!); u32(bytes)
        for s in samples {
            let v = Int16(max(-1, min(1, s)) * 32767)
            u16(UInt16(bitPattern: v))
        }
        return d
    }

    /// Decodifica WAV PCM 16-bit mono (el que produce `encode`).
    static func decode(_ data: Data) -> (samples: [Float], sampleRate: Int)? {
        guard data.count > 44, String(data: data[0..<4], encoding: .ascii) == "RIFF" else { return nil }
        let rate = data[24..<28].withUnsafeBytes { Int(UInt32(littleEndian: $0.loadUnaligned(as: UInt32.self))) }
        var out = [Float](); out.reserveCapacity((data.count - 44) / 2)
        var i = 44
        while i + 1 < data.count {
            let v = Int16(bitPattern: UInt16(data[i]) | UInt16(data[i + 1]) << 8)
            out.append(Float(v) / 32767); i += 2
        }
        return (out, rate)
    }

    /// Remuestreo lineal simple. Objetivo del K.O. II: 46 875 Hz (por confirmar).
    static func resample(_ x: [Float], from: Int, to: Int) -> [Float] {
        guard from != to, x.count > 1 else { return x }
        let n = Int(Double(x.count) * Double(to) / Double(from))
        let r = Double(from) / Double(to)
        return (0..<n).map { i in
            let p = Double(i) * r
            let k = min(Int(p), x.count - 2)
            let f = Float(p - Double(k))
            return x[k] * (1 - f) + x[k + 1] * f
        }
    }
}

import Foundation

/// ZIP mínimo sin compresión (los WAV ya vienen sin comprimir): sirve para el respaldo y la exportación por lotes.
enum Zip {
    struct Entry { var name: String; var data: Data }
    enum ZipError: Error, LocalizedError {
        case invalid, unsupported
        var errorDescription: String? {
            switch self {
            case .invalid: return "el archivo está dañado o no es un .zip"
            case .unsupported: return "el .zip usa compresión, que esta versión no lee"
            }
        }
    }

    private static let table: [UInt32] = (0..<256).map { n -> UInt32 in
        var c = UInt32(n)
        for _ in 0..<8 { c = (c & 1) != 0 ? (0xEDB88320 ^ (c >> 1)) : (c >> 1) }
        return c
    }

    static func crc32(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xFFFFFFFF
        for b in data { c = table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        return c ^ 0xFFFFFFFF
    }

    private static func put16(_ d: inout Data, _ v: UInt16) { d.append(UInt8(v & 0xFF)); d.append(UInt8(v >> 8)) }
    private static func put32(_ d: inout Data, _ v: UInt32) { for k in 0..<4 { d.append(UInt8((v >> (8 * UInt32(k))) & 0xFF)) } }

    static func make(_ entries: [Entry]) -> Data {
        var out = Data(), central = Data()
        for e in entries {
            let name = Data(e.name.utf8), crc = crc32(e.data), size = UInt32(e.data.count), offset = UInt32(out.count)
            put32(&out, 0x04034b50); put16(&out, 20); put16(&out, 0x0800); put16(&out, 0); put16(&out, 0); put16(&out, 0)
            put32(&out, crc); put32(&out, size); put32(&out, size); put16(&out, UInt16(name.count)); put16(&out, 0)
            out.append(name); out.append(e.data)
            put32(&central, 0x02014b50); put16(&central, 20); put16(&central, 20); put16(&central, 0x0800); put16(&central, 0); put16(&central, 0); put16(&central, 0)
            put32(&central, crc); put32(&central, size); put32(&central, size); put16(&central, UInt16(name.count))
            put16(&central, 0); put16(&central, 0); put16(&central, 0); put16(&central, 0); put32(&central, 0); put32(&central, offset)
            central.append(name)
        }
        let cdOffset = UInt32(out.count)
        out.append(central)
        put32(&out, 0x06054b50); put16(&out, 0); put16(&out, 0)
        put16(&out, UInt16(entries.count)); put16(&out, UInt16(entries.count))
        put32(&out, UInt32(central.count)); put32(&out, cdOffset); put16(&out, 0)
        return out
    }

    static func read(_ data: Data) throws -> [Entry] {
        let b = [UInt8](data)
        func u16(_ i: Int) -> Int { Int(b[i]) | Int(b[i + 1]) << 8 }
        func u32(_ i: Int) -> Int { Int(b[i]) | Int(b[i + 1]) << 8 | Int(b[i + 2]) << 16 | Int(b[i + 3]) << 24 }
        guard b.count >= 22 else { throw ZipError.invalid }
        var eocd = -1, i = b.count - 22
        while i >= max(0, b.count - 22 - 65_535) { if u32(i) == 0x06054b50 { eocd = i; break }; i -= 1 }
        guard eocd >= 0 else { throw ZipError.invalid }
        let count = u16(eocd + 10)
        var p = u32(eocd + 16)
        var out: [Entry] = []
        for _ in 0..<count {
            guard p + 46 <= b.count, u32(p) == 0x02014b50 else { throw ZipError.invalid }
            let method = u16(p + 10), size = u32(p + 24), n = u16(p + 28), x = u16(p + 30), c = u16(p + 32), local = u32(p + 42)
            guard p + 46 + n <= b.count, local + 30 <= b.count, u32(local) == 0x04034b50 else { throw ZipError.invalid }
            guard method == 0 else { throw ZipError.unsupported }
            let name = String(decoding: b[(p + 46)..<(p + 46 + n)], as: UTF8.self)
            let start = local + 30 + u16(local + 26) + u16(local + 28)
            guard start + size <= b.count else { throw ZipError.invalid }
            out.append(Entry(name: name, data: Data(b[start..<(start + size)])))
            p += 46 + n + x + c
        }
        return out
    }
}

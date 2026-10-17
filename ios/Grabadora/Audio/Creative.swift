import Foundation

/// Herramientas creativas. Mismo algoritmo que `dsp.js` en la PWA.
enum Creative {
    /// Da la vuelta a un tramo [a, b) del audio (por defecto, todo).
    nonisolated static func reverseRange(_ x: [Float], from a: Int = 0, to b: Int? = nil) -> [Float] {
        let lo = max(0, min(a, x.count)), hi = max(lo, min(b ?? x.count, x.count))
        var y = x
        for i in 0..<(hi - lo) { y[lo + i] = x[hi - 1 - i] }
        return y
    }
}

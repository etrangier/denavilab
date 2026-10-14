import Foundation

/// Búfer circular mono en memoria para la captura retroactiva.
struct RingBuffer {
    private(set) var storage: [Float]
    private var head = 0
    private(set) var count = 0
    let capacity: Int

    init(capacity: Int) {
        self.capacity = max(1, capacity)
        storage = [Float](repeating: 0, count: self.capacity)
    }

    mutating func write(_ samples: [Float]) {
        for s in samples.suffix(capacity) {
            storage[head] = s
            head = (head + 1) % capacity
            count = min(count + 1, capacity)
        }
    }

    /// Últimas `n` muestras, de la más antigua a la más reciente.
    func last(_ n: Int) -> [Float] {
        let n = min(n, count)
        var out = [Float](); out.reserveCapacity(n)
        var i = (head - n + capacity) % capacity
        for _ in 0..<n { out.append(storage[i]); i = (i + 1) % capacity }
        return out
    }

    mutating func clear() { head = 0; count = 0 }
}

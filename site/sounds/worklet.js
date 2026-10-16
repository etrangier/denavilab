// Captura el micrófono en bloques de 2048 muestras y, si se pide, lo deja pasar a la salida (escucha en directo).
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048); this.n = 0; this.monitor = false;
    this.port.onmessage = e => { if (e.data && 'monitor' in e.data) this.monitor = !!e.data.monitor; };
  }
  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    if (input) {
      if (this.monitor && outputs[0] && outputs[0][0]) outputs[0][0].set(input);
      for (let i = 0; i < input.length; i++) {
        this.buf[this.n++] = input[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('capture', Capture);

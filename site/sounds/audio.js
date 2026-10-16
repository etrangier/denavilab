// Motor de captura: micrófono → búfer circular (captura retroactiva) + toma en curso.
import { RingBuffer } from './dsp.js';

export class Engine {
  constructor() {
    this.state = 'idle';            // idle | listening | recording
    this.rate = 48000;
    this.level = 0; this.clipped = false; this.liveWave = [];
    this.elapsed = 0; this.bufferedSeconds = 0; this.countInRemaining = 0;
    this.retroSeconds = 30; this.monitoring = false;
    this.micDenied = false; this.error = null;
    this.completed = null;          // toma terminada sola (límite de compases)
    this.onChange = () => {};
    this._take = []; this._takeLen = 0; this._total = 0; this._pendingStart = 0; this._max = null;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    });
  }

  /** Debe llamarse desde un gesto del usuario (iOS/Safari exigen que el audio nazca de un toque). */
  async start() {
    if (this.state !== 'idle' || this._starting) return;
    this._starting = true; this.error = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.ctx.resume().catch(() => {});
      // Sin cancelación de eco, supresión de ruido ni control automático de ganancia: es un sampler, no una llamada.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      this.micDenied = false;
      await this.ctx.audioWorklet.addModule('worklet.js');
      this.rate = this.ctx.sampleRate;
      this.ring = new RingBuffer(this.rate * 60);
      this.node = new AudioWorkletNode(this.ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.node.port.onmessage = e => this._ingest(e.data);
      this.ctx.createMediaStreamSource(this.stream).connect(this.node);
      this.node.connect(this.ctx.destination);   // silencioso salvo que se active la escucha
      this.stream.getAudioTracks().forEach(t => { t.onended = () => { this._teardown(); this.onChange(); }; });
      await this.ctx.resume();
      this.state = 'listening';
    } catch (e) {
      const name = e && e.name;
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') this.micDenied = true;
      else this.error = name === 'NotFoundError' ? 'No encuentro ningún micrófono.' : 'No se pudo iniciar el audio: ' + (e && e.message || e);
      await this._teardown();
    } finally { this._starting = false; this.onChange(); }
  }

  async stop() { await this._teardown(); this.onChange(); }

  async _teardown() {
    try { this.stream && this.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { this.node && this.node.disconnect(); } catch (e) {}
    try { this.ctx && this.ctx.state !== 'closed' && await this.ctx.close(); } catch (e) {}
    this.stream = this.node = this.ctx = null;
    this.state = 'idle'; this.level = 0; this.countInRemaining = 0; this._max = null;
  }

  /** Empieza la toma `afterSamples` muestras más tarde (cuenta de entrada) y, si se indica, la corta sola en `maxSamples`. */
  startRecording(afterSamples = 0, maxSamples = null) {
    this._take = []; this._takeLen = 0; this.elapsed = 0; this.clipped = false; this.completed = null;
    this._pendingStart = this._total + afterSamples; this._max = maxSamples;
    this.state = 'recording'; this.onChange();
  }

  stopRecording() {
    const out = this._concat();
    this.state = 'listening'; this._max = null; this.countInRemaining = 0;
    this._take = []; this._takeLen = 0;
    this.onChange();
    return out;
  }

  captureRetro(seconds = this.retroSeconds) { return this.ring ? this.ring.last(Math.floor(seconds * this.rate)) : new Float32Array(0); }
  lastSamples(n) { return this.ring ? this.ring.last(n) : new Float32Array(0); }

  setMonitoring(on) { this.monitoring = on; if (this.node) this.node.port.postMessage({ monitor: on }); this.onChange(); }

  _concat() {
    const out = new Float32Array(this._takeLen); let o = 0;
    for (const c of this._take) { out.set(c, o); o += c.length; }
    return out;
  }

  _ingest(s) {
    let peak = 0; for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (a > peak) peak = a; }
    this.ring.write(s);
    const base = this._total; this._total += s.length;
    this.bufferedSeconds = this.ring.count / this.rate;
    this.liveWave.push(peak); if (this.liveWave.length > 48) this.liveWave.shift();
    this.level = Math.max(peak, this.level * 0.85);
    if (peak >= 0.99) this.clipped = true;
    if (this.state !== 'recording') return;
    const skip = Math.max(0, this._pendingStart - base);
    this.countInRemaining = Math.max(0, (this._pendingStart - base) / this.rate);
    if (skip >= s.length) return;                       // sigue la cuenta de entrada
    const chunk = skip ? s.subarray(skip) : s;
    this._take.push(chunk.slice()); this._takeLen += chunk.length;
    this.elapsed = this._takeLen / this.rate;
    if (this._max != null && this._takeLen >= this._max) {
      const all = this._concat().subarray(0, this._max).slice();
      this._take = []; this._takeLen = 0; this._max = null; this.countInRemaining = 0;
      this.state = 'listening'; this.completed = all; this.onChange();
    }
  }
}

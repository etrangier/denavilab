// Metrónomo sobre el reloj de audio (no sobre setInterval), con acento en el tiempo 1 y aviso visual.
import { tapTempo } from './dsp.js';

const KEY = 'denavilab.sounds.metro';
const DEFAULTS = { mode: 'free', bpm: 120, beats: 4, bars: 4, countIn: true, flash: false };

export class Metronome {
  constructor() {
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
    Object.assign(this, DEFAULTS, saved);
    this.running = false; this.beat = 0; this.flashing = false; this.taps = [];
    this.onBeat = () => {};
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ mode: this.mode, bpm: this.bpm, beats: this.beats, bars: this.bars, countIn: this.countIn, flash: this.flash })); } catch (e) {} }
  set(k, v) { this[k] = v; this.save(); }

  /** Arranca sobre `ctx`; el primer clic suena 50 ms después. Devuelve la latencia de arranque en segundos. */
  start(ctx) {
    if (this.running) return 0.05;
    this.ctx = ctx; this.running = true; this.index = 0; this.next = ctx.currentTime + 0.05;
    this.timer = setInterval(() => this._schedule(), 25); this._schedule();
    return 0.05;
  }
  stop() { clearInterval(this.timer); this.running = false; this.flashing = false; this.onBeat(); }

  _schedule() {
    while (this.next < this.ctx.currentTime + 0.12) {
      const beat = this.index % this.beats;
      this._click(this.next, beat);
      this.index++; this.next += 60 / this.bpm;
    }
  }
  _click(time, beat) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), accent = beat === 0;
    o.frequency.value = accent ? 1800 : (this.beats === 6 && beat === 3 ? 1500 : 1200);
    g.gain.setValueAtTime(accent ? 0.9 : 0.6, time); g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    o.connect(g); g.connect(ctx.destination); o.start(time); o.stop(time + 0.04);
    setTimeout(() => {
      if (!this.running) return;
      this.beat = beat; this.flashing = true; this.onBeat();
      setTimeout(() => { this.flashing = false; this.onBeat(); }, 120);
    }, Math.max(0, (time - ctx.currentTime) * 1000));
  }

  tap() { const b = tapTempo(this.taps, performance.now() / 1000); if (b) this.set('bpm', Math.round(b)); }
}

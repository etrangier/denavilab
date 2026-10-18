// Los cálculos que pueden tardar, con nombre. Los usan el hilo aparte (dsp-worker.js) y, si el navegador no lo permite, el hilo principal.
export const OPS = {
  cleanNoise: (dsp, x, rate, level) => dsp.cleanNoise(x, rate, level),
  denoise: (dsp, x, noise, amount) => dsp.denoise(x, noise, amount),
  padStretch: (dsp, x, factor, rate, sustain) => dsp.padStretch(x, factor, rate, sustain),
  loopSeamless: (dsp, x, a, b, rate, cross, refine) => dsp.loopSeamless(x, a, b, rate, cross, refine),
};

// Efeitos sonoros sintetizados com WebAudio (sem assets).
let ctx = null, master = null, noiseBuf = null;

export function unlockAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function env(gain, t, attack, decay, peak) {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(f0, f1, dur, type = 'sine', peak = 0.2, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  env(g, t, 0.004, dur, peak);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur, freq, q, peak, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, 0.002, dur, peak);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
}

export const sfx = {
  break() { noise(0.14, 1300 + Math.random() * 900, 0.9, 0.7); tone(340 + Math.random() * 60, 110, 0.09, 'triangle', 0.28); },
  paint(on) { tone(on ? 620 : 540, on ? 900 : 380, 0.08, 'sine', 0.16); },
  blocked() { tone(210, 190, 0.07, 'square', 0.05); },
  error() { tone(170, 90, 0.3, 'sawtooth', 0.13); tone(116, 70, 0.32, 'square', 0.07); },
  ui() { tone(980, 1250, 0.045, 'sine', 0.1); },
  slice() { tone(720, 600, 0.05, 'triangle', 0.09); },
  win() {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, f * 1.003, 0.45, 'triangle', 0.16, i * 0.085));
    for (let i = 0; i < 8; i++) noise(0.08, 5000 + Math.random() * 3000, 4, 0.12, 0.5 + i * 0.06);
  },
};

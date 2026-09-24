/* clavis-clap-worklet.js — impulse detector for clap / snap activation.
   Runs on the audio thread, so it sees every sample (the old 32 ms
   analyser poll missed short claps) and keeps working when the window
   is in the background (timers there are throttled to once a second).

   A clap or snap is an impulse: energy jumps far above the room's
   background within a few ms and falls back to a tenth of its peak
   within ~80 ms. Speech never does that — even a hard "t" or "k" runs
   straight into a vowel — so the decay test is what keeps talking,
   typing bursts and music from counting. Pattern logic (double clap)
   lives on the main thread. */
class ClavisClapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blockLen = Math.max(1, Math.round(sampleRate * 0.005)); // 5 ms blocks
    this.acc = 0; this.n = 0; this.zc = 0; this.prev = 0; this.peak = 0;
    this.bg = 1e-5;          // slow background energy (mean square)
    this.t = 0;              // time in blocks
    this.inImpulse = false;
    this.onset = 0; this.maxE = 0; this.zcSum = 0; this.blocks = 0;
    this.refractory = 0;
    this.sens = 1;           // 0.7 = more sensitive, 1.4 = less
    this.port.onmessage = (e) => { if (e.data && e.data.sens) this.sens = e.data.sens; };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      this.acc += x * x;
      if ((x >= 0) !== (this.prev >= 0)) this.zc++;
      this.prev = x;
      const a = x < 0 ? -x : x;
      if (a > this.peak) this.peak = a;
      if (++this.n >= this.blockLen) {
        this.block(this.acc / this.n, this.zc / this.n, this.peak);
        this.acc = 0; this.n = 0; this.zc = 0; this.peak = 0;
      }
    }
    return true;
  }

  block(e, zcr, peak) {
    this.t++;
    if (!this.inImpulse) {
      const ratio = e / (this.bg + 1e-9);
      if (this.t > this.refractory && ratio > 18 * this.sens && e > 1.5e-4 && peak > 0.045) {
        this.inImpulse = true;
        this.onset = this.t; this.maxE = e; this.zcSum = zcr; this.blocks = 1;
        return;
      }
      // ~0.5 s time constant; loud-but-not-impulsive sound (speech, fans)
      // raises the floor, which makes claps over talking harder to fake.
      this.bg = Math.max(1e-7, this.bg * 0.99 + e * 0.01);
      return;
    }
    this.blocks++;
    this.zcSum += zcr;
    if (e > this.maxE) this.maxE = e;
    const ms = (this.t - this.onset) * 5;
    if (e < this.maxE * 0.1) {
      this.inImpulse = false;
      this.refractory = this.t + 14; // 70 ms: the room's echo is not a second clap
      if (ms <= 90) {
        this.port.postMessage({ type: 'impulse', at: currentTime, ms, zcr: this.zcSum / this.blocks, level: Math.sqrt(this.maxE) });
      }
    } else if (ms > 140) {
      // Sustained: a word, a bang with a long tail, music. Not an impulse.
      this.inImpulse = false;
      this.refractory = this.t + 20;
      this.bg = Math.max(this.bg, e * 0.5);
    }
  }
}

registerProcessor('clavis-clap', ClavisClapProcessor);

class ClavisPcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.hadAudio = false;
    this.played = 0;
    this.streaming = false;
    this.playbackId = null;
    this.bufferedSamples = 0;
    this.buffering = false;
    this.prebufferSamples = Math.round(sampleRate * 0.12);
    this.port.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === 'begin-stream') { this.streaming = true; this.buffering = true; this.playbackId = message.playback_id ?? null; }
      if (message.type === 'end-stream') this.streaming = false;
      if (message.type === 'reset-position') this.played = 0;
      if (message.type === 'position') this.port.postMessage({ type: 'position', item_id: message.item_id, played: this.played });
      if (message.type === 'chunk' && message.audio) {
        if (message.playback_id !== undefined) this.playbackId = message.playback_id;
        const samples = new Int16Array(message.audio);
        this.queue.push(samples);
        this.bufferedSamples += samples.length;
        this.hadAudio = true;
      }
      if (message.type === 'stop') {
        this.queue = [];
        this.current = null;
        this.offset = 0;
        this.hadAudio = false;
        this.streaming = false;
        this.playbackId = null;
        this.bufferedSamples = 0;
        this.buffering = false;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    // A small jitter buffer prevents each network packet from becoming a
    // start/stop burst. End-stream releases even a very short final clip.
    if (this.buffering && this.streaming && this.bufferedSamples < this.prebufferSamples) { output.fill(0); return true; }
    this.buffering = false;
    for (let i = 0; i < output.length; i += 1) {
      if (!this.current || this.offset >= this.current.length) {
        this.current = this.queue.shift() || null;
        this.offset = 0;
      }
      output[i] = this.current ? this.current[this.offset++] / 32768 : 0;
      if (this.current) { this.played++; this.bufferedSamples--; }
    }
    if (this.streaming && this.bufferedSamples === 0) this.buffering = true;
    if (this.hadAudio && !this.streaming && !this.current && this.queue.length === 0) {
      this.port.postMessage({ type: 'drained', playback_id: this.playbackId });
      this.hadAudio = false;
    }
    return true;
  }
}

registerProcessor('clavis-pcm-player', ClavisPcmPlayerProcessor);

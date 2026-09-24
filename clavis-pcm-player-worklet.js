class ClavisPcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.hadAudio = false;
    this.port.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === 'chunk' && message.audio) {
        this.queue.push(new Int16Array(message.audio));
        this.hadAudio = true;
      }
      if (message.type === 'stop') {
        this.queue = [];
        this.current = null;
        this.offset = 0;
        this.hadAudio = false;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    for (let i = 0; i < output.length; i += 1) {
      if (!this.current || this.offset >= this.current.length) {
        this.current = this.queue.shift() || null;
        this.offset = 0;
      }
      output[i] = this.current ? this.current[this.offset++] / 32768 : 0;
    }
    if (this.hadAudio && !this.current && this.queue.length === 0) {
      this.port.postMessage({ type: 'drained' });
      this.hadAudio = false;
    }
    return true;
  }
}

registerProcessor('clavis-pcm-player', ClavisPcmPlayerProcessor);

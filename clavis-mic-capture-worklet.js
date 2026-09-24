class ClavisMicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sourceRate = sampleRate;
    this.targetRate = 16000;
    this.position = 0;
    this.pending = [];
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    const ratio = this.sourceRate / this.targetRate;
    const values = [];
    while (this.position < input.length) {
      const left = Math.floor(this.position);
      const right = Math.min(left + 1, input.length - 1);
      const fraction = this.position - left;
      values.push(input[left] + (input[right] - input[left]) * fraction);
      this.position += ratio;
    }
    this.position -= input.length;
    if (values.length) this.pending.push(...values);
    // Silero's 16 kHz frontend expects 512-sample windows. Keeping this
    // boundary in the worklet means the server can run neural VAD on every
    // frame instead of silently falling back to RMS endpointing.
    while (this.pending.length >= 512) {
      const audio = new Float32Array(this.pending.splice(0, 512));
      this.port.postMessage({ type: 'pcm', audio: audio.buffer }, [audio.buffer]);
    }
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    return true;
  }
}

registerProcessor('clavis-mic-capture', ClavisMicCaptureProcessor);

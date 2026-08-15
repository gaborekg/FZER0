import { detectPitch } from '../../src/f0-core.js';
import { FRAME_SIZE } from '../../src/config.js';

class F0Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(FRAME_SIZE);
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];

    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.bufferIndex] = channel[i];
      this.bufferIndex += 1;
      if (this.bufferIndex === FRAME_SIZE) {
        const result = detectPitch(this.buffer, sampleRate);
        this.port.postMessage(result);
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('fzer0-f0-processor', F0Processor);

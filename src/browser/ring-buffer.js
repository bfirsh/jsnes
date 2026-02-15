// Minimal ring buffer for audio sample buffering.
// Replaces the ringbufferjs npm package to keep jsnes at zero runtime dependencies.

export default class RingBuffer {
  constructor(capacity) {
    this._buffer = new Float32Array(capacity);
    this._capacity = capacity;
    this._readPos = 0;
    this._size = 0;
  }

  enq(value) {
    let writePos = (this._readPos + this._size) % this._capacity;
    this._buffer[writePos] = value;
    if (this._size < this._capacity) {
      this._size++;
    } else {
      // Overwrite oldest, advance read pointer
      this._readPos = (this._readPos + 1) % this._capacity;
    }
  }

  deqN(count) {
    if (count > this._size) {
      throw new Error(
        `Not enough elements in buffer (requested ${count}, have ${this._size})`,
      );
    }
    let result = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      result[i] = this._buffer[(this._readPos + i) % this._capacity];
    }
    this._readPos = (this._readPos + count) % this._capacity;
    this._size -= count;
    return result;
  }

  size() {
    return this._size;
  }
}

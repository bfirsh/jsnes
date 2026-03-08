import test from "node:test";
import assert from "node:assert/strict";

import Speakers from "../src/browser/speakers.js";

test("getSampleRate returns default without creating AudioContext", () => {
  let constructions = 0;
  globalThis.window = {
    AudioContext: class {
      constructor() {
        constructions++;
        this.sampleRate = 48000;
      }
    },
  };

  const speakers = new Speakers({ onBufferUnderrun: () => {} });

  assert.equal(speakers.getSampleRate(), 44100);
  assert.equal(constructions, 0);
});

test("getSampleRate uses active audio context sample rate", () => {
  globalThis.window = {};
  const speakers = new Speakers({ onBufferUnderrun: () => {} });
  speakers.audioCtx = { sampleRate: 48000 };

  assert.equal(speakers.getSampleRate(), 48000);
});

import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import Speakers from "../src/browser/speakers.js";

describe("Speakers#getSampleRate", function () {
  afterEach(function () {
    delete global.window;
    Speakers._detectedSampleRate = null;
  });

  it("returns 44100 when AudioContext is unavailable", function () {
    global.window = {};
    let speakers = new Speakers({ onBufferUnderrun: null });

    assert.strictEqual(speakers.getSampleRate(), 44100);
  });

  it("reuses detected sample rate instead of creating multiple AudioContexts", function () {
    let created = 0;

    global.window = {
      AudioContext: class {
        constructor() {
          created++;
          this.sampleRate = 48000;
        }
        close() {}
      },
    };

    let speakers = new Speakers({ onBufferUnderrun: null });

    assert.strictEqual(speakers.getSampleRate(), 48000);
    assert.strictEqual(speakers.getSampleRate(), 48000);
    assert.strictEqual(created, 1);
  });

  it("uses active audio context sample rate when available", function () {
    global.window = {
      AudioContext: class {
        constructor() {
          this.sampleRate = 48000;
        }
        close() {}
      },
    };

    let speakers = new Speakers({ onBufferUnderrun: null });
    speakers.audioCtx = { sampleRate: 32000 };

    assert.strictEqual(speakers.getSampleRate(), 32000);
  });
});

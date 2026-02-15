import assert from "node:assert/strict";
import { describe, it, before, mock } from "node:test";
import fs from "fs";
import NES from "../src/nes.js";

describe("NES", function () {
  it("can be initialized", function () {
    let nes = new NES();
  });

  it("loads a ROM and runs a frame", function () {
    let onFrame = mock.fn();
    let nes = new NES({ onFrame: onFrame });
    let data = fs.readFileSync("roms/croom/croom.nes");
    nes.loadROM(data.toString("binary"));
    nes.frame();
    assert.strictEqual(onFrame.mock.callCount(), 1);
    assert.ok(onFrame.mock.calls[0].arguments[0] instanceof Uint32Array);
    assert.strictEqual(onFrame.mock.calls[0].arguments[0].length, 256 * 240);
  });

  it("generates the correct frame buffer", function () {
    let onFrame = mock.fn();
    let nes = new NES({ onFrame: onFrame });
    let data = fs.readFileSync("roms/croom/croom.nes");
    nes.loadROM(data.toString("binary"));
    // Check the first index of a white pixel on the first 6 frames of
    // output. Croom only uses 2 colors on the initial screen which makes
    // it easy to detect. Comparing full snapshots of each frame takes too
    // long.
    let expectedIndexes = [-1, -1, -1, 2056, 4104, 4104];
    for (let i = 0; i < 6; i++) {
      nes.frame();
      let lastCall = onFrame.mock.calls[onFrame.mock.calls.length - 1];
      assert.strictEqual(
        lastCall.arguments[0].indexOf(0xffffff),
        expectedIndexes[i],
      );
    }
  });

  it("loads a ROM from a Uint8Array and runs a frame", function () {
    let onFrame = mock.fn();
    let nes = new NES({ onFrame: onFrame });
    let data = fs.readFileSync("roms/croom/croom.nes");
    nes.loadROM(new Uint8Array(data));
    nes.frame();
    assert.strictEqual(onFrame.mock.callCount(), 1);
    assert.ok(onFrame.mock.calls[0].arguments[0] instanceof Uint32Array);
    assert.strictEqual(onFrame.mock.calls[0].arguments[0].length, 256 * 240);
  });

  it("produces the same frame buffer from Uint8Array and string", function () {
    let stringFrames = [];
    let nes1 = new NES({ onFrame: (buf) => stringFrames.push(buf.slice()) });
    let data = fs.readFileSync("roms/croom/croom.nes");
    nes1.loadROM(data.toString("binary"));
    for (let i = 0; i < 6; i++) nes1.frame();

    let uint8Frames = [];
    let nes2 = new NES({ onFrame: (buf) => uint8Frames.push(buf.slice()) });
    nes2.loadROM(new Uint8Array(data));
    for (let i = 0; i < 6; i++) nes2.frame();

    assert.strictEqual(stringFrames.length, uint8Frames.length);
    for (let i = 0; i < stringFrames.length; i++) {
      assert.deepStrictEqual(stringFrames[i], uint8Frames[i]);
    }
  });

  describe("#loadROM()", function () {
    it("throws an error given an invalid ROM string", function () {
      let nes = new NES();
      assert.throws(
        function () {
          nes.loadROM("foo");
        },
        { message: "Not a valid NES ROM." },
      );
    });

    it("throws an error given an invalid ROM Uint8Array", function () {
      let nes = new NES();
      assert.throws(
        function () {
          nes.loadROM(new Uint8Array([0x66, 0x6f, 0x6f]));
        },
        { message: "Not a valid NES ROM." },
      );
    });
  });

  describe("#frame() with invalid opcode", function () {
    // Build a minimal iNES ROM (mapper 0, 1 PRG bank, 0 CHR banks)
    // filled with 0x02 (an invalid opcode) so the CPU crashes immediately.
    function makeInvalidOpcodeROM() {
      let header =
        "NES\x1a" + // magic
        "\x01" + // 1 PRG-ROM bank (16KB)
        "\x00" + // 0 CHR-ROM banks
        "\x00" + // flags 6: mapper 0, horizontal mirroring
        "\x00" + // flags 7
        "\x00\x00\x00\x00\x00\x00\x00\x00"; // padding
      let prg = new Array(16384);
      // Fill with invalid opcode 0x02
      for (let i = 0; i < 16384; i++) {
        prg[i] = 0x02;
      }
      // Set reset vector at 0xFFFC-0xFFFD to point to 0xC000
      prg[0x3ffc] = 0x00; // low byte
      prg[0x3ffd] = 0xc0; // high byte
      let prgStr = "";
      for (let j = 0; j < 16384; j++) {
        prgStr += String.fromCharCode(prg[j]);
      }
      return header + prgStr;
    }

    it("throws an error on invalid opcode instead of looping infinitely", function () {
      let nes = new NES();
      nes.loadROM(makeInvalidOpcodeROM());
      assert.throws(function () {
        nes.frame();
      }, /invalid opcode/);
    });

    it("marks NES as crashed and subsequent frame() throws", function () {
      let nes = new NES();
      nes.loadROM(makeInvalidOpcodeROM());
      assert.throws(function () {
        nes.frame();
      }, /invalid opcode/);
      assert.strictEqual(nes.crashed, true);
      // Subsequent calls to frame() should also throw
      assert.throws(function () {
        nes.frame();
      }, /crashed/);
    });

    it("can be reset after crashing", function () {
      let onFrame = mock.fn();
      let nes = new NES({ onFrame: onFrame });
      nes.loadROM(makeInvalidOpcodeROM());
      assert.throws(function () {
        nes.frame();
      }, /invalid opcode/);
      assert.strictEqual(nes.crashed, true);
      // After reset, crashed flag is cleared
      nes.reset();
      assert.strictEqual(nes.crashed, false);
    });
  });

  describe("#getFPS()", function () {
    let nes = new NES();
    before(function () {
      let data = fs.readFileSync("roms/croom/croom.nes");
      nes.loadROM(data.toString("binary"));
    });

    it("returns an FPS count when frames have been run", function () {
      assert.strictEqual(nes.getFPS(), null);
      nes.frame();
      nes.frame();
      let fps = nes.getFPS();
      assert.strictEqual(typeof fps, "number");
      assert.ok(fps > 0);
    });
  });
});

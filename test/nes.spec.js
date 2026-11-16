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
    // long. (On frame 3 the game is loading its palette with rendering
    // disabled, so the backdrop color changes partway down the screen.)
    let expectedIndexes = [-1, -1, 41224, 2056, 4104, 4104];
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

    it("keeps the current cartridge if the new ROM is invalid", function () {
      let data = fs.readFileSync("roms/croom/croom.nes").toString("binary");
      let nes = new NES();
      nes.loadROM(data);
      assert.throws(() => nes.loadROM("foo"), {
        message: "Not a valid NES ROM.",
      });
      // reset() power-cycles whatever cartridge is inserted, so it must still
      // be the old one rather than the ROM that failed to parse.
      nes.reset();
      for (let i = 0; i < 10; i++) nes.frame();
    });
  });

  describe("#reset()", function () {
    // Runs `count` frames and returns a copy of each frame buffer.
    function runFrames(nes, frames, count) {
      frames.length = 0;
      for (let i = 0; i < count; i++) nes.frame();
      return frames.slice();
    }

    it("does nothing harmful when no ROM is loaded", function () {
      let nes = new NES();
      nes.reset();
      assert.strictEqual(nes.mmap, null);
      nes.frame();
    });

    // reset() is a power cycle: it should be indistinguishable from loading
    // the same ROM again into a fresh emulator. lj65 is a good test because
    // it uses the reset vector and starts drawing straight away; before this
    // was fixed, reset() left cpu.mem empty and the CPU ran into zeros
    // (BRK) and then an invalid opcode.
    it("power-cycles the cartridge, producing the same frames as loadROM()", function () {
      let data = fs.readFileSync("roms/lj65/lj65.nes").toString("binary");

      let frames = [];
      let nes = new NES({ onFrame: (buf) => frames.push(buf.slice()) });
      nes.loadROM(data);
      // Play for a while so there's plenty of state to throw away.
      runFrames(nes, frames, 100);
      nes.reset();
      let afterReset = runFrames(nes, frames, 60);

      let freshFrames = [];
      let fresh = new NES({ onFrame: (buf) => freshFrames.push(buf.slice()) });
      fresh.loadROM(data);
      let afterLoad = runFrames(fresh, freshFrames, 60);

      // Make sure the comparison means something: the game has drawn
      // something other than a single flat colour.
      let last = afterLoad[afterLoad.length - 1];
      assert.ok(last.some((pixel) => pixel !== last[0]));

      assert.strictEqual(afterReset.length, afterLoad.length);
      for (let i = 0; i < afterLoad.length; i++) {
        assert.deepStrictEqual(afterReset[i], afterLoad[i], `frame ${i}`);
      }
    });

    it("recovers a crashed emulator", function () {
      let data = fs.readFileSync("roms/croom/croom.nes").toString("binary");
      let nes = new NES();
      nes.loadROM(data);
      nes.frame();
      // Simulate a crash partway through a game.
      nes.crashed = true;
      assert.throws(() => nes.frame(), /crashed/);
      nes.reset();
      assert.strictEqual(nes.crashed, false);
      for (let i = 0; i < 10; i++) nes.frame();
    });

    it("keeps Game Genie codes active", function () {
      let data = fs.readFileSync("roms/croom/croom.nes").toString("binary");
      let nes = new NES();
      nes.loadROM(data);
      nes.gameGenie.addPatch(0x8000, 0x00);
      nes.reset();
      assert.strictEqual(nes.cpu._gameGenieActive, true);
      assert.strictEqual(nes.cpu.directPrgReads, false);
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

  it("serializes CPU dataBus and controller state", function () {
    let nes = new NES();
    let data = fs.readFileSync("roms/croom/croom.nes");
    nes.loadROM(data.toString("binary"));

    nes.cpu.dataBus = 0xab;
    nes.controllers[1].buttonDown(0);
    nes.controllers[1].buttonDown(8);
    nes.controllers[1].clock();
    nes.controllers[2].buttonDown(1);

    let state = nes.toJSON();

    let restored = new NES();
    restored.loadROM(data.toString("binary"));
    restored.fromJSON(state);

    assert.strictEqual(restored.cpu.dataBus, 0xab);
    assert.deepStrictEqual(
      restored.controllers[1].state,
      nes.controllers[1].state,
    );
    assert.strictEqual(restored.controllers[1].turboA, true);
    assert.strictEqual(restored.controllers[2].state[1], 0x41);
  });

  describe("#fromJSON()", function () {
    it("restores a saved state", function () {
      let data = fs.readFileSync("roms/croom/croom.nes").toString("binary");
      let nes = new NES();
      nes.loadROM(data);
      for (let i = 0; i < 10; i++) nes.frame();
      let state = JSON.parse(JSON.stringify(nes.toJSON()));
      let nes2 = new NES();
      nes2.loadROM(data);
      nes2.fromJSON(state);
      assert.strictEqual(nes2.cpu.REG_PC, nes.cpu.REG_PC);
      assert.strictEqual(nes2.cpu.cycles, nes.cpu.cycles);
      nes2.frame();
    });

    // fromJSON() power-cycles via reset() and then overwrites the fresh
    // state, so the restored emulator must carry on exactly where the saved
    // one left off.
    it("continues with the same frames as the saved emulator", function () {
      let data = fs.readFileSync("roms/lj65/lj65.nes").toString("binary");
      let frames = [];
      let nes = new NES({ onFrame: (buf) => frames.push(buf.slice()) });
      nes.loadROM(data);
      for (let i = 0; i < 60; i++) nes.frame();
      let state = JSON.parse(JSON.stringify(nes.toJSON()));
      frames.length = 0;
      for (let i = 0; i < 30; i++) nes.frame();

      let restoredFrames = [];
      let nes2 = new NES({
        onFrame: (buf) => restoredFrames.push(buf.slice()),
      });
      nes2.loadROM(data);
      for (let i = 0; i < 10; i++) nes2.frame();
      nes2.fromJSON(state);
      restoredFrames.length = 0;
      for (let i = 0; i < 30; i++) nes2.frame();

      // The fast PRG read path is set up again for the restored mapper.
      assert.strictEqual(nes2.cpu.directPrgReads, true);
      for (let i = 0; i < frames.length; i++) {
        assert.deepStrictEqual(restoredFrames[i], frames[i], `frame ${i}`);
      }
    });

    it("rejects states from incompatible versions", function () {
      let data = fs.readFileSync("roms/croom/croom.nes").toString("binary");
      let nes = new NES();
      nes.loadROM(data);
      let state = nes.toJSON();
      delete state.version;
      assert.throws(() => nes.fromJSON(state), /incompatible version/);
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

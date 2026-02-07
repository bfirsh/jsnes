var assert = require("chai").assert;
var fs = require("fs");
var NES = require("../src/nes");
var sinon = require("sinon");

describe("NES", function() {
  it("can be initialized", function() {
    var nes = new NES();
  });

  it("loads a ROM and runs a frame", function(done) {
    var onFrame = sinon.spy();
    var nes = new NES({ onFrame: onFrame });
    fs.readFile("roms/croom/croom.nes", function(err, data) {
      if (err) return done(err);
      nes.loadROM(data.toString("binary"));
      nes.frame();
      assert(onFrame.calledOnce);
      assert.isArray(onFrame.args[0][0]);
      assert.lengthOf(onFrame.args[0][0], 256 * 240);
      done();
    });
  });

  it("generates the correct frame buffer", function(done) {
    var onFrame = sinon.spy();
    var nes = new NES({ onFrame: onFrame });
    fs.readFile("roms/croom/croom.nes", function(err, data) {
      if (err) return done(err);
      nes.loadROM(data.toString("binary"));
      // Check the first index of a white pixel on the first 6 frames of
      // output. Croom only uses 2 colors on the initial screen which makes
      // it easy to detect. Comparing full snapshots of each frame takes too
      // long.
      var expectedIndexes = [-1, -1, -1, 2056, 4104, 4104];
      for (var i = 0; i < 6; i++) {
        nes.frame();
        assert.equal(onFrame.lastCall.args[0].indexOf(0xFFFFFF), expectedIndexes[i]);
      }
      done();
    });
  });

  describe("#loadROM()", function() {
    it("throws an error given an invalid ROM", function() {
      var nes = new NES();
      assert.throws(function() {
        nes.loadROM("foo");
      }, "Not a valid NES ROM.");
    });
  });

  describe("#frame() with invalid opcode", function() {
    // Build a minimal iNES ROM (mapper 0, 1 PRG bank, 0 CHR banks)
    // filled with 0x02 (an invalid opcode) so the CPU crashes immediately.
    function makeInvalidOpcodeROM() {
      var header = "NES\x1a" + // magic
        "\x01" + // 1 PRG-ROM bank (16KB)
        "\x00" + // 0 CHR-ROM banks
        "\x00" + // flags 6: mapper 0, horizontal mirroring
        "\x00" + // flags 7
        "\x00\x00\x00\x00\x00\x00\x00\x00"; // padding
      var prg = new Array(16384);
      // Fill with invalid opcode 0x02
      for (var i = 0; i < 16384; i++) {
        prg[i] = 0x02;
      }
      // Set reset vector at 0xFFFC-0xFFFD to point to 0xC000
      prg[0x3FFC] = 0x00; // low byte
      prg[0x3FFD] = 0xC0; // high byte
      var prgStr = "";
      for (var j = 0; j < 16384; j++) {
        prgStr += String.fromCharCode(prg[j]);
      }
      return header + prgStr;
    }

    it("throws an error on invalid opcode instead of looping infinitely", function() {
      var nes = new NES();
      nes.loadROM(makeInvalidOpcodeROM());
      assert.throws(function() {
        nes.frame();
      }, /invalid opcode/);
    });

    it("marks NES as crashed and subsequent frame() throws", function() {
      var nes = new NES();
      nes.loadROM(makeInvalidOpcodeROM());
      assert.throws(function() {
        nes.frame();
      }, /invalid opcode/);
      assert.isTrue(nes.crashed);
      // Subsequent calls to frame() should also throw
      assert.throws(function() {
        nes.frame();
      }, /crashed/);
    });

    it("can be reset after crashing", function() {
      var onFrame = sinon.spy();
      var nes = new NES({ onFrame: onFrame });
      nes.loadROM(makeInvalidOpcodeROM());
      assert.throws(function() {
        nes.frame();
      }, /invalid opcode/);
      assert.isTrue(nes.crashed);
      // After reset, crashed flag is cleared
      nes.reset();
      assert.isFalse(nes.crashed);
    });
  });

  describe("#getFPS()", function() {
    var nes = new NES();
    before(function(done) {
      fs.readFile("roms/croom/croom.nes", function(err, data) {
        if (err) return done(err);
        nes.loadROM(data.toString("binary"));
        done();
      });
    });

    it("returns an FPS count when frames have been run", function() {
      assert.isNull(nes.getFPS());
      nes.frame();
      nes.frame();
      var fps = nes.getFPS();
      assert.isNumber(fps);
      assert.isAbove(fps, 0);
    });
  });
});

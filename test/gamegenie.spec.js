var assert = require("chai").assert;
var GameGenie = require("../src/gamegenie");
var NES = require("../src/nes");
var fs = require("fs");

describe("GameGenie", function () {
  var gg = null;

  beforeEach(function () {
    gg = new GameGenie();
  });

  describe("decode", function () {
    it("decodes a 6-letter code (no compare key)", function () {
      // SXIOPO = infinite lives in SMB
      var result = gg.decode("SXIOPO");
      assert.equal(result.value, 0xad);
      assert.equal(result.addr, 0x11d9);
      assert.isUndefined(result.key);
      assert.isFalse(result.wantskey);
    });

    it("decodes an 8-letter code (with compare key)", function () {
      // AAEAULPA = 8-letter Game Genie code
      var result = gg.decode("AAEAULPA");
      assert.equal(result.value, 0x00);
      assert.equal(result.addr, 0x0b03);
      assert.equal(result.key, 0x01);
      assert.isTrue(result.wantskey);
    });

    it("is case-insensitive", function () {
      var upper = gg.decode("SXIOPO");
      var lower = gg.decode("sxiopo");
      assert.deepEqual(upper, lower);
    });

    it("decodes a hex code", function () {
      var result = gg.decode("11d9:ad");
      assert.equal(result.value, 0xad);
      assert.equal(result.addr, 0x11d9);
      assert.isUndefined(result.key);
    });

    it("decodes a hex code with compare key", function () {
      var result = gg.decode("075a:01?00");
      assert.equal(result.value, 0x01);
      assert.equal(result.addr, 0x075a);
      assert.equal(result.key, 0x00);
      assert.isTrue(result.wantskey);
    });

    it("decodes a hex code with ? but no key value", function () {
      var result = gg.decode("1234:ab?");
      assert.equal(result.addr, 0x1234);
      assert.equal(result.value, 0xab);
      assert.isTrue(result.wantskey);
      assert.isUndefined(result.key);
    });
  });

  describe("encode", function () {
    it("encodes a 6-letter code", function () {
      var code = gg.encode(0x11d9, 0xad);
      assert.equal(code, "SXIOPO");
    });

    it("encodes an 8-letter code with compare key", function () {
      var code = gg.encode(0x0b03, 0x00, 0x01);
      assert.equal(code, "AAEAULPA");
    });

    it("round-trips a 6-letter code through decode/encode", function () {
      var original = "SXIOPO";
      var decoded = gg.decode(original);
      var encoded = gg.encode(decoded.addr, decoded.value, decoded.key);
      assert.equal(encoded, original);
    });

    it("round-trips an 8-letter code through decode/encode", function () {
      var original = "AAEAULPA";
      var decoded = gg.decode(original);
      var encoded = gg.encode(
        decoded.addr,
        decoded.value,
        decoded.key,
        decoded.wantskey,
      );
      assert.equal(encoded, original);
    });
  });

  describe("encodeHex / decodeHex", function () {
    it("round-trips a hex code without key", function () {
      var hex = gg.encodeHex(0x05d9, 0xad);
      var decoded = gg.decodeHex(hex);
      assert.equal(decoded.addr, 0x05d9);
      assert.equal(decoded.value, 0xad);
      assert.isUndefined(decoded.key);
    });

    it("round-trips a hex code with key", function () {
      var hex = gg.encodeHex(0x075a, 0x01, 0x00);
      var decoded = gg.decodeHex(hex);
      assert.equal(decoded.addr, 0x075a);
      assert.equal(decoded.value, 0x01);
      assert.equal(decoded.key, 0x00);
    });

    it("returns null for invalid hex code", function () {
      assert.isNull(gg.decodeHex("not-a-code"));
    });
  });

  describe("applyCodes", function () {
    it("returns the original value when no patches match", function () {
      assert.equal(gg.applyCodes(0x8000, 0x42), 0x42);
    });

    it("substitutes a value at the patched address", function () {
      gg.addPatch(0x1234, 0xff);
      // Address is masked to 15 bits: 0x9234 & 0x7FFF = 0x1234
      assert.equal(gg.applyCodes(0x9234, 0x00), 0xff);
    });

    it("does not substitute at a different address", function () {
      gg.addPatch(0x1234, 0xff);
      assert.equal(gg.applyCodes(0x9235, 0x42), 0x42);
    });

    it("only substitutes when compare key matches", function () {
      gg.addPatch(0x1234, 0xff, 0x42);
      // Key matches
      assert.equal(gg.applyCodes(0x9234, 0x42), 0xff);
      // Key doesn't match
      assert.equal(gg.applyCodes(0x9234, 0x00), 0x00);
    });

    it("does not apply when disabled", function () {
      gg.addPatch(0x1234, 0xff);
      gg.setEnabled(false);
      assert.equal(gg.applyCodes(0x9234, 0x00), 0x00);
    });

    it("re-applies after re-enabling", function () {
      gg.addPatch(0x1234, 0xff);
      gg.setEnabled(false);
      gg.setEnabled(true);
      assert.equal(gg.applyCodes(0x9234, 0x00), 0xff);
    });

    it("applies the first matching patch", function () {
      gg.addPatch(0x1234, 0xaa);
      gg.addPatch(0x1234, 0xbb);
      assert.equal(gg.applyCodes(0x9234, 0x00), 0xaa);
    });
  });

  describe("addCode", function () {
    it("adds a decoded 6-letter code as a patch", function () {
      gg.addCode("SXIOPO");
      assert.equal(gg.patches.length, 1);
      assert.equal(gg.patches[0].addr, 0x11d9);
      assert.equal(gg.patches[0].value, 0xad);
    });

    it("adds a decoded hex code as a patch", function () {
      gg.addCode("11d9:ad");
      assert.equal(gg.patches.length, 1);
      assert.equal(gg.patches[0].addr, 0x11d9);
      assert.equal(gg.patches[0].value, 0xad);
    });
  });

  describe("removeAllCodes", function () {
    it("clears all patches", function () {
      gg.addPatch(0x1234, 0xff);
      gg.addPatch(0x5678, 0xaa);
      assert.equal(gg.patches.length, 2);
      gg.removeAllCodes();
      assert.equal(gg.patches.length, 0);
    });

    it("stops applying patches after clearing", function () {
      gg.addPatch(0x1234, 0xff);
      gg.removeAllCodes();
      assert.equal(gg.applyCodes(0x9234, 0x42), 0x42);
    });
  });

  describe("NES integration", function () {
    it("NES has a gameGenie instance", function () {
      var nes = new NES();
      assert.isObject(nes.gameGenie);
      assert.isTrue(nes.gameGenie.enabled);
      assert.isArray(nes.gameGenie.patches);
    });

    it("Game Genie patches affect CPU ROM reads", function (done) {
      var nes = new NES({ onFrame: function () {} });
      fs.readFile("roms/croom/croom.nes", function (err, data) {
        if (err) return done(err);
        nes.loadROM(data.toString("binary"));

        // Read a byte from ROM without any patches
        var addr = 0xc000;
        var original = nes.cpu.load(addr);

        // Apply a patch that changes that byte
        nes.gameGenie.addPatch(addr & 0x7fff, 0x42);
        var patched = nes.cpu.load(addr);
        assert.equal(patched, 0x42);

        // Disable Game Genie and verify original value returns
        nes.gameGenie.setEnabled(false);
        var unpatched = nes.cpu.load(addr);
        assert.equal(unpatched, original);

        done();
      });
    });

    it("Game Genie patches work with compare keys on real ROM data", function (done) {
      var nes = new NES({ onFrame: function () {} });
      fs.readFile("roms/croom/croom.nes", function (err, data) {
        if (err) return done(err);
        nes.loadROM(data.toString("binary"));

        var addr = 0xc000;
        var original = nes.cpu.load(addr);

        // Patch with wrong compare key — should NOT substitute
        nes.gameGenie.addPatch(addr & 0x7fff, 0x42, original ^ 0xff);
        assert.equal(nes.cpu.load(addr), original);

        // Clear and patch with correct compare key — should substitute
        nes.gameGenie.removeAllCodes();
        nes.gameGenie.addPatch(addr & 0x7fff, 0x42, original);
        assert.equal(nes.cpu.load(addr), 0x42);

        done();
      });
    });

    it("emulator still runs frames with Game Genie patches active", function (done) {
      var frameCount = 0;
      var nes = new NES({
        onFrame: function () {
          frameCount++;
        },
      });
      fs.readFile("roms/croom/croom.nes", function (err, data) {
        if (err) return done(err);
        nes.loadROM(data.toString("binary"));

        // Add a harmless patch (address unlikely to be hit)
        nes.gameGenie.addPatch(0x7fff, 0x00);

        // Run a few frames — should not crash
        for (var i = 0; i < 3; i++) {
          nes.frame();
        }
        assert.equal(frameCount, 3);
        done();
      });
    });
  });
});

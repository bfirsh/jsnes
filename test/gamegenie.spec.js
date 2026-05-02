import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import GameGenie from "../src/gamegenie.ts";
import NES from "../src/nes.ts";
import fs from "fs";

describe("GameGenie", function () {
  let gg = null;

  beforeEach(function () {
    gg = new GameGenie();
  });

  describe("decode", function () {
    it("decodes a 6-letter code (no compare key)", function () {
      // SXIOPO = infinite lives in SMB
      let result = gg.decode("SXIOPO");
      assert.strictEqual(result.value, 0xad);
      assert.strictEqual(result.addr, 0x11d9);
      assert.strictEqual(result.key, undefined);
      assert.strictEqual(result.wantskey, false);
    });

    it("decodes an 8-letter code (with compare key)", function () {
      // AAEAULPA = 8-letter Game Genie code
      let result = gg.decode("AAEAULPA");
      assert.strictEqual(result.value, 0x00);
      assert.strictEqual(result.addr, 0x0b03);
      assert.strictEqual(result.key, 0x01);
      assert.strictEqual(result.wantskey, true);
    });

    it("is case-insensitive", function () {
      let upper = gg.decode("SXIOPO");
      let lower = gg.decode("sxiopo");
      assert.deepStrictEqual(upper, lower);
    });

    it("decodes a hex code", function () {
      let result = gg.decode("11d9:ad");
      assert.strictEqual(result.value, 0xad);
      assert.strictEqual(result.addr, 0x11d9);
      assert.strictEqual(result.key, undefined);
    });

    it("decodes a hex code with compare key", function () {
      let result = gg.decode("075a:01?00");
      assert.strictEqual(result.value, 0x01);
      assert.strictEqual(result.addr, 0x075a);
      assert.strictEqual(result.key, 0x00);
      assert.strictEqual(result.wantskey, true);
    });

    it("decodes a hex code with ? but no key value", function () {
      let result = gg.decode("1234:ab?");
      assert.strictEqual(result.addr, 0x1234);
      assert.strictEqual(result.value, 0xab);
      assert.strictEqual(result.wantskey, true);
      assert.strictEqual(result.key, undefined);
    });
  });

  describe("encode", function () {
    it("encodes a 6-letter code", function () {
      let code = gg.encode(0x11d9, 0xad);
      assert.strictEqual(code, "SXIOPO");
    });

    it("encodes an 8-letter code with compare key", function () {
      let code = gg.encode(0x0b03, 0x00, 0x01);
      assert.strictEqual(code, "AAEAULPA");
    });

    it("round-trips a 6-letter code through decode/encode", function () {
      let original = "SXIOPO";
      let decoded = gg.decode(original);
      let encoded = gg.encode(decoded.addr, decoded.value, decoded.key);
      assert.strictEqual(encoded, original);
    });

    it("round-trips an 8-letter code through decode/encode", function () {
      let original = "AAEAULPA";
      let decoded = gg.decode(original);
      let encoded = gg.encode(
        decoded.addr,
        decoded.value,
        decoded.key,
        decoded.wantskey,
      );
      assert.strictEqual(encoded, original);
    });
  });

  describe("encodeHex / decodeHex", function () {
    it("round-trips a hex code without key", function () {
      let hex = gg.encodeHex(0x05d9, 0xad);
      let decoded = gg.decodeHex(hex);
      assert.strictEqual(decoded.addr, 0x05d9);
      assert.strictEqual(decoded.value, 0xad);
      assert.strictEqual(decoded.key, undefined);
    });

    it("round-trips a hex code with key", function () {
      let hex = gg.encodeHex(0x075a, 0x01, 0x00);
      let decoded = gg.decodeHex(hex);
      assert.strictEqual(decoded.addr, 0x075a);
      assert.strictEqual(decoded.value, 0x01);
      assert.strictEqual(decoded.key, 0x00);
    });

    it("returns null for invalid hex code", function () {
      assert.strictEqual(gg.decodeHex("not-a-code"), null);
    });
  });

  describe("applyCodes", function () {
    it("returns the original value when no patches match", function () {
      assert.strictEqual(gg.applyCodes(0x8000, 0x42), 0x42);
    });

    it("substitutes a value at the patched address", function () {
      gg.addPatch(0x1234, 0xff);
      // Address is masked to 15 bits: 0x9234 & 0x7FFF = 0x1234
      assert.strictEqual(gg.applyCodes(0x9234, 0x00), 0xff);
    });

    it("does not substitute at a different address", function () {
      gg.addPatch(0x1234, 0xff);
      assert.strictEqual(gg.applyCodes(0x9235, 0x42), 0x42);
    });

    it("only substitutes when compare key matches", function () {
      gg.addPatch(0x1234, 0xff, 0x42);
      // Key matches
      assert.strictEqual(gg.applyCodes(0x9234, 0x42), 0xff);
      // Key doesn't match
      assert.strictEqual(gg.applyCodes(0x9234, 0x00), 0x00);
    });

    it("does not apply when disabled", function () {
      gg.addPatch(0x1234, 0xff);
      gg.setEnabled(false);
      assert.strictEqual(gg.applyCodes(0x9234, 0x00), 0x00);
    });

    it("re-applies after re-enabling", function () {
      gg.addPatch(0x1234, 0xff);
      gg.setEnabled(false);
      gg.setEnabled(true);
      assert.strictEqual(gg.applyCodes(0x9234, 0x00), 0xff);
    });

    it("applies the first matching patch", function () {
      gg.addPatch(0x1234, 0xaa);
      gg.addPatch(0x1234, 0xbb);
      assert.strictEqual(gg.applyCodes(0x9234, 0x00), 0xaa);
    });
  });

  describe("addCode", function () {
    it("adds a decoded 6-letter code as a patch", function () {
      gg.addCode("SXIOPO");
      assert.strictEqual(gg.patches.length, 1);
      assert.strictEqual(gg.patches[0].addr, 0x11d9);
      assert.strictEqual(gg.patches[0].value, 0xad);
    });

    it("adds a decoded hex code as a patch", function () {
      gg.addCode("11d9:ad");
      assert.strictEqual(gg.patches.length, 1);
      assert.strictEqual(gg.patches[0].addr, 0x11d9);
      assert.strictEqual(gg.patches[0].value, 0xad);
    });
  });

  describe("removeAllCodes", function () {
    it("clears all patches", function () {
      gg.addPatch(0x1234, 0xff);
      gg.addPatch(0x5678, 0xaa);
      assert.strictEqual(gg.patches.length, 2);
      gg.removeAllCodes();
      assert.strictEqual(gg.patches.length, 0);
    });

    it("stops applying patches after clearing", function () {
      gg.addPatch(0x1234, 0xff);
      gg.removeAllCodes();
      assert.strictEqual(gg.applyCodes(0x9234, 0x42), 0x42);
    });
  });

  describe("NES integration", function () {
    it("NES has a gameGenie instance", function () {
      let nes = new NES();
      assert.strictEqual(typeof nes.gameGenie, "object");
      assert.strictEqual(nes.gameGenie.enabled, true);
      assert.ok(Array.isArray(nes.gameGenie.patches));
    });

    it("Game Genie patches affect CPU ROM reads", function () {
      let nes = new NES({ onFrame: function () {} });
      let data = fs.readFileSync("roms/croom/croom.nes");
      nes.loadROM(data.toString("binary"));

      // Read a byte from ROM without any patches
      let addr = 0xc000;
      let original = nes.cpu.load(addr);

      // Apply a patch that changes that byte
      nes.gameGenie.addPatch(addr & 0x7fff, 0x42);
      let patched = nes.cpu.load(addr);
      assert.strictEqual(patched, 0x42);

      // Disable Game Genie and verify original value returns
      nes.gameGenie.setEnabled(false);
      let unpatched = nes.cpu.load(addr);
      assert.strictEqual(unpatched, original);
    });

    it("Game Genie patches work with compare keys on real ROM data", function () {
      let nes = new NES({ onFrame: function () {} });
      let data = fs.readFileSync("roms/croom/croom.nes");
      nes.loadROM(data.toString("binary"));

      let addr = 0xc000;
      let original = nes.cpu.load(addr);

      // Patch with wrong compare key — should NOT substitute
      nes.gameGenie.addPatch(addr & 0x7fff, 0x42, original ^ 0xff);
      assert.strictEqual(nes.cpu.load(addr), original);

      // Clear and patch with correct compare key — should substitute
      nes.gameGenie.removeAllCodes();
      nes.gameGenie.addPatch(addr & 0x7fff, 0x42, original);
      assert.strictEqual(nes.cpu.load(addr), 0x42);
    });

    it("emulator still runs frames with Game Genie patches active", function () {
      let frameCount = 0;
      let nes = new NES({
        onFrame: function () {
          frameCount++;
        },
      });
      let data = fs.readFileSync("roms/croom/croom.nes");
      nes.loadROM(data.toString("binary"));

      // Add a harmless patch (address unlikely to be hit)
      nes.gameGenie.addPatch(0x7fff, 0x00);

      // Run a few frames — should not crash
      for (let i = 0; i < 3; i++) {
        nes.frame();
      }
      assert.strictEqual(frameCount, 3);
    });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ROM from "../src/rom.js";

// Build a minimal iNES/NES 2.0 header as a Uint8Array.
// The returned array includes enough PRG/CHR data bytes (filled with 0)
// to satisfy the sizes declared in the header.
function buildHeader(bytes, opts = {}) {
  const header = new Uint8Array(16);
  // NES magic
  header[0] = 0x4e; // N
  header[1] = 0x45; // E
  header[2] = 0x53; // S
  header[3] = 0x1a; // \x1a
  for (let i = 4; i < 16; i++) {
    if (bytes[i] !== undefined) {
      header[i] = bytes[i];
    }
  }

  // Calculate how much PRG + CHR data to append so the ROM doesn't truncate.
  const prgBanks = opts.prgBanks || header[4] || 1;
  const chrBanks8k = opts.chrBanks8k || header[5] || 0;
  const trainerSize = (header[6] & 0x04) !== 0 ? 512 : 0;
  const dataSize = trainerSize + prgBanks * 16384 + chrBanks8k * 8192;

  const rom = new Uint8Array(16 + dataSize);
  rom.set(header);
  return rom;
}

// Minimal mock NES object for ROM constructor
function mockNes() {
  return {};
}

describe("ROM", function () {
  describe("iNES 1.0 detection", function () {
    it("detects iNES 1.0 when bytes 8-15 are zero", function () {
      const data = buildHeader({ 4: 1, 5: 0, 6: 0x00, 7: 0x00 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.isNES2, false);
    });

    it("parses mapper from bytes 6 and 7", function () {
      // Mapper 4: byte 6 upper nibble = 0x4, byte 7 upper nibble = 0x0
      const data = buildHeader({ 4: 1, 5: 0, 6: 0x40, 7: 0x00 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.mapperType, 4);
    });

    it("ignores byte 7 mapper bits when bytes 8-15 have garbage", function () {
      // Byte 7 upper nibble = 0x10 but byte 8 is non-zero (garbage).
      // In this case, the parser should discard byte 7 and only use byte 6.
      // But we need to make sure byte 7 bits 3..2 != 0b10 so it's not NES 2.0.
      const data = buildHeader({
        4: 1,
        5: 0,
        6: 0x30, // mapper low nibble = 3
        7: 0x10, // mapper high nibble = 1 (would make mapper 0x13)
        8: 0xff, // garbage
      });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.isNES2, false);
      assert.strictEqual(rom.mapperType, 3); // Only low nibble used
    });

    it("sets NES 2.0 fields to zero defaults", function () {
      const data = buildHeader({ 4: 1, 5: 0 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.subMapper, 0);
      assert.strictEqual(rom.prgRamSize, 0);
      assert.strictEqual(rom.prgNvRamSize, 0);
      assert.strictEqual(rom.chrRamSize, 0);
      assert.strictEqual(rom.chrNvRamSize, 0);
      assert.strictEqual(rom.timingMode, 0);
      assert.strictEqual(rom.consoleType, 0);
    });
  });

  describe("NES 2.0 detection", function () {
    it("detects NES 2.0 when byte 7 bits 3..2 == 0b10", function () {
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x08 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.isNES2, true);
    });

    it("does not detect NES 2.0 when byte 7 bits 3..2 == 0b00", function () {
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x00 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.isNES2, false);
    });

    it("does not detect NES 2.0 when byte 7 bits 3..2 == 0b01", function () {
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x04 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.isNES2, false);
    });

    it("does not detect NES 2.0 when byte 7 bits 3..2 == 0b11", function () {
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x0c });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.isNES2, false);
    });
  });

  describe("NES 2.0 mapper number", function () {
    it("parses 12-bit mapper from bytes 6, 7, and 8", function () {
      // Mapper 0x123:
      //   byte 6 D7..D4 = 0x3 (mapper D3..D0)
      //   byte 7 D7..D4 = 0x2 (mapper D7..D4), D3..D2 = 0b10 (NES 2.0 id)
      //   byte 8 D3..D0 = 0x1 (mapper D11..D8)
      const data = buildHeader({
        4: 1,
        5: 0,
        6: 0x30,
        7: 0x28, // 0x20 | 0x08
        8: 0x01,
      });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.mapperType, 0x123);
    });

    it("parses mapper 0 correctly", function () {
      const data = buildHeader({ 4: 1, 5: 0, 6: 0x00, 7: 0x08, 8: 0x00 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.mapperType, 0);
    });

    it("parses large mapper numbers", function () {
      // Mapper 0xFFF (4095): byte 6 upper = 0xF, byte 7 upper = 0xF, byte 8 lower = 0xF
      const data = buildHeader({
        4: 1,
        5: 0,
        6: 0xf0,
        7: 0xf8, // 0xF0 | 0x08
        8: 0x0f,
      });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.mapperType, 0xfff);
    });
  });

  describe("NES 2.0 submapper", function () {
    it("parses submapper from byte 8 upper nibble", function () {
      const data = buildHeader({
        4: 1,
        5: 0,
        7: 0x08,
        8: 0x50, // submapper 5
      });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.subMapper, 5);
    });

    it("parses submapper 0", function () {
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x08, 8: 0x00 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.subMapper, 0);
    });
  });

  describe("NES 2.0 PRG-ROM size", function () {
    it("uses 12-bit size in simple mode", function () {
      // 2 PRG-ROM banks via simple 12-bit encoding:
      // byte 4 = 2, byte 9 D3..D0 = 0
      const data = buildHeader(
        { 4: 2, 5: 0, 7: 0x08, 9: 0x00 },
        { prgBanks: 2 },
      );
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.romCount, 2);
    });

    it("combines MSB nibble with LSB byte for large PRG-ROM", function () {
      // 0x102 (258) PRG-ROM banks: byte 9 D3..D0 = 1, byte 4 = 2
      const data = buildHeader(
        { 4: 2, 5: 0, 7: 0x08, 9: 0x01 },
        { prgBanks: 258 },
      );
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.romCount, 258);
    });

    it("uses exponent-multiplier when MSB nibble is 0xF", function () {
      // Exponent-multiplier mode: byte 9 D3..D0 = 0xF
      // byte 4 encodes E and M: E=bits 7..2, M=bits 1..0
      // E=1, M=0 -> size = 2^1 * (0*2+1) = 2 bytes => romCount = ceil(2/16384) = 1
      // Let's use E=14, M=0 -> size = 2^14 * 1 = 16384 bytes = 1 bank
      const e = 14;
      const m = 0;
      const data = buildHeader(
        { 4: (e << 2) | m, 5: 0, 7: 0x08, 9: 0x0f },
        { prgBanks: 1 },
      );
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.romCount, 1);
    });

    it("handles exponent-multiplier with multiplier > 0", function () {
      // E=14, M=1 -> size = 2^14 * (1*2+1) = 16384 * 3 = 49152 bytes
      // romCount = ceil(49152 / 16384) = 3
      const e = 14;
      const m = 1;
      const data = buildHeader(
        { 4: (e << 2) | m, 5: 0, 7: 0x08, 9: 0x0f },
        { prgBanks: 3 },
      );
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.romCount, 3);
    });
  });

  describe("NES 2.0 CHR-ROM size", function () {
    it("uses 12-bit size in simple mode", function () {
      // 1 CHR-ROM 8KB bank = 2 4KB vrom banks
      const data = buildHeader(
        { 4: 1, 5: 1, 7: 0x08, 9: 0x00 },
        { chrBanks8k: 1 },
      );
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.vromCount, 2);
    });

    it("combines MSB nibble with LSB byte", function () {
      // 0x102 (258) 8KB banks = 516 4KB banks
      const data = buildHeader(
        { 4: 1, 5: 2, 7: 0x08, 9: 0x10 },
        { chrBanks8k: 258 },
      );
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.vromCount, 516);
    });

    it("uses exponent-multiplier when MSB nibble is 0xF", function () {
      // E=12, M=0 -> size = 2^12 * 1 = 4096 bytes = 1 4KB bank
      const e = 12;
      const m = 0;
      const data = buildHeader(
        { 4: 1, 5: (e << 2) | m, 7: 0x08, 9: 0xf0 },
        { chrBanks8k: 1 },
      );
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.vromCount, 1);
    });

    it("handles zero CHR-ROM", function () {
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x08, 9: 0x00 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.vromCount, 0);
    });
  });

  describe("NES 2.0 RAM sizes", function () {
    it("decodes PRG-RAM size from byte 10 lower nibble", function () {
      // Value 7 -> 64 << 7 = 8192 (8KB)
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x08, 10: 0x07 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.prgRamSize, 8192);
    });

    it("decodes PRG-NVRAM size from byte 10 upper nibble", function () {
      // Value 7 -> 64 << 7 = 8192 (8KB)
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x08, 10: 0x70 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.prgNvRamSize, 8192);
    });

    it("decodes CHR-RAM size from byte 11 lower nibble", function () {
      // Value 7 -> 64 << 7 = 8192 (8KB)
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x08, 11: 0x07 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.chrRamSize, 8192);
    });

    it("decodes CHR-NVRAM size from byte 11 upper nibble", function () {
      // Value 7 -> 64 << 7 = 8192 (8KB)
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x08, 11: 0x70 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.chrNvRamSize, 8192);
    });

    it("returns 0 for RAM nibble value 0", function () {
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x08, 10: 0x00, 11: 0x00 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.prgRamSize, 0);
      assert.strictEqual(rom.prgNvRamSize, 0);
      assert.strictEqual(rom.chrRamSize, 0);
      assert.strictEqual(rom.chrNvRamSize, 0);
    });

    it("decodes various shift count values correctly", function () {
      const rom = new ROM(mockNes());
      // Test the static helper directly
      assert.strictEqual(ROM._decodeRamSize(0), 0);
      assert.strictEqual(ROM._decodeRamSize(1), 128);
      assert.strictEqual(ROM._decodeRamSize(2), 256);
      assert.strictEqual(ROM._decodeRamSize(3), 512);
      assert.strictEqual(ROM._decodeRamSize(4), 1024);
      assert.strictEqual(ROM._decodeRamSize(5), 2048);
      assert.strictEqual(ROM._decodeRamSize(6), 4096);
      assert.strictEqual(ROM._decodeRamSize(7), 8192);
      assert.strictEqual(ROM._decodeRamSize(8), 16384);
      assert.strictEqual(ROM._decodeRamSize(9), 32768);
      assert.strictEqual(ROM._decodeRamSize(10), 65536);
      assert.strictEqual(ROM._decodeRamSize(14), 1048576);
    });
  });

  describe("NES 2.0 timing and console type", function () {
    it("parses NTSC timing (0)", function () {
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x08, 12: 0x00 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.timingMode, 0);
    });

    it("parses PAL timing (1)", function () {
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x08, 12: 0x01 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.timingMode, 1);
    });

    it("parses Dendy timing (3)", function () {
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x08, 12: 0x03 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.timingMode, 3);
    });

    it("parses NES/Famicom console type (0)", function () {
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x08 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.consoleType, 0);
    });

    it("parses Vs. System console type (1)", function () {
      const data = buildHeader({ 4: 1, 5: 0, 7: 0x09 }); // 0x08 | 0x01
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.consoleType, 1);
    });
  });

  describe("shared header flags", function () {
    it("parses mirroring from byte 6 bit 0", function () {
      const data = buildHeader({ 4: 1, 5: 0, 6: 0x01, 7: 0x08 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.mirroring, 1); // vertical
    });

    it("parses battery RAM flag from byte 6 bit 1", function () {
      const data = buildHeader({ 4: 1, 5: 0, 6: 0x02, 7: 0x08 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.batteryRam, true);
    });

    it("parses trainer flag from byte 6 bit 2", function () {
      const data = buildHeader({ 4: 1, 5: 0, 6: 0x04, 7: 0x08 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.trainer, true);
    });

    it("parses four-screen flag from byte 6 bit 3", function () {
      const data = buildHeader({ 4: 1, 5: 0, 6: 0x08, 7: 0x08 });
      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.fourScreen, true);
    });
  });

  describe("trainer offset", function () {
    it("skips 512-byte trainer when loading PRG-ROM data", function () {
      // Build a ROM with trainer flag set. The trainer area (512 bytes after
      // header) is filled with 0xAA, and the first PRG-ROM byte is 0xBB.
      const header = new Uint8Array(16);
      header[0] = 0x4e;
      header[1] = 0x45;
      header[2] = 0x53;
      header[3] = 0x1a;
      header[4] = 1; // 1 PRG bank
      header[5] = 0;
      header[6] = 0x04; // trainer flag set

      const totalSize = 16 + 512 + 16384;
      const data = new Uint8Array(totalSize);
      data.set(header);
      // Fill trainer with 0xAA
      for (let i = 16; i < 16 + 512; i++) {
        data[i] = 0xaa;
      }
      // First PRG-ROM byte is 0xBB
      data[16 + 512] = 0xbb;

      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.rom[0][0], 0xbb);
    });

    it("starts PRG-ROM at offset 16 when no trainer", function () {
      const header = new Uint8Array(16);
      header[0] = 0x4e;
      header[1] = 0x45;
      header[2] = 0x53;
      header[3] = 0x1a;
      header[4] = 1;
      header[5] = 0;

      const totalSize = 16 + 16384;
      const data = new Uint8Array(totalSize);
      data.set(header);
      data[16] = 0xcc; // First PRG-ROM byte

      const rom = new ROM(mockNes());
      rom.load(data);
      assert.strictEqual(rom.rom[0][0], 0xcc);
    });
  });
});

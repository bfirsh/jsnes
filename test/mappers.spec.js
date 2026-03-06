import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import Mappers from "../src/mappers/index.js";

describe("Mappers", function () {
  let mapper = null;
  let mockNes = null;

  beforeEach(function () {
    // Create minimal mock NES with CPU memory
    mockNes = {
      cpu: {
        mem: new Array(0x10000).fill(0),
      },
      opts: {
        onBatteryRamWrite: function () {},
      },
    };
    mapper = new Mappers[0](mockNes);
  });

  describe("write", function () {
    it("does not modify ROM when writing to ROM addresses", function () {
      // Set up some ROM data at 0x8000
      let romAddress = 0x8000;
      let originalValue = 0x42;
      mockNes.cpu.mem[romAddress] = originalValue;

      // Attempt to write a different value
      let newValue = 0xff;
      mapper.write(romAddress, newValue);

      // Verify ROM was not modified
      assert.strictEqual(mockNes.cpu.mem[romAddress], originalValue);
    });

    it("does not modify ROM at high ROM addresses", function () {
      let romAddress = 0xfffc;
      let originalValue = 0xab;
      mockNes.cpu.mem[romAddress] = originalValue;

      mapper.write(romAddress, 0x00);

      assert.strictEqual(mockNes.cpu.mem[romAddress], originalValue);
    });

    it("allows writes to cartridge SRAM", function () {
      let sramAddress = 0x6000;
      mockNes.cpu.mem[sramAddress] = 0x00;

      mapper.write(sramAddress, 0x42);

      assert.strictEqual(mockNes.cpu.mem[sramAddress], 0x42);
    });

    it("allows writes to RAM", function () {
      let ramAddress = 0x0200;
      mockNes.cpu.mem[ramAddress] = 0x00;

      mapper.write(ramAddress, 0x42);

      assert.strictEqual(mockNes.cpu.mem[ramAddress & 0x7ff], 0x42);
    });
  });

  describe("writelow", function () {
    it("does not modify ROM when writing to ROM addresses", function () {
      let romAddress = 0x8000;
      let originalValue = 0x42;
      mockNes.cpu.mem[romAddress] = originalValue;

      mapper.writelow(romAddress, 0xff);

      assert.strictEqual(mockNes.cpu.mem[romAddress], originalValue);
    });
  });

  describe("Mapper 3 (CNROM)", function () {
    it("writes a single 8k CHR bank switch", function () {
      let mapper3 = new Mappers[3](mockNes);
      let calls = [];
      mapper3.load8kVromBank = (bank, address) => {
        calls.push([bank, address]);
      };

      mapper3.write(0x8000, 3);

      assert.deepStrictEqual(calls, [[6, 0x0000]]);
    });
  });

  describe("Mapper 180", function () {
    it("loads bank 0 at $8000 and $c000 on reset", function () {
      mockNes.rom = {
        valid: true,
        romCount: 8,
      };
      mockNes.cpu.IRQ_RESET = 1;
      mockNes.cpu.requestIrq = () => {};

      let mapper180 = new Mappers[180](mockNes);
      let calls = [];
      mapper180.loadRomBank = (bank, address) => {
        calls.push([bank, address]);
      };
      mapper180.loadCHRROM = () => {};

      mapper180.loadROM();

      assert.deepStrictEqual(calls, [
        [0, 0x8000],
        [0, 0xc000],
      ]);
    });
  });
});

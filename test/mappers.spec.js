var assert = require("chai").assert;
var Mappers = require("../src/mappers");

describe("Mappers", function () {
  var mapper = null;
  var mockNes = null;

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
    mapper.reset();
  });

  describe("write", function () {
    it("does not modify ROM when writing to ROM addresses", function () {
      // Set up some ROM data at 0x8000
      var romAddress = 0x8000;
      var originalValue = 0x42;
      mockNes.cpu.mem[romAddress] = originalValue;

      // Attempt to write a different value
      var newValue = 0xff;
      mapper.write(romAddress, newValue);

      // Verify ROM was not modified
      assert.equal(mockNes.cpu.mem[romAddress], originalValue);
    });

    it("does not modify ROM at high ROM addresses", function () {
      var romAddress = 0xfffc;
      var originalValue = 0xab;
      mockNes.cpu.mem[romAddress] = originalValue;

      mapper.write(romAddress, 0x00);

      assert.equal(mockNes.cpu.mem[romAddress], originalValue);
    });

    it("allows writes to cartridge SRAM", function () {
      var sramAddress = 0x6000;
      mockNes.cpu.mem[sramAddress] = 0x00;

      mapper.write(sramAddress, 0x42);

      assert.equal(mockNes.cpu.mem[sramAddress], 0x42);
    });

    it("allows writes to RAM", function () {
      var ramAddress = 0x0200;
      mockNes.cpu.mem[ramAddress] = 0x00;

      mapper.write(ramAddress, 0x42);

      assert.equal(mockNes.cpu.mem[ramAddress & 0x7ff], 0x42);
    });
  });

  describe("writelow", function () {
    it("does not modify ROM when writing to ROM addresses", function () {
      var romAddress = 0x8000;
      var originalValue = 0x42;
      mockNes.cpu.mem[romAddress] = originalValue;

      mapper.writelow(romAddress, 0xff);

      assert.equal(mockNes.cpu.mem[romAddress], originalValue);
    });
  });
});

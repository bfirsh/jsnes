import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import Mappers from "../src/mappers/index.js";
import NameTable from "../src/ppu/nametable.js";
import Tile from "../src/tile.js";

// Create a minimal mock NES sufficient for Mapper 0
function createMockNes() {
  return {
    cpu: {
      mem: new Array(0x10000).fill(0),
      dataBus: 0,
      IRQ_NORMAL: 0,
      IRQ_RESET: 2,
      requestIrq: function () {},
    },
    ppu: {
      vramMem: new Uint8Array(0x8000),
      vramMirrorTable: new Uint16Array(0x8000),
      ptTile: new Array(512).fill(null).map(() => new Tile()),
      scanline: 0,
      f_bgVisibility: 0,
      f_spVisibility: 0,
      f_spriteSize: 0,
      nameTable: [
        new NameTable(32, 32, "Nt0"),
        new NameTable(32, 32, "Nt1"),
        new NameTable(32, 32, "Nt2"),
        new NameTable(32, 32, "Nt3"),
      ],
      ntable1: [0, 1, 2, 3],
      triggerRendering: function () {},
      setMirroring: function () {},
      defineMirrorRegion: function (fromStart, toStart, size) {
        for (let i = 0; i < size; i++) {
          this.vramMirrorTable[fromStart + i] = toStart + i;
        }
      },
    },
    papu: {
      getLengthMax: function (value) {
        // Simplified length lookup — return something nonzero
        return (value >> 3) + 1;
      },
    },
    rom: {
      valid: true,
      romCount: 8, // 8 x 16K = 128K PRG ROM
      vromCount: 16, // 16 x 4K = 64K CHR ROM
      rom: [],
      vrom: [],
      vromTile: [],
      batteryRam: false,
      HORIZONTAL_MIRRORING: 1,
      VERTICAL_MIRRORING: 0,
      FOURSCREEN_MIRRORING: 2,
      SINGLESCREEN_MIRRORING: 3,
    },
    opts: {
      onBatteryRamWrite: function () {},
    },
  };
}

// Fill mock ROM with identifiable data so we can verify bank switching
function populateMockRom(mockNes) {
  for (let i = 0; i < mockNes.rom.romCount; i++) {
    mockNes.rom.rom[i] = new Uint8Array(16384);
    // Fill each 16K bank with a unique byte pattern based on bank index
    for (let j = 0; j < 16384; j++) {
      mockNes.rom.rom[i][j] = (i * 16 + (j & 0x0f)) & 0xff;
    }
  }
  for (let i = 0; i < mockNes.rom.vromCount; i++) {
    mockNes.rom.vrom[i] = new Uint8Array(4096);
    mockNes.rom.vromTile[i] = new Array(256).fill(null).map(() => new Tile());
    for (let j = 0; j < 4096; j++) {
      mockNes.rom.vrom[i][j] = (i + j) & 0xff;
    }
  }
}

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
});

// --- MMC5 (Mapper 5) Tests ---
describe("MMC5 (Mapper 5)", function () {
  let mapper = null;
  let mockNes = null;

  beforeEach(function () {
    mockNes = createMockNes();
    populateMockRom(mockNes);
    mapper = new Mappers[5](mockNes);
    mockNes.mmap = mapper;
    // Initialize vramMirrorTable to identity
    for (let i = 0; i < 0x8000; i++) {
      mockNes.ppu.vramMirrorTable[i] = i;
    }
  });

  describe("hardware multiplier ($5205/$5206)", function () {
    it("returns product of two values", function () {
      mapper.write(0x5205, 20);
      mapper.write(0x5206, 13);
      // 20 * 13 = 260 = 0x0104
      assert.strictEqual(mapper.load(0x5205), 0x04); // low byte
      assert.strictEqual(mapper.load(0x5206), 0x01); // high byte
    });

    it("handles 0xFF * 0xFF", function () {
      mapper.write(0x5205, 0xff);
      mapper.write(0x5206, 0xff);
      // 255 * 255 = 65025 = 0xFE01
      assert.strictEqual(mapper.load(0x5205), 0x01);
      assert.strictEqual(mapper.load(0x5206), 0xfe);
    });

    it("handles multiplication by zero", function () {
      mapper.write(0x5205, 0);
      mapper.write(0x5206, 42);
      assert.strictEqual(mapper.load(0x5205), 0x00);
      assert.strictEqual(mapper.load(0x5206), 0x00);
    });

    it("defaults to 0xFF * 0xFF on power-up", function () {
      // Power-on default: $5205=$FF, $5206=$FF → product = $FE01
      assert.strictEqual(mapper.load(0x5205), 0x01);
      assert.strictEqual(mapper.load(0x5206), 0xfe);
    });
  });

  describe("scanline IRQ ($5203/$5204)", function () {
    it("reports no IRQ pending and no in-frame initially", function () {
      let val = mapper.load(0x5204);
      assert.strictEqual(val & 0x80, 0); // no IRQ pending
      assert.strictEqual(val & 0x40, 0); // not in-frame
    });

    it("sets in-frame flag on first clockIrqCounter call at scanline 20", function () {
      mockNes.ppu.scanline = 20;
      mockNes.ppu.f_bgVisibility = 1;
      mapper.clockIrqCounter();

      // Read $5204 during rendering to see in-frame flag
      let val = mapper.load(0x5204);
      assert.strictEqual(val & 0x40, 0x40); // in-frame set
    });

    it("fires IRQ when scanline counter matches target", function () {
      let irqFired = false;
      mockNes.cpu.requestIrq = function () {
        irqFired = true;
      };

      // Set target scanline to 5
      mapper.write(0x5203, 5);
      // Enable IRQ
      mapper.write(0x5204, 0x80);

      // Simulate pre-render scanline 20 (resets counter)
      mockNes.ppu.scanline = 20;
      mapper.clockIrqCounter();

      // Simulate visible scanlines 21-25 (counter goes 1,2,3,4,5)
      for (let s = 21; s <= 25; s++) {
        mockNes.ppu.scanline = s;
        mapper.clockIrqCounter();
      }

      assert.ok(irqFired, "IRQ should have fired at scanline counter = 5");
    });

    it("does not fire IRQ when disabled", function () {
      let irqFired = false;
      mockNes.cpu.requestIrq = function () {
        irqFired = true;
      };

      mapper.write(0x5203, 3);
      // Do NOT enable IRQ (leave $5204 bit 7 clear)

      mockNes.ppu.scanline = 20;
      mapper.clockIrqCounter();
      for (let s = 21; s <= 23; s++) {
        mockNes.ppu.scanline = s;
        mapper.clockIrqCounter();
      }

      assert.ok(!irqFired, "IRQ should not fire when disabled");
      // But IRQ pending flag should still be set
      let val = mapper.load(0x5204);
      assert.strictEqual(val & 0x80, 0x80, "IRQ pending flag should be set");
    });

    it("target $00 never matches (special case)", function () {
      mapper.write(0x5203, 0x00);
      mapper.write(0x5204, 0x80);

      mockNes.ppu.scanline = 20;
      mapper.clockIrqCounter();
      for (let s = 21; s <= 260; s++) {
        mockNes.ppu.scanline = s;
        mapper.clockIrqCounter();
      }

      let val = mapper.load(0x5204);
      assert.strictEqual(val & 0x80, 0, "IRQ pending should never be set");
    });

    it("reading $5204 clears IRQ pending flag", function () {
      mapper.write(0x5203, 1);
      mapper.write(0x5204, 0x80);

      mockNes.ppu.scanline = 20;
      mapper.clockIrqCounter();
      mockNes.ppu.scanline = 21;
      mapper.clockIrqCounter(); // counter=1, should match

      let val1 = mapper.load(0x5204);
      assert.strictEqual(val1 & 0x80, 0x80, "IRQ pending on first read");

      let val2 = mapper.load(0x5204);
      assert.strictEqual(val2 & 0x80, 0, "IRQ pending cleared after read");
    });

    it("clears in-frame flag outside rendering", function () {
      // Set in-frame by clocking during rendering
      mockNes.ppu.scanline = 20;
      mockNes.ppu.f_bgVisibility = 1;
      mapper.clockIrqCounter();

      // Now simulate VBlank: scanline outside rendering range
      mockNes.ppu.scanline = 0;
      mockNes.ppu.f_bgVisibility = 0;
      let val = mapper.load(0x5204);
      assert.strictEqual(
        val & 0x40,
        0,
        "in-frame should be clear during VBlank",
      );
    });
  });

  describe("PRG RAM protection ($5102/$5103)", function () {
    it("blocks PRG RAM writes when protection is not unlocked", function () {
      // Default: both protect registers are 0, so writes are blocked
      mapper.write(0x6000, 0x42);
      assert.strictEqual(mapper.load(0x6000), 0, "write blocked by default");
    });

    it("allows PRG RAM writes when both protection registers are set", function () {
      mapper.write(0x5102, 0x02); // must be %10
      mapper.write(0x5103, 0x01); // must be %01
      mapper.write(0x6000, 0x42);
      assert.strictEqual(mapper.load(0x6000), 0x42);
    });

    it("blocks writes if only one protection register is set", function () {
      mapper.write(0x5102, 0x02);
      // $5103 still default 0
      mapper.write(0x6000, 0x42);
      assert.strictEqual(
        mapper.load(0x6000),
        0,
        "write blocked with partial unlock",
      );
    });
  });

  describe("PRG banking modes ($5100, $5114-$5117)", function () {
    it("mode 3: four independent 8K banks", function () {
      mapper.write(0x5100, 3); // 8K mode

      // Map bank 0 (ROM) to $8000 — bit 7 set for ROM
      mapper.write(0x5114, 0x80 | 0);
      // Map bank 2 (ROM) to $A000
      mapper.write(0x5115, 0x80 | 2);
      // Map bank 4 (ROM) to $C000
      mapper.write(0x5116, 0x80 | 4);
      // Map bank 6 (ROM) to $E000
      mapper.write(0x5117, 6);

      // Verify each region reads from the correct 8K ROM bank.
      // Bank 0 is in 16K ROM bank 0, offset 0
      // rom[0][0] = (0*16 + 0) = 0x00
      assert.strictEqual(mapper.load(0x8000), mockNes.rom.rom[0][0]);
      // Bank 2 is in 16K ROM bank 1, offset 0
      assert.strictEqual(mapper.load(0xa000), mockNes.rom.rom[1][0]);
      // Bank 4 is in 16K ROM bank 2, offset 0
      assert.strictEqual(mapper.load(0xc000), mockNes.rom.rom[2][0]);
      // Bank 6 is in 16K ROM bank 3, offset 0
      assert.strictEqual(mapper.load(0xe000), mockNes.rom.rom[3][0]);
    });

    it("mode 3: PRG RAM bank at $8000 when bit 7 is clear", function () {
      mapper.write(0x5100, 3);
      mapper.write(0x5102, 0x02); // unlock RAM writes
      mapper.write(0x5103, 0x01);

      // Map RAM bank 0 to $8000 (bit 7 clear = RAM)
      mapper.write(0x5114, 0x00);

      // Write to the RAM-mapped region
      mapper.write(0x8000, 0xab);
      assert.strictEqual(mapper.load(0x8000), 0xab);
    });

    it("$5117 always selects ROM regardless of bit 7", function () {
      mapper.write(0x5100, 3);
      // Even writing 0 (bit 7 clear) to $5117 should still read ROM
      mapper.write(0x5117, 0x00);
      // Bank 0 of ROM: rom[0][0]
      assert.strictEqual(mapper.load(0xe000), mockNes.rom.rom[0][0]);
    });
  });

  describe("PRG RAM banking ($5113)", function () {
    it("banks PRG RAM into $6000-$7FFF", function () {
      mapper.write(0x5102, 0x02);
      mapper.write(0x5103, 0x01);

      // Write to bank 0
      mapper.write(0x5113, 0);
      mapper.write(0x6000, 0xaa);
      assert.strictEqual(mapper.load(0x6000), 0xaa);

      // Switch to bank 1 and write different data
      mapper.write(0x5113, 1);
      mapper.write(0x6000, 0xbb);
      assert.strictEqual(mapper.load(0x6000), 0xbb);

      // Switch back to bank 0 and verify original data
      mapper.write(0x5113, 0);
      assert.strictEqual(mapper.load(0x6000), 0xaa);
    });
  });

  describe("ExRAM ($5C00-$5FFF)", function () {
    it("mode 2: readable and writable as general-purpose RAM", function () {
      mapper.write(0x5104, 2); // mode 2
      mapper.write(0x5c00, 0x42);
      assert.strictEqual(mapper.load(0x5c00), 0x42);
      mapper.write(0x5cff, 0xab);
      assert.strictEqual(mapper.load(0x5cff), 0xab);
    });

    it("mode 3: readable but writes have no effect", function () {
      mapper.write(0x5104, 2); // mode 2 to write initial data
      mapper.write(0x5c00, 0x42);

      mapper.write(0x5104, 3); // switch to mode 3 (read-only)
      mapper.write(0x5c00, 0xff); // this write should be ignored
      assert.strictEqual(mapper.load(0x5c00), 0x42);
    });

    it("modes 0/1: returns open bus on read", function () {
      mapper.write(0x5104, 0); // mode 0
      mockNes.cpu.dataBus = 0x37;
      assert.strictEqual(mapper.load(0x5c00), 0x37, "mode 0 returns open bus");

      mapper.write(0x5104, 1); // mode 1
      mockNes.cpu.dataBus = 0x99;
      assert.strictEqual(mapper.load(0x5c00), 0x99, "mode 1 returns open bus");
    });

    it("modes 0/1: writes $00 when not in-frame", function () {
      mapper.write(0x5104, 0); // mode 0
      // Not in-frame, so writes should store $00 instead
      mapper.write(0x5c00, 0x42);

      // Verify by switching to mode 2 to read back
      mapper.write(0x5104, 2);
      assert.strictEqual(mapper.load(0x5c00), 0x00);
    });

    it("modes 0/1: writes actual value when in-frame", function () {
      mapper.write(0x5104, 0);

      // Set in-frame by clocking at scanline 20
      mockNes.ppu.scanline = 20;
      mockNes.ppu.f_bgVisibility = 1;
      mapper.clockIrqCounter();

      mapper.write(0x5c00, 0x42);

      // Verify by switching to mode 2 to read back
      mapper.write(0x5104, 2);
      assert.strictEqual(mapper.load(0x5c00), 0x42);
    });
  });

  describe("nametable mapping ($5105)", function () {
    it("maps all four nametable slots to CIRAM A", function () {
      // All slots = 0 (CIRAM A at $2000)
      mapper.write(0x5105, 0x00);

      let ppu = mockNes.ppu;
      assert.strictEqual(ppu.vramMirrorTable[0x2000], 0x2000);
      assert.strictEqual(ppu.vramMirrorTable[0x2400], 0x2000);
      assert.strictEqual(ppu.vramMirrorTable[0x2800], 0x2000);
      assert.strictEqual(ppu.vramMirrorTable[0x2c00], 0x2000);
    });

    it("maps nametables to different CIRAM pages", function () {
      // Slot 0=A, Slot 1=B, Slot 2=A, Slot 3=B → vertical mirroring
      // Binary: 01 00 01 00 → 0x44
      mapper.write(0x5105, 0x44);

      let ppu = mockNes.ppu;
      assert.strictEqual(ppu.vramMirrorTable[0x2000], 0x2000); // CIRAM A
      assert.strictEqual(ppu.vramMirrorTable[0x2400], 0x2400); // CIRAM B
      assert.strictEqual(ppu.vramMirrorTable[0x2800], 0x2000); // CIRAM A
      assert.strictEqual(ppu.vramMirrorTable[0x2c00], 0x2400); // CIRAM B
    });

    it("fill mode populates nametable with fill tile/attr", function () {
      mapper.write(0x5106, 0x5a); // fill tile
      mapper.write(0x5107, 0x02); // fill palette

      // Map slot 3 to fill mode (value 3)
      // Slot 0=A(0), Slot 1=A(0), Slot 2=A(0), Slot 3=Fill(3)
      // Binary: 11 00 00 00 → 0xC0
      mapper.write(0x5105, 0xc0);

      // The fill nametable is written at $2C00 in VRAM
      let ppu = mockNes.ppu;
      // First 960 bytes should be the fill tile
      assert.strictEqual(ppu.vramMem[0x2c00], 0x5a);
      assert.strictEqual(ppu.vramMem[0x2c00 + 959], 0x5a);
      // Attribute bytes (960-1023) should be the fill palette packed
      // Palette 2 = %10, packed = %10101010 = 0xAA
      assert.strictEqual(ppu.vramMem[0x2c00 + 960], 0xaa);
    });
  });

  describe("expansion audio registers", function () {
    it("$5015 controls pulse channel enable", function () {
      mapper.write(0x5015, 0x03); // enable both pulse channels
      assert.ok(mapper.pulse1.enabled);
      assert.ok(mapper.pulse2.enabled);

      mapper.write(0x5015, 0x00); // disable both
      assert.ok(!mapper.pulse1.enabled);
      assert.ok(!mapper.pulse2.enabled);
    });

    it("$5015 read reflects length counter status", function () {
      mapper.write(0x5015, 0x03); // enable both
      // Write to $5003 to set length counter on pulse 1
      mapper.write(0x5003, 0x08); // length counter load
      assert.ok(mapper.pulse1.lengthCounter > 0);

      let val = mapper.load(0x5015);
      assert.strictEqual(val & 0x01, 0x01, "pulse 1 length > 0");
    });

    it("$5011 sets PCM value (non-zero only)", function () {
      mapper.write(0x5011, 0x80);
      assert.strictEqual(mapper.pcmValue, 0x80);

      // Writing $00 should NOT change the value
      mapper.write(0x5011, 0x00);
      assert.strictEqual(mapper.pcmValue, 0x80);
    });
  });

  describe("register edge cases", function () {
    it("open bus for unmapped registers in $5000-$5BFF range", function () {
      mockNes.cpu.dataBus = 0x77;
      assert.strictEqual(mapper.load(0x5018), 0x77);
      assert.strictEqual(mapper.load(0x5300), 0x77);
    });

    it("$5100-$5104 are write-only (return open bus)", function () {
      mockNes.cpu.dataBus = 0x55;
      assert.strictEqual(mapper.load(0x5100), 0x55);
      assert.strictEqual(mapper.load(0x5101), 0x55);
      assert.strictEqual(mapper.load(0x5104), 0x55);
    });

    it("split screen registers store values", function () {
      mapper.write(0x5200, 0xd5); // enable, right side, tile 21
      assert.ok(mapper.splitEnabled);
      assert.ok(mapper.splitRight);
      assert.strictEqual(mapper.splitTile, 0x15);

      mapper.write(0x5201, 0x40); // scroll
      assert.strictEqual(mapper.splitScroll, 0x40);

      mapper.write(0x5202, 0x0a); // CHR page
      assert.strictEqual(mapper.splitPage, 0x0a);
    });
  });

  describe("save state (toJSON/fromJSON)", function () {
    it("round-trips all mapper state", function () {
      // Set up some interesting state
      mapper.write(0x5100, 2); // PRG mode 2
      mapper.write(0x5101, 1); // CHR mode 1
      mapper.write(0x5102, 0x02);
      mapper.write(0x5103, 0x01);
      mapper.write(0x5203, 42); // IRQ target
      mapper.write(0x5204, 0x80); // IRQ enable
      mapper.write(0x5205, 7);
      mapper.write(0x5206, 11);
      mapper.write(0x5106, 0xaa); // fill tile
      mapper.write(0x5107, 0x03); // fill attr

      // Write to ExRAM (mode 2)
      mapper.write(0x5104, 2);
      mapper.write(0x5c10, 0xbe);

      // Write to PRG RAM
      mapper.write(0x6100, 0xef);

      let json = mapper.toJSON();

      // Create a fresh mapper and restore
      let mapper2 = new Mappers[5](mockNes);
      mapper2.fromJSON(json);

      assert.strictEqual(mapper2.prgMode, 2);
      assert.strictEqual(mapper2.chrMode, 1);
      assert.strictEqual(mapper2.irqTarget, 42);
      assert.strictEqual(mapper2.irqEnabled, true);
      assert.strictEqual(mapper2.multA, 7);
      assert.strictEqual(mapper2.multB, 11);
      assert.strictEqual(mapper2.fillTile, 0xaa);
      assert.strictEqual(mapper2.fillAttr, 3);

      // Verify ExRAM survived
      assert.strictEqual(mapper2.load(0x5c10), 0xbe);

      // Verify PRG RAM survived
      assert.strictEqual(mapper2.load(0x6100), 0xef);

      // Verify multiplier still works after restore
      assert.strictEqual(mapper2.load(0x5205), (7 * 11) & 0xff);
    });
  });
});

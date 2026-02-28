import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import Mappers from "../src/mappers/index.js";
import NameTable from "../src/ppu/nametable.js";
import Tile from "../src/tile.js";

// MMC5 CHR Bank Switching Test Harness
//
// The MMC5 maintains two CHR bank sets: Set A (sprites) and Set B (background).
// In 8x16 sprite mode, the mapper swaps these into the PPU's ptTile[] cache
// during rendering. This test harness verifies that:
//   1. The correct bank data ends up in ptTile at each rendering phase
//   2. getSpritePatternTile() returns Set A tiles regardless of what's in ptTile
//   3. All CHR modes (0-3) produce correct bank mappings
//   4. The rendering pipeline sequence works correctly

// Create a mock NES with tagged VROM tiles.
// Each tile's pix[0] = bank4k index, pix[1] = tile-within-bank index.
// This lets tests verify exactly which VROM bank a ptTile entry came from.
function createTaggedMockNes(vromCount) {
  let mockNes = {
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
      nameTable: [
        new NameTable(32, 32, "Nt0"),
        new NameTable(32, 32, "Nt1"),
        new NameTable(32, 32, "Nt2"),
        new NameTable(32, 32, "Nt3"),
      ],
      ntable1: [0, 1, 2, 3],
      scanline: 0,
      f_bgVisibility: 0,
      f_spVisibility: 0,
      f_spriteSize: 0,
      validTileData: false,
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
        return (value >> 3) + 1;
      },
    },
    rom: {
      valid: true,
      romCount: 8,
      vromCount: vromCount,
      rom: [],
      vrom: [],
      vromTile: [],
      batteryRam: false,
      HORIZONTAL_MIRRORING: 1,
      VERTICAL_MIRRORING: 0,
    },
    opts: {
      onBatteryRamWrite: function () {},
    },
  };

  // Populate PRG ROM
  for (let i = 0; i < mockNes.rom.romCount; i++) {
    mockNes.rom.rom[i] = new Uint8Array(16384);
    for (let j = 0; j < 16384; j++) {
      mockNes.rom.rom[i][j] = (i * 16 + (j & 0x0f)) & 0xff;
    }
  }

  // Populate VROM with tagged tiles.
  // vromTile[bank4k][tileInBank] has pix[0]=bank4k, pix[1]=tileInBank.
  // This makes it trivial to check which bank a tile came from.
  for (let i = 0; i < vromCount; i++) {
    mockNes.rom.vrom[i] = new Uint8Array(4096);
    mockNes.rom.vromTile[i] = [];
    for (let j = 0; j < 256; j++) {
      let tile = new Tile();
      tile.pix[0] = i; // bank4k index
      tile.pix[1] = j; // tile index within this 4K bank
      mockNes.rom.vromTile[i][j] = tile;
    }
    // Also fill the raw VROM data
    for (let j = 0; j < 4096; j++) {
      mockNes.rom.vrom[i][j] = (i + j) & 0xff;
    }
  }

  // Init vramMirrorTable to identity
  for (let i = 0; i < 0x8000; i++) {
    mockNes.ppu.vramMirrorTable[i] = i;
  }

  return mockNes;
}

// Helper: check that ptTile[index] comes from the expected bank and tile position.
function assertTileOrigin(
  ptTile,
  index,
  expectedBank4k,
  expectedTileInBank,
  msg,
) {
  let tile = ptTile[index];
  assert.ok(tile, `${msg}: ptTile[${index}] should not be null/undefined`);
  assert.strictEqual(
    tile.pix[0],
    expectedBank4k,
    `${msg}: ptTile[${index}] bank4k should be ${expectedBank4k}, got ${tile.pix[0]}`,
  );
  assert.strictEqual(
    tile.pix[1],
    expectedTileInBank,
    `${msg}: ptTile[${index}] tileInBank should be ${expectedTileInBank}, got ${tile.pix[1]}`,
  );
}

// Compute expected bank4k and tileInBank for a 1K bank number and slot.
// bank1k = the 1K bank number written to the CHR register
// slotTile = the tile index within the 1K slot (0-63)
function expected1k(bank1k, slotTile) {
  return {
    bank4k: Math.floor(bank1k / 4),
    tileInBank: ((bank1k % 4) << 6) + slotTile,
  };
}

// Compute expected bank4k and tileInBank for a 2K bank number.
function expected2k(bank2k, slotTile) {
  return {
    bank4k: Math.floor(bank2k / 2),
    tileInBank: ((bank2k % 2) << 7) + slotTile,
  };
}

describe("MMC5 CHR bank switching", function () {
  const VROM_COUNT = 64; // 64 x 4K = 256K CHR ROM (like CV3)
  let mapper, mockNes;

  beforeEach(function () {
    mockNes = createTaggedMockNes(VROM_COUNT);
    mapper = new Mappers[5](mockNes);
    mockNes.mmap = mapper;
  });

  // --- 8x8 sprite mode: always Set A ---
  describe("8x8 sprite mode (always Set A)", function () {
    beforeEach(function () {
      mockNes.ppu.f_spriteSize = 0; // 8x8
    });

    it("_syncChr loads Set A and ignores Set B", function () {
      // Write distinct banks to Set A and Set B
      mapper.write(0x5101, 3); // CHR mode 3 (1K)
      for (let i = 0; i < 8; i++) {
        mapper.write(0x5120 + i, i + 10); // Set A: banks 10-17
      }
      for (let i = 0; i < 4; i++) {
        mapper.write(0x5128 + i, i + 50); // Set B: banks 50-53
      }

      // In 8x8 mode, ptTile should have Set A data
      let e = expected1k(10, 0);
      assertTileOrigin(mockNes.ppu.ptTile, 0, e.bank4k, e.tileInBank, "slot 0");

      e = expected1k(17, 0);
      assertTileOrigin(
        mockNes.ppu.ptTile,
        448,
        e.bank4k,
        e.tileInBank,
        "slot 7",
      );
    });

    it("onBgRender is a no-op", function () {
      mapper.write(0x5101, 3);
      for (let i = 0; i < 8; i++) {
        mapper.write(0x5120 + i, i + 10);
      }
      for (let i = 0; i < 4; i++) {
        mapper.write(0x5128 + i, i + 50);
      }

      // Capture current ptTile state
      let tileBefore = mockNes.ppu.ptTile[0];

      // onBgRender should not change anything
      mapper.onBgRender();
      assert.strictEqual(
        mockNes.ppu.ptTile[0],
        tileBefore,
        "ptTile should not change",
      );
    });

    it("onSpriteRender is a no-op", function () {
      mapper.write(0x5101, 3);
      for (let i = 0; i < 8; i++) {
        mapper.write(0x5120 + i, i + 10);
      }

      let tileBefore = mockNes.ppu.ptTile[0];
      mapper.onSpriteRender();
      assert.strictEqual(mockNes.ppu.ptTile[0], tileBefore);
    });

    it("getSpritePatternTile returns from ptTile directly", function () {
      mapper.write(0x5101, 3);
      for (let i = 0; i < 8; i++) {
        mapper.write(0x5120 + i, i + 10);
      }

      let tile = mapper.getSpritePatternTile(0);
      assert.strictEqual(
        tile,
        mockNes.ppu.ptTile[0],
        "should return ptTile[0] directly",
      );
    });
  });

  // --- 8x16 sprite mode: CHR mode 3 (1K banks) ---
  describe("8x16 sprite mode, CHR mode 3 (1K banks)", function () {
    beforeEach(function () {
      mockNes.ppu.f_spriteSize = 1; // 8x16
      mapper.write(0x5101, 3); // CHR mode 3

      // Set A: banks 10, 11, 12, 13, 14, 15, 16, 17
      for (let i = 0; i < 8; i++) {
        mapper.write(0x5120 + i, i + 10);
      }
      // Set B: banks 50, 51, 52, 53
      for (let i = 0; i < 4; i++) {
        mapper.write(0x5128 + i, i + 50);
      }
    });

    it("onSpriteRender loads Set A into ptTile", function () {
      mapper.onSpriteRender();

      // Check first tile of each 1K slot
      for (let i = 0; i < 8; i++) {
        let e = expected1k(i + 10, 0);
        assertTileOrigin(
          mockNes.ppu.ptTile,
          i * 64,
          e.bank4k,
          e.tileInBank,
          `Set A slot ${i}`,
        );
      }
      // Check last tile of a slot
      let e = expected1k(10, 63);
      assertTileOrigin(
        mockNes.ppu.ptTile,
        63,
        e.bank4k,
        e.tileInBank,
        "Set A slot 0 last tile",
      );
    });

    it("onBgRender loads Set B into ptTile (replicated)", function () {
      mapper.onBgRender();

      // Set B replicates 4 banks across both halves ($0000 and $1000)
      for (let i = 0; i < 4; i++) {
        let e = expected1k(i + 50, 0);
        // First half
        assertTileOrigin(
          mockNes.ppu.ptTile,
          i * 64,
          e.bank4k,
          e.tileInBank,
          `Set B first half slot ${i}`,
        );
        // Second half (mirrored)
        assertTileOrigin(
          mockNes.ppu.ptTile,
          (i + 4) * 64,
          e.bank4k,
          e.tileInBank,
          `Set B second half slot ${i}`,
        );
      }
    });

    it("onSpriteRender then onBgRender switches correctly", function () {
      mapper.onSpriteRender();

      // Verify Set A
      let eA = expected1k(10, 0);
      assertTileOrigin(
        mockNes.ppu.ptTile,
        0,
        eA.bank4k,
        eA.tileInBank,
        "after onSpriteRender",
      );

      mapper.onBgRender();

      // Verify Set B
      let eB = expected1k(50, 0);
      assertTileOrigin(
        mockNes.ppu.ptTile,
        0,
        eB.bank4k,
        eB.tileInBank,
        "after onBgRender",
      );
    });

    it("repeated calls are no-ops (target tracking)", function () {
      mapper.onSpriteRender();
      assert.strictEqual(mapper._chrBankTarget, 0);

      // Second call should be a no-op
      let tileBefore = mockNes.ppu.ptTile[0];
      mapper.onSpriteRender();
      assert.strictEqual(
        mockNes.ppu.ptTile[0],
        tileBefore,
        "second onSpriteRender should be no-op",
      );

      mapper.onBgRender();
      assert.strictEqual(mapper._chrBankTarget, 1);

      tileBefore = mockNes.ppu.ptTile[0];
      mapper.onBgRender();
      assert.strictEqual(
        mockNes.ppu.ptTile[0],
        tileBefore,
        "second onBgRender should be no-op",
      );
    });

    it("CHR register write invalidates target", function () {
      mapper.onSpriteRender();
      assert.strictEqual(mapper._chrBankTarget, 0);

      // Writing a CHR register should invalidate
      mapper.write(0x5120, 20);
      assert.strictEqual(mapper._chrBankTarget, -1);
    });

    it("onBgRender sets validTileData to false", function () {
      mockNes.ppu.validTileData = true;
      mapper.onBgRender();
      assert.strictEqual(
        mockNes.ppu.validTileData,
        false,
        "should invalidate tile cache",
      );
    });
  });

  // --- getSpritePatternTile correctness ---
  // This is the critical test: getSpritePatternTile must return Set A tiles
  // regardless of what's currently in ptTile. It reads directly from vromTile.
  describe("getSpritePatternTile (8x16 mode)", function () {
    beforeEach(function () {
      mockNes.ppu.f_spriteSize = 1;
    });

    it("mode 3 (1K): returns Set A tiles when Set B is loaded", function () {
      mapper.write(0x5101, 3);
      for (let i = 0; i < 8; i++) {
        mapper.write(0x5120 + i, i + 10);
      }
      for (let i = 0; i < 4; i++) {
        mapper.write(0x5128 + i, i + 50);
      }

      // Load Set B into ptTile
      mapper.onBgRender();

      // getSpritePatternTile should still return Set A tiles
      for (let idx = 0; idx < 512; idx++) {
        let slot = idx >> 6; // 0-7
        let tileInSlot = idx & 63;
        let bank1k = mapper.chrBankA[slot] & 0x3ff;
        let bank4k = Math.floor(bank1k / 4) % VROM_COUNT;
        let expectedTileInBank = ((bank1k % 4) << 6) + tileInSlot;

        let tile = mapper.getSpritePatternTile(idx);
        assert.strictEqual(
          tile.pix[0],
          bank4k,
          `idx ${idx}: bank4k should be ${bank4k}, got ${tile.pix[0]}`,
        );
        assert.strictEqual(
          tile.pix[1],
          expectedTileInBank,
          `idx ${idx}: tileInBank should be ${expectedTileInBank}, got ${tile.pix[1]}`,
        );
      }
    });

    it("mode 3: matches _applyChrSetA for all 512 indices", function () {
      mapper.write(0x5101, 3);
      // Use varied bank numbers to catch off-by-one errors
      mapper.write(0x5120, 0);
      mapper.write(0x5121, 7);
      mapper.write(0x5122, 15);
      mapper.write(0x5123, 31);
      mapper.write(0x5124, 63);
      mapper.write(0x5125, 100);
      mapper.write(0x5126, 200);
      mapper.write(0x5127, 255);

      // Load Set A into ptTile via onSpriteRender
      mapper.onSpriteRender();

      // Every ptTile entry should match getSpritePatternTile
      for (let idx = 0; idx < 512; idx++) {
        let fromPtTile = mockNes.ppu.ptTile[idx];
        let fromMethod = mapper.getSpritePatternTile(idx);
        assert.strictEqual(
          fromPtTile.pix[0],
          fromMethod.pix[0],
          `idx ${idx}: bank4k mismatch (ptTile=${fromPtTile.pix[0]}, method=${fromMethod.pix[0]})`,
        );
        assert.strictEqual(
          fromPtTile.pix[1],
          fromMethod.pix[1],
          `idx ${idx}: tileInBank mismatch (ptTile=${fromPtTile.pix[1]}, method=${fromMethod.pix[1]})`,
        );
      }
    });

    it("mode 2 (2K): returns correct Set A tiles", function () {
      mapper.write(0x5101, 2);
      // 2K mode: registers 1, 3, 5, 7 select 2K banks
      mapper.write(0x5121, 5); // $0000-$07FF
      mapper.write(0x5123, 10); // $0800-$0FFF
      mapper.write(0x5125, 20); // $1000-$17FF
      mapper.write(0x5127, 30); // $1800-$1FFF

      // Load Set A
      mapper.onSpriteRender();

      // Check a tile from each 2K slot
      let slots = [
        { regIdx: 1, ptBase: 0 },
        { regIdx: 3, ptBase: 128 },
        { regIdx: 5, ptBase: 256 },
        { regIdx: 7, ptBase: 384 },
      ];
      for (let s of slots) {
        let bank2k = mapper.chrBankA[s.regIdx] & 0x1ff;
        let e = expected2k(bank2k, 0);
        assertTileOrigin(
          mockNes.ppu.ptTile,
          s.ptBase,
          e.bank4k,
          e.tileInBank,
          `2K slot reg ${s.regIdx}`,
        );

        // Also verify getSpritePatternTile
        let tile = mapper.getSpritePatternTile(s.ptBase);
        assert.strictEqual(tile.pix[0], e.bank4k, `getSPT 2K reg ${s.regIdx}`);
      }
    });

    it("mode 2: matches _applyChrSetA for all 512 indices", function () {
      mapper.write(0x5101, 2);
      mapper.write(0x5121, 5);
      mapper.write(0x5123, 10);
      mapper.write(0x5125, 20);
      mapper.write(0x5127, 30);

      mapper.onSpriteRender();

      for (let idx = 0; idx < 512; idx++) {
        let fromPtTile = mockNes.ppu.ptTile[idx];
        let fromMethod = mapper.getSpritePatternTile(idx);
        assert.strictEqual(
          fromPtTile.pix[0],
          fromMethod.pix[0],
          `mode 2 idx ${idx}: bank4k mismatch`,
        );
        assert.strictEqual(
          fromPtTile.pix[1],
          fromMethod.pix[1],
          `mode 2 idx ${idx}: tileInBank mismatch`,
        );
      }
    });

    it("mode 1 (4K): returns correct Set A tiles", function () {
      mapper.write(0x5101, 1);
      // 4K mode: register 3 → $0000, register 7 → $1000
      mapper.write(0x5123, 8); // $0000-$0FFF: 4K bank 8
      mapper.write(0x5127, 20); // $1000-$1FFF: 4K bank 20

      mapper.onSpriteRender();

      // First 256 tiles from bank 8
      assertTileOrigin(mockNes.ppu.ptTile, 0, 8, 0, "4K first half start");
      assertTileOrigin(mockNes.ppu.ptTile, 255, 8, 255, "4K first half end");

      // Next 256 tiles from bank 20
      assertTileOrigin(mockNes.ppu.ptTile, 256, 20, 0, "4K second half start");
      assertTileOrigin(mockNes.ppu.ptTile, 511, 20, 255, "4K second half end");

      // getSpritePatternTile should match
      for (let idx = 0; idx < 512; idx++) {
        let fromPtTile = mockNes.ppu.ptTile[idx];
        let fromMethod = mapper.getSpritePatternTile(idx);
        assert.strictEqual(
          fromPtTile.pix[0],
          fromMethod.pix[0],
          `mode 1 idx ${idx}: bank4k mismatch`,
        );
        assert.strictEqual(
          fromPtTile.pix[1],
          fromMethod.pix[1],
          `mode 1 idx ${idx}: tileInBank mismatch`,
        );
      }
    });

    it("mode 0 (8K): returns correct Set A tiles", function () {
      mapper.write(0x5101, 0);
      // 8K mode: register 7 selects an 8K bank (two consecutive 4K banks)
      mapper.write(0x5127, 5); // 8K bank 5 = 4K banks 10 and 11

      mapper.onSpriteRender();

      // First 256 tiles from 4K bank 10
      assertTileOrigin(mockNes.ppu.ptTile, 0, 10, 0, "8K first half start");
      assertTileOrigin(mockNes.ppu.ptTile, 255, 10, 255, "8K first half end");

      // Next 256 tiles from 4K bank 11
      assertTileOrigin(mockNes.ppu.ptTile, 256, 11, 0, "8K second half start");
      assertTileOrigin(mockNes.ppu.ptTile, 511, 11, 255, "8K second half end");

      // getSpritePatternTile should match
      for (let idx = 0; idx < 512; idx++) {
        let fromPtTile = mockNes.ppu.ptTile[idx];
        let fromMethod = mapper.getSpritePatternTile(idx);
        assert.strictEqual(
          fromPtTile.pix[0],
          fromMethod.pix[0],
          `mode 0 idx ${idx}: bank4k mismatch`,
        );
        assert.strictEqual(
          fromPtTile.pix[1],
          fromMethod.pix[1],
          `mode 0 idx ${idx}: tileInBank mismatch`,
        );
      }
    });
  });

  // --- Set B bank replication across all CHR modes ---
  describe("Set B replication (8x16 mode)", function () {
    beforeEach(function () {
      mockNes.ppu.f_spriteSize = 1;
    });

    it("mode 3: 4 registers mirrored across both halves", function () {
      mapper.write(0x5101, 3);
      mapper.write(0x5128, 40); // → ptTile[0..63] and ptTile[256..319]
      mapper.write(0x5129, 41); // → ptTile[64..127] and ptTile[320..383]
      mapper.write(0x512a, 42); // → ptTile[128..191] and ptTile[384..447]
      mapper.write(0x512b, 43); // → ptTile[192..255] and ptTile[448..511]

      mapper.onBgRender();

      for (let i = 0; i < 4; i++) {
        let e = expected1k(40 + i, 0);
        // First half ($0000-$0FFF)
        assertTileOrigin(
          mockNes.ppu.ptTile,
          i * 64,
          e.bank4k,
          e.tileInBank,
          `Set B mode 3 first half slot ${i}`,
        );
        // Second half ($1000-$1FFF, mirrored)
        assertTileOrigin(
          mockNes.ppu.ptTile,
          (i + 4) * 64,
          e.bank4k,
          e.tileInBank,
          `Set B mode 3 second half slot ${i}`,
        );
      }
    });

    it("mode 2: 2 registers mirrored", function () {
      mapper.write(0x5101, 2);
      mapper.write(0x5129, 20); // → $0000 and $1000
      mapper.write(0x512b, 25); // → $0800 and $1800

      mapper.onBgRender();

      let e0 = expected2k(20, 0);
      let e1 = expected2k(25, 0);

      // First half
      assertTileOrigin(
        mockNes.ppu.ptTile,
        0,
        e0.bank4k,
        e0.tileInBank,
        "Set B mode 2 $0000",
      );
      assertTileOrigin(
        mockNes.ppu.ptTile,
        128,
        e1.bank4k,
        e1.tileInBank,
        "Set B mode 2 $0800",
      );
      // Second half (mirrored)
      assertTileOrigin(
        mockNes.ppu.ptTile,
        256,
        e0.bank4k,
        e0.tileInBank,
        "Set B mode 2 $1000",
      );
      assertTileOrigin(
        mockNes.ppu.ptTile,
        384,
        e1.bank4k,
        e1.tileInBank,
        "Set B mode 2 $1800",
      );
    });

    it("mode 1: register $512B duplicated to both halves", function () {
      mapper.write(0x5101, 1);
      mapper.write(0x512b, 15); // Both $0000 and $1000

      mapper.onBgRender();

      // 4K bank 15 at both halves
      assertTileOrigin(mockNes.ppu.ptTile, 0, 15, 0, "Set B mode 1 $0000");
      assertTileOrigin(mockNes.ppu.ptTile, 255, 15, 255, "Set B mode 1 $0FFF");
      assertTileOrigin(mockNes.ppu.ptTile, 256, 15, 0, "Set B mode 1 $1000");
      assertTileOrigin(mockNes.ppu.ptTile, 511, 15, 255, "Set B mode 1 $1FFF");
    });

    it("mode 0: register $512B selects 8K bank", function () {
      mapper.write(0x5101, 0);
      mapper.write(0x512b, 3); // 8K bank 3 = 4K banks 6 and 7

      mapper.onBgRender();

      assertTileOrigin(mockNes.ppu.ptTile, 0, 6, 0, "Set B mode 0 $0000");
      assertTileOrigin(mockNes.ppu.ptTile, 256, 7, 0, "Set B mode 0 $1000");
    });
  });

  // --- Rendering pipeline sequence ---
  // Simulates the order of operations during a real frame to verify
  // that bank data is correct at each phase.
  describe("rendering pipeline sequence", function () {
    beforeEach(function () {
      mockNes.ppu.f_spriteSize = 1;
      mapper.write(0x5101, 3);

      // Set A: banks 10-17, Set B: banks 50-53
      for (let i = 0; i < 8; i++) {
        mapper.write(0x5120 + i, i + 10);
      }
      for (let i = 0; i < 4; i++) {
        mapper.write(0x5128 + i, i + 50);
      }
    });

    it("full frame sequence: sprite render → BG render → sprite render", function () {
      // Phase 1: renderFramePartially calls onSpriteRender first
      mapper.onSpriteRender();
      let eA = expected1k(10, 0);
      assertTileOrigin(
        mockNes.ppu.ptTile,
        0,
        eA.bank4k,
        eA.tileInBank,
        "phase 1: sprite render",
      );

      // Phase 2: renderFramePartially calls onBgRender at the end
      mapper.onBgRender();
      let eB = expected1k(50, 0);
      assertTileOrigin(
        mockNes.ppu.ptTile,
        0,
        eB.bank4k,
        eB.tileInBank,
        "phase 2: BG render",
      );

      // Phase 3: renderBgScanline calls onBgRender (should be no-op)
      let tileBefore = mockNes.ppu.ptTile[0];
      mapper.onBgRender();
      assert.strictEqual(
        mockNes.ppu.ptTile[0],
        tileBefore,
        "phase 3: repeated onBgRender should be no-op",
      );

      // Phase 4: next renderFramePartially calls onSpriteRender
      mapper.onSpriteRender();
      assertTileOrigin(
        mockNes.ppu.ptTile,
        0,
        eA.bank4k,
        eA.tileInBank,
        "phase 4: sprite render again",
      );
    });

    it("mid-frame CHR register write triggers re-sync", function () {
      // Start with Set A loaded
      mapper.onSpriteRender();
      assert.strictEqual(mapper._chrBankTarget, 0);

      // Switch to Set B
      mapper.onBgRender();
      assert.strictEqual(mapper._chrBankTarget, 1);

      // Game writes a new CHR bank register mid-frame
      mapper.write(0x5120, 30); // Change Set A slot 0

      // Target should be invalidated
      assert.strictEqual(mapper._chrBankTarget, -1);

      // Next onSpriteRender should re-apply Set A with the new bank
      mapper.onSpriteRender();
      let e = expected1k(30, 0);
      assertTileOrigin(
        mockNes.ppu.ptTile,
        0,
        e.bank4k,
        e.tileInBank,
        "after mid-frame CHR write",
      );
    });

    it("switching from 8x8 to 8x16 mode works correctly", function () {
      // Start in 8x8 mode
      mockNes.ppu.f_spriteSize = 0;
      mapper._syncChr(); // This loads Set A
      assert.strictEqual(mapper._chrBankTarget, 0);

      // onBgRender/onSpriteRender are no-ops in 8x8
      mapper.onBgRender();
      mapper.onSpriteRender();
      let eA = expected1k(10, 0);
      assertTileOrigin(
        mockNes.ppu.ptTile,
        0,
        eA.bank4k,
        eA.tileInBank,
        "8x8 mode",
      );

      // Switch to 8x16 mode
      mockNes.ppu.f_spriteSize = 1;
      // Target is still 0 (Set A), but now onBgRender should work
      mapper.onBgRender();
      let eB = expected1k(50, 0);
      assertTileOrigin(
        mockNes.ppu.ptTile,
        0,
        eB.bank4k,
        eB.tileInBank,
        "after switch to 8x16",
      );
    });
  });

  // --- ExRAM mode 1 ---
  describe("ExRAM mode 1 (extended attributes)", function () {
    it("getBgTileData returns correct tile from per-tile bank", function () {
      mapper.write(0x5104, 1); // ExRAM mode 1

      // Set in-frame so ExRAM writes are accepted
      mockNes.ppu.scanline = 20;
      mockNes.ppu.f_bgVisibility = 1;
      mapper.clockIrqCounter();

      // Write ExRAM byte for tile at (ht=0, vt=0): bank 10, palette 2
      // Byte = (palette << 6) | bankLow6
      let exByte = (2 << 6) | 10;
      mapper.write(0x5c00, exByte);

      // Write ExRAM byte for tile at (ht=5, vt=3): bank 20, palette 1
      let exByte2 = (1 << 6) | 20;
      mapper.write(0x5c00 + 3 * 32 + 5, exByte2);

      let result1 = mapper.getBgTileData(0, 42, 0, 0);
      assert.ok(result1, "should return tile data");
      assert.strictEqual(
        result1.tile.pix[0],
        10,
        "tile should be from bank 10",
      );
      assert.strictEqual(result1.tile.pix[1], 42, "tile index should be 42");
      assert.strictEqual(result1.attrib, 2 << 2, "palette should be 2 << 2");

      let result2 = mapper.getBgTileData(0, 100, 5, 3);
      assert.ok(result2);
      assert.strictEqual(result2.tile.pix[0], 20, "tile from bank 20");
      assert.strictEqual(result2.tile.pix[1], 100, "tile index 100");
      assert.strictEqual(result2.attrib, 1 << 2, "palette 1 << 2");
    });

    it("uses chrUpperBits ($5130) for upper bank bits", function () {
      mapper.write(0x5104, 1);
      mapper.write(0x5130, 1); // Upper bits = 1

      mockNes.ppu.scanline = 20;
      mockNes.ppu.f_bgVisibility = 1;
      mapper.clockIrqCounter();

      // ExRAM byte: bank low 6 = 0 → combined bank = (1 << 6) | 0 = 64
      // But 64 >= VROM_COUNT(64), so it wraps to 0
      let exByte = 0;
      mapper.write(0x5c00, exByte);
      let result = mapper.getBgTileData(0, 0, 0, 0);
      // Expected: (0 & 0x3F) | (1 << 6) = 64, 64 % 64 = 0
      assert.strictEqual(result.tile.pix[0], 0, "bank should wrap to 0");

      // ExRAM byte: bank low 6 = 1 → combined = 65 % 64 = 1
      mapper.write(0x5c01, 1);
      let result2 = mapper.getBgTileData(0, 0, 1, 0);
      assert.strictEqual(result2.tile.pix[0], 1, "bank should wrap to 1");
    });

    it("returns null when ExRAM mode is not 1", function () {
      mapper.write(0x5104, 0); // mode 0
      let result = mapper.getBgTileData(0, 0, 0, 0);
      assert.strictEqual(result, null);
    });
  });

  // --- Edge cases ---
  describe("edge cases", function () {
    it("bank numbers that exceed vromCount wrap correctly", function () {
      mockNes.ppu.f_spriteSize = 1;
      mapper.write(0x5101, 3);

      // Bank 255 in 1K mode: bank4k = 63, which is max for 64 banks
      mapper.write(0x5120, 255);
      mapper.onSpriteRender();

      let e = expected1k(255, 0);
      assertTileOrigin(
        mockNes.ppu.ptTile,
        0,
        e.bank4k % VROM_COUNT,
        e.tileInBank,
        "bank 255 wraps correctly",
      );

      // Also check getSpritePatternTile
      let tile = mapper.getSpritePatternTile(0);
      assert.strictEqual(tile.pix[0], e.bank4k % VROM_COUNT);
    });

    it("chrUpperBits ($5130) extends bank range", function () {
      mockNes.ppu.f_spriteSize = 0; // 8x8 mode
      mapper.write(0x5101, 3);
      mapper.write(0x5130, 1); // Upper bits = 1

      // Write bank value 0 with upper bits 1 → actual bank = (1 << 8) | 0 = 256
      // Masked by & 0x3ff = 256. bank4k = 256/4 = 64, wraps to 0 (64 % 64)
      mapper.write(0x5120, 0);

      let bank1k = (1 << 8) | 0; // = 256
      let e = expected1k(bank1k, 0);
      assertTileOrigin(
        mockNes.ppu.ptTile,
        0,
        e.bank4k % VROM_COUNT,
        e.tileInBank,
        "chrUpperBits extends bank",
      );
    });

    it("lastChrWrite tracking for $2007 access", function () {
      // Writing to Set A registers sets lastChrWrite to 0
      mapper.write(0x5120, 5);
      assert.strictEqual(mapper.lastChrWrite, 0);

      // Writing to Set B registers sets lastChrWrite to 1
      mapper.write(0x5128, 10);
      assert.strictEqual(mapper.lastChrWrite, 1);

      // Back to Set A
      mapper.write(0x5127, 15);
      assert.strictEqual(mapper.lastChrWrite, 0);
    });
  });

  // --- Comprehensive consistency check ---
  // For every CHR mode, verify that getSpritePatternTile and _applyChrSetA
  // agree on every tile index. This is the most thorough correctness check.
  describe("getSpritePatternTile vs _applyChrSetA full consistency", function () {
    beforeEach(function () {
      mockNes.ppu.f_spriteSize = 1;
    });

    function testConsistency(chrMode, bankValues) {
      mapper.write(0x5101, chrMode);
      for (let i = 0; i < bankValues.length; i++) {
        mapper.write(0x5120 + i, bankValues[i]);
      }

      // Load Set A into ptTile
      mapper.onSpriteRender();

      // Now check every index
      let mismatches = [];
      for (let idx = 0; idx < 512; idx++) {
        let fromPtTile = mockNes.ppu.ptTile[idx];
        let fromMethod = mapper.getSpritePatternTile(idx);
        if (
          fromPtTile.pix[0] !== fromMethod.pix[0] ||
          fromPtTile.pix[1] !== fromMethod.pix[1]
        ) {
          mismatches.push({
            idx,
            ptBank: fromPtTile.pix[0],
            ptTile: fromPtTile.pix[1],
            methodBank: fromMethod.pix[0],
            methodTile: fromMethod.pix[1],
          });
        }
      }
      assert.strictEqual(
        mismatches.length,
        0,
        `${mismatches.length} mismatches found: ${JSON.stringify(mismatches.slice(0, 5))}`,
      );
    }

    it("mode 0 (8K) with various bank values", function () {
      testConsistency(0, [0, 0, 0, 0, 0, 0, 0, 3]);
      testConsistency(0, [0, 0, 0, 0, 0, 0, 0, 31]);
    });

    it("mode 1 (4K) with various bank values", function () {
      testConsistency(1, [0, 0, 0, 8, 0, 0, 0, 20]);
      testConsistency(1, [0, 0, 0, 63, 0, 0, 0, 0]);
    });

    it("mode 2 (2K) with various bank values", function () {
      testConsistency(2, [0, 5, 0, 10, 0, 20, 0, 30]);
      testConsistency(2, [0, 127, 0, 0, 0, 63, 0, 1]);
    });

    it("mode 3 (1K) with sequential banks", function () {
      testConsistency(3, [0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it("mode 3 (1K) with scattered banks", function () {
      testConsistency(3, [255, 128, 64, 32, 16, 8, 4, 2]);
    });

    it("mode 3 (1K) with all same bank", function () {
      testConsistency(3, [42, 42, 42, 42, 42, 42, 42, 42]);
    });

    it("mode 3 (1K) with high bank numbers", function () {
      testConsistency(3, [200, 201, 202, 203, 204, 205, 206, 207]);
    });
  });
});

// --- Nametable Synchronization Tests ---
// The MMC5's nametable mapping ($5105) controls which source each nametable
// slot reads from: CIRAM A, CIRAM B, ExRAM, or Fill. The PPU has TWO
// parallel data structures: vramMem (raw bytes for $2007) and nameTable[]
// objects (parsed tile/attrib for rendering). Both must be updated.

function createNametableMockNes() {
  let mockNes = {
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
      nameTable: [],
      ntable1: new Array(4).fill(0),
      scanline: 0,
      f_bgVisibility: 0,
      f_spVisibility: 0,
      f_spriteSize: 0,
      validTileData: false,
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
        return (value >> 3) + 1;
      },
    },
    rom: {
      valid: true,
      romCount: 8,
      vromCount: 16,
      rom: [],
      vrom: [],
      vromTile: [],
      batteryRam: false,
      HORIZONTAL_MIRRORING: 1,
      VERTICAL_MIRRORING: 0,
    },
    opts: {
      onBatteryRamWrite: function () {},
    },
  };

  // Create 4 NameTable objects (same as PPU constructor)
  for (let i = 0; i < 4; i++) {
    mockNes.ppu.nameTable[i] = new NameTable(32, 32, `Nt${i}`);
  }

  // Populate ROM
  for (let i = 0; i < mockNes.rom.romCount; i++) {
    mockNes.rom.rom[i] = new Uint8Array(16384);
  }
  for (let i = 0; i < mockNes.rom.vromCount; i++) {
    mockNes.rom.vrom[i] = new Uint8Array(4096);
    mockNes.rom.vromTile[i] = new Array(256).fill(null).map(() => new Tile());
  }

  // Init vramMirrorTable to identity
  for (let i = 0; i < 0x8000; i++) {
    mockNes.ppu.vramMirrorTable[i] = i;
  }

  return mockNes;
}

describe("MMC5 nametable synchronization", function () {
  let mapper, mockNes;

  beforeEach(function () {
    mockNes = createNametableMockNes();
    mapper = new Mappers[5](mockNes);
    mockNes.mmap = mapper;
  });

  describe("ntable1 updates", function () {
    it("ntable1 matches ntMapping after $5105 write", function () {
      // Map: slot 0=CIRAM A, slot 1=ExRAM, slot 2=Fill, slot 3=CIRAM B
      // Binary: 01 11 10 00 = 0x78
      mapper.write(0x5105, 0x78);

      assert.strictEqual(mockNes.ppu.ntable1[0], 0, "slot 0 = CIRAM A");
      assert.strictEqual(mockNes.ppu.ntable1[1], 2, "slot 1 = ExRAM");
      assert.strictEqual(mockNes.ppu.ntable1[2], 3, "slot 2 = Fill");
      assert.strictEqual(mockNes.ppu.ntable1[3], 1, "slot 3 = CIRAM B");
    });

    it("all slots mapped to same source", function () {
      // All Fill: 11 11 11 11 = 0xFF
      mapper.write(0x5105, 0xff);

      for (let i = 0; i < 4; i++) {
        assert.strictEqual(
          mockNes.ppu.ntable1[i],
          3,
          `slot ${i} should be Fill`,
        );
      }
    });

    it("vertical mirroring equivalent", function () {
      // Slots: A, B, A, B → 01 00 01 00 = 0x44
      mapper.write(0x5105, 0x44);

      assert.strictEqual(mockNes.ppu.ntable1[0], 0);
      assert.strictEqual(mockNes.ppu.ntable1[1], 1);
      assert.strictEqual(mockNes.ppu.ntable1[2], 0);
      assert.strictEqual(mockNes.ppu.ntable1[3], 1);
    });
  });

  describe("fill mode NameTable population", function () {
    it("NameTable 3 has fill tile data", function () {
      mapper.write(0x5106, 0x42); // fill tile = 0x42
      mapper.write(0x5107, 0x01); // fill attr = 1

      // Map slot 0 to fill
      mapper.write(0x5105, 0x03);

      let nt3 = mockNes.ppu.nameTable[3];
      // All 960 tiles should be the fill tile
      assert.strictEqual(nt3.tile[0], 0x42);
      assert.strictEqual(nt3.tile[500], 0x42);
      assert.strictEqual(nt3.tile[959], 0x42);
    });

    it("NameTable 3 has fill attribute data", function () {
      mapper.write(0x5106, 0x00);
      mapper.write(0x5107, 0x02); // palette 2

      mapper.write(0x5105, 0x03);

      let nt3 = mockNes.ppu.nameTable[3];
      // Palette 2 should be decoded into per-tile attrib (2 << 2 = 8)
      assert.strictEqual(nt3.attrib[0], 8, "tile (0,0) attrib");
      assert.strictEqual(nt3.attrib[33], 8, "tile (1,1) attrib");
    });

    it("fill data updates when tile/attr changes", function () {
      mapper.write(0x5105, 0x03);
      mapper.write(0x5106, 0x10);

      assert.strictEqual(mockNes.ppu.nameTable[3].tile[0], 0x10);

      // Change fill tile
      mapper.write(0x5106, 0x20);
      assert.strictEqual(mockNes.ppu.nameTable[3].tile[0], 0x20);
    });
  });

  describe("ExRAM nametable population", function () {
    it("NameTable 2 has ExRAM data when in-frame", function () {
      mapper.write(0x5104, 0); // ExRAM mode 0 (nametable)

      // Set in-frame so writes are accepted
      mockNes.ppu.scanline = 20;
      mockNes.ppu.f_bgVisibility = 1;
      mapper.clockIrqCounter();

      // Write tile data to ExRAM
      mapper.write(0x5c00, 0xaa);
      mapper.write(0x5c00 + 100, 0xbb);

      let nt2 = mockNes.ppu.nameTable[2];
      assert.strictEqual(nt2.tile[0], 0xaa, "ExRAM tile 0");
      assert.strictEqual(nt2.tile[100], 0xbb, "ExRAM tile 100");
    });

    it("ExRAM attribute bytes update NameTable 2 attrib", function () {
      mapper.write(0x5104, 0);

      mockNes.ppu.scanline = 20;
      mockNes.ppu.f_bgVisibility = 1;
      mapper.clockIrqCounter();

      // Write an attribute byte at offset 960 (first attrib byte)
      // Attribute byte: palette 3 for all quadrants = 0xFF
      mapper.write(0x5c00 + 960, 0xff);

      let nt2 = mockNes.ppu.nameTable[2];
      // Palette 3 = (3 << 2) = 12 for the 4x4 tile area
      assert.strictEqual(nt2.attrib[0], 12, "attrib decoded correctly");
    });

    it("not-in-frame writes store 0 but still update NameTable", function () {
      mapper.write(0x5104, 0);
      // Not in-frame: writes store $00

      mapper.write(0x5c00, 0x42);

      let nt2 = mockNes.ppu.nameTable[2];
      assert.strictEqual(nt2.tile[0], 0x00, "should store 0 when not in-frame");
    });
  });

  describe("vramMirrorTable mapping", function () {
    it("ExRAM slot redirects through mirror table", function () {
      // Map slot 1 to ExRAM
      mapper.write(0x5105, 0x08); // slot 0=A(0), slot 1=ExRAM(2)

      // $2400 should redirect to $2800 (ExRAM)
      assert.strictEqual(
        mockNes.ppu.vramMirrorTable[0x2400],
        0x2800,
        "$2400 → $2800",
      );
    });

    it("Fill slot redirects through mirror table", function () {
      // Map slot 2 to Fill
      mapper.write(0x5105, 0x30); // slot 2=Fill(3)

      // $2800 should redirect to $2C00 (Fill)
      assert.strictEqual(
        mockNes.ppu.vramMirrorTable[0x2800],
        0x2c00,
        "$2800 → $2C00",
      );
    });
  });
});

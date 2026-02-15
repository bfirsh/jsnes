import Mapper4 from "./mapper4.js";
import Tile from "../tile.js";
import { copyArrayElements } from "../utils.js";

// TQROM - MMC3 variant that supports both CHR ROM and CHR RAM simultaneously.
// Used by Pin-Bot and High Speed (both by Rare).
// Identical to standard MMC3 except: bit 6 of the CHR bank register values
// selects between CHR ROM (0) and CHR RAM (1). Bits 0-5 specify the bank
// within the selected chip, allowing up to 64KB CHR ROM and 8KB CHR RAM.
// A 74HC32 ORs PPU A13 with CHR A16 (bit 6) to generate the ROM chip-enable,
// while CHR A16 directly enables the RAM chip.
// See https://www.nesdev.org/wiki/INES_Mapper_119
class Mapper119 extends Mapper4 {
  static mapperName = "TQROM";

  constructor(nes) {
    super(nes);

    // 8KB of CHR RAM (8 x 1KB banks)
    this.chrRam = new Uint8Array(8192);

    // Pre-decoded tiles for CHR RAM banks. Each 1KB bank has 64 tiles (1KB / 16
    // bytes per tile). These are persistent Tile objects: when a CHR RAM bank is
    // loaded into a PPU slot, ptTile entries point here, and PPU patternWrite()
    // updates them in place on $2007 writes.
    this.chrRamTiles = new Array(8);
    for (let i = 0; i < 8; i++) {
      this.chrRamTiles[i] = new Array(64);
      for (let j = 0; j < 64; j++) {
        this.chrRamTiles[i][j] = new Tile();
      }
    }

    // Tracks which CHR RAM bank (0-7) is mapped at each 1KB PPU pattern table
    // slot (0-7 for addresses $0000-$1FFF), or -1 if CHR ROM is there.
    this.chrRamSlots = [-1, -1, -1, -1, -1, -1, -1, -1];
  }

  executeCommand(cmd, arg) {
    switch (cmd) {
      case Mapper4.CMD_SEL_2_1K_VROM_0000: {
        // Select 2 consecutive 1KB banks at $0000/$0400 (or $1000/$1400)
        let base = this.chrAddressSelect === 0 ? 0x0000 : 0x1000;
        if (arg & 0x40) {
          let bank = arg & 0x06; // 2KB-aligned within CHR RAM
          this.load1kChrRamBank(bank, base);
          this.load1kChrRamBank(bank + 1, base + 0x0400);
        } else {
          let bank = arg & 0x3f;
          this.saveChrRamSlot(base);
          this.saveChrRamSlot(base + 0x0400);
          this.chrRamSlots[base >> 10] = -1;
          this.chrRamSlots[(base >> 10) + 1] = -1;
          this.load1kVromBank(bank, base);
          this.load1kVromBank(bank + 1, base + 0x0400);
        }
        break;
      }

      case Mapper4.CMD_SEL_2_1K_VROM_0800: {
        let base = this.chrAddressSelect === 0 ? 0x0800 : 0x1800;
        if (arg & 0x40) {
          let bank = arg & 0x06;
          this.load1kChrRamBank(bank, base);
          this.load1kChrRamBank(bank + 1, base + 0x0400);
        } else {
          let bank = arg & 0x3f;
          this.saveChrRamSlot(base);
          this.saveChrRamSlot(base + 0x0400);
          this.chrRamSlots[base >> 10] = -1;
          this.chrRamSlots[(base >> 10) + 1] = -1;
          this.load1kVromBank(bank, base);
          this.load1kVromBank(bank + 1, base + 0x0400);
        }
        break;
      }

      case Mapper4.CMD_SEL_1K_VROM_1000: {
        let base = this.chrAddressSelect === 0 ? 0x1000 : 0x0000;
        if (arg & 0x40) {
          this.load1kChrRamBank(arg & 0x07, base);
        } else {
          this.saveChrRamSlot(base);
          this.chrRamSlots[base >> 10] = -1;
          this.load1kVromBank(arg & 0x3f, base);
        }
        break;
      }

      case Mapper4.CMD_SEL_1K_VROM_1400: {
        let base = this.chrAddressSelect === 0 ? 0x1400 : 0x0400;
        if (arg & 0x40) {
          this.load1kChrRamBank(arg & 0x07, base);
        } else {
          this.saveChrRamSlot(base);
          this.chrRamSlots[base >> 10] = -1;
          this.load1kVromBank(arg & 0x3f, base);
        }
        break;
      }

      case Mapper4.CMD_SEL_1K_VROM_1800: {
        let base = this.chrAddressSelect === 0 ? 0x1800 : 0x0800;
        if (arg & 0x40) {
          this.load1kChrRamBank(arg & 0x07, base);
        } else {
          this.saveChrRamSlot(base);
          this.chrRamSlots[base >> 10] = -1;
          this.load1kVromBank(arg & 0x3f, base);
        }
        break;
      }

      case Mapper4.CMD_SEL_1K_VROM_1C00: {
        let base = this.chrAddressSelect === 0 ? 0x1c00 : 0x0c00;
        if (arg & 0x40) {
          this.load1kChrRamBank(arg & 0x07, base);
        } else {
          this.saveChrRamSlot(base);
          this.chrRamSlots[base >> 10] = -1;
          this.load1kVromBank(arg & 0x3f, base);
        }
        break;
      }

      default:
        // PRG commands (6, 7) pass through to MMC3
        super.executeCommand(cmd, arg);
    }
  }

  // Save the current vramMem content of a 1KB PPU slot back to chrRam.
  // This must be called before overwriting a slot that has CHR RAM mapped,
  // so that any PPU $2007 writes to that region are preserved.
  saveChrRamSlot(address) {
    let slot = address >> 10;
    let bank = this.chrRamSlots[slot];
    if (bank === -1) return;
    copyArrayElements(
      this.nes.ppu.vramMem,
      slot << 10,
      this.chrRam,
      bank * 1024,
      1024,
    );
  }

  // Load a 1KB CHR RAM bank into the PPU pattern table at the given address.
  load1kChrRamBank(bank, address) {
    this.nes.ppu.triggerRendering();
    bank &= 0x07;

    // Save the old CHR RAM content if this slot had a different bank mapped
    this.saveChrRamSlot(address);

    let slot = address >> 10;
    this.chrRamSlots[slot] = bank;

    // Copy CHR RAM data into PPU VRAM
    let srcOffset = bank * 1024;
    copyArrayElements(
      this.chrRam,
      srcOffset,
      this.nes.ppu.vramMem,
      address,
      1024,
    );

    // Rebuild tiles from CHR RAM data and install them in ppuTile
    this.rebuildChrRamTiles(bank);
    let baseIndex = address >> 4;
    for (let i = 0; i < 64; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = this.chrRamTiles[bank][i];
    }
  }

  // Rebuild the pre-decoded Tile objects for a CHR RAM bank from raw bytes.
  rebuildChrRamTiles(bank) {
    let base = bank * 1024;
    for (let i = 0; i < 1024; i++) {
      let tileIndex = i >> 4;
      let leftOver = i % 16;
      if (leftOver < 8) {
        this.chrRamTiles[bank][tileIndex].setScanline(
          leftOver,
          this.chrRam[base + i],
          this.chrRam[base + i + 8],
        );
      } else {
        this.chrRamTiles[bank][tileIndex].setScanline(
          leftOver - 8,
          this.chrRam[base + i - 8],
          this.chrRam[base + i],
        );
      }
    }
  }

  // Allow PPU writes to pattern table addresses that are mapped to CHR RAM.
  canWriteChr(address) {
    if (address >= 0x2000) return false;
    return this.chrRamSlots[address >> 10] !== -1;
  }

  toJSON() {
    // Flush any pending CHR RAM writes from vramMem back to chrRam
    for (let slot = 0; slot < 8; slot++) {
      this.saveChrRamSlot(slot << 10);
    }
    let s = super.toJSON();
    s.chrRam = Array.from(this.chrRam);
    s.chrRamSlots = this.chrRamSlots.slice();
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.chrRam = new Uint8Array(s.chrRam);
    this.chrRamSlots = s.chrRamSlots;
    // Rebuild all CHR RAM tile data
    for (let bank = 0; bank < 8; bank++) {
      this.rebuildChrRamTiles(bank);
    }
    // Re-install CHR RAM tiles into PPU ptTile for active slots
    for (let slot = 0; slot < 8; slot++) {
      let bank = this.chrRamSlots[slot];
      if (bank !== -1) {
        let baseIndex = (slot << 10) >> 4;
        for (let i = 0; i < 64; i++) {
          this.nes.ppu.ptTile[baseIndex + i] = this.chrRamTiles[bank][i];
        }
      }
    }
  }
}

export default Mapper119;

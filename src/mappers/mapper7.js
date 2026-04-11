import Mapper0 from "./mapper0.js";

// AxROM (NES-AMROM, NES-ANROM, NES-AOROM)
// Used by games like Battletoads, Marble Madness, Wizards & Warriors.
// 32 KB switchable PRG-ROM bank (bits 0-2) with single-screen nametable mirroring
// select (bit 4). Uses CHR-RAM, no CHR bank switching.
// See https://www.nesdev.org/wiki/AxROM
class Mapper7 extends Mapper0 {
  static mapperName = "AxROM";

  constructor(nes) {
    super(nes);
    // Raw value last written to $8000-$FFFF. Bits 0-2 select the 32 KB
    // PRG bank; bit 4 chooses which single-screen nametable is used.
    this.bankReg = 0;
  }

  write(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
      super.write(address, value);
    } else {
      this.bankReg = value;
      this.load32kRomBank(value & 0x7, 0x8000);
      if (value & 0x10) {
        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING2);
      } else {
        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING);
      }
    }
  }

  toJSON() {
    let s = super.toJSON();
    s.bankReg = this.bankReg;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.bankReg = s.bankReg || 0;
    // Re-apply the 32 KB PRG bank select. Nametable mirroring is part
    // of the PPU state, which is restored separately by ppu.fromJSON().
    this.load32kRomBank(this.bankReg & 0x7, 0x8000);
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("AOROM: Invalid ROM! Unable to load.");
    }

    // Load PRG-ROM:
    this.loadPRGROM();

    // Load CHR-ROM:
    this.loadCHRROM();

    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

export default Mapper7;

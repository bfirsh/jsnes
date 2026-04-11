import Mapper0 from "./mapper0.js";

// Camerica/Codemasters mapper (BF9093/BF9097)
// Used by games like Fire Hawk, Micro Machines, Bee 52, MiG 29, etc.
// Largely a clone of UxROM with optional 1-screen mirroring control.
// See https://www.nesdev.org/wiki/INES_Mapper_071
class Mapper71 extends Mapper0 {
  static mapperName = "Camerica";

  constructor(nes) {
    super(nes);
    // Raw value last written to $C000-$FFFF. Bits 0-3 select the
    // switchable 16 KB PRG bank at $8000-$BFFF.
    this.prgBankReg = 0;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }

    if (address >= 0x9000 && address < 0xa000) {
      // $9000-$9FFF: 1-screen mirroring control (Fire Hawk / BF9097 variant)
      // Bit 4 selects which CIRAM nametable to fill all four screen slots
      if (value & 0x10) {
        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING2);
      } else {
        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING);
      }
    } else if (address >= 0xc000) {
      // $C000-$FFFF: PRG bank select (bits 3-0 select 16 KiB bank at $8000)
      this.prgBankReg = value;
      this.loadRomBank(value & 0x0f, 0x8000);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("Mapper 71: Invalid ROM! Unable to load.");
    }

    // Load first PRG bank at $8000, last at $C000 (fixed)
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);

    // Load CHR-ROM (usually CHR-RAM, so this may be a no-op)
    this.loadCHRROM();

    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    let s = super.toJSON();
    s.prgBankReg = this.prgBankReg;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.prgBankReg = s.prgBankReg || 0;
    // Re-apply switchable bank. 1-screen mirroring state is stored in
    // the PPU and restored by ppu.fromJSON().
    this.loadRomBank(this.prgBankReg & 0x0f, 0x8000);
  }
}

export default Mapper71;

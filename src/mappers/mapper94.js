import Mapper0 from "./mapper0.js";

// UN1ROM (HVC-UN1ROM)
// Used by Senjou no Ookami (Commando).
// UxROM variant where the bank number is in bits 2-4 instead of bits 0-2.
// 16 KB switchable PRG-ROM at $8000, last 16 KB bank fixed at $C000.
// See https://www.nesdev.org/wiki/INES_Mapper_094
class Mapper94 extends Mapper0 {
  static mapperName = "UN1ROM";

  constructor(nes) {
    super(nes);
    // Raw value last written to $8000-$FFFF. Bits 2-4 select the
    // switchable 16 KB PRG bank at $8000-$BFFF.
    this.prgBankReg = 0;
  }

  write(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      // This is a ROM bank select command.
      // Swap in the given ROM bank at 0x8000:
      this.prgBankReg = value;
      this.loadRomBank(value >> 2, 0x8000);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("UN1ROM: Invalid ROM! Unable to load.");
    }

    // Load PRG-ROM:
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);

    // Load CHR-ROM:
    this.loadCHRROM();

    // Do Reset-Interrupt:
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
    // Re-apply the switchable bank. The fixed last bank at $C000-$FFFF
    // never changes and is already present in cpu.mem from cpu.fromJSON().
    this.loadRomBank(this.prgBankReg >> 2, 0x8000);
  }
}

export default Mapper94;

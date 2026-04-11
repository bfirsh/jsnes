import Mapper0 from "./mapper0.js";

// UxROM (NES-UNROM, NES-UOROM)
// Used by games like Mega Man, Castlevania, Contra, Duck Tales, Metal Gear.
// 16 KB switchable PRG-ROM bank at $8000, last 16 KB bank fixed at $C000.
// Uses CHR-RAM (no CHR-ROM bank switching).
// See https://www.nesdev.org/wiki/UxROM
class Mapper2 extends Mapper0 {
  static mapperName = "UxROM";

  constructor(nes) {
    super(nes);
    // Raw value last written to $8000-$FFFF. Tracked so save states can
    // restore the selected PRG bank without relying on cpu.mem being
    // serialized. The last 16 KB bank at $C000-$FFFF is fixed, so only
    // the $8000-$BFFF bank is switchable.
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
      this.loadRomBank(value, 0x8000);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("UNROM: Invalid ROM! Unable to load.");
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
    // Re-apply the PRG bank select so $8000-$BFFF holds the correct bank
    // regardless of cpu.mem serialization. The fixed last bank at
    // $C000-$FFFF never changes after loadROM(), so it doesn't need to
    // be re-installed here; cpu.fromJSON() will have restored it.
    this.loadRomBank(this.prgBankReg, 0x8000);
  }
}

export default Mapper2;

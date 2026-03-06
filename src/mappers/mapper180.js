import Mapper0 from "./mapper0.js";

// UNROM (AND-logic variant, HVC-UNROM)
// Used by Crazy Climber.
// Inverted UxROM: first 16 KB bank fixed at $8000, switchable bank at $C000.
// Standard UxROM fixes the last bank; this variant uses AND logic instead of OR logic
// on the bank select lines, producing the opposite fixed-bank behavior.
// See https://www.nesdev.org/wiki/INES_Mapper_180
class Mapper180 extends Mapper0 {
  static mapperName = "UNROM (Crazy Climber)";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      // This is a ROM bank select command.
      // Swap in the given ROM bank at 0xc000:
      this.loadRomBank(value, 0xc000);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("Mapper 180: Invalid ROM! Unable to load.");
    }

    // Load PRG-ROM:
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(0, 0xc000);

    // Load CHR-ROM:
    this.loadCHRROM();

    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

export default Mapper180;

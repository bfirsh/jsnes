import Mapper0 from "./mapper0.js";

// CNROM
// Used by games like Solomon's Key, Arkanoid, Arkista's Ring, Bump 'n' Jump.
// Fixed PRG-ROM (up to 32 KB), with switchable 8 KB CHR-ROM banks.
// See https://www.nesdev.org/wiki/INES_Mapper_003
class Mapper3 extends Mapper0 {
  static mapperName = "CNROM";

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
      // Swap in the given ROM bank at 0x8000:
      // This is a VROM bank select command.
      // Swap in the given VROM bank at 0x0000:
      this.load8kVromBank(value * 2, 0x0000);
    }
  }
}

export default Mapper3;

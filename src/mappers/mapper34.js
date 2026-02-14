import Mapper0 from "./mapper0.js";

// BNROM (NES-BNROM)
// Used by games like Deadly Towers (Mashou), Darkseed.
// Simple 32 KB PRG-ROM bank switching via writes to $8000-$FFFF.
// No CHR bank switching (uses CHR-RAM or fixed CHR-ROM).
// Note: iNES mapper 34 also covers NINA-001; this implementation handles BNROM only.
// See https://www.nesdev.org/wiki/INES_Mapper_034
class Mapper34 extends Mapper0 {
  static mapperName = "BNROM";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      this.load32kRomBank(value, 0x8000);
    }
  }
}

export default Mapper34;

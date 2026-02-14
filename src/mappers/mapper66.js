import Mapper0 from "./mapper0.js";

// GxROM (NES-GNROM, NES-MHROM)
// Used by games like Doraemon, Dragon Power, Gumshoe, Super Mario Bros. + Duck Hunt.
// Discrete mapper with 32 KB PRG and 8 KB CHR bank switching via a single register
// at $8000-$FFFF. Bits 4-5 select PRG bank, bits 0-1 select CHR bank.
// See https://www.nesdev.org/wiki/GxROM
class Mapper66 extends Mapper0 {
  static mapperName = "GxROM";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      // Swap in the given PRG-ROM bank at 0x8000:
      this.load32kRomBank((value >> 4) & 3, 0x8000);

      // Swap in the given VROM bank at 0x0000:
      this.load8kVromBank((value & 3) * 2, 0x0000);
    }
  }
}

export default Mapper66;

import Mapper0 from "./mapper0.js";

// Jaleco JF-11 / JF-14
// Used by Bio Senshi Dan - Increaser Tono Tatakai.
// Similar to GxROM (mapper 66) but register is at $6000-$7FFF instead of $8000+,
// which means it cannot coexist with SRAM. Bits 4-5 select 32 KB PRG bank,
// bits 0-3 select 8 KB CHR bank.
// See https://www.nesdev.org/wiki/INES_Mapper_140
class Mapper140 extends Mapper0 {
  static mapperName = "Jaleco JF-11/JF-14";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    if (address < 0x6000 || address > 0x7fff) {
      super.write(address, value);
      return;
    } else {
      // Swap in the given PRG-ROM bank at 0x8000:
      this.load32kRomBank((value >> 4) & 3, 0x8000);

      // Swap in the given VROM bank at 0x0000:
      this.load8kVromBank((value & 0xf) * 2, 0x0000);
    }
  }
}

export default Mapper140;

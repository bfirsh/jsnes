import Mapper0 from "./mapper0.js";

// NINA-03/NINA-06 (American Video Entertainment)
// Used by games like Tiles of Fate, Krazy Kreatures, Impossible Mission II.
// GxROM-like mapper with the register in the expansion area ($4100-$5FFF)
// instead of the cartridge space. Address decode: (addr & $E100) == $4100.
// Register format: .... PCCC
//   P (bit 3): selects 32 KB PRG bank
//   CCC (bits 0-2): selects 8 KB CHR bank
// See https://www.nesdev.org/wiki/INES_Mapper_079
class Mapper79 extends Mapper0 {
  static mapperName = "NINA-03/NINA-06";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    // The NINA register is active at addresses where (address & $E100) == $4100.
    // This covers $4100-$41FF, $4300-$43FF, $4500-$45FF, ... $5F00-$5FFF.
    if ((address & 0xe100) === 0x4100) {
      // Swap 32 KB PRG bank based on bit 3
      this.load32kRomBank((value >> 3) & 1, 0x8000);

      // Swap 8 KB CHR bank based on bits 0-2
      this.load8kVromBank((value & 7) * 2, 0x0000);
    }

    super.write(address, value);
  }
}

export default Mapper79;

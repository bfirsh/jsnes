import Mapper0 from "./mapper0.js";

// Color Dreams (unlicensed discrete mapper)
// Used by games like Bible Adventures, Crystal Mines, Chiller, Metal Fighter.
// Single register at $8000-$FFFF: bits 0-1 select 32 KB PRG bank,
// bits 4-7 select 8 KB CHR bank.
// See https://www.nesdev.org/wiki/Color_Dreams
class Mapper11 extends Mapper0 {
  static mapperName = "Color Dreams";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      // Swap in the given PRG-ROM bank:
      let prgbank1 = ((value & 0xf) * 2) % this.nes.rom.romCount;
      let prgbank2 = ((value & 0xf) * 2 + 1) % this.nes.rom.romCount;

      this.loadRomBank(prgbank1, 0x8000);
      this.loadRomBank(prgbank2, 0xc000);

      if (this.nes.rom.vromCount > 0) {
        // Swap in the given VROM bank at 0x0000:
        let bank = ((value >> 4) * 2) % this.nes.rom.vromCount;
        this.loadVromBank(bank, 0x0000);
        this.loadVromBank(bank + 1, 0x1000);
      }
    }
  }
}

export default Mapper11;

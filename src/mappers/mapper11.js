import Mapper0 from "./mapper0.js";

/**
 * Mapper 011 (Color Dreams)
 *
 * @description http://wiki.nesdev.com/w/index.php/Color_Dreams
 * @example Crystal Mines, Metal Fighter
 */
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

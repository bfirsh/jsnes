import Mapper0 from "./mapper0.js";

/**
 * Mapper 038
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_038
 * @example Crime Busters
 */
class Mapper38 extends Mapper0 {
  static mapperName = "PCI556";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    if (address < 0x7000 || address > 0x7fff) {
      super.write(address, value);
      return;
    } else {
      // Swap in the given PRG-ROM bank at 0x8000:
      this.load32kRomBank(value & 3, 0x8000);

      // Swap in the given VROM bank at 0x0000:
      this.load8kVromBank(((value >> 2) & 3) * 2, 0x0000);
    }
  }
}

export default Mapper38;

import Mapper0 from "./mapper0.js";

/**
 * Mapper 066 (GxROM)
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_066
 * @example Doraemon, Dragon Power, Gumshoe, Thunder & Lightning,
 * Super Mario Bros. + Duck Hunt
 */
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

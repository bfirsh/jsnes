import Mapper0 from "./mapper0.js";

/**
 * Mapper 034 (BNROM, NINA-01)
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_034
 * @example Darkseed, Mashou, Mission Impossible 2
 */
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

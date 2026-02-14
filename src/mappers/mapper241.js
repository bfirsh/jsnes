import Mapper0 from "./mapper0.js";

/**
 * Mapper 241 (BNROM, NINA-01)
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_241
 * https://blog.heheda.top
 */
class Mapper241 extends Mapper0 {
  static mapperName = "BxROM (Mapper 241)";

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

export default Mapper241;

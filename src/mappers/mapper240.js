import Mapper0 from "./mapper0.js";

// Mapper 240 (Jing Ke Xin Zhuan / Sheng Huo Lie Zhuan PCBs)
// Used by Jing Ke Xin Zhuan, Sheng Huo Lie Zhuan.
// Register at $4020-$5FFF: upper nibble selects 32 KB PRG bank,
// lower nibble selects 8 KB CHR bank.
// See https://www.nesdev.org/wiki/INES_Mapper_240
class Mapper240 extends Mapper0 {
  static mapperName = "Mapper 240";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    if (address < 0x4020 || address > 0x5fff) {
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

export default Mapper240;

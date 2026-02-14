import Mapper0 from "./mapper0.js";

// BxROM variant (Hengge Technology)
// Used by various Hengge Technology titles and educational cartridges.
// BxROM-like 32 KB PRG bank switching via writes to $8000-$FFFF,
// with optional battery-backed WRAM at $6000-$7FFF.
// See https://www.nesdev.org/wiki/INES_Mapper_241
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

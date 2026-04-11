import Mapper0 from "./mapper0.js";

// CNROM
// Used by games like Solomon's Key, Arkanoid, Arkista's Ring, Bump 'n' Jump.
// Fixed PRG-ROM (up to 32 KB), with switchable 8 KB CHR-ROM banks.
// See https://www.nesdev.org/wiki/INES_Mapper_003
class Mapper3 extends Mapper0 {
  static mapperName = "CNROM";

  constructor(nes) {
    super(nes);
    // Raw value last written to $8000-$FFFF, selecting the 8 KB CHR
    // bank. Tracked so save states can restore CHR banking without
    // relying on ppu.vramMem/ptTile being serialized.
    this.chrBankReg = 0;
  }

  write(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      // This is a VROM bank select command.
      // Swap in the given VROM bank at 0x0000:
      this.chrBankReg = value;
      this.load8kVromBank(value * 2, 0x0000);
    }
  }

  toJSON() {
    let s = super.toJSON();
    s.chrBankReg = this.chrBankReg;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.chrBankReg = s.chrBankReg || 0;
    // Re-apply the CHR bank select so pattern tables are correct.
    this.load8kVromBank(this.chrBankReg * 2, 0x0000);
  }
}

export default Mapper3;

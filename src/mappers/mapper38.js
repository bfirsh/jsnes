import Mapper0 from "./mapper0.js";

// PCI556 (UNL-PCI556) - Bit Corp
// Used by Crime Busters.
// Nearly identical to GxROM (mapper 66) but the register is at $7000-$7FFF.
// Bits 0-1 select 32 KB PRG bank, bits 2-3 select 8 KB CHR bank.
// See https://www.nesdev.org/wiki/INES_Mapper_038
class Mapper38 extends Mapper0 {
  static mapperName = "PCI556";

  constructor(nes) {
    super(nes);
    // Raw value last written to $7000-$7FFF. Bits 0-1 select the 32 KB
    // PRG bank; bits 2-3 select the 8 KB CHR bank.
    this.bankReg = 0;
  }

  write(address, value) {
    if (address < 0x7000 || address > 0x7fff) {
      super.write(address, value);
      return;
    } else {
      this.bankReg = value;
      this._applyBanks();
    }
  }

  _applyBanks() {
    let value = this.bankReg;
    // Swap in the given PRG-ROM bank at 0x8000:
    this.load32kRomBank(value & 3, 0x8000);
    // Swap in the given VROM bank at 0x0000:
    this.load8kVromBank(((value >> 2) & 3) * 2, 0x0000);
  }

  toJSON() {
    let s = super.toJSON();
    s.bankReg = this.bankReg;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.bankReg = s.bankReg || 0;
    this._applyBanks();
  }
}

export default Mapper38;

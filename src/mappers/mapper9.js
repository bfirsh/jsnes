import Mapper0 from "./mapper0.js";

// MMC2 (PNROM / PEEOROM)
// Used exclusively by Mike Tyson's Punch-Out!! (and Punch-Out!!).
// Features tile-triggered CHR bank switching: two independent 4 KB CHR latches
// automatically swap between two banks when the PPU fetches specific tiles ($FD/$FE).
// PRG: 8 KB switchable at $8000, three 8 KB fixed banks at $A000-$FFFF.
// See https://www.nesdev.org/wiki/MMC2
class Mapper9 extends Mapper0 {
  static mapperName = "MMC2";

  constructor(nes) {
    super(nes);

    // PRG bank register ($A000-$AFFF): selects 8 KB bank at $8000
    this.prgBank = 0;

    // CHR bank registers: each pattern table half has two possible banks,
    // selected by the corresponding latch state ($FD or $FE).
    this.chrBankFD0 = 0; // $B000: CHR bank for $0000 when latch0 = $FD
    this.chrBankFE0 = 0; // $C000: CHR bank for $0000 when latch0 = $FE
    this.chrBankFD1 = 0; // $D000: CHR bank for $1000 when latch1 = $FD
    this.chrBankFE1 = 0; // $E000: CHR bank for $1000 when latch1 = $FE

    // Latch states: $FD or $FE, one per pattern table half.
    // Both initialize to $FE on power-up.
    this.latch0 = 0xfe;
    this.latch1 = 0xfe;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }

    // Only the top nibble matters for register selection
    switch (address & 0xf000) {
      case 0xa000:
        // $A000-$AFFF: PRG bank select (bits 3-0 select 8 KB bank at $8000)
        this.prgBank = value & 0x0f;
        this.load8kRomBank(this.prgBank, 0x8000);
        break;

      case 0xb000:
        // $B000-$BFFF: CHR bank for $0000 when latch0 = $FD
        this.chrBankFD0 = value & 0x1f;
        this._updateChr0();
        break;

      case 0xc000:
        // $C000-$CFFF: CHR bank for $0000 when latch0 = $FE
        this.chrBankFE0 = value & 0x1f;
        this._updateChr0();
        break;

      case 0xd000:
        // $D000-$DFFF: CHR bank for $1000 when latch1 = $FD
        this.chrBankFD1 = value & 0x1f;
        this._updateChr1();
        break;

      case 0xe000:
        // $E000-$EFFF: CHR bank for $1000 when latch1 = $FE
        this.chrBankFE1 = value & 0x1f;
        this._updateChr1();
        break;

      case 0xf000:
        // $F000-$FFFF: Mirroring (bit 0: 0=vertical, 1=horizontal)
        if (value & 0x01) {
          this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
        } else {
          this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
        }
        break;
    }
  }

  // Load the correct CHR bank into $0000 based on latch0 state.
  _updateChr0() {
    let bank = this.latch0 === 0xfd ? this.chrBankFD0 : this.chrBankFE0;
    this.loadVromBank(bank, 0x0000);
  }

  // Load the correct CHR bank into $1000 based on latch1 state.
  _updateChr1() {
    let bank = this.latch1 === 0xfd ? this.chrBankFD1 : this.chrBankFE1;
    this.loadVromBank(bank, 0x1000);
  }

  // Called by the PPU when pattern table memory is accessed.
  // Updates the CHR latches based on the tile being fetched.
  // The latch switches AFTER the data has been read, so the
  // tile at $FD/$FE itself is rendered with the old bank.
  // See https://www.nesdev.org/wiki/MMC2#Latch_0_($0000-$0FFF)
  latchAccess(address) {
    // Only reload CHR banks when the latch state actually changes.
    // The same trigger tile may appear on many consecutive scanlines (e.g. a
    // column of $FD tiles in the nametable), and redundantly calling
    // loadVromBank on every fetch would copy 4 KB of VRAM each time.
    if (address === 0x0fd8) {
      // Latch 0 triggers on exactly $0FD8
      if (this.latch0 !== 0xfd) {
        this.latch0 = 0xfd;
        this._updateChr0();
      }
    } else if (address === 0x0fe8) {
      // Latch 0 triggers on exactly $0FE8
      if (this.latch0 !== 0xfe) {
        this.latch0 = 0xfe;
        this._updateChr0();
      }
    } else if (address >= 0x1fd8 && address <= 0x1fdf) {
      // Latch 1 triggers on $1FD8-$1FDF
      if (this.latch1 !== 0xfd) {
        this.latch1 = 0xfd;
        this._updateChr1();
      }
    } else if (address >= 0x1fe8 && address <= 0x1fef) {
      // Latch 1 triggers on $1FE8-$1FEF
      if (this.latch1 !== 0xfe) {
        this.latch1 = 0xfe;
        this._updateChr1();
      }
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("MMC2: Invalid ROM! Unable to load.");
    }

    // Load first switchable 8 KB PRG bank at $8000
    this.load8kRomBank(0, 0x8000);

    // Load the last three 8 KB PRG banks fixed at $A000-$FFFF
    let lastBank8k = (this.nes.rom.romCount - 1) * 2 + 1;
    this.load8kRomBank(lastBank8k - 2, 0xa000);
    this.load8kRomBank(lastBank8k - 1, 0xc000);
    this.load8kRomBank(lastBank8k, 0xe000);

    // Load CHR-ROM
    this.loadCHRROM();

    // Load Battery RAM (if present)
    this.loadBatteryRam();

    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    let s = super.toJSON();
    s.prgBank = this.prgBank;
    s.chrBankFD0 = this.chrBankFD0;
    s.chrBankFE0 = this.chrBankFE0;
    s.chrBankFD1 = this.chrBankFD1;
    s.chrBankFE1 = this.chrBankFE1;
    s.latch0 = this.latch0;
    s.latch1 = this.latch1;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.prgBank = s.prgBank;
    this.chrBankFD0 = s.chrBankFD0;
    this.chrBankFE0 = s.chrBankFE0;
    this.chrBankFD1 = s.chrBankFD1;
    this.chrBankFE1 = s.chrBankFE1;
    this.latch0 = s.latch0;
    this.latch1 = s.latch1;
  }
}

export default Mapper9;

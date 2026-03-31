import Mapper0 from "./mapper0.js";

// MMC3 / TxROM (TSROM, TLSROM, TQROM, etc.)
// Used by games like Super Mario Bros. 2, Super Mario Bros. 3, Kirby's Adventure.
// Fine-grained bank switching: two 8 KB switchable PRG-ROM banks, two 2 KB + four
// 1 KB CHR banks. Provides a scanline-counting IRQ for split-screen effects and
// software-switchable H/V nametable mirroring.
// See https://www.nesdev.org/wiki/MMC3
class Mapper4 extends Mapper0 {
  static mapperName = "MMC3";
  static CMD_SEL_2_1K_VROM_0000 = 0;
  static CMD_SEL_2_1K_VROM_0800 = 1;
  static CMD_SEL_1K_VROM_1000 = 2;
  static CMD_SEL_1K_VROM_1400 = 3;
  static CMD_SEL_1K_VROM_1800 = 4;
  static CMD_SEL_1K_VROM_1C00 = 5;
  static CMD_SEL_ROM_PAGE1 = 6;
  static CMD_SEL_ROM_PAGE2 = 7;

  constructor(nes) {
    super(nes);
    this.command = 0;
    this.prgAddressSelect = 0;
    this.chrAddressSelect = 0;
    this.pageNumber = 0;
    this.irqCounter = 0;
    this.irqLatchValue = 0;
    this.irqEnable = 0;
    this.prgAddressChanged = false;
  }

  write(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }

    switch (address & 0xe001) {
      case 0x8000: {
        // Command/Address Select register
        this.command = value & 7;
        const tmp = (value >> 6) & 1;
        if (tmp !== this.prgAddressSelect) {
          this.prgAddressChanged = true;
        }
        this.prgAddressSelect = tmp;
        this.chrAddressSelect = (value >> 7) & 1;
        break;
      }

      case 0x8001:
        // Page number for command
        this.executeCommand(this.command, value);
        break;

      case 0xa000:
        // Mirroring select
        if ((value & 1) !== 0) {
          this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
        } else {
          this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
        }
        break;

      case 0xa001:
        // SaveRAM Toggle
        // TODO
        //nes.getRom().setSaveState((value&1)!=0);
        break;

      case 0xc000:
        // IRQ Counter register
        this.irqCounter = value;
        //nes.ppu.mapperIrqCounter = 0;
        break;

      case 0xc001:
        // IRQ Latch register
        this.irqLatchValue = value;
        break;

      case 0xe000:
        // IRQ Control Reg 0 (disable)
        //irqCounter = irqLatchValue;
        this.irqEnable = 0;
        break;

      case 0xe001:
        // IRQ Control Reg 1 (enable)
        this.irqEnable = 1;
        break;

      // No default needed: the 0xE001 mask maps every address >= $8000
      // to one of the eight cases above.
    }
  }

  executeCommand(cmd, arg) {
    switch (cmd) {
      case Mapper4.CMD_SEL_2_1K_VROM_0000:
        // Select 2 1KB VROM pages at 0x0000:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x0000);
          this.load1kVromBank(arg + 1, 0x0400);
        } else {
          this.load1kVromBank(arg, 0x1000);
          this.load1kVromBank(arg + 1, 0x1400);
        }
        break;

      case Mapper4.CMD_SEL_2_1K_VROM_0800:
        // Select 2 1KB VROM pages at 0x0800:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x0800);
          this.load1kVromBank(arg + 1, 0x0c00);
        } else {
          this.load1kVromBank(arg, 0x1800);
          this.load1kVromBank(arg + 1, 0x1c00);
        }
        break;

      case Mapper4.CMD_SEL_1K_VROM_1000:
        // Select 1K VROM Page at 0x1000:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x1000);
        } else {
          this.load1kVromBank(arg, 0x0000);
        }
        break;

      case Mapper4.CMD_SEL_1K_VROM_1400:
        // Select 1K VROM Page at 0x1400:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x1400);
        } else {
          this.load1kVromBank(arg, 0x0400);
        }
        break;

      case Mapper4.CMD_SEL_1K_VROM_1800:
        // Select 1K VROM Page at 0x1800:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x1800);
        } else {
          this.load1kVromBank(arg, 0x0800);
        }
        break;

      case Mapper4.CMD_SEL_1K_VROM_1C00:
        // Select 1K VROM Page at 0x1C00:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x1c00);
        } else {
          this.load1kVromBank(arg, 0x0c00);
        }
        break;

      case Mapper4.CMD_SEL_ROM_PAGE1:
        if (this.prgAddressChanged) {
          // Load the two hardwired banks:
          if (this.prgAddressSelect === 0) {
            this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0xc000);
          } else {
            this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0x8000);
          }
          this.prgAddressChanged = false;
        }

        // Select first switchable ROM page:
        if (this.prgAddressSelect === 0) {
          this.load8kRomBank(arg, 0x8000);
        } else {
          this.load8kRomBank(arg, 0xc000);
        }
        break;

      case Mapper4.CMD_SEL_ROM_PAGE2:
        // Select second switchable ROM page:
        this.load8kRomBank(arg, 0xa000);

        // hardwire appropriate bank:
        if (this.prgAddressChanged) {
          // Load the two hardwired banks:
          if (this.prgAddressSelect === 0) {
            this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0xc000);
          } else {
            this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0x8000);
          }
          this.prgAddressChanged = false;
        }
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("MMC3: Invalid ROM! Unable to load.");
    }

    // Load hardwired PRG banks (0xC000 and 0xE000):
    this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0xc000);
    this.load8kRomBank((this.nes.rom.romCount - 1) * 2 + 1, 0xe000);

    // Load swappable PRG banks (0x8000 and 0xA000):
    this.load8kRomBank(0, 0x8000);
    this.load8kRomBank(1, 0xa000);

    // Load CHR-ROM:
    this.loadCHRROM();

    // Load Battery RAM (if present):
    this.loadBatteryRam();

    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  clockIrqCounter() {
    if (this.irqEnable === 1) {
      this.irqCounter--;
      if (this.irqCounter < 0) {
        // Trigger IRQ:
        //nes.getCpu().doIrq();
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
        this.irqCounter = this.irqLatchValue;
      }
    }
  }

  toJSON() {
    let s = super.toJSON();
    s.command = this.command;
    s.prgAddressSelect = this.prgAddressSelect;
    s.chrAddressSelect = this.chrAddressSelect;
    s.pageNumber = this.pageNumber;
    s.irqCounter = this.irqCounter;
    s.irqLatchValue = this.irqLatchValue;
    s.irqEnable = this.irqEnable;
    s.prgAddressChanged = this.prgAddressChanged;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.command = s.command;
    this.prgAddressSelect = s.prgAddressSelect;
    this.chrAddressSelect = s.chrAddressSelect;
    this.pageNumber = s.pageNumber;
    this.irqCounter = s.irqCounter;
    this.irqLatchValue = s.irqLatchValue;
    this.irqEnable = s.irqEnable;
    this.prgAddressChanged = s.prgAddressChanged;
  }
}

export default Mapper4;

import Mapper0 from "./mapper0.js";
import { copyArrayElements } from "../utils.js";

// MMC5 / ExROM (EKROM, ELROM, ETROM, EWROM)
// Used by games like Castlevania III, Just Breed, Uncharted Waters, Metal Slader Glory.
// The most complex Nintendo mapper. Flexible PRG/CHR banking (up to 1 MB each),
// expansion audio (2 pulse + PCM), 8x8 hardware multiplier, 1 KB ExRAM for extended
// nametable attributes, vertical split screen, and scanline-counting IRQ.
// See https://www.nesdev.org/wiki/MMC5
class Mapper5 extends Mapper0 {
  static mapperName = "MMC5";

  constructor(nes) {
    super(nes);

    // PRG banking
    // $5100: PRG mode (0=32K, 1=16K+16K, 2=16K+8K+8K, 3=8K+8K+8K+8K)
    this.prgMode = 3; // Power-on default: mode 3 (8K banks)
    // $5113-$5117: PRG bank registers. Raw values written by the game.
    // $5113 always maps RAM to $6000-$7FFF.
    // $5114-$5116 bit 7: 0=RAM, 1=ROM. $5117 always ROM.
    this.prgBankReg = new Uint8Array(5); // indices 0-4 for $5113-$5117
    this.prgBankReg[4] = 0xff; // $5117 defaults to last page (0xFF)

    // PRG RAM: up to 64 KB (two 32 KB chips), banked into $6000-$7FFF.
    // Also mappable into $8000-$DFFF via bank registers with bit 7 clear.
    this.prgRam = new Uint8Array(0x10000); // 64 KB PRG RAM

    // PRG RAM write protection: $5102 and $5103
    // Writes only enabled when $5102=%10 and $5103=%01
    this.prgRamProtectA = 0; // $5102
    this.prgRamProtectB = 0; // $5103

    // CHR banking
    // $5101: CHR mode (0=8K, 1=4K, 2=2K, 3=1K)
    this.chrMode = 3; // Power-on default: mode 3 (1K banks)
    // $5120-$5127: CHR bank set A (sprite banks)
    this.chrBankA = new Uint16Array(8);
    // $5128-$512B: CHR bank set B (background banks)
    this.chrBankB = new Uint16Array(4);
    // $5130: Upper CHR bank bits (bits 8-9 appended to bank registers)
    this.chrUpperBits = 0;
    // Tracks which CHR set was last written (0=A, 1=B) for $2007 access
    this.lastChrWrite = 0;

    // Nametable mapping: $5105
    // Each 2-bit field: 0=CIRAM A, 1=CIRAM B, 2=ExRAM, 3=Fill
    this.ntMapping = new Uint8Array(4);

    // ExRAM: 1 KB internal to MMC5, used for nametable/extended attributes/RAM
    // $5104: ExRAM mode (0=nametable, 1=ext attributes, 2=RAM, 3=read-only)
    this.exramMode = 0;
    this.exram = new Uint8Array(0x400); // 1 KB

    // Fill mode: $5106/$5107
    this.fillTile = 0;
    this.fillAttr = 0;

    // Scanline IRQ: $5203/$5204
    // The MMC5 counts scanlines by monitoring PPU nametable fetches.
    // See https://www.nesdev.org/wiki/MMC5#Scanline_detection_and_scanline_IRQ
    this.irqTarget = 0; // $5203: target scanline
    this.irqEnabled = false; // $5204 bit 7 write: IRQ enable
    this.irqPending = false; // $5204 bit 7 read: IRQ pending flag
    this.inFrame = false; // $5204 bit 6 read: in-frame flag
    this.irqCounter = 0; // Internal scanline counter

    // Hardware multiplier: $5205/$5206
    // Write two 8-bit unsigned values, read 16-bit product immediately.
    this.multA = 0xff; // Power-on default 0xFF
    this.multB = 0xff; // Power-on default 0xFF

    // Split screen: $5200-$5202
    // Not commonly used. Basic support for register storage.
    this.splitEnabled = false; // $5200 bit 7
    this.splitRight = false; // $5200 bit 6 (0=left, 1=right)
    this.splitTile = 0; // $5200 bits 0-4: tile threshold
    this.splitScroll = 0; // $5201: vertical scroll for split
    this.splitPage = 0; // $5202: 4K CHR page for split

    // Expansion audio: two pulse channels + PCM
    // The MMC5 pulse channels are similar to APU square channels but lack
    // sweep units and don't silence at low frequencies.
    // See https://www.nesdev.org/wiki/MMC5_audio
    this.pulse1 = this._initPulse();
    this.pulse2 = this._initPulse();
    this.pcmValue = 0; // $5011: raw 8-bit PCM output
    this.pcmReadMode = false; // $5010 bit 0
    this.pcmIrqEnabled = false; // $5010 bit 7
    this.audioEnabled = 0; // $5015: pulse channel enable bits

    // Tracks which CHR bank set is currently loaded into the PPU's pattern
    // table cache. Used by onBgRender/onSpriteRender to avoid redundant
    // bank switches. -1 = unknown/dirty, 0 = set A (sprites), 1 = set B (BG).
    this._chrBankTarget = -1;
  }

  // Initialize a pulse channel state object.
  // MMC5 pulse channels are like APU square channels minus the sweep unit.
  _initPulse() {
    return {
      enabled: false,
      dutyCycle: 0, // 2-bit duty
      lengthHalt: false, // envelope loop / length counter halt
      constantVolume: false,
      volume: 0, // 4-bit volume/envelope
      timer: 0, // 11-bit timer period
      timerCounter: 0,
      lengthCounter: 0,
      envelopeCounter: 0,
      envelopeDecay: 15,
      envelopeStart: false,
      sequencePos: 0,
    };
  }

  // --- CPU Read Handler ---
  // Override load() to handle MMC5 register reads and banked PRG access.
  load(address) {
    address &= 0xffff;

    if (address < 0x5000) {
      // Standard read (RAM, PPU regs, APU regs, controllers)
      return super.load(address);
    }

    // $5000-$5017: Expansion audio read-back
    if (address === 0x5015) {
      // Status register: bits 0-1 indicate pulse channel length counter > 0
      let val = 0;
      if (this.pulse1.lengthCounter > 0) val |= 0x01;
      if (this.pulse2.lengthCounter > 0) val |= 0x02;
      return val;
    }

    if (address === 0x5010) {
      // PCM IRQ status (bit 7). Reading clears the flag.
      // PCM IRQ is rarely used; return 0 for now.
      return 0;
    }

    // $5100-$5104: Write-only control registers — return open bus
    if (address >= 0x5100 && address <= 0x5104) {
      return this.nes.cpu.dataBus;
    }

    // $5105: Nametable mapping (write-only, open bus on read)
    if (address === 0x5105) {
      return this.nes.cpu.dataBus;
    }

    // $5204: Scanline IRQ status
    if (address === 0x5204) {
      // The in-frame flag reflects whether the PPU is actively rendering.
      // Since the PPU only calls clockIrqCounter during rendering, we check
      // the current PPU state to determine in-frame for reads outside rendering.
      let ppu = this.nes.ppu;
      let rendering =
        ppu.scanline >= 20 &&
        ppu.scanline <= 260 &&
        (ppu.f_bgVisibility === 1 || ppu.f_spVisibility === 1);
      if (!rendering) {
        this.inFrame = false;
      }

      let val = 0;
      if (this.irqPending) val |= 0x80;
      if (this.inFrame) val |= 0x40;
      // Reading $5204 acknowledges (clears) the IRQ pending flag
      this.irqPending = false;
      return val;
    }

    // $5205: Multiplier result low byte
    if (address === 0x5205) {
      return (this.multA * this.multB) & 0xff;
    }

    // $5206: Multiplier result high byte
    if (address === 0x5206) {
      return ((this.multA * this.multB) >> 8) & 0xff;
    }

    // $5C00-$5FFF: ExRAM
    if (address >= 0x5c00 && address <= 0x5fff) {
      // Readable in modes 2 and 3 only; otherwise open bus
      if (this.exramMode >= 2) {
        return this.exram[address - 0x5c00];
      }
      return this.nes.cpu.dataBus;
    }

    // $5000-$5BFF other: expansion area, return open bus
    if (address < 0x6000) {
      return this.nes.cpu.dataBus;
    }

    // $6000-$7FFF: PRG RAM (banked via $5113)
    if (address < 0x8000) {
      let bank = this.prgBankReg[0] & 0x07; // 3-bit page within 64K RAM
      let offset = bank * 0x2000 + (address - 0x6000);
      return this.prgRam[offset & 0xffff];
    }

    // $8000-$FFFF: PRG ROM/RAM (banked via $5114-$5117 and prgMode)
    return this._readPrg(address);
  }

  // Read from banked PRG space ($8000-$FFFF).
  // In modes where a region can map to RAM (bit 7 of bank reg = 0),
  // reads come from prgRam. Otherwise, reads come from ROM.
  _readPrg(address) {
    let slot, reg, isRam, bank;

    switch (this.prgMode) {
      case 0:
        // Mode 0: One 32K bank at $8000-$FFFF, controlled by $5117
        // Ignore low 2 bits for 32K alignment
        reg = this.prgBankReg[4];
        bank = (reg & 0x7c) >> 2; // 32K page = bits 6-2
        return this._readPrgRom32k(bank, address - 0x8000);

      case 1:
        // Mode 1: Two 16K banks
        // $8000-$BFFF: $5115 (can be RAM if bit 7=0)
        // $C000-$FFFF: $5117 (always ROM)
        if (address < 0xc000) {
          reg = this.prgBankReg[2]; // $5115
          isRam = (reg & 0x80) === 0;
          if (isRam) {
            bank = (reg & 0x06) >> 1; // 16K RAM page
            return this.prgRam[bank * 0x4000 + (address - 0x8000)];
          }
          bank = (reg & 0x7e) >> 1; // 16K ROM page (ignore bit 0)
          return this._readPrgRom16k(bank, address - 0x8000);
        } else {
          reg = this.prgBankReg[4]; // $5117
          bank = (reg & 0x7e) >> 1; // 16K ROM page
          return this._readPrgRom16k(bank, address - 0xc000);
        }

      case 2:
        // Mode 2: 16K + 8K + 8K
        // $8000-$BFFF: $5115 (RAM or ROM)
        // $C000-$DFFF: $5116 (RAM or ROM)
        // $E000-$FFFF: $5117 (always ROM)
        if (address < 0xc000) {
          reg = this.prgBankReg[2]; // $5115
          isRam = (reg & 0x80) === 0;
          if (isRam) {
            bank = (reg & 0x06) >> 1;
            return this.prgRam[bank * 0x4000 + (address - 0x8000)];
          }
          bank = (reg & 0x7e) >> 1;
          return this._readPrgRom16k(bank, address - 0x8000);
        } else if (address < 0xe000) {
          reg = this.prgBankReg[3]; // $5116
          isRam = (reg & 0x80) === 0;
          if (isRam) {
            bank = reg & 0x07;
            return this.prgRam[bank * 0x2000 + (address - 0xc000)];
          }
          bank = reg & 0x7f;
          return this._readPrgRom8k(bank, address - 0xc000);
        } else {
          reg = this.prgBankReg[4]; // $5117
          bank = reg & 0x7f;
          return this._readPrgRom8k(bank, address - 0xe000);
        }

      case 3:
      default:
        // Mode 3: Four 8K banks
        // $8000-$9FFF: $5114 (RAM or ROM)
        // $A000-$BFFF: $5115 (RAM or ROM)
        // $C000-$DFFF: $5116 (RAM or ROM)
        // $E000-$FFFF: $5117 (always ROM)
        if (address < 0xa000) {
          slot = 1; // $5114
        } else if (address < 0xc000) {
          slot = 2; // $5115
        } else if (address < 0xe000) {
          slot = 3; // $5116
        } else {
          slot = 4; // $5117
        }
        reg = this.prgBankReg[slot];
        let base =
          slot === 1
            ? 0x8000
            : slot === 2
              ? 0xa000
              : slot === 3
                ? 0xc000
                : 0xe000;
        // $5117 is always ROM; $5114-$5116 use bit 7 for RAM/ROM select
        if (slot < 4 && (reg & 0x80) === 0) {
          bank = reg & 0x07;
          return this.prgRam[bank * 0x2000 + (address - base)];
        }
        bank = reg & 0x7f;
        return this._readPrgRom8k(bank, address - base);
    }
  }

  // Read a byte from PRG ROM given a 32K bank number and offset within it.
  _readPrgRom32k(bank32k, offset) {
    // ROM is stored as 16K banks in rom.rom[]
    let bank16k =
      (bank32k * 2 + Math.floor(offset / 0x4000)) % this.nes.rom.romCount;
    let innerOffset = offset % 0x4000;
    if (bank16k < this.nes.rom.romCount) {
      return this.nes.rom.rom[bank16k][innerOffset];
    }
    return 0;
  }

  // Read a byte from PRG ROM given a 16K bank number and offset within it.
  _readPrgRom16k(bank16k, offset) {
    bank16k %= this.nes.rom.romCount;
    if (bank16k < this.nes.rom.romCount) {
      return this.nes.rom.rom[bank16k][offset];
    }
    return 0;
  }

  // Read a byte from PRG ROM given an 8K bank number and offset within it.
  _readPrgRom8k(bank8k, offset) {
    let bank16k = Math.floor(bank8k / 2) % this.nes.rom.romCount;
    let innerOffset = (bank8k % 2) * 0x2000 + offset;
    if (bank16k < this.nes.rom.romCount) {
      return this.nes.rom.rom[bank16k][innerOffset];
    }
    return 0;
  }

  // --- CPU Write Handler ---
  write(address, value) {
    // Standard NES write handling for addresses below $5000
    if (address < 0x5000) {
      super.write(address, value);

      // MMC5 monitors writes to $2000 to track 8x8 vs 8x16 sprite mode.
      // This affects which CHR bank set is used for rendering.
      // The PPU already parses $2000, so we just note it here.
      return;
    }

    // $5000-$5015: Expansion audio registers
    if (address >= 0x5000 && address <= 0x5003) {
      this._writePulse(this.pulse1, address - 0x5000, value);
      return;
    }
    if (address >= 0x5004 && address <= 0x5007) {
      this._writePulse(this.pulse2, address - 0x5004, value);
      return;
    }
    if (address === 0x5010) {
      this.pcmReadMode = (value & 0x01) !== 0;
      this.pcmIrqEnabled = (value & 0x80) !== 0;
      return;
    }
    if (address === 0x5011) {
      // Raw PCM write. Writing $00 has no effect on the output.
      if (!this.pcmReadMode && value !== 0) {
        this.pcmValue = value;
      }
      return;
    }
    if (address === 0x5015) {
      // Expansion audio status: bits 0-1 enable pulse channels
      this.audioEnabled = value & 0x03;
      this.pulse1.enabled = (value & 0x01) !== 0;
      this.pulse2.enabled = (value & 0x02) !== 0;
      if (!this.pulse1.enabled) this.pulse1.lengthCounter = 0;
      if (!this.pulse2.enabled) this.pulse2.lengthCounter = 0;
      return;
    }

    // $5100: PRG banking mode
    if (address === 0x5100) {
      this.prgMode = value & 0x03;
      this._syncPrg();
      return;
    }

    // $5101: CHR banking mode
    if (address === 0x5101) {
      this.chrMode = value & 0x03;
      this._syncChr();
      return;
    }

    // $5102/$5103: PRG RAM write protection
    if (address === 0x5102) {
      this.prgRamProtectA = value & 0x03;
      return;
    }
    if (address === 0x5103) {
      this.prgRamProtectB = value & 0x03;
      return;
    }

    // $5104: ExRAM mode
    if (address === 0x5104) {
      this.exramMode = value & 0x03;
      this._syncNametables();
      return;
    }

    // $5105: Nametable mapping
    if (address === 0x5105) {
      let v = value;
      this.ntMapping[0] = v & 0x03;
      v >>= 2;
      this.ntMapping[1] = v & 0x03;
      v >>= 2;
      this.ntMapping[2] = v & 0x03;
      v >>= 2;
      this.ntMapping[3] = v & 0x03;
      this._syncNametables();
      return;
    }

    // $5106: Fill-mode tile
    if (address === 0x5106) {
      this.fillTile = value;
      this._syncNametables();
      return;
    }

    // $5107: Fill-mode attribute (bottom 2 bits)
    if (address === 0x5107) {
      this.fillAttr = value & 0x03;
      this._syncNametables();
      return;
    }

    // $5113: PRG RAM bank for $6000-$7FFF
    if (address === 0x5113) {
      this.prgBankReg[0] = value & 0x07;
      return;
    }

    // $5114-$5117: PRG bank registers
    if (address >= 0x5114 && address <= 0x5117) {
      let idx = address - 0x5113; // 1-4
      this.prgBankReg[idx] = value;
      this._syncPrg();
      return;
    }

    // $5120-$5127: CHR bank set A (sprites / "last written" set)
    if (address >= 0x5120 && address <= 0x5127) {
      let reg = address - 0x5120;
      this.chrBankA[reg] = (this.chrUpperBits << 8) | value;
      this.lastChrWrite = 0;
      this._syncChr();
      return;
    }

    // $5128-$512B: CHR bank set B (background)
    if (address >= 0x5128 && address <= 0x512b) {
      let reg = address - 0x5128;
      this.chrBankB[reg] = (this.chrUpperBits << 8) | value;
      this.lastChrWrite = 1;
      this._syncChr();
      return;
    }

    // $5130: Upper CHR bank bits
    if (address === 0x5130) {
      this.chrUpperBits = value & 0x03;
      return;
    }

    // $5200: Split screen control
    if (address === 0x5200) {
      this.splitEnabled = (value & 0x80) !== 0;
      this.splitRight = (value & 0x40) !== 0;
      this.splitTile = value & 0x1f;
      return;
    }

    // $5201: Split screen Y scroll
    if (address === 0x5201) {
      this.splitScroll = value;
      return;
    }

    // $5202: Split screen CHR page
    if (address === 0x5202) {
      this.splitPage = value & 0x3f;
      return;
    }

    // $5203: Scanline IRQ target
    if (address === 0x5203) {
      this.irqTarget = value;
      return;
    }

    // $5204: Scanline IRQ enable
    if (address === 0x5204) {
      this.irqEnabled = (value & 0x80) !== 0;
      // If both enabled and pending, fire IRQ immediately
      if (this.irqEnabled && this.irqPending) {
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
      }
      return;
    }

    // $5205: Multiplier operand A
    if (address === 0x5205) {
      this.multA = value;
      return;
    }

    // $5206: Multiplier operand B
    if (address === 0x5206) {
      this.multB = value;
      return;
    }

    // $5C00-$5FFF: ExRAM writes
    if (address >= 0x5c00 && address <= 0x5fff) {
      let exAddr = address - 0x5c00;
      if (this.exramMode === 0 || this.exramMode === 1) {
        // Modes 0/1: writable only during rendering (in-frame).
        // If not in-frame, $00 is written instead.
        this.exram[exAddr] = this.inFrame ? value : 0x00;
        // If ExRAM is used as a nametable, sync it to VRAM
        this._syncExramToVram(exAddr);
      } else if (this.exramMode === 2) {
        // Mode 2: general-purpose RAM, always writable
        this.exram[exAddr] = value;
      }
      // Mode 3: read-only, writes have no effect
      return;
    }

    // $6000-$7FFF: PRG RAM writes (write-protected via $5102/$5103)
    if (address >= 0x6000 && address <= 0x7fff) {
      if (this.prgRamProtectA === 0x02 && this.prgRamProtectB === 0x01) {
        let bank = this.prgBankReg[0] & 0x07;
        let offset = bank * 0x2000 + (address - 0x6000);
        this.prgRam[offset & 0xffff] = value;
        // Also write to CPU mem for compatibility with save state / battery RAM
        this.nes.cpu.mem[address] = value;
        this.nes.opts.onBatteryRamWrite(address, value);
      }
      return;
    }

    // $8000-$FFFF: PRG ROM/RAM writes
    if (address >= 0x8000) {
      this._writePrg(address, value);
      return;
    }
  }

  // Handle writes to the PRG address space ($8000-$FFFF).
  // Some bank slots may be mapped to RAM if bit 7 of the bank register is 0.
  _writePrg(address, value) {
    let slot, reg, isRam, bank, base;

    switch (this.prgMode) {
      case 0:
        // Mode 0: Entire $8000-$FFFF is a single 32K ROM bank — not writable
        return;

      case 1:
        // $8000-$BFFF: $5115 (can be RAM)
        // $C000-$FFFF: $5117 (always ROM)
        if (address < 0xc000) {
          reg = this.prgBankReg[2];
          isRam = (reg & 0x80) === 0;
          if (isRam && this._isPrgRamWritable()) {
            bank = (reg & 0x06) >> 1;
            this.prgRam[bank * 0x4000 + (address - 0x8000)] = value;
          }
        }
        return;

      case 2:
        // $8000-$BFFF: $5115 (can be RAM)
        // $C000-$DFFF: $5116 (can be RAM)
        // $E000-$FFFF: $5117 (always ROM)
        if (address < 0xc000) {
          reg = this.prgBankReg[2];
          isRam = (reg & 0x80) === 0;
          if (isRam && this._isPrgRamWritable()) {
            bank = (reg & 0x06) >> 1;
            this.prgRam[bank * 0x4000 + (address - 0x8000)] = value;
          }
        } else if (address < 0xe000) {
          reg = this.prgBankReg[3];
          isRam = (reg & 0x80) === 0;
          if (isRam && this._isPrgRamWritable()) {
            bank = reg & 0x07;
            this.prgRam[bank * 0x2000 + (address - 0xc000)] = value;
          }
        }
        return;

      case 3:
      default:
        // $8000-$9FFF: $5114 (can be RAM)
        // $A000-$BFFF: $5115 (can be RAM)
        // $C000-$DFFF: $5116 (can be RAM)
        // $E000-$FFFF: $5117 (always ROM)
        if (address < 0xa000) {
          slot = 1;
          base = 0x8000;
        } else if (address < 0xc000) {
          slot = 2;
          base = 0xa000;
        } else if (address < 0xe000) {
          slot = 3;
          base = 0xc000;
        } else {
          return; // $5117 is always ROM
        }
        reg = this.prgBankReg[slot];
        isRam = (reg & 0x80) === 0;
        if (isRam && this._isPrgRamWritable()) {
          bank = reg & 0x07;
          this.prgRam[bank * 0x2000 + (address - base)] = value;
        }
        return;
    }
  }

  // Check if PRG RAM writes are enabled via the two protection registers.
  _isPrgRamWritable() {
    return this.prgRamProtectA === 0x02 && this.prgRamProtectB === 0x01;
  }

  // --- PRG Synchronization ---
  // Copy the selected PRG ROM banks into CPU address space so the CPU can
  // read them directly. This follows the same approach as other mappers.
  // Called when prgMode or bank registers change.
  _syncPrg() {
    switch (this.prgMode) {
      case 0: {
        // 32K bank at $8000-$FFFF from $5117
        let reg = this.prgBankReg[4];
        let bank = (reg & 0x7c) >> 2; // 32K page
        this.load32kRomBank(bank, 0x8000);
        break;
      }
      case 1: {
        // $8000-$BFFF from $5115, $C000-$FFFF from $5117
        let regLo = this.prgBankReg[2]; // $5115
        if (regLo & 0x80) {
          // ROM
          let bank16k = (regLo & 0x7e) >> 1;
          this.loadRomBank(bank16k % this.nes.rom.romCount, 0x8000);
        }
        // else: RAM — reads will be handled by load() override

        let regHi = this.prgBankReg[4]; // $5117
        let bank16kHi = (regHi & 0x7e) >> 1;
        this.loadRomBank(bank16kHi % this.nes.rom.romCount, 0xc000);
        break;
      }
      case 2: {
        // $8000-$BFFF from $5115, $C000-$DFFF from $5116, $E000-$FFFF from $5117
        let regA = this.prgBankReg[2]; // $5115
        if (regA & 0x80) {
          let bank16k = (regA & 0x7e) >> 1;
          this.loadRomBank(bank16k % this.nes.rom.romCount, 0x8000);
        }

        let regB = this.prgBankReg[3]; // $5116
        if (regB & 0x80) {
          this.load8kRomBank(regB & 0x7f, 0xc000);
        }

        let regC = this.prgBankReg[4]; // $5117
        this.load8kRomBank(regC & 0x7f, 0xe000);
        break;
      }
      case 3:
      default: {
        // Four 8K banks from $5114-$5117
        for (let i = 1; i <= 4; i++) {
          let reg = this.prgBankReg[i];
          let addr = 0x6000 + i * 0x2000; // $8000, $A000, $C000, $E000
          // $5117 (i=4) is always ROM; $5114-$5116 check bit 7
          if (i === 4 || reg & 0x80) {
            this.load8kRomBank(reg & 0x7f, addr);
          }
          // RAM banks are handled dynamically in load()
        }
        break;
      }
    }
  }

  // --- CHR Synchronization ---
  // Apply the current CHR bank registers to PPU pattern table memory.
  // See https://www.nesdev.org/wiki/MMC5#CHR_banking
  _syncChr() {
    // Invalidate cached CHR bank target so the render hooks re-apply.
    this._chrBankTarget = -1;

    if (this.nes.ppu.f_spriteSize === 0) {
      // 8x8 sprite mode: only one CHR bank set is used for all fetches.
      // Apply whichever set was last written to.
      if (this.lastChrWrite === 1) {
        this._applyChrSetB();
        this._chrBankTarget = 1;
      } else {
        this._applyChrSetA();
        this._chrBankTarget = 0;
      }
    }
    // In 8x16 sprite mode, the onBgRender/onSpriteRender hooks handle
    // switching between set A (sprites) and set B (backgrounds) per phase.
  }

  // Apply CHR bank set A ($5120-$5127) based on chrMode.
  _applyChrSetA() {
    if (this.nes.rom.vromCount === 0) return;

    switch (this.chrMode) {
      case 0:
        // 8K mode: $5127 selects an 8K page
        this.load8kVromBank((this.chrBankA[7] & 0xff) * 2, 0x0000);
        break;
      case 1:
        // 4K mode: $5123 selects 4K at $0000, $5127 selects 4K at $1000
        this.loadVromBank(this.chrBankA[3] & 0xff, 0x0000);
        this.loadVromBank(this.chrBankA[7] & 0xff, 0x1000);
        break;
      case 2:
        // 2K mode: $5121/$5123/$5125/$5127 each select 2K
        this.load2kVromBank(this.chrBankA[1] & 0x1ff, 0x0000);
        this.load2kVromBank(this.chrBankA[3] & 0x1ff, 0x0800);
        this.load2kVromBank(this.chrBankA[5] & 0x1ff, 0x1000);
        this.load2kVromBank(this.chrBankA[7] & 0x1ff, 0x1800);
        break;
      case 3:
      default:
        // 1K mode: $5120-$5127 each select a 1K page
        for (let i = 0; i < 8; i++) {
          this.load1kVromBank(this.chrBankA[i] & 0x3ff, i * 0x0400);
        }
        break;
    }
  }

  // Apply CHR bank set B ($5128-$512B) based on chrMode.
  // Set B uses only 4 registers, so larger modes replicate them.
  _applyChrSetB() {
    if (this.nes.rom.vromCount === 0) return;

    switch (this.chrMode) {
      case 0:
        // 8K mode: $512B selects an 8K page
        this.load8kVromBank((this.chrBankB[3] & 0xff) * 2, 0x0000);
        break;
      case 1:
        // 4K mode: $512B selects 4K at both halves
        this.loadVromBank(this.chrBankB[3] & 0xff, 0x0000);
        this.loadVromBank(this.chrBankB[3] & 0xff, 0x1000);
        break;
      case 2:
        // 2K mode: $5129/$512B each select 2K, replicated across 8K
        this.load2kVromBank(this.chrBankB[1] & 0x1ff, 0x0000);
        this.load2kVromBank(this.chrBankB[3] & 0x1ff, 0x0800);
        this.load2kVromBank(this.chrBankB[1] & 0x1ff, 0x1000);
        this.load2kVromBank(this.chrBankB[3] & 0x1ff, 0x1800);
        break;
      case 3:
      default:
        // 1K mode: $5128-$512B each select 1K, replicated for both halves
        for (let i = 0; i < 4; i++) {
          this.load1kVromBank(this.chrBankB[i] & 0x3ff, i * 0x0400);
          this.load1kVromBank(this.chrBankB[i] & 0x3ff, (i + 4) * 0x0400);
        }
        break;
    }
  }

  // --- Nametable Synchronization ---
  // Configure the PPU's vramMirrorTable to reflect the MMC5's nametable mapping.
  // Each of the 4 nametable slots ($2000/$2400/$2800/$2C00) can be mapped to:
  //   0: NES CIRAM page A ($2000)
  //   1: NES CIRAM page B ($2400)
  //   2: ExRAM (internal 1KB, stored at $2800 in VRAM)
  //   3: Fill mode (stored at $2C00 in VRAM)
  // See https://www.nesdev.org/wiki/MMC5#Nametable_mapping
  _syncNametables() {
    let ppu = this.nes.ppu;

    // First, populate the fill-mode nametable at VRAM $2C00.
    // 960 bytes of tile index followed by 64 bytes of attribute.
    // The attribute byte packs the fill palette into all four sub-quadrants.
    let fillAttrByte =
      this.fillAttr |
      (this.fillAttr << 2) |
      (this.fillAttr << 4) |
      (this.fillAttr << 6);
    for (let i = 0; i < 960; i++) {
      ppu.vramMem[0x2c00 + i] = this.fillTile;
    }
    for (let i = 960; i < 1024; i++) {
      ppu.vramMem[0x2c00 + i] = fillAttrByte;
    }

    // Copy ExRAM into VRAM at $2800 for nametable use.
    // In modes 2/3 (general-purpose RAM), ExRAM reads as all zeros for nametable.
    if (this.exramMode >= 2) {
      for (let i = 0; i < 0x400; i++) {
        ppu.vramMem[0x2800 + i] = 0;
      }
    } else {
      copyArrayElements(this.exram, 0, ppu.vramMem, 0x2800, 0x400);
    }

    // Physical VRAM locations for each source:
    //   0 → $2000 (CIRAM A)
    //   1 → $2400 (CIRAM B)
    //   2 → $2800 (ExRAM copy)
    //   3 → $2C00 (Fill mode)
    const sourceBase = [0x2000, 0x2400, 0x2800, 0x2c00];

    for (let nt = 0; nt < 4; nt++) {
      let logicalBase = 0x2000 + nt * 0x400;
      let physBase = sourceBase[this.ntMapping[nt]];
      ppu.defineMirrorRegion(logicalBase, physBase, 0x400);
    }

    // Also mirror $3000-$3EFF → $2000-$2EFF as per normal NES behavior
    ppu.defineMirrorRegion(0x3000, 0x2000, 0xf00);
  }

  // Sync a single ExRAM byte to the VRAM copy at $2800 if ExRAM is used
  // as a nametable (modes 0/1).
  _syncExramToVram(exAddr) {
    if (this.exramMode < 2) {
      this.nes.ppu.vramMem[0x2800 + exAddr] = this.exram[exAddr];
    }
  }

  // --- Expansion Audio ---
  // Write to a pulse channel register. Layout matches the NES APU square channels
  // ($4000-$4003) except that $5001/$5005 (sweep) has no effect on MMC5 pulses.
  _writePulse(pulse, reg, value) {
    switch (reg) {
      case 0:
        // $5000/$5004: Duty, length counter halt, constant volume, volume/envelope
        pulse.dutyCycle = (value >> 6) & 0x03;
        pulse.lengthHalt = (value & 0x20) !== 0;
        pulse.constantVolume = (value & 0x10) !== 0;
        pulse.volume = value & 0x0f;
        break;
      case 1:
        // $5001/$5005: Sweep — no effect on MMC5 pulse channels
        break;
      case 2:
        // $5002/$5006: Timer low 8 bits
        pulse.timer = (pulse.timer & 0x700) | value;
        break;
      case 3:
        // $5003/$5007: Length counter load, timer high 3 bits
        pulse.timer = (pulse.timer & 0x0ff) | ((value & 0x07) << 8);
        if (pulse.enabled) {
          pulse.lengthCounter = this.nes.papu.getLengthMax(value);
        }
        pulse.envelopeStart = true;
        pulse.sequencePos = 0;
        break;
    }
  }

  // --- Scanline IRQ Counter ---
  // Called by the PPU once per scanline when BG or sprites are enabled.
  // The PPU calls this at scanline 20 (pre-render) and scanlines 21-260 (visible).
  // The MMC5 uses an up-counter that resets when entering rendering and increments
  // each scanline, firing an IRQ when it matches the target value in $5203.
  // See https://www.nesdev.org/wiki/MMC5#Scanline_detection_and_scanline_IRQ
  clockIrqCounter() {
    let scanline = this.nes.ppu.scanline;

    if (scanline === 20) {
      // Pre-render scanline: entering active rendering.
      // Set in-frame and reset the scanline counter.
      this.inFrame = true;
      this.irqCounter = 0;
      return;
    }

    // Visible scanlines (21-260): increment counter and compare.
    this.irqCounter++;
    // $5203 value of 0 is a special case that never matches.
    if (this.irqTarget !== 0 && this.irqCounter === this.irqTarget) {
      this.irqPending = true;
      if (this.irqEnabled) {
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
      }
    }
  }

  // --- CHR Bank Switching for Sprite/BG Phases ---
  // The MMC5 uses dual CHR bank sets in 8x16 sprite mode ($2000 bit 5 = 1):
  //   - Bank set A ($5120-$5127) is used for sprite pattern fetches
  //   - Bank set B ($5128-$512B) is used for background pattern fetches
  // In 8x8 sprite mode, only the last-written set is used for all fetches.
  // The PPU calls these hooks before each rendering phase so we can swap
  // the pattern table data in the ptTile cache.
  // See https://www.nesdev.org/wiki/MMC5#CHR_banking

  onBgRender() {
    if (this.nes.ppu.f_spriteSize === 1 && this._chrBankTarget !== 1) {
      this._applyChrSetB();
      this._chrBankTarget = 1;
      // Invalidate the PPU's tile cache since we swapped CHR data
      this.nes.ppu.validTileData = false;
    }
  }

  onSpriteRender() {
    if (this.nes.ppu.f_spriteSize === 1 && this._chrBankTarget !== 0) {
      this._applyChrSetA();
      this._chrBankTarget = 0;
    }
  }

  // --- ROM Loading ---
  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("MMC5: Invalid ROM! Unable to load.");
    }

    // Default PRG banking: last bank at $E000-$FFFF (mode 3 default)
    this.prgBankReg[4] = 0xff;
    this._syncPrg();

    // Load CHR-ROM if present
    this.loadCHRROM();

    // Load Battery RAM (if present)
    this.loadBatteryRam();

    // Initialize nametable mapping (default to vertical mirroring pattern)
    this._syncNametables();

    // Reset interrupt
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  // --- Save State Support ---
  toJSON() {
    let s = super.toJSON();
    s.prgMode = this.prgMode;
    s.prgBankReg = Array.from(this.prgBankReg);
    s.prgRam = Array.from(this.prgRam);
    s.prgRamProtectA = this.prgRamProtectA;
    s.prgRamProtectB = this.prgRamProtectB;
    s.chrMode = this.chrMode;
    s.chrBankA = Array.from(this.chrBankA);
    s.chrBankB = Array.from(this.chrBankB);
    s.chrUpperBits = this.chrUpperBits;
    s.lastChrWrite = this.lastChrWrite;
    s.ntMapping = Array.from(this.ntMapping);
    s.exramMode = this.exramMode;
    s.exram = Array.from(this.exram);
    s.fillTile = this.fillTile;
    s.fillAttr = this.fillAttr;
    s.irqTarget = this.irqTarget;
    s.irqEnabled = this.irqEnabled;
    s.irqPending = this.irqPending;
    s.inFrame = this.inFrame;
    s.irqCounter = this.irqCounter;
    s.multA = this.multA;
    s.multB = this.multB;
    s.splitEnabled = this.splitEnabled;
    s.splitRight = this.splitRight;
    s.splitTile = this.splitTile;
    s.splitScroll = this.splitScroll;
    s.splitPage = this.splitPage;
    s.pcmValue = this.pcmValue;
    s.pcmReadMode = this.pcmReadMode;
    s.audioEnabled = this.audioEnabled;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.prgMode = s.prgMode;
    this.prgBankReg = new Uint8Array(s.prgBankReg);
    this.prgRam = new Uint8Array(s.prgRam);
    this.prgRamProtectA = s.prgRamProtectA;
    this.prgRamProtectB = s.prgRamProtectB;
    this.chrMode = s.chrMode;
    this.chrBankA = new Uint16Array(s.chrBankA);
    this.chrBankB = new Uint16Array(s.chrBankB);
    this.chrUpperBits = s.chrUpperBits;
    this.lastChrWrite = s.lastChrWrite;
    this.ntMapping = new Uint8Array(s.ntMapping);
    this.exramMode = s.exramMode;
    this.exram = new Uint8Array(s.exram);
    this.fillTile = s.fillTile;
    this.fillAttr = s.fillAttr;
    this.irqTarget = s.irqTarget;
    this.irqEnabled = s.irqEnabled;
    this.irqPending = s.irqPending;
    this.inFrame = s.inFrame;
    this.irqCounter = s.irqCounter;
    this.multA = s.multA;
    this.multB = s.multB;
    this.splitEnabled = s.splitEnabled;
    this.splitRight = s.splitRight;
    this.splitTile = s.splitTile;
    this.splitScroll = s.splitScroll;
    this.splitPage = s.splitPage;
    this.pcmValue = s.pcmValue;
    this.pcmReadMode = s.pcmReadMode;
    this.audioEnabled = s.audioEnabled;

    // Re-sync banks after loading state
    this._syncPrg();
    this._syncChr();
    this._syncNametables();
  }
}

export default Mapper5;

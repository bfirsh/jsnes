import { copyArrayElements } from "../utils.js";

class Mapper0 {
  static mapperName = "NROM";

  constructor(nes) {
    this.nes = nes;

    this.joy1StrobeState = 0;
    this.joy2StrobeState = 0;
    this.joypadLastWrite = 0;

    this.zapperFired = false;
    this.zapperX = null;
    this.zapperY = null;
  }

  write(address, value) {
    if (address < 0x2000) {
      // Mirroring of RAM:
      this.nes.cpu.mem[address & 0x7ff] = value;
    } else if (address >= 0x8000) {
      // ROM is not writable. Mappers may override this to handle bank switching.
    } else if (address >= 0x6000) {
      // Cartridge SRAM (0x6000-0x7FFF)
      this.nes.cpu.mem[address] = value;
      this.nes.opts.onBatteryRamWrite(address, value);
    } else if (address > 0x4017) {
      // Cartridge expansion area (0x4018-0x5FFF)
      this.nes.cpu.mem[address] = value;
    } else if (address > 0x2007 && address < 0x4000) {
      this.regWrite(0x2000 + (address & 0x7), value);
    } else {
      this.regWrite(address, value);
    }
  }

  writelow(address, value) {
    if (address < 0x2000) {
      // Mirroring of RAM:
      this.nes.cpu.mem[address & 0x7ff] = value;
    } else if (address >= 0x8000) {
      // ROM is not writable
    } else if (address > 0x4017) {
      // Cartridge RAM/expansion area (0x4018-0x7FFF)
      this.nes.cpu.mem[address] = value;
    } else if (address > 0x2007 && address < 0x4000) {
      this.regWrite(0x2000 + (address & 0x7), value);
    } else {
      this.regWrite(address, value);
    }
  }

  load(address) {
    // Wrap around:
    address &= 0xffff;

    // Check address range:
    if (address > 0x4017) {
      if (address < 0x6000) {
        // Open bus: $4018-$5FFF (unmapped expansion area)
        return this.nes.cpu.dataBus;
      }
      // Cartridge RAM ($6000-$7FFF) and ROM ($8000-$FFFF):
      return this.nes.cpu.mem[address];
    } else if (address >= 0x2000) {
      // I/O Ports.
      return this.regLoad(address);
    } else {
      // RAM (mirrored)
      return this.nes.cpu.mem[address & 0x7ff];
    }
  }

  regLoad(address) {
    switch (
      address >> 12 // use fourth nibble (0xF000)
    ) {
      case 0:
        break;

      case 1:
        break;

      case 2:
      // Fall through to case 3
      case 3:
        // PPU Registers
        switch (address & 0x7) {
          case 0x0:
            // 0x2000: PPU Control Register 1 (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x1:
            // 0x2001: PPU Control Register 2 (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x2:
            // 0x2002: PPU Status Register (bits 7-5 from status, 4-0 from open bus)
            return this.nes.ppu.readStatusRegister();

          case 0x3:
            // 0x2003: OAM Address (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x4:
            // 0x2004: Sprite Memory read
            return this.nes.ppu.sramLoad();

          case 0x5:
            // 0x2005: Scroll (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x6:
            // 0x2006: VRAM Address (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x7:
            // 0x2007: VRAM read
            return this.nes.ppu.vramLoad();
        }
        break;
      case 4:
        // Sound+Joypad registers
        switch (address - 0x4015) {
          case 0:
            // 0x4015:
            // Sound channel enable, DMC Status
            return this.nes.papu.readReg(address);

          case 1:
            // 0x4016:
            // Joystick 1 + Strobe
            // Bits 0-4 from controller, bits 5-7 are open bus (data bus)
            // See https://www.nesdev.org/wiki/Open_bus_behavior
            return (this.joy1Read() & 0x1f) | (this.nes.cpu.dataBus & 0xe0);

          case 2: {
            // 0x4017:
            // Joystick 2 + Strobe
            // https://wiki.nesdev.com/w/index.php/Zapper
            // Bits 0-4 from controller/zapper, bits 5-7 are open bus (data bus)
            // Zapper bits (3=light sensor, 4=trigger) are only driven when the
            // zapper is connected (zapperX/Y non-null). With no zapper, these
            // bits are 0 (standard controller doesn't drive them).
            let w = 0;

            if (this.zapperX !== null && this.zapperY !== null) {
              // Zapper connected: bit 3 = light not detected
              if (!this.nes.ppu.isPixelWhite(this.zapperX, this.zapperY)) {
                w = 0x1 << 3;
              }
            }

            if (this.zapperFired) {
              w |= 0x1 << 4;
            }
            return (
              ((this.joy2Read() | w) & 0x1f) | (this.nes.cpu.dataBus & 0xe0)
            );
          }
        }
        break;
    }
    // Write-only registers (APU $4000-$4014, etc.) are open bus.
    // On real hardware, if a DMC DMA fetch coincides with this read cycle,
    // the DMA steals the CPU bus cycle and the fetched sample byte appears
    // on the data bus instead of the open bus value. This is how the ROM's
    // DMA sync loops (LDA $4000; BNE) detect DMC activity.
    // See https://www.nesdev.org/wiki/APU_DMC#Memory_reader
    let cpu = this.nes.cpu;
    if (
      cpu._dmcFetchCycles > 0 &&
      cpu._dmcFetchCycles === cpu.instrBusCycles + 1
    ) {
      let dmc = this.nes.papu.dmc;
      if (dmc && dmc.isEnabled) {
        return dmc.lastFetchedByte;
      }
    }
    return cpu.dataBus;
  }

  regWrite(address, value) {
    // All PPU register writes update the open bus latch
    if (address >= 0x2000 && address <= 0x3fff) {
      this.nes.ppu.openBusLatch = value;
      this.nes.ppu.openBusDecayFrames = 36; // ~600ms at 60fps
    }

    switch (address) {
      case 0x2000:
        // PPU Control register 1
        this.nes.cpu.mem[address] = value;
        this.nes.ppu.updateControlReg1(value);
        break;

      case 0x2001:
        // PPU Control register 2
        this.nes.cpu.mem[address] = value;
        this.nes.ppu.updateControlReg2(value);
        break;

      case 0x2003:
        // Set Sprite RAM address:
        this.nes.ppu.writeSRAMAddress(value);
        break;

      case 0x2004:
        // Write to Sprite RAM:
        this.nes.ppu.sramWrite(value);
        break;

      case 0x2005:
        // Screen Scroll offsets:
        this.nes.ppu.scrollWrite(value);
        break;

      case 0x2006:
        // Set VRAM address:
        this.nes.ppu.writeVRAMAddress(value);
        break;

      case 0x2007:
        // Write to VRAM:
        this.nes.ppu.vramWrite(value);
        break;

      case 0x4014:
        // Sprite Memory DMA Access
        this.nes.ppu.sramDMA(value);
        break;

      case 0x4015:
        // Sound Channel Switch, DMC Status
        this.nes.papu.writeReg(address, value);
        break;

      case 0x4016:
        // Joystick 1 + Strobe
        if ((value & 1) === 0 && (this.joypadLastWrite & 1) === 1) {
          this.joy1StrobeState = 0;
          this.joy2StrobeState = 0;
        }
        this.joypadLastWrite = value;
        break;

      case 0x4017:
        // Sound channel frame sequencer:
        this.nes.papu.writeReg(address, value);
        break;

      default:
        // Sound registers
        // console.log("write to sound reg");
        if (address >= 0x4000 && address <= 0x4017) {
          this.nes.papu.writeReg(address, value);
        }
    }
  }

  joy1Read() {
    // While strobe is active ($4016 bit 0 = 1), the shift register is
    // continuously reloaded, so reads always return button A's state.
    // See https://www.nesdev.org/wiki/Standard_controller
    if (this.joypadLastWrite & 1) {
      return this.nes.controllers[1].state[0];
    }

    let ret;
    if (this.joy1StrobeState < 8) {
      ret = this.nes.controllers[1].state[this.joy1StrobeState];
    } else {
      // After 8 reads, the shift register is empty and the serial data
      // line floats high, returning 1 on a standard NES controller.
      ret = 1;
    }

    this.joy1StrobeState++;
    if (this.joy1StrobeState === 24) {
      this.joy1StrobeState = 0;
    }

    return ret;
  }

  joy2Read() {
    // While strobe is active, always return button A's state.
    if (this.joypadLastWrite & 1) {
      return this.nes.controllers[2].state[0];
    }

    let ret;
    if (this.joy2StrobeState < 8) {
      ret = this.nes.controllers[2].state[this.joy2StrobeState];
    } else {
      // After 8 reads, the shift register is empty → returns 1.
      ret = 1;
    }

    this.joy2StrobeState++;
    if (this.joy2StrobeState === 24) {
      this.joy2StrobeState = 0;
    }

    return ret;
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 1) {
      throw new Error("NoMapper: Invalid ROM! Unable to load.");
    }

    // Load ROM into memory:
    this.loadPRGROM();

    // Load CHR-ROM:
    this.loadCHRROM();

    // Load Battery RAM (if present):
    this.loadBatteryRam();

    // Reset IRQ:
    //nes.getCpu().doResetInterrupt();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  loadPRGROM() {
    if (this.nes.rom.romCount > 1) {
      // Load the two first banks into memory.
      this.loadRomBank(0, 0x8000);
      this.loadRomBank(1, 0xc000);
    } else {
      // Load the one bank into both memory locations:
      this.loadRomBank(0, 0x8000);
      this.loadRomBank(0, 0xc000);
    }
  }

  loadCHRROM() {
    // console.log("Loading CHR ROM..");
    if (this.nes.rom.vromCount > 0) {
      if (this.nes.rom.vromCount === 1) {
        this.loadVromBank(0, 0x0000);
        this.loadVromBank(0, 0x1000);
      } else {
        this.loadVromBank(0, 0x0000);
        this.loadVromBank(1, 0x1000);
      }
    } else {
      //System.out.println("There aren't any CHR-ROM banks..");
    }
  }

  loadBatteryRam() {
    if (this.nes.rom.batteryRam) {
      let ram = this.nes.rom.batteryRam;
      if (ram !== null && ram.length === 0x2000) {
        // Load Battery RAM into memory:
        copyArrayElements(ram, 0, this.nes.cpu.mem, 0x6000, 0x2000);
      }
    }
  }

  loadRomBank(bank, address) {
    // Loads a ROM bank into the specified address.
    bank %= this.nes.rom.romCount;
    //let data = this.nes.rom.rom[bank];
    //cpuMem.write(address,data,data.length);
    copyArrayElements(
      this.nes.rom.rom[bank],
      0,
      this.nes.cpu.mem,
      address,
      16384,
    );
  }

  loadVromBank(bank, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    copyArrayElements(
      this.nes.rom.vrom[bank % this.nes.rom.vromCount],
      0,
      this.nes.ppu.vramMem,
      address,
      4096,
    );

    let vromTile = this.nes.rom.vromTile[bank % this.nes.rom.vromCount];
    copyArrayElements(vromTile, 0, this.nes.ppu.ptTile, address >> 4, 256);
  }

  load32kRomBank(bank, address) {
    this.loadRomBank((bank * 2) % this.nes.rom.romCount, address);
    this.loadRomBank((bank * 2 + 1) % this.nes.rom.romCount, address + 16384);
  }

  load8kVromBank(bank4kStart, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    this.loadVromBank(bank4kStart % this.nes.rom.vromCount, address);
    this.loadVromBank(
      (bank4kStart + 1) % this.nes.rom.vromCount,
      address + 4096,
    );
  }

  load1kVromBank(bank1k, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    let bank4k = Math.floor(bank1k / 4) % this.nes.rom.vromCount;
    let bankoffset = (bank1k % 4) * 1024;
    copyArrayElements(
      this.nes.rom.vrom[bank4k],
      bankoffset,
      this.nes.ppu.vramMem,
      address,
      1024,
    );

    // Update tiles:
    let vromTile = this.nes.rom.vromTile[bank4k];
    let baseIndex = address >> 4;
    for (let i = 0; i < 64; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = vromTile[((bank1k % 4) << 6) + i];
    }
  }

  load2kVromBank(bank2k, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    let bank4k = Math.floor(bank2k / 2) % this.nes.rom.vromCount;
    let bankoffset = (bank2k % 2) * 2048;
    copyArrayElements(
      this.nes.rom.vrom[bank4k],
      bankoffset,
      this.nes.ppu.vramMem,
      address,
      2048,
    );

    // Update tiles:
    let vromTile = this.nes.rom.vromTile[bank4k];
    let baseIndex = address >> 4;
    for (let i = 0; i < 128; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = vromTile[((bank2k % 2) << 7) + i];
    }
  }

  load8kRomBank(bank8k, address) {
    let bank16k = Math.floor(bank8k / 2) % this.nes.rom.romCount;
    let offset = (bank8k % 2) * 8192;

    //this.nes.cpu.mem.write(address,this.nes.rom.rom[bank16k],offset,8192);
    copyArrayElements(
      this.nes.rom.rom[bank16k],
      offset,
      this.nes.cpu.mem,
      address,
      8192,
    );
  }

  clockIrqCounter() {
    // Does nothing. This is used by the MMC3 mapper.
  }

  // eslint-disable-next-line no-unused-vars
  latchAccess(address) {
    // Does nothing. This is used by MMC2.
  }

  toJSON() {
    return {
      joy1StrobeState: this.joy1StrobeState,
      joy2StrobeState: this.joy2StrobeState,
      joypadLastWrite: this.joypadLastWrite,
    };
  }

  fromJSON(s) {
    this.joy1StrobeState = s.joy1StrobeState;
    this.joy2StrobeState = s.joy2StrobeState;
    this.joypadLastWrite = s.joypadLastWrite;
  }
}

export default Mapper0;

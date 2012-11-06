/*
JSNES, based on Jamie Sanders' vNES
Copyright (C) 2010 Ben Firshman

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

JSNES.Mappers = {};

JSNES.Mappers[0] = function(nes) {
    this.nes = nes;
};

JSNES.Mappers[0].prototype = {
    reset: function() {
        this.joy1StrobeState = 0;
        this.joy2StrobeState = 0;
        this.joypadLastWrite = 0;
        
        this.mousePressed = false;
        this.mouseX = null;
        this.mouseY = null;
    },
    
    write: function(address, value) {
        if (address < 0x2000) {
            // Mirroring of RAM:
            this.nes.cpu.mem[address & 0x7FF] = value;
        
        }
        else if (address > 0x4017) {
            this.nes.cpu.mem[address] = value;
            if (address >= 0x6000 && address < 0x8000) {
                // Write to SaveRAM. Store in file:
                // TODO: not yet
                //if(this.nes.rom!=null)
                //    this.nes.rom.writeBatteryRam(address,value);
            }
        }
        else if (address > 0x2007 && address < 0x4000) {
            this.regWrite(0x2000 + (address & 0x7), value);
        }
        else {
            this.regWrite(address, value);
        }
    },
    
    writelow: function(address, value) {
        if (address < 0x2000) {
            // Mirroring of RAM:
            this.nes.cpu.mem[address & 0x7FF] = value;
        }
        else if (address > 0x4017) {
            this.nes.cpu.mem[address] = value;
        }
        else if (address > 0x2007 && address < 0x4000) {
            this.regWrite(0x2000 + (address & 0x7), value);
        }
        else {
            this.regWrite(address, value);
        }
    },

    load: function(address) {
        // Wrap around:
        address &= 0xFFFF;
    
        // Check address range:
        if (address > 0x4017) {
            // ROM:
            return this.nes.cpu.mem[address];
        }
        else if (address >= 0x2000) {
            // I/O Ports.
            return this.regLoad(address);
        }
        else {
            // RAM (mirrored)
            return this.nes.cpu.mem[address & 0x7FF];
        }
    },

    regLoad: function(address) {
        switch (address >> 12) { // use fourth nibble (0xF000)
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
                        // 0x2000:
                        // PPU Control Register 1.
                        // (the value is stored both
                        // in main memory and in the
                        // PPU as flags):
                        // (not in the real NES)
                        return this.nes.cpu.mem[0x2000];
                    
                    case 0x1:
                        // 0x2001:
                        // PPU Control Register 2.
                        // (the value is stored both
                        // in main memory and in the
                        // PPU as flags):
                        // (not in the real NES)
                        return this.nes.cpu.mem[0x2001];
                    
                    case 0x2:
                        // 0x2002:
                        // PPU Status Register.
                        // The value is stored in
                        // main memory in addition
                        // to as flags in the PPU.
                        // (not in the real NES)
                        return this.nes.ppu.readStatusRegister();
                    
                    case 0x3:
                        return 0;
                    
                    case 0x4:
                        // 0x2004:
                        // Sprite Memory read.
                        return this.nes.ppu.sramLoad();
                    case 0x5:
                        return 0;
                    
                    case 0x6:
                        return 0;
                    
                    case 0x7:
                        // 0x2007:
                        // VRAM read:
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
                        return this.joy1Read();
                    
                    case 2:
                        // 0x4017:
                        // Joystick 2 + Strobe
                        if (this.mousePressed) {
                        
                            // Check for white pixel nearby:
                            var sx = Math.max(0, this.mouseX - 4);
                            var ex = Math.min(256, this.mouseX + 4);
                            var sy = Math.max(0, this.mouseY - 4);
                            var ey = Math.min(240, this.mouseY + 4);
                            var w = 0;
                        
                            for (var y=sy; y<ey; y++) {
                                for (var x=sx; x<ex; x++) {
                               
                                    if (this.nes.ppu.buffer[(y<<8)+x] == 0xFFFFFF) {
                                        w |= 0x1<<3;
                                        console.debug("Clicked on white!");
                                        break;
                                    }
                                }
                            }
                        
                            w |= (this.mousePressed?(0x1<<4):0);
                            return (this.joy2Read()|w) & 0xFFFF;
                        }
                        else {
                            return this.joy2Read();
                        }
                    
                }
                break;
        }
        return 0;
    },

    regWrite: function(address, value) {
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
                if (value === 0 && this.joypadLastWrite === 1) {
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
                ////System.out.println("write to sound reg");
                if (address >= 0x4000 && address <= 0x4017) {
                    this.nes.papu.writeReg(address,value);
                }
                
        }
    },

    joy1Read: function() {
        var ret;
    
        switch (this.joy1StrobeState) {
            case 0:
            case 1:
            case 2:
            case 3:
            case 4:
            case 5:
            case 6:
            case 7:
                ret = this.nes.keyboard.state1[this.joy1StrobeState];
                break;
            case 8:
            case 9:
            case 10:
            case 11:
            case 12:
            case 13:
            case 14:
            case 15:
            case 16:
            case 17:
            case 18:
                ret = 0;
                break;
            case 19:
                ret = 1;
                break;
            default:
                ret = 0;
        }
    
        this.joy1StrobeState++;
        if (this.joy1StrobeState == 24) {
            this.joy1StrobeState = 0;
        }
    
        return ret;
    },

    joy2Read: function() {
        var ret;
    
        switch (this.joy2StrobeState) {
            case 0:
            case 1:
            case 2:
            case 3:
            case 4:
            case 5:
            case 6:
            case 7:
                ret = this.nes.keyboard.state2[this.joy2StrobeState];
                break;
            case 8:
            case 9:
            case 10:
            case 11:
            case 12:
            case 13:
            case 14:
            case 15:
            case 16:
            case 17:
            case 18:
                ret = 0;
                break;
            case 19:
                ret = 1;
                break;
            default:
                ret = 0;
        }

        this.joy2StrobeState++;
        if (this.joy2StrobeState == 24) {
            this.joy2StrobeState = 0;
        }
    
        return ret;
      },

    loadROM: function() {
        if (!this.nes.rom.valid || this.nes.rom.romCount < 1) {
            alert("NoMapper: Invalid ROM! Unable to load.");
            return;
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
    },

    loadPRGROM: function() {
        if (this.nes.rom.romCount > 1) {
            // Load the two first banks into memory.
            this.loadRomBank(0, 0x8000);
            this.loadRomBank(1, 0xC000);
        }
        else {
            // Load the one bank into both memory locations:
            this.loadRomBank(0, 0x8000);
            this.loadRomBank(0, 0xC000);
        }
    },

    loadCHRROM: function() {
        ////System.out.println("Loading CHR ROM..");
        if (this.nes.rom.vromCount > 0) {
            if (this.nes.rom.vromCount == 1) {
                this.loadVromBank(0,0x0000);
                this.loadVromBank(0,0x1000);
            }
            else {
                this.loadVromBank(0,0x0000);
                this.loadVromBank(1,0x1000);
            }
        }
        else {
            //System.out.println("There aren't any CHR-ROM banks..");
        }
    },

    loadBatteryRam: function() {
        if (this.nes.rom.batteryRam) {
            var ram = this.nes.rom.batteryRam;
            if (ram !== null && ram.length == 0x2000) {
                // Load Battery RAM into memory:
                JSNES.Utils.copyArrayElements(ram, 0, this.nes.cpu.mem, 0x6000, 0x2000);
            }
        }
    },

    loadRomBank: function(bank, address) {
        // Loads a ROM bank into the specified address.
        bank %= this.nes.rom.romCount;
        //var data = this.nes.rom.rom[bank];
        //cpuMem.write(address,data,data.length);
        JSNES.Utils.copyArrayElements(this.nes.rom.rom[bank], 0, this.nes.cpu.mem, address, 16384);
    },

    loadVromBank: function(bank, address) {
        if (this.nes.rom.vromCount === 0) {
            return;
        }
        this.nes.ppu.triggerRendering();
    
        JSNES.Utils.copyArrayElements(this.nes.rom.vrom[bank % this.nes.rom.vromCount], 
            0, this.nes.ppu.vramMem, address, 4096);
    
        var vromTile = this.nes.rom.vromTile[bank % this.nes.rom.vromCount];
        JSNES.Utils.copyArrayElements(vromTile, 0, this.nes.ppu.ptTile,address >> 4, 256);
    },

    load32kRomBank: function(bank, address) {
        this.loadRomBank((bank*2) % this.nes.rom.romCount, address);
        this.loadRomBank((bank*2+1) % this.nes.rom.romCount, address+16384);
    },

    load8kVromBank: function(bank4kStart, address) {
        if (this.nes.rom.vromCount === 0) {
            return;
        }
        this.nes.ppu.triggerRendering();

        this.loadVromBank((bank4kStart) % this.nes.rom.vromCount, address);
        this.loadVromBank((bank4kStart + 1) % this.nes.rom.vromCount,
                address + 4096);
    },

    load1kVromBank: function(bank1k, address) {
        if (this.nes.rom.vromCount === 0) {
            return;
        }
        this.nes.ppu.triggerRendering();
    
        var bank4k = Math.floor(bank1k / 4) % this.nes.rom.vromCount;
        var bankoffset = (bank1k % 4) * 1024;
        JSNES.Utils.copyArrayElements(this.nes.rom.vrom[bank4k], 0, 
            this.nes.ppu.vramMem, bankoffset, 1024);
    
        // Update tiles:
        var vromTile = this.nes.rom.vromTile[bank4k];
        var baseIndex = address >> 4;
        for (var i = 0; i < 64; i++) {
            this.nes.ppu.ptTile[baseIndex+i] = vromTile[((bank1k%4) << 6) + i];
        }
    },

    load2kVromBank: function(bank2k, address) {
        if (this.nes.rom.vromCount === 0) {
            return;
        }
        this.nes.ppu.triggerRendering();
    
        var bank4k = Math.floor(bank2k / 2) % this.nes.rom.vromCount;
        var bankoffset = (bank2k % 2) * 2048;
        JSNES.Utils.copyArrayElements(this.nes.rom.vrom[bank4k], bankoffset,
            this.nes.ppu.vramMem, address, 2048);
    
        // Update tiles:
        var vromTile = this.nes.rom.vromTile[bank4k];
        var baseIndex = address >> 4;
        for (var i = 0; i < 128; i++) {
            this.nes.ppu.ptTile[baseIndex+i] = vromTile[((bank2k%2) << 7) + i];
        }
    },

    load8kRomBank: function(bank8k, address) {
        var bank16k = Math.floor(bank8k / 2) % this.nes.rom.romCount;
        var offset = (bank8k % 2) * 8192;
    
        //this.nes.cpu.mem.write(address,this.nes.rom.rom[bank16k],offset,8192);
        JSNES.Utils.copyArrayElements(this.nes.rom.rom[bank16k], offset, 
                  this.nes.cpu.mem, address, 8192);
    },

    clockIrqCounter: function() {
        // Does nothing. This is used by the MMC3 mapper.
    },

    latchAccess: function(address) {
        // Does nothing. This is used by MMC2.
    },
    
    toJSON: function() {
        return {
            'joy1StrobeState': this.joy1StrobeState,
            'joy2StrobeState': this.joy2StrobeState,
            'joypadLastWrite': this.joypadLastWrite
        };
    },
    
    fromJSON: function(s) {
        this.joy1StrobeState = s.joy1StrobeState;
        this.joy2StrobeState = s.joy2StrobeState;
        this.joypadLastWrite = s.joypadLastWrite;
    }
};


JSNES.Mappers[1] = function(nes) {
    this.nes = nes;
};

JSNES.Mappers[1].prototype = new JSNES.Mappers[0]();

JSNES.Mappers[1].prototype.reset = function() {
    JSNES.Mappers[0].prototype.reset.apply(this);
    
    // 5-bit buffer:
    this.regBuffer = 0;
    this.regBufferCounter = 0;

    // Register 0:
    this.mirroring = 0;
    this.oneScreenMirroring = 0;
    this.prgSwitchingArea = 1;
    this.prgSwitchingSize = 1;
    this.vromSwitchingSize = 0;

    // Register 1:
    this.romSelectionReg0 = 0;

    // Register 2:
    this.romSelectionReg1 = 0;

    // Register 3:
    this.romBankSelect = 0;
};

JSNES.Mappers[1].prototype.write = function(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
        JSNES.Mappers[0].prototype.write.apply(this, arguments);
        return;
    }

    // See what should be done with the written value:
    if ((value & 128) !== 0) {

        // Reset buffering:
        this.regBufferCounter = 0;
        this.regBuffer = 0;
    
        // Reset register:
        if (this.getRegNumber(address) === 0) {
        
            this.prgSwitchingArea = 1;
            this.prgSwitchingSize = 1;
        
        }
    }
    else {
    
        // Continue buffering:
        //regBuffer = (regBuffer & (0xFF-(1<<regBufferCounter))) | ((value & (1<<regBufferCounter))<<regBufferCounter);
        this.regBuffer = (this.regBuffer & (0xFF - (1 << this.regBufferCounter))) | ((value & 1) << this.regBufferCounter);
        this.regBufferCounter++;
        
        if (this.regBufferCounter == 5) {
            // Use the buffered value:
            this.setReg(this.getRegNumber(address), this.regBuffer);
        
            // Reset buffer:
            this.regBuffer = 0;
            this.regBufferCounter = 0;
        }
    }
};

JSNES.Mappers[1].prototype.setReg = function(reg, value) {
    var tmp;

    switch (reg) {
        case 0:
            // Mirroring:
            tmp = value & 3;
            if (tmp !== this.mirroring) {
                // Set mirroring:
                this.mirroring = tmp;
                if ((this.mirroring & 2) === 0) {
                    // SingleScreen mirroring overrides the other setting:
                    this.nes.ppu.setMirroring(
                        this.nes.rom.SINGLESCREEN_MIRRORING);
                }
                // Not overridden by SingleScreen mirroring.
                else if ((this.mirroring & 1) !== 0) {
                    this.nes.ppu.setMirroring(
                        this.nes.rom.HORIZONTAL_MIRRORING
                    );
                }
                else {
                    this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
                }
            }
    
            // PRG Switching Area;
            this.prgSwitchingArea = (value >> 2) & 1;
    
            // PRG Switching Size:
            this.prgSwitchingSize = (value >> 3) & 1;
    
            // VROM Switching Size:
            this.vromSwitchingSize = (value >> 4) & 1;
        
            break;
    
        case 1:
            // ROM selection:
            this.romSelectionReg0 = (value >> 4) & 1;
    
            // Check whether the cart has VROM:
            if (this.nes.rom.vromCount > 0) {
        
                // Select VROM bank at 0x0000:
                if (this.vromSwitchingSize === 0) {
        
                    // Swap 8kB VROM:
                    if (this.romSelectionReg0 === 0) {
                        this.load8kVromBank((value & 0xF), 0x0000);
                    }
                    else {
                        this.load8kVromBank(
                            Math.floor(this.nes.rom.vromCount / 2) +
                                (value & 0xF), 
                            0x0000
                        );
                    }
            
                }
                else {
                    // Swap 4kB VROM:
                    if (this.romSelectionReg0 === 0) {
                        this.loadVromBank((value & 0xF), 0x0000);
                    }
                    else {
                        this.loadVromBank(
                            Math.floor(this.nes.rom.vromCount / 2) +
                                (value & 0xF),
                            0x0000
                        );
                    }
                }
            }
        
            break;
    
        case 2:
            // ROM selection:
            this.romSelectionReg1 = (value >> 4) & 1;
    
            // Check whether the cart has VROM:
            if (this.nes.rom.vromCount > 0) {
                
                // Select VROM bank at 0x1000:
                if (this.vromSwitchingSize === 1) {
                    // Swap 4kB of VROM:
                    if (this.romSelectionReg1 === 0) {
                        this.loadVromBank((value & 0xF), 0x1000);
                    }
                    else {
                        this.loadVromBank(
                            Math.floor(this.nes.rom.vromCount / 2) +
                                (value & 0xF),
                            0x1000
                        );
                    }
                }
            }
            break;
    
        default:
            // Select ROM bank:
            // -------------------------
            tmp = value & 0xF;
            var bank;
            var baseBank = 0;
    
            if (this.nes.rom.romCount >= 32) {
                // 1024 kB cart
                if (this.vromSwitchingSize === 0) {
                    if (this.romSelectionReg0 === 1) {
                        baseBank = 16;
                    }
                }
                else {
                    baseBank = (this.romSelectionReg0 
                                | (this.romSelectionReg1 << 1)) << 3;
                }
            }
            else if (this.nes.rom.romCount >= 16) {
                // 512 kB cart
                if (this.romSelectionReg0 === 1) {
                    baseBank = 8;
                }
            }
    
            if (this.prgSwitchingSize === 0) {
                // 32kB
                bank = baseBank + (value & 0xF);
                this.load32kRomBank(bank, 0x8000);
            }
            else {
                // 16kB
                bank = baseBank * 2 + (value & 0xF);
                if (this.prgSwitchingArea === 0) {
                    this.loadRomBank(bank, 0xC000);
                }
                else {
                    this.loadRomBank(bank, 0x8000);
                }
            }  
    }
};

// Returns the register number from the address written to:
JSNES.Mappers[1].prototype.getRegNumber = function(address) {
    if (address >= 0x8000 && address <= 0x9FFF) {
        return 0;
    }
    else if (address >= 0xA000 && address <= 0xBFFF) {
        return 1;
    }
    else if (address >= 0xC000 && address <= 0xDFFF) {
        return 2;
    }
    else {
        return 3;
    }
};

JSNES.Mappers[1].prototype.loadROM = function(rom) {
    if (!this.nes.rom.valid) {
        alert("MMC1: Invalid ROM! Unable to load.");
        return;
    }

    // Load PRG-ROM:
    this.loadRomBank(0, 0x8000);                         //   First ROM bank..
    this.loadRomBank(this.nes.rom.romCount - 1, 0xC000); // ..and last ROM bank.

    // Load CHR-ROM:
    this.loadCHRROM();

    // Load Battery RAM (if present):
    this.loadBatteryRam();

    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
};

JSNES.Mappers[1].prototype.switchLowHighPrgRom = function(oldSetting) {
    // not yet.
};

JSNES.Mappers[1].prototype.switch16to32 = function() {
    // not yet.
};

JSNES.Mappers[1].prototype.switch32to16 = function() {
    // not yet.
};

JSNES.Mappers[1].prototype.toJSON = function() {
    var s = JSNES.Mappers[0].prototype.toJSON.apply(this);
    s.mirroring = this.mirroring;
    s.oneScreenMirroring = this.oneScreenMirroring;
    s.prgSwitchingArea = this.prgSwitchingArea;
    s.prgSwitchingSize = this.prgSwitchingSize;
    s.vromSwitchingSize = this.vromSwitchingSize;
    s.romSelectionReg0 = this.romSelectionReg0;
    s.romSelectionReg1 = this.romSelectionReg1;
    s.romBankSelect = this.romBankSelect;
    s.regBuffer = this.regBuffer;
    s.regBufferCounter = this.regBufferCounter;
    return s;
};

JSNES.Mappers[1].prototype.fromJSON = function(s) {
    JSNES.Mappers[0].prototype.fromJSON.apply(this, s);
    this.mirroring = s.mirroring;
    this.oneScreenMirroring = s.oneScreenMirroring;
    this.prgSwitchingArea = s.prgSwitchingArea;
    this.prgSwitchingSize = s.prgSwitchingSize;
    this.vromSwitchingSize = s.vromSwitchingSize;
    this.romSelectionReg0 = s.romSelectionReg0;
    this.romSelectionReg1 = s.romSelectionReg1;
    this.romBankSelect = s.romBankSelect;
    this.regBuffer = s.regBuffer;
    this.regBufferCounter = s.regBufferCounter;
};

JSNES.Mappers[2] = function(nes) {
    this.nes = nes;
};

JSNES.Mappers[2].prototype = new JSNES.Mappers[0]();

JSNES.Mappers[2].prototype.write = function(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
        JSNES.Mappers[0].prototype.write.apply(this, arguments);
        return;
    }

    else {
        // This is a ROM bank select command.
        // Swap in the given ROM bank at 0x8000:
        this.loadRomBank(value, 0x8000);
    }
};

JSNES.Mappers[2].prototype.loadROM = function(rom) {
    if (!this.nes.rom.valid) {
        alert("UNROM: Invalid ROM! Unable to load.");
        return;
    }

    // Load PRG-ROM:
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xC000);

    // Load CHR-ROM:
    this.loadCHRROM();

    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
};


JSNES.Mappers[4] = function(nes) {
    this.nes = nes;
    
    this.CMD_SEL_2_1K_VROM_0000 = 0;
    this.CMD_SEL_2_1K_VROM_0800 = 1;
    this.CMD_SEL_1K_VROM_1000 = 2;
    this.CMD_SEL_1K_VROM_1400 = 3;
    this.CMD_SEL_1K_VROM_1800 = 4;
    this.CMD_SEL_1K_VROM_1C00 = 5;
    this.CMD_SEL_ROM_PAGE1 = 6;
    this.CMD_SEL_ROM_PAGE2 = 7;
    
    this.command = null;
    this.prgAddressSelect = null;
    this.chrAddressSelect = null;
    this.pageNumber = null;
    this.irqCounter = null;
    this.irqLatchValue = null;
    this.irqEnable = null;
    this.prgAddressChanged = false;
};

JSNES.Mappers[4].prototype = new JSNES.Mappers[0]();

JSNES.Mappers[4].prototype.write = function(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
        JSNES.Mappers[0].prototype.write.apply(this, arguments);
        return;
    }

    switch (address) {
        case 0x8000:
            // Command/Address Select register
            this.command = value & 7;
            var tmp = (value >> 6) & 1;
            if (tmp != this.prgAddressSelect) {
                this.prgAddressChanged = true;
            }
            this.prgAddressSelect = tmp;
            this.chrAddressSelect = (value >> 7) & 1;
            break;
    
        case 0x8001:
            // Page number for command
            this.executeCommand(this.command, value);
            break;
    
        case 0xA000:        
            // Mirroring select
            if ((value & 1) !== 0) {
                this.nes.ppu.setMirroring(
                    this.nes.rom.HORIZONTAL_MIRRORING
                );
            }
            else {
                this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
            }
            break;
        
        case 0xA001:
            // SaveRAM Toggle
            // TODO
            //nes.getRom().setSaveState((value&1)!=0);
            break;
    
        case 0xC000:
            // IRQ Counter register
            this.irqCounter = value;
            //nes.ppu.mapperIrqCounter = 0;
            break;
    
        case 0xC001:
            // IRQ Latch register
            this.irqLatchValue = value;
            break;
    
        case 0xE000:
            // IRQ Control Reg 0 (disable)
            //irqCounter = irqLatchValue;
            this.irqEnable = 0;
            break;
    
        case 0xE001:        
            // IRQ Control Reg 1 (enable)
            this.irqEnable = 1;
            break;
    
        default:
            // Not a MMC3 register.
            // The game has probably crashed,
            // since it tries to write to ROM..
            // IGNORE.
    }
};

JSNES.Mappers[4].prototype.executeCommand = function(cmd, arg) {
    switch (cmd) {
        case this.CMD_SEL_2_1K_VROM_0000:
            // Select 2 1KB VROM pages at 0x0000:
            if (this.chrAddressSelect === 0) {
                this.load1kVromBank(arg, 0x0000);
                this.load1kVromBank(arg + 1, 0x0400);
            }
            else {
                this.load1kVromBank(arg, 0x1000);
                this.load1kVromBank(arg + 1, 0x1400);
            }
            break;
        
        case this.CMD_SEL_2_1K_VROM_0800:           
            // Select 2 1KB VROM pages at 0x0800:
            if (this.chrAddressSelect === 0) {
                this.load1kVromBank(arg, 0x0800);
                this.load1kVromBank(arg + 1, 0x0C00);
            }
            else {
                this.load1kVromBank(arg, 0x1800);
                this.load1kVromBank(arg + 1, 0x1C00);
            }
            break;
    
        case this.CMD_SEL_1K_VROM_1000:         
            // Select 1K VROM Page at 0x1000:
            if (this.chrAddressSelect === 0) {
                this.load1kVromBank(arg, 0x1000);
            }
            else {
                this.load1kVromBank(arg, 0x0000);
            }
            break;
    
        case this.CMD_SEL_1K_VROM_1400:         
            // Select 1K VROM Page at 0x1400:
            if (this.chrAddressSelect === 0) {
                this.load1kVromBank(arg, 0x1400);
            }
            else {
                this.load1kVromBank(arg, 0x0400);
            }
            break;
    
        case this.CMD_SEL_1K_VROM_1800:
            // Select 1K VROM Page at 0x1800:
            if (this.chrAddressSelect === 0) {
                this.load1kVromBank(arg, 0x1800);
            }
            else {
                this.load1kVromBank(arg, 0x0800);
            }
            break;
    
        case this.CMD_SEL_1K_VROM_1C00:
            // Select 1K VROM Page at 0x1C00:
            if (this.chrAddressSelect === 0) {
                this.load1kVromBank(arg, 0x1C00);
            }else {
                this.load1kVromBank(arg, 0x0C00);
            }
            break;
    
        case this.CMD_SEL_ROM_PAGE1:
            if (this.prgAddressChanged) {
                // Load the two hardwired banks:
                if (this.prgAddressSelect === 0) { 
                    this.load8kRomBank(
                        ((this.nes.rom.romCount - 1) * 2),
                        0xC000
                    );
                }
                else {
                    this.load8kRomBank(
                        ((this.nes.rom.romCount - 1) * 2),
                        0x8000
                    );
                }
                this.prgAddressChanged = false;
            }
    
            // Select first switchable ROM page:
            if (this.prgAddressSelect === 0) {
                this.load8kRomBank(arg, 0x8000);
            }
            else {
                this.load8kRomBank(arg, 0xC000);
            }
            break;
        
        case this.CMD_SEL_ROM_PAGE2:
            // Select second switchable ROM page:
            this.load8kRomBank(arg, 0xA000);
    
            // hardwire appropriate bank:
            if (this.prgAddressChanged) {
                // Load the two hardwired banks:
                if (this.prgAddressSelect === 0) { 
                    this.load8kRomBank(
                        ((this.nes.rom.romCount - 1) * 2),
                        0xC000
                    );
                }
                else {              
                    this.load8kRomBank(
                        ((this.nes.rom.romCount - 1) * 2),
                        0x8000
                    );
                }
                this.prgAddressChanged = false;
            }
    }
};

JSNES.Mappers[4].prototype.loadROM = function(rom) {
    if (!this.nes.rom.valid) {
        alert("MMC3: Invalid ROM! Unable to load.");
        return;
    }

    // Load hardwired PRG banks (0xC000 and 0xE000):
    this.load8kRomBank(((this.nes.rom.romCount - 1) * 2), 0xC000);
    this.load8kRomBank(((this.nes.rom.romCount - 1) * 2) + 1, 0xE000);

    // Load swappable PRG banks (0x8000 and 0xA000):
    this.load8kRomBank(0, 0x8000);
    this.load8kRomBank(1, 0xA000);

    // Load CHR-ROM:
    this.loadCHRROM();

    // Load Battery RAM (if present):
    this.loadBatteryRam();

    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
};

JSNES.Mappers[4].prototype.clockIrqCounter = function() {
    if (this.irqEnable == 1) {
        this.irqCounter--;
        if (this.irqCounter < 0) {
            // Trigger IRQ:
            //nes.getCpu().doIrq();
            this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
            this.irqCounter = this.irqLatchValue;
        }
    }
};

JSNES.Mappers[4].prototype.toJSON = function() {
    var s = JSNES.Mappers[0].prototype.toJSON.apply(this);
    s.command = this.command;
    s.prgAddressSelect = this.prgAddressSelect;
    s.chrAddressSelect = this.chrAddressSelect;
    s.pageNumber = this.pageNumber;
    s.irqCounter = this.irqCounter;
    s.irqLatchValue = this.irqLatchValue;
    s.irqEnable = this.irqEnable;
    s.prgAddressChanged = this.prgAddressChanged;
    return s;
};

JSNES.Mappers[4].prototype.fromJSON = function(s) {
    JSNES.Mappers[0].prototype.fromJSON.apply(this, s);
    this.command = s.command;
    this.prgAddressSelect = s.prgAddressSelect;
    this.chrAddressSelect = s.chrAddressSelect;
    this.pageNumber = s.pageNumber;
    this.irqCounter = s.irqCounter;
    this.irqLatchValue = s.irqLatchValue;
    this.irqEnable = s.irqEnable;
    this.prgAddressChanged = s.prgAddressChanged;
};

function MapperDefault(nes) {
    this.nes = nes;
    
    this.joy1StrobeState = null;
    this.joy2StrobeState = null;
    this.joypadLastWrite = -1;
    
    this.mousePressed = null;
    this.gameGenieActive = null;
    this.mouseX = null;
    this.mouseY = null;
    
    this.tmp = null;
    
}

MapperDefault.prototype.write = function(address, value){
    
    if(address<0x2000){
        
        // Mirroring of RAM:
        this.nes.cpuMem[address & 0x7FF] = value;
        
    }else if(address>0x4017){
        
        this.nes.cpuMem[address] = value;
        if(address>=0x6000 && address<0x8000){
            
            // Write to SaveRAM. Store in file:
            // TODO: not yet
            //if(this.nes.rom!=null)
            //    this.nes.rom.writeBatteryRam(address,value);
            
        }
        
    }else if(address>0x2007 && address<0x4000){
        
        this.regWrite(0x2000 + (address & 0x7),value);
        
    }else{
    
        this.regWrite(address,value);
        
    }
    
}

MapperDefault.prototype.load = function(address){
    
    // Game Genie codes active?
    /*if(this.gameGenieActive){
        if(this.nes.gameGenie.addressMatch[address]){
            
            tmp = nes.gameGenie.getCodeIndex(address);
            
            // Check the code type:
            if(nes.gameGenie.getCodeType(tmp) == GameGenie.TYPE_6CHAR){
                
                // Return the code value:
                return (short)nes.gameGenie.getCodeValue(tmp);
                
            }else{
                
                // Check whether the actual value equals the compare value:
                if(nes.cpuMem[address] == nes.gameGenie.getCodeCompare(tmp)){
                    
                    // The values match, so use the supplied game genie value:
                    return (short)nes.gameGenie.getCodeValue(tmp);
                    
                }
                
            }
        }
    }*/
    
    // Wrap around:
    address &= 0xFFFF;
    
    // Check address range:
    if(address > 0x4017){
        
        // ROM:
        return this.nes.cpuMem[address];
                
    }else if(address >= 0x2000){
        
        // I/O Ports.
        return this.regLoad(address);
        
    }else{
        
        // RAM (mirrored)
        return this.nes.cpuMem[address&0x7FF];
        
    }
    
}

MapperDefault.prototype.regLoad = function(address){
    
    switch(address>>12){ // use fourth nibble (0xF000)
        
        case 0:{
            break;
        }case 1:{
            break;
        }case 2:{
        
            // Fall through to case 3
            
        }case 3:{
            
            // PPU Registers
            switch(address&0x7){
                case 0x0:{
                    
                    // 0x2000:
                    // PPU Control Register 1.
                    // (the value is stored both
                    // in main memory and in the
                    // PPU as flags):
                    // (not in the real NES)
                    return this.nes.cpuMem[0x2000];
                    
                }case 0x1:{
                    
                    // 0x2001:
                    // PPU Control Register 2.
                    // (the value is stored both
                    // in main memory and in the
                    // PPU as flags):
                    // (not in the real NES)
                    return this.nes.cpuMem[0x2001];
                    
                }case 0x2:{
                    
                    // 0x2002:
                    // PPU Status Register.
                    // The value is stored in
                    // main memory in addition
                    // to as flags in the PPU.
                    // (not in the real NES)
                    return this.nes.ppu.readStatusRegister();
                    
                }case 0x3:{
                    return 0;
                }case 0x4:{
                    
                    // 0x2004:
                    // Sprite Memory read.
                    return this.nes.ppu.sramLoad();
                    
                }case 0x5:{
                    return 0;
                }case 0x6:{
                    return 0;
                }case 0x7:{
                    
                    // 0x2007:
                    // VRAM read:
                    return this.nes.ppu.vramLoad();
                    
                }
            }
            break;
            
        }case 4:{
        
        
            // Sound+Joypad registers
            
            switch(address-0x4015){
                case 0:{
                
                    // 0x4015:
                    // Sound channel enable, DMC Status
                    //return nes.getPapu().readReg(address);
                    //alert("Accessed sound register")
                    return 0;
                
                }case 1:{
                
                    // 0x4016:
                    // Joystick 1 + Strobe
                    return this.joy1Read();
                
                }case 2:{
                
                    // 0x4017:
                    // Joystick 2 + Strobe
                    /*if(this.mousePressed){
                        
                        // Check for white pixel nearby:
                        // TODO
                        var sx,sy,ex,ey,w;
                        sx = Math.max(0,this.mouseX-4);
                        ex = Math.min(256,this.mouseX+4);
                        sy = Math.max(0,this.mouseY-4);
                        ey = Math.min(240,this.mouseY+4);
                        w = 0x1<<4;
                        
                        w |= 0x1<<3; // FIXME
                        
                        for(var y=sy;y<ey;y++){
                            for(var x=sx;x<ex;x++){
                                if((this.nes.ppu.buffer[(y<<8)+x]&0xFFFFFF)==0xFFFFFF){
                                    w |= 0x1<<3;
                                    alert("Clicked on white!");
                                    break;
                                }
                            }
                        }
                        
                        return this.joy2Read()|w;*/
                        
                    //}else{
                        return this.joy2Read();
                    //}
                    
                }
            }
            
            break;
        
        }
    }
    
    return 0;
    
}

MapperDefault.prototype.regWrite = function(address, value){
    
    switch(address){
        case 0x2000:{
            
            // PPU Control register 1
            this.nes.cpuMem[address] = value;
            this.nes.ppu.updateControlReg1(value);
            break;
            
        }case 0x2001:{
            
            // PPU Control register 2
            this.nes.cpuMem[address] = value;
            this.nes.ppu.updateControlReg2(value);
            break;
            
        }case 0x2003:{
            
            // Set Sprite RAM address:
            this.nes.ppu.writeSRAMAddress(value);
            break;
            
        }case 0x2004:{
            
            // Write to Sprite RAM:
            this.nes.ppu.sramWrite(value);
            break;
            
        }case 0x2005:{
            
            // Screen Scroll offsets:
            this.nes.ppu.scrollWrite(value);
            break;
            
        }case 0x2006:{
            
            // Set VRAM address:
            this.nes.ppu.writeVRAMAddress(value);
            break;
            
        }case 0x2007:{
            
            // Write to VRAM:
            this.nes.ppu.vramWrite(value);
            break;
            
        }case 0x4014:{
            
            // Sprite Memory DMA Access
            this.nes.ppu.sramDMA(value);
            break;
            
        }case 0x4015:{
            
            // Sound Channel Switch, DMC Status
            //this.nes.getPapu().writeReg(address,value);
            break;
            
        }case 0x4016:{
            
            ////System.out.println("joy strobe write "+value);
            
            // Joystick 1 + Strobe
            if(value==0 && this.joypadLastWrite==1){
                ////System.out.println("Strobes reset.");
                this.joy1StrobeState = 0;
                this.joy2StrobeState = 0;
            }
            this.joypadLastWrite = value;
            break;
            
        }case 0x4017:{
            
            // Sound channel frame sequencer:
            //nes.papu.writeReg(address,value);
            break;
            
        }default:{
            
            // Sound registers
            ////System.out.println("write to sound reg");
            /*if(address >= 0x4000 && address <= 0x4017){
                nes.getPapu().writeReg(address,value);
            }*/
            break;
            
        }
    }

}

MapperDefault.prototype.joy1Read = function(){
    var ret;
    
    switch(this.joy1StrobeState){
        case 0:
            ret = keyStates1[KEY_A];
            break;
        case 1:
            ret = keyStates1[KEY_B];
            break;
        case 2:
            ret = keyStates1[KEY_SELECT];
            break;
        case 3:
            ret = keyStates1[KEY_START];
            break;
        case 4:
            ret = keyStates1[KEY_UP];
            break;
        case 5:
            ret = keyStates1[KEY_DOWN];
            break;
        case 6:
            ret = keyStates1[KEY_LEFT];
            break;
        case 7:
            ret = keyStates1[KEY_RIGHT];
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
    if(this.joy1StrobeState == 24){
        this.joy1StrobeState = 0;
    }
    
    return ret;
    
}

MapperDefault.prototype.joy2Read = function(){
    var ret;
    
    this.joy2StrobeState++;
    if(this.joy2StrobeState == 24){
        this.joy2StrobeState = 0;
    }
    
    switch(this.joy2StrobeState){
        case 0:
            ret = keyStates2[KEY_A];
            break;
        case 1:
            ret = keyStates2[KEY_B];
            break;
        case 2:
            ret = keyStates2[KEY_SELECT];
            break;
        case 3:
            ret = keyStates2[KEY_START];
            break;
        case 4:
            ret = keyStates2[KEY_UP];
            break;
        case 5:
            ret = keyStates2[KEY_DOWN];
            break;
        case 6:
            ret = keyStates2[KEY_LEFT];
            break;
        case 7:
            ret = keyStates2[KEY_RIGHT];
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
            ret = 0;
            break;
        case 18:
            ret = 1;
            break;
        default:
            ret = 0;
    }
    
    return ret;
    
}

MapperDefault.prototype.loadROM = function(){
    
    if(!this.nes.rom.valid || this.nes.rom.romCount<1){
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
    
}

MapperDefault.prototype.loadPRGROM = function(){
    if(this.nes.rom.romCount>1){
        // Load the two first banks into memory.
        this.loadRomBank(0,0x8000);
        this.loadRomBank(1,0xC000);
    }else{
        // Load the one bank into both memory locations:
        this.loadRomBank(0,0x8000);
        this.loadRomBank(0,0xC000);
    }
}

MapperDefault.prototype.loadCHRROM = function(){
    ////System.out.println("Loading CHR ROM..");
    if(this.nes.rom.vromCount > 0){
        if(this.nes.rom.vromCount == 1){
            this.loadVromBank(0,0x0000);
            this.loadVromBank(0,0x1000);
        }else{
            this.loadVromBank(0,0x0000);
            this.loadVromBank(1,0x1000);
        }
    }else{
        //System.out.println("There aren't any CHR-ROM banks..");
    }
}

MapperDefault.prototype.loadBatteryRam = function(){
    if(this.nes.rom.batteryRam){
        var ram = this.nes.rom.batteryRam;
        if(ram!=null && ram.length==0x2000){
            // Load Battery RAM into memory:
            arraycopy(ram, 0, this.nes.cpuMem, 0x6000, 0x2000);
        }
    }
}

MapperDefault.prototype.loadRomBank = function(bank, address){
    // Loads a ROM bank into the specified address.
    bank %= this.nes.rom.romCount;
    //var data = this.nes.rom.rom[bank];
    //cpuMem.write(address,data,data.length);
    arraycopy(this.nes.rom.rom[bank], 0, this.nes.cpuMem, address, 16384);
    
}

MapperDefault.prototype.loadVromBank = function(bank, address){

    if(this.nes.rom.vromCount == 0) return;
    this.nes.ppu.triggerRendering();
    
    arraycopy(this.nes.rom.vrom[bank%this.nes.rom.vromCount],0,
        this.nes.ppuMem,address,4096);
    
    var vromTile = this.nes.rom.vromTile[bank%this.nes.rom.vromCount];
    arraycopy(vromTile,0,this.nes.ppu.ptTile,address>>4,256);
    
}

MapperDefault.prototype.load32kRomBank = function(bank, address){
    
    this.loadRomBank((bank*2)%this.nes.rom.romCount,address);
    this.loadRomBank((bank*2+1)%this.nes.rom.romCount,address+16384);
    
}

MapperDefault.prototype.load8kVromBank = function(bank4kStart, address){
    if(this.nes.rom.vromCount == 0) return;
    this.nes.ppu.triggerRendering();

    this.loadVromBank((bank4kStart)%this.nes.rom.vromCount,address);
    this.loadVromBank((bank4kStart+1)%this.nes.rom.vromCount,address+4096);
    
}

MapperDefault.prototype.load1kVromBank = function(bank1k, address){
    
    if(this.nes.rom.vromCount == 0)return;
    this.nes.ppu.triggerRendering();
    
    var bank4k = parseInt(bank1k/4)%this.nes.rom.vromCount;
    var bankoffset = (bank1k%4)*1024;
    arraycopy(this.nes.rom.vrom[bank4k],0,this.nes.ppuMem,
        bankoffset,1024);
    
    // Update tiles:
    var vromTile = this.nes.rom.vromTile[bank4k];
    var baseIndex = address >> 4;
    for(var i=0;i<64;i++){
        this.nes.ppu.ptTile[baseIndex+i] = vromTile[((bank1k%4)<<6)+i];
    }
    
}

MapperDefault.prototype.load2kVromBank = function(bank2k, address){
    
    if(this.nes.rom.vromCount == 0)return;
    this.nes.ppu.triggerRendering();
    
    var bank4k = parseInt(bank2k/2)%this.nes.rom.vromCount;
    var bankoffset = (bank2k%2)*2048;
    arraycopy(this.nes.rom.vrom[bank4k], bankoffset,
        this.nes.ppuMem,address,2048);
    
    // Update tiles:
    var vromTile = this.nes.rom.vromTile[bank4k];
    var baseIndex = address >> 4;
    for(var i=0;i<128;i++){
        this.nes.ppu.ptTile[baseIndex+i] = vromTile[((bank2k%2)<<7)+i];
    }
    
}

MapperDefault.prototype.load8kRomBank = function(bank8k, address){
    
    var bank16k = parseInt(bank8k/2)%this.nes.rom.romCount;
    var offset = (bank8k%2)*8192;
    
    //this.nes.cpuMem.write(address,this.nes.rom.rom[bank16k],offset,8192);
    arraycopy(this.nes.rom.rom[bank16k], offset, 
              this.nes.cpuMem, address, 8192);
    
}

MapperDefault.prototype.clockIrqCounter = function(){
    
    // Does nothing. This is used by the MMC3 mapper.
    
}

MapperDefault.prototype.latchAccess = function(address){
    
    // Does nothing. This is used by MMC2.
    
}

MapperDefault.prototype.reset = function(){
    
    this.joy1StrobeState = 0;
    this.joy2StrobeState = 0;
    this.joypadLastWrite = 0;
    this.mousePressed = false;
    
}

function Mapper001(nes) {
    this.nes = nes
    
    // Register flags:
    
    // Register 0:
    this.mirroring = null;
    this.oneScreenMirroring = null;
    this.prgSwitchingArea = 1;
    this.prgSwitchingSize = 1;
    this.vromSwitchingSize = null;
    
    // Register 1:
    this.romSelectionReg0 = null;
    
    // Register 2:
    this.romSelectionReg1 = null;
    
    // Register 3:
    this.romBankSelect = null;
    
    // 5-bit buffer:
    this.regBuffer = null;
    this.regBufferCounter = null;
}

copyPrototype(Mapper001, MapperDefault);

Mapper001.prototype.write = function(address, value){
    
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if(address < 0x8000){
        MapperDefault.prototype.write.apply(this, arguments);
        return;
    }
    
    ////System.out.println("MMC Write. Reg="+(getRegNumber(address))+" Value="+value);
    
    // See what should be done with the written value:
    if((value&128)!=0){
    
        // Reset buffering:
        this.regBufferCounter = 0;
        this.regBuffer = 0;
        
        // Reset register:
        if(this.getRegNumber(address) == 0){
            
            this.prgSwitchingArea = 1;
            this.prgSwitchingSize = 1;
            
        }
        
    }else{
        
        // Continue buffering:
        //regBuffer = (regBuffer & (0xFF-(1<<regBufferCounter))) | ((value & (1<<regBufferCounter))<<regBufferCounter);
        this.regBuffer = (this.regBuffer & (0xFF-(1<<this.regBufferCounter))) | ((value&1)<<this.regBufferCounter);
        this.regBufferCounter++;
        if(this.regBufferCounter == 5){
            
            // Use the buffered value:
            this.setReg(this.getRegNumber(address), this.regBuffer);
            
            // Reset buffer:
            this.regBuffer = 0;
            this.regBufferCounter = 0;
            
        }
        
    }
    
}
    
Mapper001.prototype.setReg = function(reg, value){
    
    var tmp,tmp2;
    
    switch (reg) {
        case 0:
            // Mirroring:
            tmp = value&3;
            if(tmp != this.mirroring){
                // Set mirroring:
                this.mirroring = tmp;
                if((this.mirroring & 2)==0){
                    // SingleScreen mirroring overrides the other setting:
                    this.nes.ppu.setMirroring(
                        this.nes.rom.SINGLESCREEN_MIRRORING);
                }else{
                    // Not overridden by SingleScreen mirroring.
                    this.nes.ppu.setMirroring(
                        (this.mirroring&1)!=0 ?
                            this.nes.rom.HORIZONTAL_MIRRORING
                        :
                            this.nes.rom.VERTICAL_MIRRORING);
                }
            }
        
            // PRG Switching Area;
            this.prgSwitchingArea = (value>>2)&1;
        
            // PRG Switching Size:
            this.prgSwitchingSize = (value>>3)&1;
        
            // VROM Switching Size:
            this.vromSwitchingSize = (value>>4)&1;
            
            break;
        
        case 1:
            // ROM selection:
            this.romSelectionReg0 = (value>>4)&1;
        
            // Check whether the cart has VROM:
            if(this.nes.rom.vromCount > 0){
            
                // Select VROM bank at 0x0000:
                if(this.vromSwitchingSize == 0){
            
                    // Swap 8kB VROM:
                    ////System.out.println("Swapping 8k VROM, bank="+(value&0xF)+" romSelReg="+romSelectionReg0);
                    if(this.romSelectionReg0==0){
                        this.load8kVromBank((value&0xF), 0x0000);
                    }else{
                        this.load8kVromBank(
                            parseInt(this.nes.rom.vromCount/2) + (value&0xF),
                            0x0000);
                    }
                
                }else{
                
                    // Swap 4kB VROM:
                    ////System.out.println("ROMSELREG0 = "+romSelectionReg0);
                    ////System.out.println("Swapping 4k VROM at 0x0000, bank="+(value&0xF));
                
                    if(this.romSelectionReg0 == 0){
                        this.loadVromBank((value&0xF), 0x0000);
                    }else{
                        this.loadVromBank(
                            parseInt(this.nes.rom.vromCount/2)+(value&0xF),
                            0x0000);
                    }
                
                }
            
            }
            
            break;
        
        case 2:
            // ROM selection:
            this.romSelectionReg1 = (value>>4)&1;
        
            // Check whether the cart has VROM:
            if(this.nes.rom.vromCount > 0){
        
                // Select VROM bank at 0x1000:
                if(this.vromSwitchingSize == 1){
                
                    // Swap 4kB of VROM:
                    ////System.out.println("ROMSELREG1 = "+romSelectionReg1);
                    ////System.out.println("Swapping 4k VROM at 0x1000, bank="+(value&0xF));
                    if(this.romSelectionReg1 == 0){
                        this.loadVromBank((value&0xF),0x1000);
                    }else{
                        this.loadVromBank(
                            parseInt(this.nes.rom.vromCount/2)+(value&0xF),
                            0x1000);
                    }
                
                }
            
            }
        
        default:
            // Select ROM bank:
            // -------------------------
            tmp = value & 0xF;
            var bank;
            var baseBank = 0;
        
            if(this.nes.rom.romCount >= 32){
            
                // 1024 kB cart
                if(this.vromSwitchingSize == 0){
                    if(this.romSelectionReg0 == 1){
                        baseBank = 16;
                    }
                }else{
                    baseBank = (this.romSelectionReg0 
                                | (this.romSelectionReg1<<1))<<3;
                }
            
            }else if(this.nes.rom.romCount >= 16){
            
                // 512 kB cart
                if(this.romSelectionReg0 == 1){
                    baseBank = 8;
                }
            
            }
        
            if(this.prgSwitchingSize == 0){
        
                // 32kB
                bank = baseBank+(value&0xF);
                this.load32kRomBank(bank, 0x8000);
            
            }else{
            
                // 16kB
                bank = baseBank*2+(value&0xF);
                if(this.prgSwitchingArea == 0){
                    this.loadRomBank(bank, 0xC000);
                }else{
                    this.loadRomBank(bank, 0x8000);
                }
            
            }
        
    }
    
}

// Returns the register number from the address written to:
Mapper001.prototype.getRegNumber = function(address){
    
    if(address>=0x8000 && address<=0x9FFF){
        return 0;
    }else if(address>=0xA000 && address<=0xBFFF){
        return 1;
    }else if(address>=0xC000 && address<=0xDFFF){
        return 2;
    }else{
        return 3;
    }
    
}

Mapper001.prototype.loadROM = function(rom){

    //System.out.println("Loading ROM.");
    
    if(!this.nes.rom.valid){
        alert("MMC1: Invalid ROM! Unable to load.");
        return;
    }
    
    // Load PRG-ROM:
    this.loadRomBank(0,0x8000);              //   First ROM bank..
    this.loadRomBank(this.nes.rom.romCount-1,0xC000);    // ..and last ROM bank.
    
    // Load CHR-ROM:
    this.loadCHRROM();
    
    // Load Battery RAM (if present):
    this.loadBatteryRam();
    
    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
    
}

Mapper001.prototype.reset = function(){
    
    MapperDefault.prototype.reset.apply(this);
    
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
    
}

Mapper001.prototype.switchLowHighPrgRom = function(oldSetting){
    
    // not yet.
    
}

Mapper001.prototype.switch16to32 = function(){

    // not yet.
    
}

Mapper001.prototype.switch32to16 = function(){

    // not yet.
    
}

function Mapper002(nes) {
    this.nes = nes
}

copyPrototype(Mapper002, MapperDefault);

Mapper002.prototype.write = function(address, value){
    
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if(address < 0x8000){
        MapperDefault.prototype.write.apply(this, arguments);
        return;
    }
    
    else{
		
		// This is a ROM bank select command.
		// Swap in the given ROM bank at 0x8000:
		this.loadRomBank(value,0x8000);
		
	}
}

Mapper002.prototype.loadROM = function(rom){
	
	if(!this.nes.rom.valid){
		alert("UNROM: Invalid ROM! Unable to load.");
		return;
	}
	
	// Load PRG-ROM:
	this.loadRomBank(0,0x8000);
	this.loadRomBank(this.nes.rom.romCount-1,0xC000);
	
	// Load CHR-ROM:
	this.loadCHRROM();
	
	// Do Reset-Interrupt:
	this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
	
}

function Mapper004(nes) {
    this.nes = nes
    
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
}

copyPrototype(Mapper004, MapperDefault);

Mapper004.prototype.write = function(address, value){
    
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if(address < 0x8000){
        MapperDefault.prototype.write.apply(this, arguments);
        return;
    }
    
    switch (address) {
        case 0x8000:
    		// Command/Address Select register
    		this.command = value&7;
    		var tmp = (value>>6)&1;
    		if(tmp != this.prgAddressSelect){
    			this.prgAddressChanged = true;
    		}
    		this.prgAddressSelect = tmp;
    		this.chrAddressSelect = (value>>7)&1;
    		break;
        
		case 0x8001:
		    // Page number for command
		    this.executeCommand(this.command,value);
		    break;
		
	    case 0xA000:		
    		// Mirroring select
    		if((value&1) != 0){
    			this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
    		}else{
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
}
    
Mapper004.prototype.executeCommand = function(cmd, arg){
	switch (cmd) {
	    case this.CMD_SEL_2_1K_VROM_0000:
	        // Select 2 1KB VROM pages at 0x0000:
			if(this.chrAddressSelect == 0){
				this.load1kVromBank(arg,0x0000);
				this.load1kVromBank(arg+1,0x0400);
			}else{
				this.load1kVromBank(arg,0x1000);
				this.load1kVromBank(arg+1,0x1400);
			}
			break;
			
		case this.CMD_SEL_2_1K_VROM_0800:    		
			// Select 2 1KB VROM pages at 0x0800:
			if(this.chrAddressSelect == 0){
				this.load1kVromBank(arg,0x0800);
				this.load1kVromBank(arg+1,0x0C00);
			}else{
				this.load1kVromBank(arg,0x1800);
				this.load1kVromBank(arg+1,0x1C00);
			}
			break;
		
	    case this.CMD_SEL_1K_VROM_1000:			
			// Select 1K VROM Page at 0x1000:
			if(this.chrAddressSelect == 0){
				this.load1kVromBank(arg,0x1000);
			}else{
				this.load1kVromBank(arg,0x0000);
			}
			break;
		
	    case this.CMD_SEL_1K_VROM_1400:			
			// Select 1K VROM Page at 0x1400:
			if(this.chrAddressSelect == 0){
				this.load1kVromBank(arg,0x1400);
			}else{
				this.load1kVromBank(arg,0x0400);
			}
			break;
		
	    case this.CMD_SEL_1K_VROM_1800:			
			// Select 1K VROM Page at 0x1800:
			if(this.chrAddressSelect == 0){
				this.load1kVromBank(arg,0x1800);
			}else{
				this.load1kVromBank(arg,0x0800);
			}
			break;
		
	    case this.CMD_SEL_1K_VROM_1C00:			
			// Select 1K VROM Page at 0x1C00:
			if(this.chrAddressSelect == 0){
				this.load1kVromBank(arg,0x1C00);
			}else{
				this.load1kVromBank(arg,0x0C00);
			}
			break;
		
	    case this.CMD_SEL_ROM_PAGE1:
			if(this.prgAddressChanged){
				// Load the two hardwired banks:
				if(this.prgAddressSelect == 0){	
					this.load8kRomBank(
					    ((this.nes.rom.romCount-1)*2),
					    0xC000);
				} else {
					this.load8kRomBank(
					    ((this.nes.rom.romCount-1)*2),
					    0x8000);
				}
				this.prgAddressChanged = false;
			}
		
			// Select first switchable ROM page:
			if(this.prgAddressSelect == 0){
				this.load8kRomBank(arg,0x8000);
			}else{
				this.load8kRomBank(arg,0xC000);
			}
		    break;
		    
	    case this.CMD_SEL_ROM_PAGE2:
		
    		// Select second switchable ROM page:
    		this.load8kRomBank(arg,0xA000);
		
			// hardwire appropriate bank:
			if(this.prgAddressChanged){
				// Load the two hardwired banks:
				if(this.prgAddressSelect == 0){	
					this.load8kRomBank(
					    ((this.nes.rom.romCount-1)*2),
					    0xC000);
				}else{				
					this.load8kRomBank(
					    ((this.nes.rom.romCount-1)*2),
					    0x8000);
				}
				this.prgAddressChanged = false;
			}
	}
	
}
	
Mapper004.prototype.loadROM = function(rom){
	
	if(!this.nes.rom.valid){
		alert("MMC3: Invalid ROM! Unable to load.");
		return;
	}
	
	// Load hardwired PRG banks (0xC000 and 0xE000):
	this.load8kRomBank(((this.nes.rom.romCount-1)*2)  ,0xC000);
	this.load8kRomBank(((this.nes.rom.romCount-1)*2)+1,0xE000);
	
	// Load swappable PRG banks (0x8000 and 0xA000):
	this.load8kRomBank(0,0x8000);
	this.load8kRomBank(1,0xA000);
	
	// Load CHR-ROM:
	this.loadCHRROM();
	
	// Load Battery RAM (if present):
	this.loadBatteryRam();
	
	// Do Reset-Interrupt:
	this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
	
}

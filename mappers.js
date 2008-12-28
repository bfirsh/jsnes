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
	
	
	this.write = function(address, value){
		
		if(address<0x2000){
			
			// Mirroring of RAM:
			this.nes.cpuMem[address & 0x7FF] = value;
			
		}else if(address>0x4017){
			
			this.nes.cpuMem[address] = value;
			if(address>=0x6000 && address<0x8000){
				
				// Write to SaveRAM. Store in file:
				if(this.nes.rom!=null)
				    this.nes.rom.writeBatteryRam(address,value);
				
			}
			
		}else if(address>0x2007 && address<0x4000){
			
			this.regWrite(0x2000 + (address & 0x7),value);
			
		}else{
		
			this.regWrite(address,value);
			
		}
		
	}
	
	this.load = function(address){
		
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
	
	this.regLoad = function(address){
		
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
						alert("Accessed sound register")
						return 0;
					
					}case 1:{
					
						// 0x4016:
						// Joystick 1 + Strobe
						return this.joy1Read();
					
					}case 2:{
					
						// 0x4017:
						// Joystick 2 + Strobe
						if(this.mousePressed){
							
							// Check for white pixel nearby:
							
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
							
							return this.joy2Read()|w;
							
						}else{
							return this.joy2Read();
						}
						
					}
				}
				
				break;
			
			}
		}
		
		return 0;
		
	}
	
	this.regWrite = function(address, value){
		
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
	
	this.joy1Read = function(){
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
	
	this.joy2Read = function(){
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

	this.loadROM = function(){
		
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
	
	this.loadPRGROM = function(){
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
	
	this.loadCHRROM = function(){
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

	this.loadBatteryRam = function(){
		if(this.nes.rom.batteryRam){
			var ram = this.nes.rom.batteryRam;
			if(ram!=null && ram.length==0x2000){
				// Load Battery RAM into memory:
				arraycopy(ram, 0, this.nes.cpuMem, 0x6000, 0x2000);
			}
		}
	}

	this.loadRomBank = function(bank, address){
		// Loads a ROM bank into the specified address.
		bank %= this.nes.rom.romCount;
		//var data = this.nes.rom.rom[bank];
		//cpuMem.write(address,data,data.length);
		arraycopy(this.nes.rom.rom[bank], 0, this.nes.cpuMem, address, 16384);
		
	}
	
	this.loadVromBank = function(bank, address){
	
		if(this.nes.rom.vromCount == 0) return;
		this.nes.ppu.triggerRendering();
		
		arraycopy(this.nes.rom.vrom[bank%this.nes.rom.vromCount],0,
		    this.nes.ppuMem,address,4096);
		
		var vromTile = this.nes.rom.vromTile[bank%this.nes.rom.vromCount];
		arraycopy(vromTile,0,this.nes.ppu.ptTile,address>>4,256);
		
	}
	
	this.load32kRomBank = function(bank, address){
		
		this.loadRomBank((bank*2)%this.nes.rom.romCount,address);
		this.loadRomBank((bank*2+1)%this.nes.rom.romCount,address+16384);
		
	}
	
	this.load8kVromBank = function(bank4kStart, address){
		if(this.nes.rom.vromCount == 0) return;
		this.nes.ppu.triggerRendering();
	
		this.loadVromBank((bank4kStart)%this.nes.rom.vromCount,address);
		this.loadVromBank((bank4kStart+1)%this.nes.rom.vromCount,address+4096);
		
	}

	this.load1kVromBank = function(bank1k, address){
		
		if(this.nes.rom.vromCount == 0)return;
		this.nes.ppu.triggerRendering();
		
		var bank4k = parseInt(bank1k/4)%rom.vromCount;
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
	
	this.load2kVromBank = function(bank2k, address){
		
		if(this.nes.rom.vromCount == 0)return;
		this.nes.ppu.triggerRendering();
		
		var bank4k = parseInt(bank2k/2)%this.nes.rom.vromCount;
		var bankoffset = (bank2k%2)*2048;
		arraycopy(this.nes.rom.getVromBank(bank4k),bankoffset,
		    this.nes.ppuMem,address,2048);
		
		// Update tiles:
		var vromTile = this.nes.rom.vromTile[bank4k];
		var baseIndex = address >> 4;
		for(var i=0;i<128;i++){
			this.nes.ppu.ptTile[baseIndex+i] = vromTile[((bank2k%2)<<7)+i];
		}
		
	}
	
	this.load8kRomBank = function(bank8k, address){
		
		var bank16k = parseInt(bank8k/2)%this.nes.rom.romCount;
		var offset = (bank8k%2)*8192;
		
		//this.nes.cpuMem.write(address,this.nes.rom.rom[bank16k],offset,8192);
		arraycopy(this.nes.rom.rom[bank16k], offset, 
		          this.nes.cpuMem, address, 8192);
		
	}

	this.clockIrqCounter = function(){
		
		// Does nothing. This is used by the MMC3 mapper.
		
	}
	
	this.latchAccess = function(address){
		
		// Does nothing. This is used by MMC2.
		
	}
    
	this.reset = function(){
		
		this.joy1StrobeState = 0;
		this.joy2StrobeState = 0;
		this.joypadLastWrite = 0;
		this.mousePressed = false;
		
	}
	
}
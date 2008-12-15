function NES() {
    Globals.nes = this;
    
    this.cpuMem = new Memory(this, 0x10000);	// Main memory (internal to CPU)
    this.ppuMem = new Memory(this, 0x8000);	// VRAM memory (internal to PPU)
    this.sprMem = new Memory(this, 0x100);	// Sprite RAM  (internal to PPU)
    this.cpu = new CPU(this);
    this.ppu = new PPU(this);
    this.memMapper = null;
    this.palTable = new PaletteTable();
    this.rom = null;
    this.cc = null;
    
    this.romFile = null;
    this.isRunning = false;
    this.inFrame = false;
    
    this.palTable.loadNTSCPalette();
	//this.palTable.loadDefaultPalette();
	
	// Graphics
	this.canvas = document.getElementById('screen');
    this.ctx = this.canvas.getContext('2d');
    this.imageData = this.ctx.getImageData(0,0,256,240);
    this.ctx.fillStyle = 'black';
	this.ctx.fillRect(0,0,256,240); /* set alpha to opaque */
	// Set alpha
	for (var i = 3; i < this.imageData.data.length-3; i+=4) {
        this.imageData.data[i] = 0xFF;
    }
	
    
    this.start = function() {
        if(this.rom != null && this.rom.valid) {
            if (!this.isRunning) {
                $("#status").text("Running "+this.romFile)
                this.isRunning = true;
                this.frame();
            }
        }
        else
            alert("There is no ROM loaded, or it is invalid.")
    }
    
    this.frame = function() {
        if (this.isRunning) {
            this.ppu.startFrame();
            var cycles = 0;
            FRAMELOOP: for (;;) {
                if (this.cpu.cyclesToHalt == 0)
                    // Execute a CPU instruction
                    cycles = this.cpu.emulate()*3;
                else {
                    if (this.cpu.cyclesToHalt > 8) {
                        cycles = 24;
                        this.cpu.cyclesToHalt -= 8;
                    }
                    else {
                        cycles = this.cpu.cyclesToHalt * 3;
                        this.cpu.cyclesToHalt = 0;
                    }
                }
                
                for(;cycles>0;cycles--){

                    if(this.ppu.curX == this.ppu.spr0HitX 
                            && this.ppu.f_spVisibility==1 
                            && this.ppu.scanline-21 == this.ppu.spr0HitY){
                        // Set sprite 0 hit flag:
                        this.ppu.setStatusFlag(this.ppu.STATUS_SPRITE0HIT,true);
                    }

                    if(this.ppu.requestEndFrame){
                        this.ppu.nmiCounter--;
                        if(this.ppu.nmiCounter == 0){
                            this.ppu.requestEndFrame = false;
                            this.ppu.startVBlank();
                            break FRAMELOOP;
                        }
                    }

                    this.ppu.curX++;
                    if(this.ppu.curX==341){
                        this.ppu.curX = 0;
                        this.ppu.endScanline();
                    }

                }
            }
            this.fillImage();
            this.ctx.putImageData(this.imageData, 0, 0);
            setTimeout(function(o) {o.frame()}, 0, this);
    		/*$("#cpu_acc").text(this.cpu.REG_ACC.toString(16));
    		$("#cpu_x").text(this.cpu.REG_X.toString(16));
    		$("#cpu_y").text(this.cpu.REG_Y.toString(16));
    		$("#cpu_pc").text(this.cpu.REG_PC.toString(16));
    		$("#cpu_sp").text(this.cpu.REG_SP.toString(16));
    		$("#cpu_f_carry").text(this.cpu.F_CARRY.toString(16));
    		$("#cpu_f_zero").text(this.cpu.F_ZERO.toString(16));
    		$("#cpu_f_interrupt").text(this.cpu.F_INTERRUPT.toString(16));
    		$("#cpu_f_decimal").text(this.cpu.F_DECIMAL.toString(16));
    		$("#cpu_f_brk").text(this.cpu.F_BRK.toString(16));
    		$("#cpu_f_overflow").text(this.cpu.F_OVERFLOW.toString(16));
    		$("#cpu_f_sign").text(this.cpu.F_SIGN.toString(16));
    		
    		
    		$("#ppu_curX").text(this.ppu.curX);
    		$("#ppu_scanline").text(this.ppu.scanline);*/
        }
    }
    
    this.fillImage = function() {
        var i = 0;
        for (var j = 0; j < this.ppu.buffer.length; j++) {
            this.imageData.data[i++] = this.ppu.buffer[j]&0xFF;
            this.imageData.data[i++] = (this.ppu.buffer[j]>>8)&0xFF;
            this.imageData.data[i++] = (this.ppu.buffer[j]>>16)&0xFF;
            i++;
        }
    }
    
    this.testFrame = function() {
        for (var i = 0; i < this.imageData.data.length; i+=4) {
            this.imageData.data[i] = 0xFF;
        }
        this.ctx.putImageData(this.imageData, 0, 0);
    }
    
    this.stop = function() {
        $("#status").text("Stopped.");
		this.isRunning = false;
    }
    
    this.reloadRom = function() {
		if(this.romFile != null){
			this.loadRom(this.romFile);
		}
	}
	
	this.clearCPUMemory = function() {
		var flushval = Globals.memoryFlushValue;
		for(var i=0;i<0x2000;i++) {
			this.cpuMem.mem[i] = flushval;
		}
		for(var p=0;p<4;p++){
			var i = p*0x800;
			this.cpuMem.mem[i+0x008] = 0xF7;
			this.cpuMem.mem[i+0x009] = 0xEF;
			this.cpuMem.mem[i+0x00A] = 0xDF;
			this.cpuMem.mem[i+0x00F] = 0xBF;
		}
	}
	
	// Loads a ROM file into the CPU and PPU.
	// The ROM file is validated first.
	this.loadRom = function(file){
		// Can't load ROM while still running.
		if(this.isRunning)
		    this.stop();
		
		$("#status").text("Loading "+file);
		
		// Load ROM file:
		this.rom = new ROM(this);
		this.rom.load(file);
		if(this.rom.valid){
			
			// The CPU will load
			// the ROM into the CPU
			// and PPU memory.
			
			this.reset();
			
			this.memMapper = this.rom.createMapper();
			this.cpu.mmap = this.memMapper;
			this.memMapper.loadROM();
			this.ppu.setMirroring(this.rom.getMirroringType());
			this.romFile = file;
			
			$("#status").text(file+" successfully loaded. Ready to be started.");
		}
		else {
		    $("#status").text(file+" is an invalid ROM!");
		}
		return this.rom.valid;
	}
	
	// Resets the system.
	this.reset = function(){
		if(this.rom!=null)
			this.rom.closeRom();
		if(this.memMapper != null)
			this.memMapper.reset();
		this.cpuMem.reset();
		this.ppuMem.reset();
		this.sprMem.reset();
		this.clearCPUMemory();
		this.cpu.reset();
		this.cpu.init();
		this.ppu.reset();
		this.palTable.reset();
		
        
	}
	
	this.setFramerate = function(rate){
		Globals.preferredFrameRate = rate;
		Globals.frameTime = 1000/rate;
	}
	
	this.cpu.init();
    this.ppu.init();
    
    this.clearCPUMemory();
    
    $("#status").text("Initialised. Ready to load a ROM.");
    
}


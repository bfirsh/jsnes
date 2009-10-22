function NES() {
    Globals.nes = this;
    
    this.cpuMem = new Array(0x10000);	// Main memory (internal to CPU)
    this.ppuMem = new Array(0x8000);	// VRAM memory (internal to PPU)
    this.sprMem = new Array(0x100);	// Sprite RAM  (internal to PPU)

    this.cpu = new CPU(this);
    this.ppu = new PPU(this);
    this.papu = new PAPU(this);
    this.memMapper = null;
    this.palTable = new PaletteTable();
    this.rom = null;
    
    this.romFile = null;
    this.isRunning = false;
    this.lastFpsTime = null;
    this.fpsFrameCount = 0;
    this.crashMessage = null;
    this.limitFrames = true;
    
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
	
    // Init sound registers:
	for(var i=0;i<0x14;i++){
		if(i==0x10){
			this.papu.writeReg(0x4010, 0x10);
		}else{
			this.papu.writeReg(0x4000+i, 0);
		}
	}
    
    this.start = function() {
        if(this.rom != null && this.rom.valid) {
            if (!this.isRunning) {
                //$("#status").text("Running "+this.romFile)
                this.isRunning = true;
                var frameTime = 0;
                if (this.limitFrames) {
                    frameTime = Globals.frameTime;
                }
                this.frameInterval = setInterval(runFrame, frameTime);
                this.resetFps();
                this.printFps();
                this.fpsInterval = setInterval(runPrintFps, Globals.fpsInterval);
            }
        }
        else {
            alert("There is no ROM loaded, or it is invalid.");
        }
    }
    
    this.frame = function() {
        this.ppu.startFrame();
        var cycles = 0;
        var emulateSound = Globals.emulateSound;
        var cpu = this.cpu;
        var ppu = this.ppu;
        var papu = this.papu;
        FRAMELOOP: for (;;) {
            if (cpu.cyclesToHalt == 0) {
                // Execute a CPU instruction
                cycles = cpu.emulate();
                if (emulateSound) {
    				papu.clockFrameCounter(cycles);
    			}
                cycles *= 3;
            }
            else {
                if (cpu.cyclesToHalt > 8) {
                    cycles = 24;
                    if (emulateSound) {
                        papu.clockFrameCounter(8);
                    }
                    cpu.cyclesToHalt -= 8;
                }
                else {
                    cycles = cpu.cyclesToHalt * 3;
                    if (emulateSound) {
                        papu.clockFrameCounter(cpu.cyclesToHalt);
                    }
                    cpu.cyclesToHalt = 0;
                }
            }
            
            for(;cycles>0;cycles--){

                if(ppu.curX == ppu.spr0HitX 
                        && ppu.f_spVisibility==1 
                        && ppu.scanline-21 == ppu.spr0HitY){
                    // Set sprite 0 hit flag:
                    ppu.setStatusFlag(ppu.STATUS_SPRITE0HIT,true);
                }

                if(ppu.requestEndFrame){
                    ppu.nmiCounter--;
                    if(ppu.nmiCounter == 0){
                        ppu.requestEndFrame = false;
                        ppu.startVBlank();
                        break FRAMELOOP;
                    }
                }

                ppu.curX++;
                if(ppu.curX==341){
                    ppu.curX = 0;
                    ppu.endScanline();
                }

            }
        }
        this.ctx.putImageData(this.imageData, 0, 0);
        this.fpsFrameCount++;
        
    }
    
    this.printFps = function() {
        var now = (new Date()).getTime();
        var s = 'Running';
        if (this.lastFpsTime) {
            s += ': '+(this.fpsFrameCount/((now-this.lastFpsTime)/1000)).toFixed(2)+' FPS';
        }
        $("#status").text(s);
        this.fpsFrameCount = 0;
        this.lastFpsTime = now;
    }
    
    this.stop = function() {
        //$("#status").text("Stopped.");
        clearInterval(this.frameInterval);
        clearInterval(this.fpsInterval);
		this.isRunning = false;
    }
    
    this.reloadRom = function() {
		if(this.romFile != null){
			this.loadRom(this.romFile);
		}
	}
	
	this.clearCPUMemory = function() {
		for(var i=0;i<0x2000;i++) {
			this.cpuMem[i] = Globals.memoryFlushValue;
		}
		for(var p=0;p<4;p++){
			var i = p*0x800;
			this.cpuMem[i+0x008] = 0xF7;
			this.cpuMem[i+0x009] = 0xEF;
			this.cpuMem[i+0x00A] = 0xDF;
			this.cpuMem[i+0x00F] = 0xBF;
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
			if (!this.memMapper) return;
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
		for (var i=0; i<this.cpuMem.length; i++) this.cpuMem[i] = 0;
        for (var i=0; i<this.ppuMem.length; i++) this.ppuMem[i] = 0;
        for (var i=0; i<this.sprMem.length; i++) this.sprMem[i] = 0;
		this.clearCPUMemory();
		this.cpu.reset();
		this.cpu.init();
		this.ppu.reset();
		this.palTable.reset();
		
		this.papu.reset();
	}
	
	this.resetFps = function() {
	    this.lastFpsTime = null;
        this.fpsFrameCount = 0;
	}
	
	this.setFramerate = function(rate){
		Globals.preferredFrameRate = rate;
		Globals.frameTime = 1000/rate;
		papu.setSampleRate(Globals.sampleRate, false);
	}
	
	this.cpu.init();
    this.ppu.init();
    
    this.clearCPUMemory();
    
    $("#status").text("Initialised. Ready to load a ROM.");
    
}

function runFrame() { Globals.nes.frame(); }
function runPrintFps() { Globals.nes.printFps(); }

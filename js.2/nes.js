
function NES() {
    this.opts = {
        preferredFrameRate: 60,
        fpsInterval: 500, // Time between updating FPS in ms
        showDisplay: true,

        emulateSound: false,
        sampleRate: 44100, // Sound sample rate in hz
        
        CPU_FREQ_NTSC: 1789772.5,//1789772.72727272d;
        CPU_FREQ_PAL: 1773447.4,
    }
    this.frameTime = 1000/this.opts.preferredFrameRate;
    
    this.cpu = new NES.CPU(this);
    this.ppu = new NES.PPU(this);
    this.papu = new NES.PAPU(this);
    this.mmap = null; // set in loadRom()
    this.keyboard = new NES.Keyboard();
    
    $("#status").text("Initialised. Ready to load a ROM.");
}
    
    
NES.prototype = {
    isRunning: false,
    fpsFrameCount: 0,
    limitFrames: true,
    romData: null,
    
    // Resets the system.
    reset: function() {
        if(this.mmap != null) {
            this.mmap.reset();
        }
        
        this.cpu.reset();
        this.ppu.reset();
        this.papu.reset();
    },
    
    start: function() {
        var self = this;
        
        if(this.rom != null && this.rom.valid) {
            if (!this.isRunning) {
                this.isRunning = true;
                
                this.frameInterval = setInterval(function() {
                    self.frame();
                }, this.frameTime/2);
                this.resetFps();
                this.printFps();
                this.fpsInterval = setInterval(function() {
                    self.printFps();
                }, this.opts.fpsInterval);
            }
        }
        else {
            alert("There is no ROM loaded, or it is invalid.");
        }
    },
    
    frame: function() {
        this.ppu.startFrame();
        var cycles = 0;
        var emulateSound = nes.opts.emulateSound;
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
        if (this.limitFrames) {
            if (this.lastFrameTime) {
                while ((new Date()).getTime() - this.lastFrameTime < this.frameTime) {
                    // twiddle thumbs
                }
            }
        }
        this.fpsFrameCount++;
        this.lastFrameTime = (new Date()).getTime();
    },
    
    printFps: function() {
        var now = (new Date()).getTime();
        var s = 'Running';
        if (this.lastFpsTime) {
            s += ': '+(this.fpsFrameCount/((now-this.lastFpsTime)/1000)).toFixed(2)+' FPS';
        }
        $("#status").text(s);
        this.fpsFrameCount = 0;
        this.lastFpsTime = now;
    },
    
    stop: function() {
        //$("#status").text("Stopped.");
        clearInterval(this.frameInterval);
        clearInterval(this.fpsInterval);
        this.isRunning = false;
    },
    
    reloadRom: function() {
        if(this.romData != null){
            this.loadRom(this.romData);
        }
    },
    
    // Loads a ROM file into the CPU and PPU.
    // The ROM file is validated first.
    loadRom: function(data) {
        if (this.isRunning) {
            this.stop();
        }
        
        $("#status").text("Loading...");
        
        // Load ROM file:
        this.rom = new NES.ROM(this);
        this.rom.load(data);
        
        if (this.rom.valid) {
            this.reset();
            this.mmap = this.rom.createMapper();
            if (!this.mmap) {
                return;
            }
            this.mmap.loadROM();
            this.ppu.setMirroring(this.rom.getMirroringType());
            this.romData = data;
            
            $("#status").text("Successfully loaded. Ready to be started.");
        }
        else {
            $("#status").text("Invalid ROM!");
        }
        return this.rom.valid;
    },
    
    resetFps: function() {
        this.lastFpsTime = null;
        this.fpsFrameCount = 0;
    },
    
    setFramerate: function(rate){
        this.nes.opts.preferredFrameRate = rate;
        this.nes.frameTime = 1000/rate;
        papu.setSampleRate(this.opts.sampleRate, false);
    },
    
    setLimitFrames: function(limit) {
        this.limitFrames = limit;
        this.lastFrameTime = null;
    }
}

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

JSNES.PPU = function(nes) {
    this.nes = nes;
    
    // Keep Chrome happy
    this.vramMem = null;
    this.spriteMem = null;
    this.vramAddress = null;
    this.vramTmpAddress = null;
    this.vramBufferedReadValue = null;
    this.firstWrite = null;
    this.sramAddress = null;
    this.currentMirroring = null;
    this.requestEndFrame = null;
    this.nmiOk = null;
    this.dummyCycleToggle = null;
    this.validTileData = null;
    this.nmiCounter = null;
    this.scanlineAlreadyRendered = null;
    this.f_nmiOnVblank = null;   
    this.f_spriteSize = null;
    this.f_bgPatternTable = null;
    this.f_spPatternTable = null;
    this.f_addrInc = null;
    this.f_nTblAddress = null;
    this.f_color = null;
    this.f_spVisibility = null;
    this.f_bgVisibility = null;
    this.f_spClipping = null;
    this.f_bgClipping = null;
    this.f_dispType = null;
    this.cntFV = null;
    this.cntV = null;
    this.cntH = null;
    this.cntVT = null;
    this.cntHT = null;
    this.regFV = null;
    this.regV = null;
    this.regH = null;
    this.regVT = null;
    this.regHT = null;
    this.regFH = null;
    this.regS = null;
    this.curNt = null;
    this.attrib = null;
    this.buffer = null;
    this.prevBuffer = null;
    this.bgbuffer = null;
    this.pixrendered = null;
    
    this.validTileData = null;
    this.scantile = null;
    this.scanline = null;
    this.lastRenderedScanline = null;
    this.curX = null;
    this.sprX = null; 
    this.sprY = null; 
    this.sprTile = null; 
    this.sprCol = null; 
    this.vertFlip = null; 
    this.horiFlip = null; 
    this.bgPriority = null; 
    this.spr0HitX = null; 
    this.spr0HitY = null; 
    this.hitSpr0 = null;
    this.sprPalette = null;
    this.imgPalette = null;
    this.ptTile = null;
    this.ntable1 = null;
    this.currentMirroring = null;
    this.nameTable = null;
    this.vramMirrorTable = null;
    this.palTable = null;
    
    
    // Rendering Options:
    this.showSpr0Hit = false;
    this.clipToTvSize = true;
    
    this.reset();
};

JSNES.PPU.prototype = {
    // Status flags:
    STATUS_VRAMWRITE: 4,
    STATUS_SLSPRITECOUNT: 5,
    STATUS_SPRITE0HIT: 6,
    STATUS_VBLANK: 7,
    
    reset: function() {
        var i;
        
        // Memory
        this.vramMem = new Array(0x8000);
        this.spriteMem = new Array(0x100);
        for (i=0; i<this.vramMem.length; i++) {
            this.vramMem[i] = 0;
        }
        for (i=0; i<this.spriteMem.length; i++) {
            this.spriteMem[i] = 0;
        }
        
        // VRAM I/O:
        this.vramAddress = null;
        this.vramTmpAddress = null;
        this.vramBufferedReadValue = 0;
        this.firstWrite = true;       // VRAM/Scroll Hi/Lo latch

        // SPR-RAM I/O:
        this.sramAddress = 0; // 8-bit only.
        
        this.currentMirroring = -1;
        this.requestEndFrame = false;
        this.nmiOk = false;
        this.dummyCycleToggle = false;
        this.validTileData = false;
        this.nmiCounter = 0;
        this.scanlineAlreadyRendered = null;
        
        // Control Flags Register 1:
        this.f_nmiOnVblank = 0;    // NMI on VBlank. 0=disable, 1=enable
        this.f_spriteSize = 0;     // Sprite size. 0=8x8, 1=8x16
        this.f_bgPatternTable = 0; // Background Pattern Table address. 0=0x0000,1=0x1000
        this.f_spPatternTable = 0; // Sprite Pattern Table address. 0=0x0000,1=0x1000
        this.f_addrInc = 0;        // PPU Address Increment. 0=1,1=32
        this.f_nTblAddress = 0;    // Name Table Address. 0=0x2000,1=0x2400,2=0x2800,3=0x2C00
        
        // Control Flags Register 2:
        this.f_color = 0;         // Background color. 0=black, 1=blue, 2=green, 4=red
        this.f_spVisibility = 0;   // Sprite visibility. 0=not displayed,1=displayed
        this.f_bgVisibility = 0;   // Background visibility. 0=Not Displayed,1=displayed
        this.f_spClipping = 0;     // Sprite clipping. 0=Sprites invisible in left 8-pixel column,1=No clipping
        this.f_bgClipping = 0;     // Background clipping. 0=BG invisible in left 8-pixel column, 1=No clipping
        this.f_dispType = 0;       // Display type. 0=color, 1=monochrome
        
        // Counters:
        this.cntFV = 0;
        this.cntV = 0;
        this.cntH = 0;
        this.cntVT = 0;
        this.cntHT = 0;
        
        // Registers:
        this.regFV = 0;
        this.regV = 0;
        this.regH = 0;
        this.regVT = 0;
        this.regHT = 0;
        this.regFH = 0;
        this.regS = 0;
        
        // These are temporary variables used in rendering and sound procedures.
        // Their states outside of those procedures can be ignored.
        // TODO: the use of this is a bit weird, investigate
        this.curNt = null;
        
        // Variables used when rendering:
        this.attrib = new Array(32);
        this.buffer = new Array(256*240);
        this.prevBuffer = new Array(256*240);
        this.bgbuffer = new Array(256*240);
        this.pixrendered = new Array(256*240);

        this.validTileData = null;

        this.scantile = new Array(32);
        
        // Initialize misc vars:
        this.scanline = 0;
        this.lastRenderedScanline = -1;
        this.curX = 0;
        
        // Sprite data:
        this.sprX = new Array(64); // X coordinate
        this.sprY = new Array(64); // Y coordinate
        this.sprTile = new Array(64); // Tile Index (into pattern table)
        this.sprCol = new Array(64); // Upper two bits of color
        this.vertFlip = new Array(64); // Vertical Flip
        this.horiFlip = new Array(64); // Horizontal Flip
        this.bgPriority = new Array(64); // Background priority
        this.spr0HitX = 0; // Sprite #0 hit X coordinate
        this.spr0HitY = 0; // Sprite #0 hit Y coordinate
        this.hitSpr0 = false;
        
        // Palette data:
        this.sprPalette = new Array(16);
        this.imgPalette = new Array(16);
        
        // Create pattern table tile buffers:
        this.ptTile = new Array(512);
        for (i=0; i<512; i++) {
            this.ptTile[i] = new JSNES.PPU.Tile();
        }
        
        // Create nametable buffers:
        // Name table data:
        this.ntable1 = new Array(4);
        this.currentMirroring = -1;
        this.nameTable = new Array(4);
        for (i=0; i<4; i++) {
            this.nameTable[i] = new JSNES.PPU.NameTable(32, 32, "Nt"+i);
        }
        
        // Initialize mirroring lookup table:
        this.vramMirrorTable = new Array(0x8000);
        for (i=0; i<0x8000; i++) {
            this.vramMirrorTable[i] = i;
        }
        
        this.palTable = new JSNES.PPU.PaletteTable();
        this.palTable.loadNTSCPalette();
        //this.palTable.loadDefaultPalette();
        
        this.updateControlReg1(0);
        this.updateControlReg2(0);
    },
    
    // Sets Nametable mirroring.
    setMirroring: function(mirroring){
    
        if (mirroring == this.currentMirroring) {
            return;
        }
        
        this.currentMirroring = mirroring;
        this.triggerRendering();
    
        // Remove mirroring:
        if (this.vramMirrorTable === null) {
            this.vramMirrorTable = new Array(0x8000);
        }
        for (var i=0; i<0x8000; i++) {
            this.vramMirrorTable[i] = i;
        }
        
        // Palette mirroring:
        this.defineMirrorRegion(0x3f20,0x3f00,0x20);
        this.defineMirrorRegion(0x3f40,0x3f00,0x20);
        this.defineMirrorRegion(0x3f80,0x3f00,0x20);
        this.defineMirrorRegion(0x3fc0,0x3f00,0x20);
        
        // Additional mirroring:
        this.defineMirrorRegion(0x3000,0x2000,0xf00);
        this.defineMirrorRegion(0x4000,0x0000,0x4000);
    
        if (mirroring == this.nes.rom.HORIZONTAL_MIRRORING) {
            // Horizontal mirroring.
            
            this.ntable1[0] = 0;
            this.ntable1[1] = 0;
            this.ntable1[2] = 1;
            this.ntable1[3] = 1;
            
            this.defineMirrorRegion(0x2400,0x2000,0x400);
            this.defineMirrorRegion(0x2c00,0x2800,0x400);
            
        }else if (mirroring == this.nes.rom.VERTICAL_MIRRORING) {
            // Vertical mirroring.
            
            this.ntable1[0] = 0;
            this.ntable1[1] = 1;
            this.ntable1[2] = 0;
            this.ntable1[3] = 1;
            
            this.defineMirrorRegion(0x2800,0x2000,0x400);
            this.defineMirrorRegion(0x2c00,0x2400,0x400);
            
        }else if (mirroring == this.nes.rom.SINGLESCREEN_MIRRORING) {
            
            // Single Screen mirroring
            
            this.ntable1[0] = 0;
            this.ntable1[1] = 0;
            this.ntable1[2] = 0;
            this.ntable1[3] = 0;
            
            this.defineMirrorRegion(0x2400,0x2000,0x400);
            this.defineMirrorRegion(0x2800,0x2000,0x400);
            this.defineMirrorRegion(0x2c00,0x2000,0x400);
            
        }else if (mirroring == this.nes.rom.SINGLESCREEN_MIRRORING2) {
            
            
            this.ntable1[0] = 1;
            this.ntable1[1] = 1;
            this.ntable1[2] = 1;
            this.ntable1[3] = 1;
            
            this.defineMirrorRegion(0x2400,0x2400,0x400);
            this.defineMirrorRegion(0x2800,0x2400,0x400);
            this.defineMirrorRegion(0x2c00,0x2400,0x400);
            
        }else {
            
            // Assume Four-screen mirroring.
            
            this.ntable1[0] = 0;
            this.ntable1[1] = 1;
            this.ntable1[2] = 2;
            this.ntable1[3] = 3;
            
        }   
        
    },
    
    
    // Define a mirrored area in the address lookup table.
    // Assumes the regions don't overlap.
    // The 'to' region is the region that is physically in memory.
    defineMirrorRegion: function(fromStart, toStart, size){
        for (var i=0;i<size;i++) {
            this.vramMirrorTable[fromStart+i] = toStart+i;
        }
    },
    
    startVBlank: function(){
        
        // Do NMI:
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NMI);
        
        // Make sure everything is rendered:
        if (this.lastRenderedScanline < 239) {
            this.renderFramePartially(
                this.lastRenderedScanline+1,240-this.lastRenderedScanline
            );
        }
        
        // End frame:
        this.endFrame();
        
        // Reset scanline counter:
        this.lastRenderedScanline = -1;
    },
    
    endScanline: function(){
        switch (this.scanline) {
            case 19:
                // Dummy scanline.
                // May be variable length:
                if (this.dummyCycleToggle) {

                    // Remove dead cycle at end of scanline,
                    // for next scanline:
                    this.curX = 1;
                    this.dummyCycleToggle = !this.dummyCycleToggle;

                }
                break;
                
            case 20:
                // Clear VBlank flag:
                this.setStatusFlag(this.STATUS_VBLANK,false);

                // Clear Sprite #0 hit flag:
                this.setStatusFlag(this.STATUS_SPRITE0HIT,false);
                this.hitSpr0 = false;
                this.spr0HitX = -1;
                this.spr0HitY = -1;

                if (this.f_bgVisibility == 1 || this.f_spVisibility==1) {

                    // Update counters:
                    this.cntFV = this.regFV;
                    this.cntV = this.regV;
                    this.cntH = this.regH;
                    this.cntVT = this.regVT;
                    this.cntHT = this.regHT;

                    if (this.f_bgVisibility==1) {
                        // Render dummy scanline:
                        this.renderBgScanline(false,0);
                    }   

                }

                if (this.f_bgVisibility==1 && this.f_spVisibility==1) {

                    // Check sprite 0 hit for first scanline:
                    this.checkSprite0(0);

                }

                if (this.f_bgVisibility==1 || this.f_spVisibility==1) {
                    // Clock mapper IRQ Counter:
                    this.nes.mmap.clockIrqCounter();
                }
                break;
                
            case 261:
                // Dead scanline, no rendering.
                // Set VINT:
                this.setStatusFlag(this.STATUS_VBLANK,true);
                this.requestEndFrame = true;
                this.nmiCounter = 9;
            
                // Wrap around:
                this.scanline = -1; // will be incremented to 0
                
                break;
                
            default:
                if (this.scanline >= 21 && this.scanline <= 260) {

                    // Render normally:
                    if (this.f_bgVisibility == 1) {

                        if (!this.scanlineAlreadyRendered) {
                            // update scroll:
                            this.cntHT = this.regHT;
                            this.cntH = this.regH;
                            this.renderBgScanline(true,this.scanline+1-21);
                        }
                        this.scanlineAlreadyRendered=false;

                        // Check for sprite 0 (next scanline):
                        if (!this.hitSpr0 && this.f_spVisibility == 1) {
                            if (this.sprX[0] >= -7 &&
                                    this.sprX[0] < 256 &&
                                    this.sprY[0] + 1 <= (this.scanline - 20) &&
                                    (this.sprY[0] + 1 + (
                                        this.f_spriteSize === 0 ? 8 : 16
                                    )) >= (this.scanline - 20)) {
                                if (this.checkSprite0(this.scanline - 20)) {
                                    this.hitSpr0 = true;
                                }
                            }
                        }

                    }

                    if (this.f_bgVisibility==1 || this.f_spVisibility==1) {
                        // Clock mapper IRQ Counter:
                        this.nes.mmap.clockIrqCounter();
                    }
                }
        }
        
        this.scanline++;
        this.regsToAddress();
        this.cntsToAddress();
        
    },
    
    startFrame: function(){    
        // Set background color:
        var bgColor=0;
        
        if (this.f_dispType === 0) {
            // Color display.
            // f_color determines color emphasis.
            // Use first entry of image palette as BG color.
            bgColor = this.imgPalette[0];
        }
        else {
            // Monochrome display.
            // f_color determines the bg color.
            switch (this.f_color) {
                case 0:
                    // Black
                    bgColor = 0x00000;
                    break;
                case 1:
                    // Green
                    bgColor = 0x00FF00;
                    break;
                case 2:
                    // Blue
                    bgColor = 0xFF0000;
                    break;
                case 3:
                    // Invalid. Use black.
                    bgColor = 0x000000;
                    break;
                case 4:
                    // Red
                    bgColor = 0x0000FF;
                    break;
                default:
                    // Invalid. Use black.
                    bgColor = 0x0;
            }
        }
        
        var buffer = this.buffer;
        var i;
        for (i=0; i<256*240; i++) {
            buffer[i] = bgColor;
        }
        var pixrendered = this.pixrendered;
        for (i=0; i<pixrendered.length; i++) {
            pixrendered[i]=65;
        }
    },
    
    endFrame: function(){
        var i, x, y;
        var buffer = this.buffer;
        
        // Draw spr#0 hit coordinates:
        if (this.showSpr0Hit) {
            // Spr 0 position:
            if (this.sprX[0] >= 0 && this.sprX[0] < 256 &&
                    this.sprY[0] >= 0 && this.sprY[0] < 240) {
                for (i=0; i<256; i++) {  
                    buffer[(this.sprY[0]<<8)+i] = 0xFF5555;
                }
                for (i=0; i<240; i++) {
                    buffer[(i<<8)+this.sprX[0]] = 0xFF5555;
                }
            }
            // Hit position:
            if (this.spr0HitX >= 0 && this.spr0HitX < 256 &&
                    this.spr0HitY >= 0 && this.spr0HitY < 240) {
                for (i=0; i<256; i++) {
                    buffer[(this.spr0HitY<<8)+i] = 0x55FF55;
                }
                for (i=0; i<240; i++) {
                    buffer[(i<<8)+this.spr0HitX] = 0x55FF55;
                }
            }
        }
        
        // This is a bit lazy..
        // if either the sprites or the background should be clipped,
        // both are clipped after rendering is finished.
        if (this.clipToTvSize || this.f_bgClipping === 0 || this.f_spClipping === 0) {
            // Clip left 8-pixels column:
            for (y=0;y<240;y++) {
                for (x=0;x<8;x++) {
                    buffer[(y<<8)+x] = 0;
                }
            }
        }
        
        if (this.clipToTvSize) {
            // Clip right 8-pixels column too:
            for (y=0; y<240; y++) {
                for (x=0; x<8; x++) {
                    buffer[(y<<8)+255-x] = 0;
                }
            }
        }
        
        // Clip top and bottom 8 pixels:
        if (this.clipToTvSize) {
            for (y=0; y<8; y++) {
                for (x=0; x<256; x++) {
                    buffer[(y<<8)+x] = 0;
                    buffer[((239-y)<<8)+x] = 0;
                }
            }
        }
        
        if (this.nes.opts.showDisplay) {
            this.nes.ui.writeFrame(buffer, this.prevBuffer);
        }
    },
    
    updateControlReg1: function(value){
        
        this.triggerRendering();
        
        this.f_nmiOnVblank =    (value>>7)&1;
        this.f_spriteSize =     (value>>5)&1;
        this.f_bgPatternTable = (value>>4)&1;
        this.f_spPatternTable = (value>>3)&1;
        this.f_addrInc =        (value>>2)&1;
        this.f_nTblAddress =     value&3;
        
        this.regV = (value>>1)&1;
        this.regH = value&1;
        this.regS = (value>>4)&1;
        
    },
    
    updateControlReg2: function(value){
        
        this.triggerRendering();
        
        this.f_color =       (value>>5)&7;
        this.f_spVisibility = (value>>4)&1;
        this.f_bgVisibility = (value>>3)&1;
        this.f_spClipping =   (value>>2)&1;
        this.f_bgClipping =   (value>>1)&1;
        this.f_dispType =      value&1;
        
        if (this.f_dispType === 0) {
            this.palTable.setEmphasis(this.f_color);
        }
        this.updatePalettes();
    },
    
    setStatusFlag: function(flag, value){
        var n = 1<<flag;
        this.nes.cpu.mem[0x2002] = 
            ((this.nes.cpu.mem[0x2002] & (255-n)) | (value?n:0));
    },
    
    // CPU Register $2002:
    // Read the Status Register.
    readStatusRegister: function(){
        
        var tmp = this.nes.cpu.mem[0x2002];
        
        // Reset scroll & VRAM Address toggle:
        this.firstWrite = true;
        
        // Clear VBlank flag:
        this.setStatusFlag(this.STATUS_VBLANK,false);
        
        // Fetch status data:
        return tmp;
        
    },
    
    // CPU Register $2003:
    // Write the SPR-RAM address that is used for sramWrite (Register 0x2004 in CPU memory map)
    writeSRAMAddress: function(address) {
        this.sramAddress = address;
    },
    
    // CPU Register $2004 (R):
    // Read from SPR-RAM (Sprite RAM).
    // The address should be set first.
    sramLoad: function() {
        /*short tmp = sprMem.load(sramAddress);
        sramAddress++; // Increment address
        sramAddress%=0x100;
        return tmp;*/
        return this.spriteMem[this.sramAddress];
    },
    
    // CPU Register $2004 (W):
    // Write to SPR-RAM (Sprite RAM).
    // The address should be set first.
    sramWrite: function(value){
        this.spriteMem[this.sramAddress] = value;
        this.spriteRamWriteUpdate(this.sramAddress,value);
        this.sramAddress++; // Increment address
        this.sramAddress %= 0x100;
    },
    
    // CPU Register $2005:
    // Write to scroll registers.
    // The first write is the vertical offset, the second is the
    // horizontal offset:
    scrollWrite: function(value){
        this.triggerRendering();
        
        if (this.firstWrite) {
            // First write, horizontal scroll:
            this.regHT = (value>>3)&31;
            this.regFH = value&7;
            
        }else {
            
            // Second write, vertical scroll:
            this.regFV = value&7;
            this.regVT = (value>>3)&31;
            
        }
        this.firstWrite = !this.firstWrite;
        
    },
    
    // CPU Register $2006:
    // Sets the adress used when reading/writing from/to VRAM.
    // The first write sets the high byte, the second the low byte.
    writeVRAMAddress: function(address){
        
        if (this.firstWrite) {
            
            this.regFV = (address>>4)&3;
            this.regV = (address>>3)&1;
            this.regH = (address>>2)&1;
            this.regVT = (this.regVT&7) | ((address&3)<<3);
            
        }else {
            this.triggerRendering();
            
            this.regVT = (this.regVT&24) | ((address>>5)&7);
            this.regHT = address&31;
            
            this.cntFV = this.regFV;
            this.cntV = this.regV;
            this.cntH = this.regH;
            this.cntVT = this.regVT;
            this.cntHT = this.regHT;
            
            this.checkSprite0(this.scanline-20);
            
        }
        
        this.firstWrite = !this.firstWrite;
        
        // Invoke mapper latch:
        this.cntsToAddress();
        if (this.vramAddress < 0x2000) {
            this.nes.mmap.latchAccess(this.vramAddress);
        }   
    },
    
    // CPU Register $2007(R):
    // Read from PPU memory. The address should be set first.
    vramLoad: function(){
        var tmp;
        
        this.cntsToAddress();
        this.regsToAddress();
        
        // If address is in range 0x0000-0x3EFF, return buffered values:
        if (this.vramAddress <= 0x3EFF) {
            tmp = this.vramBufferedReadValue;
        
            // Update buffered value:
            if (this.vramAddress < 0x2000) {
                this.vramBufferedReadValue = this.vramMem[this.vramAddress];
            }
            else {
                this.vramBufferedReadValue = this.mirroredLoad(
                    this.vramAddress
                );
            }
            
            // Mapper latch access:
            if (this.vramAddress < 0x2000) {
                this.nes.mmap.latchAccess(this.vramAddress);
            }
            
            // Increment by either 1 or 32, depending on d2 of Control Register 1:
            this.vramAddress += (this.f_addrInc == 1 ? 32 : 1);
            
            this.cntsFromAddress();
            this.regsFromAddress();
            
            return tmp; // Return the previous buffered value.
        }
            
        // No buffering in this mem range. Read normally.
        tmp = this.mirroredLoad(this.vramAddress);
        
        // Increment by either 1 or 32, depending on d2 of Control Register 1:
        this.vramAddress += (this.f_addrInc == 1 ? 32 : 1); 
        
        this.cntsFromAddress();
        this.regsFromAddress();
        
        return tmp;
    },
    
    // CPU Register $2007(W):
    // Write to PPU memory. The address should be set first.
    vramWrite: function(value){
        
        this.triggerRendering();
        this.cntsToAddress();
        this.regsToAddress();
        
        if (this.vramAddress >= 0x2000) {
            // Mirroring is used.
            this.mirroredWrite(this.vramAddress,value);
        }else {
            
            // Write normally.
            this.writeMem(this.vramAddress,value);
            
            // Invoke mapper latch:
            this.nes.mmap.latchAccess(this.vramAddress);
            
        }
        
        // Increment by either 1 or 32, depending on d2 of Control Register 1:
        this.vramAddress += (this.f_addrInc==1?32:1);
        this.regsFromAddress();
        this.cntsFromAddress();
        
    },
    
    // CPU Register $4014:
    // Write 256 bytes of main memory
    // into Sprite RAM.
    sramDMA: function(value){
        var baseAddress = value * 0x100;
        var data;
        for (var i=this.sramAddress; i < 256; i++) {
            data = this.nes.cpu.mem[baseAddress+i];
            this.spriteMem[i] = data;
            this.spriteRamWriteUpdate(i, data);
        }
        
        this.nes.cpu.haltCycles(513);
        
    },
    
    // Updates the scroll registers from a new VRAM address.
    regsFromAddress: function(){
        
        var address = (this.vramTmpAddress>>8)&0xFF;
        this.regFV = (address>>4)&7;
        this.regV = (address>>3)&1;
        this.regH = (address>>2)&1;
        this.regVT = (this.regVT&7) | ((address&3)<<3);
        
        address = this.vramTmpAddress&0xFF;
        this.regVT = (this.regVT&24) | ((address>>5)&7);
        this.regHT = address&31;
    },
    
    // Updates the scroll registers from a new VRAM address.
    cntsFromAddress: function(){
        
        var address = (this.vramAddress>>8)&0xFF;
        this.cntFV = (address>>4)&3;
        this.cntV = (address>>3)&1;
        this.cntH = (address>>2)&1;
        this.cntVT = (this.cntVT&7) | ((address&3)<<3);        
        
        address = this.vramAddress&0xFF;
        this.cntVT = (this.cntVT&24) | ((address>>5)&7);
        this.cntHT = address&31;
        
    },
    
    regsToAddress: function(){
        var b1  = (this.regFV&7)<<4;
        b1 |= (this.regV&1)<<3;
        b1 |= (this.regH&1)<<2;
        b1 |= (this.regVT>>3)&3;
        
        var b2  = (this.regVT&7)<<5;
        b2 |= this.regHT&31;
        
        this.vramTmpAddress = ((b1<<8) | b2)&0x7FFF;
    },
    
    cntsToAddress: function(){
        var b1  = (this.cntFV&7)<<4;
        b1 |= (this.cntV&1)<<3;
        b1 |= (this.cntH&1)<<2;
        b1 |= (this.cntVT>>3)&3;
        
        var b2  = (this.cntVT&7)<<5;
        b2 |= this.cntHT&31;
        
        this.vramAddress = ((b1<<8) | b2)&0x7FFF;
    },
    
    incTileCounter: function(count) { 
        for (var i=count; i!==0; i--) {
            this.cntHT++;
            if (this.cntHT == 32) {
                this.cntHT = 0;
                this.cntVT++;
                if (this.cntVT >= 30) {
                    this.cntH++;
                    if(this.cntH == 2) {
                        this.cntH = 0;
                        this.cntV++;
                        if (this.cntV == 2) {
                            this.cntV = 0;
                            this.cntFV++;
                            this.cntFV &= 0x7;
                        }
                    }
                }
            }
        }
    },
    
    // Reads from memory, taking into account
    // mirroring/mapping of address ranges.
    mirroredLoad: function(address) {
        return this.vramMem[this.vramMirrorTable[address]];
    },
    
    // Writes to memory, taking into account
    // mirroring/mapping of address ranges.
    mirroredWrite: function(address, value){
        if (address>=0x3f00 && address<0x3f20) {
            // Palette write mirroring.
            if (address==0x3F00 || address==0x3F10) {
                this.writeMem(0x3F00,value);
                this.writeMem(0x3F10,value);
                
            }else if (address==0x3F04 || address==0x3F14) {
                
                this.writeMem(0x3F04,value);
                this.writeMem(0x3F14,value);
                
            }else if (address==0x3F08 || address==0x3F18) {
                
                this.writeMem(0x3F08,value);
                this.writeMem(0x3F18,value);
                
            }else if (address==0x3F0C || address==0x3F1C) {
                
                this.writeMem(0x3F0C,value);
                this.writeMem(0x3F1C,value);
                
            }else {
                this.writeMem(address,value);
            }
            
        }else {
            
            // Use lookup table for mirrored address:
            if (address<this.vramMirrorTable.length) {
                this.writeMem(this.vramMirrorTable[address],value);
            }else {
                // FIXME
                alert("Invalid VRAM address: "+address.toString(16));
            }
            
        }
    },
    
    triggerRendering: function(){
        if (this.scanline >= 21 && this.scanline <= 260) {
            // Render sprites, and combine:
            this.renderFramePartially(
                this.lastRenderedScanline+1,
                this.scanline-21-this.lastRenderedScanline
            );
            
            // Set last rendered scanline:
            this.lastRenderedScanline = this.scanline-21;
        }
    },
    
    renderFramePartially: function(startScan, scanCount){
        if (this.f_spVisibility == 1) {
            this.renderSpritesPartially(startScan,scanCount,true);
        }
        
        if(this.f_bgVisibility == 1) {
            var si = startScan<<8;
            var ei = (startScan+scanCount)<<8;
            if (ei > 0xF000) {
                ei = 0xF000;
            }
            var buffer = this.buffer;
            var bgbuffer = this.bgbuffer;
            var pixrendered = this.pixrendered;
            for (var destIndex=si; destIndex<ei; destIndex++) {
                if (pixrendered[destIndex] > 0xFF) {
                    buffer[destIndex] = bgbuffer[destIndex];
                }
            }
        }
        
        if (this.f_spVisibility == 1) {
            this.renderSpritesPartially(startScan, scanCount, false);
        }
        
        this.validTileData = false;
    },
    
    renderBgScanline: function(bgbuffer, scan) {
        var baseTile = (this.regS === 0 ? 0 : 256);
        var destIndex = (scan<<8)-this.regFH;

        this.curNt = this.ntable1[this.cntV+this.cntV+this.cntH];
        
        this.cntHT = this.regHT;
        this.cntH = this.regH;
        this.curNt = this.ntable1[this.cntV+this.cntV+this.cntH];
        
        if (scan<240 && (scan-this.cntFV)>=0){
            
            var tscanoffset = this.cntFV<<3;
            var scantile = this.scantile;
            var attrib = this.attrib;
            var ptTile = this.ptTile;
            var nameTable = this.nameTable;
            var imgPalette = this.imgPalette;
            var pixrendered = this.pixrendered;
            var targetBuffer = bgbuffer ? this.bgbuffer : this.buffer;

            var t, tpix, att, col;

            for (var tile=0;tile<32;tile++) {
                
                if (scan>=0) {
                
                    // Fetch tile & attrib data:
                    if (this.validTileData) {
                        // Get data from array:
                        t = scantile[tile];
                        tpix = t.pix;
                        att = attrib[tile];
                    }else {
                        // Fetch data:
                        t = ptTile[baseTile+nameTable[this.curNt].getTileIndex(this.cntHT,this.cntVT)];
                        tpix = t.pix;
                        att = nameTable[this.curNt].getAttrib(this.cntHT,this.cntVT);
                        scantile[tile] = t;
                        attrib[tile] = att;
                    }
                    
                    // Render tile scanline:
                    var sx = 0;
                    var x = (tile<<3)-this.regFH;

                    if (x>-8) {
                        if (x<0) {
                            destIndex-=x;
                            sx = -x;
                        }
                        if (t.opaque[this.cntFV]) {
                            for (;sx<8;sx++) {
                                targetBuffer[destIndex] = imgPalette[
                                    tpix[tscanoffset+sx]+att
                                ];
                                pixrendered[destIndex] |= 256;
                                destIndex++;
                            }
                        }else {
                            for (;sx<8;sx++) {
                                col = tpix[tscanoffset+sx];
                                if(col !== 0) {
                                    targetBuffer[destIndex] = imgPalette[
                                        col+att
                                    ];
                                    pixrendered[destIndex] |= 256;
                                }
                                destIndex++;
                            }
                        }
                    }
                    
                }
                    
                // Increase Horizontal Tile Counter:
                if (++this.cntHT==32) {
                    this.cntHT=0;
                    this.cntH++;
                    this.cntH%=2;
                    this.curNt = this.ntable1[(this.cntV<<1)+this.cntH];    
                }
                
                
            }
            
            // Tile data for one row should now have been fetched,
            // so the data in the array is valid.
            this.validTileData = true;
            
        }
        
        // update vertical scroll:
        this.cntFV++;
        if (this.cntFV==8) {
            this.cntFV = 0;
            this.cntVT++;
            if (this.cntVT==30) {
                this.cntVT = 0;
                this.cntV++;
                this.cntV%=2;
                this.curNt = this.ntable1[(this.cntV<<1)+this.cntH];
            }else if (this.cntVT==32) {
                this.cntVT = 0;
            }
            
            // Invalidate fetched data:
            this.validTileData = false;
            
        }
    },
    
    renderSpritesPartially: function(startscan, scancount, bgPri){
        if (this.f_spVisibility === 1) {
            
            for (var i=0;i<64;i++) {
                if (this.bgPriority[i]==bgPri && this.sprX[i]>=0 && 
                        this.sprX[i]<256 && this.sprY[i]+8>=startscan && 
                        this.sprY[i]<startscan+scancount) {
                    // Show sprite.
                    if (this.f_spriteSize === 0) {
                        // 8x8 sprites
                        
                        this.srcy1 = 0;
                        this.srcy2 = 8;
                        
                        if (this.sprY[i]<startscan) {
                            this.srcy1 = startscan - this.sprY[i]-1;
                        }
                        
                        if (this.sprY[i]+8 > startscan+scancount) {
                            this.srcy2 = startscan+scancount-this.sprY[i]+1;
                        }
                        
                        if (this.f_spPatternTable===0) {
                            this.ptTile[this.sprTile[i]].render(this.buffer, 
                                0, this.srcy1, 8, this.srcy2, this.sprX[i], 
                                this.sprY[i]+1, this.sprCol[i], this.sprPalette, 
                                this.horiFlip[i], this.vertFlip[i], i, 
                                this.pixrendered
                            );
                        }else {
                            this.ptTile[this.sprTile[i]+256].render(this.buffer, 0, this.srcy1, 8, this.srcy2, this.sprX[i], this.sprY[i]+1, this.sprCol[i], this.sprPalette, this.horiFlip[i], this.vertFlip[i], i, this.pixrendered);
                        }
                    }else {
                        // 8x16 sprites
                        var top = this.sprTile[i];
                        if ((top&1)!==0) {
                            top = this.sprTile[i]-1+256;
                        }
                        
                        var srcy1 = 0;
                        var srcy2 = 8;
                        
                        if (this.sprY[i]<startscan) {
                            srcy1 = startscan - this.sprY[i]-1;
                        }
                        
                        if (this.sprY[i]+8 > startscan+scancount) {
                            srcy2 = startscan+scancount-this.sprY[i];
                        }
                        
                        this.ptTile[top+(this.vertFlip[i]?1:0)].render(
                            this.buffer,
                            0,
                            srcy1,
                            8,
                            srcy2,
                            this.sprX[i],
                            this.sprY[i]+1,
                            this.sprCol[i],
                            this.sprPalette,
                            this.horiFlip[i],
                            this.vertFlip[i],
                            i,
                            this.pixrendered
                        );
                        
                        srcy1 = 0;
                        srcy2 = 8;
                        
                        if (this.sprY[i]+8<startscan) {
                            srcy1 = startscan - (this.sprY[i]+8+1);
                        }
                        
                        if (this.sprY[i]+16 > startscan+scancount) {
                            srcy2 = startscan+scancount-(this.sprY[i]+8);
                        }
                        
                        this.ptTile[top+(this.vertFlip[i]?0:1)].render(
                            this.buffer,
                            0,
                            srcy1,
                            8,
                            srcy2,
                            this.sprX[i],
                            this.sprY[i]+1+8,
                            this.sprCol[i],
                            this.sprPalette,
                            this.horiFlip[i],
                            this.vertFlip[i],
                            i,
                            this.pixrendered
                        );
                        
                    }
                }
            }
        }
    },
    
    checkSprite0: function(scan){
        
        this.spr0HitX = -1;
        this.spr0HitY = -1;
        
        var toffset;
        var tIndexAdd = (this.f_spPatternTable === 0?0:256);
        var x, y, t, i;
        var bufferIndex;
        var col;
        var bgPri;
        
        x = this.sprX[0];
        y = this.sprY[0]+1;
        
        if (this.f_spriteSize === 0) {
            // 8x8 sprites.

            // Check range:
            if (y <= scan && y + 8 > scan && x >= -7 && x < 256) {
                
                // Sprite is in range.
                // Draw scanline:
                t = this.ptTile[this.sprTile[0] + tIndexAdd];
                col = this.sprCol[0];
                bgPri = this.bgPriority[0];
                
                if (this.vertFlip[0]) {
                    toffset = 7 - (scan -y);
                }
                else {
                    toffset = scan - y;
                }
                toffset *= 8;
                
                bufferIndex = scan * 256 + x;
                if (this.horiFlip[0]) {
                    for (i = 7; i >= 0; i--) {
                        if (x >= 0 && x < 256) {
                            if (bufferIndex>=0 && bufferIndex<61440 && 
                                    this.pixrendered[bufferIndex] !==0 ) {
                                if (t.pix[toffset+i] !== 0) {
                                    this.spr0HitX = bufferIndex % 256;
                                    this.spr0HitY = scan;
                                    return true;
                                }
                            }
                        }
                        x++;
                        bufferIndex++;
                    }
                }
                else {
                    for (i = 0; i < 8; i++) {
                        if (x >= 0 && x < 256) {
                            if (bufferIndex >= 0 && bufferIndex < 61440 && 
                                    this.pixrendered[bufferIndex] !==0 ) {
                                if (t.pix[toffset+i] !== 0) {
                                    this.spr0HitX = bufferIndex % 256;
                                    this.spr0HitY = scan;
                                    return true;
                                }
                            }
                        }
                        x++;
                        bufferIndex++;  
                    }   
                }
            }
        }
        else {
            // 8x16 sprites:
        
            // Check range:
            if (y <= scan && y + 16 > scan && x >= -7 && x < 256) {
                // Sprite is in range.
                // Draw scanline:
                
                if (this.vertFlip[0]) {
                    toffset = 15-(scan-y);
                }else {
                    toffset = scan-y;
                }
                
                if (toffset<8) {
                    // first half of sprite.
                    t = this.ptTile[this.sprTile[0]+(this.vertFlip[0]?1:0)+((this.sprTile[0]&1)!==0?255:0)];
                }else {
                    // second half of sprite.
                    t = this.ptTile[this.sprTile[0]+(this.vertFlip[0]?0:1)+((this.sprTile[0]&1)!==0?255:0)];
                    if (this.vertFlip[0]) {
                        toffset = 15-toffset;
                    }
                    else {
                        toffset -= 8;
                    }
                }
                toffset*=8;
                col = this.sprCol[0];
                bgPri = this.bgPriority[0];
                
                bufferIndex = scan*256+x;
                if (this.horiFlip[0]) {
                    for (i=7;i>=0;i--) {
                        if (x>=0 && x<256) {
                            if (bufferIndex>=0 && bufferIndex<61440 && this.pixrendered[bufferIndex]!==0) {
                                if (t.pix[toffset+i] !== 0) {
                                    this.spr0HitX = bufferIndex%256;
                                    this.spr0HitY = scan;
                                    return true;
                                }
                            }
                        }
                        x++;
                        bufferIndex++;
                    }
                    
                }
                else {
                    
                    for (i=0;i<8;i++) {
                        if (x>=0 && x<256) {
                            if (bufferIndex>=0 && bufferIndex<61440 && this.pixrendered[bufferIndex]!==0) {
                                if (t.pix[toffset+i] !== 0) {
                                    this.spr0HitX = bufferIndex%256;
                                    this.spr0HitY = scan;
                                    return true;
                                }
                            }
                        }
                        x++;
                        bufferIndex++;
                    }
                    
                }
                
            }
            
        }
        
        return false;
    },
    
    // This will write to PPU memory, and
    // update internally buffered data
    // appropriately.
    writeMem: function(address, value){
        this.vramMem[address] = value;
        
        // Update internally buffered data:
        if (address < 0x2000) {
            this.vramMem[address] = value;
            this.patternWrite(address,value);
        }
        else if (address >=0x2000 && address <0x23c0) {    
            this.nameTableWrite(this.ntable1[0], address - 0x2000, value);
        }
        else if (address >=0x23c0 && address <0x2400) {    
            this.attribTableWrite(this.ntable1[0],address-0x23c0,value);
        }
        else if (address >=0x2400 && address <0x27c0) {    
            this.nameTableWrite(this.ntable1[1],address-0x2400,value);
        }
        else if (address >=0x27c0 && address <0x2800) {    
            this.attribTableWrite(this.ntable1[1],address-0x27c0,value);
        }
        else if (address >=0x2800 && address <0x2bc0) {    
            this.nameTableWrite(this.ntable1[2],address-0x2800,value);
        }
        else if (address >=0x2bc0 && address <0x2c00) {    
            this.attribTableWrite(this.ntable1[2],address-0x2bc0,value);
        }
        else if (address >=0x2c00 && address <0x2fc0) {    
            this.nameTableWrite(this.ntable1[3],address-0x2c00,value);
        }
        else if (address >=0x2fc0 && address <0x3000) {
            this.attribTableWrite(this.ntable1[3],address-0x2fc0,value);
        }
        else if (address >=0x3f00 && address <0x3f20) {
            this.updatePalettes();
        }
    },
    
    // Reads data from $3f00 to $f20 
    // into the two buffered palettes.
    updatePalettes: function(){
        var i;
        
        for (i = 0; i < 16; i++) {
            if (this.f_dispType === 0) {
                this.imgPalette[i] = this.palTable.getEntry(
                    this.vramMem[0x3f00 + i] & 63
                );
            }
            else {
                this.imgPalette[i] = this.palTable.getEntry(
                    this.vramMem[0x3f00 + i] & 32
                );
            }
        }
        for (i = 0; i < 16; i++) {
            if (this.f_dispType === 0) {
                this.sprPalette[i] = this.palTable.getEntry(
                    this.vramMem[0x3f10 + i] & 63
                );
            }
            else {
                this.sprPalette[i] = this.palTable.getEntry(
                    this.vramMem[0x3f10 + i] & 32
                );
            }
        }
    },
    
    // Updates the internal pattern
    // table buffers with this new byte.
    // In vNES, there is a version of this with 4 arguments which isn't used.
    patternWrite: function(address, value){
        var tileIndex = Math.floor(address / 16);
        var leftOver = address%16;
        if (leftOver<8) {
            this.ptTile[tileIndex].setScanline(
                leftOver,
                value,
                this.vramMem[address+8]
            );
        }
        else {
            this.ptTile[tileIndex].setScanline(
                leftOver-8,
                this.vramMem[address-8],
                value
            );
        }
    },

    // Updates the internal name table buffers
    // with this new byte.
    nameTableWrite: function(index, address, value){
        this.nameTable[index].tile[address] = value;
        
        // Update Sprite #0 hit:
        //updateSpr0Hit();
        this.checkSprite0(this.scanline-20);
    },
    
    // Updates the internal pattern
    // table buffers with this new attribute
    // table byte.
    attribTableWrite: function(index, address, value){
        this.nameTable[index].writeAttrib(address,value);
    },
    
    // Updates the internally buffered sprite
    // data with this new byte of info.
    spriteRamWriteUpdate: function(address, value) {
        var tIndex = Math.floor(address / 4);
        
        if (tIndex === 0) {
            //updateSpr0Hit();
            this.checkSprite0(this.scanline - 20);
        }
        
        if (address % 4 === 0) {
            // Y coordinate
            this.sprY[tIndex] = value;
        }
        else if (address % 4 == 1) {
            // Tile index
            this.sprTile[tIndex] = value;
        }
        else if (address % 4 == 2) {
            // Attributes
            this.vertFlip[tIndex] = ((value & 0x80) !== 0);
            this.horiFlip[tIndex] = ((value & 0x40) !==0 );
            this.bgPriority[tIndex] = ((value & 0x20) !== 0);
            this.sprCol[tIndex] = (value & 3) << 2;
            
        }
        else if (address % 4 == 3) {
            // X coordinate
            this.sprX[tIndex] = value;
        }
    },
    
    doNMI: function() {
        // Set VBlank flag:
        this.setStatusFlag(this.STATUS_VBLANK,true);
        //nes.getCpu().doNonMaskableInterrupt();
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NMI);
    },
    
    JSON_PROPERTIES: [
        // Memory
        'vramMem', 'spriteMem',
        // Counters
        'cntFV', 'cntV', 'cntH', 'cntVT', 'cntHT',
        // Registers
        'regFV', 'regV', 'regH', 'regVT', 'regHT', 'regFH', 'regS',
        // VRAM addr
        'vramAddress', 'vramTmpAddress',
        // Control/Status registers
        'f_nmiOnVblank', 'f_spriteSize', 'f_bgPatternTable', 'f_spPatternTable', 
        'f_addrInc', 'f_nTblAddress', 'f_color', 'f_spVisibility', 
        'f_bgVisibility', 'f_spClipping', 'f_bgClipping', 'f_dispType',
        // VRAM I/O
        'vramBufferedReadValue', 'firstWrite',
        // Mirroring
        'currentMirroring', 'vramMirrorTable', 'ntable1',
        // SPR-RAM I/O
        'sramAddress',
        // Sprites. Most sprite data is rebuilt from spriteMem
        'hitSpr0',
        // Palettes
        'sprPalette', 'imgPalette',
        // Rendering progression
        'curX', 'scanline', 'lastRenderedScanline', 'curNt', 'scantile',
        // Used during rendering
        'attrib', 'buffer', 'bgbuffer', 'pixrendered',
        // Misc
        'requestEndFrame', 'nmiOk', 'dummyCycleToggle', 'nmiCounter', 
        'validTileData', 'scanlineAlreadyRendered'
    ],
    
    toJSON: function() {
        var i;
        var state = JSNES.Utils.toJSON(this);
        
        state.nameTable = [];
        for (i = 0; i < this.nameTable.length; i++) {
            state.nameTable[i] = this.nameTable[i].toJSON();
        }
        
        state.ptTile = [];
        for (i = 0; i < this.ptTile.length; i++) {
            state.ptTile[i] = this.ptTile[i].toJSON();
        }
        
        return state;
    },
    
    fromJSON: function(state) {
        var i;
        
        JSNES.Utils.fromJSON(this, state);
        
        for (i = 0; i < this.nameTable.length; i++) {
            this.nameTable[i].fromJSON(state.nameTable[i]);
        }
        
        for (i = 0; i < this.ptTile.length; i++) {
            this.ptTile[i].fromJSON(state.ptTile[i]);
        }
        
        // Sprite data:
        for (i = 0; i < this.spriteMem.length; i++) {
            this.spriteRamWriteUpdate(i, this.spriteMem[i]);
        }
    }
};

JSNES.PPU.NameTable = function(width, height, name) {   
    this.width = width;
    this.height = height;
    this.name = name;
    
    this.tile = new Array(width*height);
    this.attrib = new Array(width*height);
};

JSNES.PPU.NameTable.prototype = {
    getTileIndex: function(x, y){
        return this.tile[y*this.width+x];
    },

    getAttrib: function(x, y){
        return this.attrib[y*this.width+x];
    },

    writeAttrib: function(index, value){
        var basex = (index % 8) * 4;
        var basey = Math.floor(index / 8) * 4;
        var add;
        var tx, ty;
        var attindex;
    
        for (var sqy=0;sqy<2;sqy++) {
            for (var sqx=0;sqx<2;sqx++) {
                add = (value>>(2*(sqy*2+sqx)))&3;
                for (var y=0;y<2;y++) {
                    for (var x=0;x<2;x++) {
                        tx = basex+sqx*2+x;
                        ty = basey+sqy*2+y;
                        attindex = ty*this.width+tx;
                        this.attrib[ty*this.width+tx] = (add<<2)&12;
                    }
                }
            }
        }
    },
    
    toJSON: function() {
        return {
            'tile': this.tile,
            'attrib': this.attrib
        };
    },
    
    fromJSON: function(s) {
        this.tile = s.tile;
        this.attrib = s.attrib;
    }
};


JSNES.PPU.PaletteTable = function() {
    this.curTable = new Array(64);
    this.emphTable = new Array(8);
    this.currentEmph = -1;
};

JSNES.PPU.PaletteTable.prototype = {
    reset: function() {
        this.setEmphasis(0);
    },
    
    loadNTSCPalette: function() {
        this.curTable = [0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000, 0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000, 0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000, 0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000];
        this.makeTables();
        this.setEmphasis(0);
    },
    
    loadPALPalette: function() {
        this.curTable = [0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000, 0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000, 0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000, 0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000];
        this.makeTables();
        this.setEmphasis(0);
    },
    
    makeTables: function(){
        var r, g, b, col, i, rFactor, gFactor, bFactor;
        
        // Calculate a table for each possible emphasis setting:
        for (var emph = 0; emph < 8; emph++) {
            
            // Determine color component factors:
            rFactor = 1.0;
            gFactor = 1.0;
            bFactor = 1.0;
            
            if ((emph & 1) !== 0) {
                rFactor = 0.75;
                bFactor = 0.75;
            }
            if ((emph & 2) !== 0) {
                rFactor = 0.75;
                gFactor = 0.75;
            }
            if ((emph & 4) !== 0) {
                gFactor = 0.75;
                bFactor = 0.75;
            }
            
            this.emphTable[emph] = new Array(64);
            
            // Calculate table:
            for (i = 0; i < 64; i++) {
                col = this.curTable[i];
                r = Math.floor(this.getRed(col) * rFactor);
                g = Math.floor(this.getGreen(col) * gFactor);
                b = Math.floor(this.getBlue(col) * bFactor);
                this.emphTable[emph][i] = this.getRgb(r, g, b);
            }
        }
    },
    
    setEmphasis: function(emph){
        if (emph != this.currentEmph) {
            this.currentEmph = emph;
            for (var i = 0; i < 64; i++) {
                this.curTable[i] = this.emphTable[emph][i];
            }
        }
    },
    
    getEntry: function(yiq){
        return this.curTable[yiq];
    },
    
    getRed: function(rgb){
        return (rgb>>16)&0xFF;
    },
    
    getGreen: function(rgb){
        return (rgb>>8)&0xFF;
    },
    
    getBlue: function(rgb){
        return rgb&0xFF;
    },
    
    getRgb: function(r, g, b){
        return ((r<<16)|(g<<8)|(b));
    },
    
    loadDefaultPalette: function(){
        this.curTable[ 0] = this.getRgb(117,117,117);
        this.curTable[ 1] = this.getRgb( 39, 27,143);
        this.curTable[ 2] = this.getRgb(  0,  0,171);
        this.curTable[ 3] = this.getRgb( 71,  0,159);
        this.curTable[ 4] = this.getRgb(143,  0,119);
        this.curTable[ 5] = this.getRgb(171,  0, 19);
        this.curTable[ 6] = this.getRgb(167,  0,  0);
        this.curTable[ 7] = this.getRgb(127, 11,  0);
        this.curTable[ 8] = this.getRgb( 67, 47,  0);
        this.curTable[ 9] = this.getRgb(  0, 71,  0);
        this.curTable[10] = this.getRgb(  0, 81,  0);
        this.curTable[11] = this.getRgb(  0, 63, 23);
        this.curTable[12] = this.getRgb( 27, 63, 95);
        this.curTable[13] = this.getRgb(  0,  0,  0);
        this.curTable[14] = this.getRgb(  0,  0,  0);
        this.curTable[15] = this.getRgb(  0,  0,  0);
        this.curTable[16] = this.getRgb(188,188,188);
        this.curTable[17] = this.getRgb(  0,115,239);
        this.curTable[18] = this.getRgb( 35, 59,239);
        this.curTable[19] = this.getRgb(131,  0,243);
        this.curTable[20] = this.getRgb(191,  0,191);
        this.curTable[21] = this.getRgb(231,  0, 91);
        this.curTable[22] = this.getRgb(219, 43,  0);
        this.curTable[23] = this.getRgb(203, 79, 15);
        this.curTable[24] = this.getRgb(139,115,  0);
        this.curTable[25] = this.getRgb(  0,151,  0);
        this.curTable[26] = this.getRgb(  0,171,  0);
        this.curTable[27] = this.getRgb(  0,147, 59);
        this.curTable[28] = this.getRgb(  0,131,139);
        this.curTable[29] = this.getRgb(  0,  0,  0);
        this.curTable[30] = this.getRgb(  0,  0,  0);
        this.curTable[31] = this.getRgb(  0,  0,  0);
        this.curTable[32] = this.getRgb(255,255,255);
        this.curTable[33] = this.getRgb( 63,191,255);
        this.curTable[34] = this.getRgb( 95,151,255);
        this.curTable[35] = this.getRgb(167,139,253);
        this.curTable[36] = this.getRgb(247,123,255);
        this.curTable[37] = this.getRgb(255,119,183);
        this.curTable[38] = this.getRgb(255,119, 99);
        this.curTable[39] = this.getRgb(255,155, 59);
        this.curTable[40] = this.getRgb(243,191, 63);
        this.curTable[41] = this.getRgb(131,211, 19);
        this.curTable[42] = this.getRgb( 79,223, 75);
        this.curTable[43] = this.getRgb( 88,248,152);
        this.curTable[44] = this.getRgb(  0,235,219);
        this.curTable[45] = this.getRgb(  0,  0,  0);
        this.curTable[46] = this.getRgb(  0,  0,  0);
        this.curTable[47] = this.getRgb(  0,  0,  0);
        this.curTable[48] = this.getRgb(255,255,255);
        this.curTable[49] = this.getRgb(171,231,255);
        this.curTable[50] = this.getRgb(199,215,255);
        this.curTable[51] = this.getRgb(215,203,255);
        this.curTable[52] = this.getRgb(255,199,255);
        this.curTable[53] = this.getRgb(255,199,219);
        this.curTable[54] = this.getRgb(255,191,179);
        this.curTable[55] = this.getRgb(255,219,171);
        this.curTable[56] = this.getRgb(255,231,163);
        this.curTable[57] = this.getRgb(227,255,163);
        this.curTable[58] = this.getRgb(171,243,191);
        this.curTable[59] = this.getRgb(179,255,207);
        this.curTable[60] = this.getRgb(159,255,243);
        this.curTable[61] = this.getRgb(  0,  0,  0);
        this.curTable[62] = this.getRgb(  0,  0,  0);
        this.curTable[63] = this.getRgb(  0,  0,  0);
        
        this.makeTables();
        this.setEmphasis(0);
    }
};

JSNES.PPU.Tile = function() {
    // Tile data:
    this.pix = new Array(64);
    
    this.fbIndex = null;
    this.tIndex = null;
    this.x = null;
    this.y = null;
    this.w = null;
    this.h = null;
    this.incX = null;
    this.incY = null;
    this.palIndex = null;
    this.tpri = null;
    this.c = null;
    this.initialized = false;
    this.opaque = new Array(8);
};
    
JSNES.PPU.Tile.prototype = {
    setBuffer: function(scanline){
        for (this.y=0;this.y<8;this.y++) {
            this.setScanline(this.y,scanline[this.y],scanline[this.y+8]);
        }
    },
    
    setScanline: function(sline, b1, b2){
        this.initialized = true;
        this.tIndex = sline<<3;
        for (this.x = 0; this.x < 8; this.x++) {
            this.pix[this.tIndex + this.x] = ((b1 >> (7 - this.x)) & 1) +
                    (((b2 >> (7 - this.x)) & 1) << 1);
            if(this.pix[this.tIndex+this.x] === 0) {
                this.opaque[sline] = false;
            }
        }
    },
    
    render: function(buffer, srcx1, srcy1, srcx2, srcy2, dx, dy, palAdd, palette, flipHorizontal, flipVertical, pri, priTable) {

        if (dx<-7 || dx>=256 || dy<-7 || dy>=240) {
            return;
        }

        this.w=srcx2-srcx1;
        this.h=srcy2-srcy1;
    
        if (dx<0) {
            srcx1-=dx;
        }
        if (dx+srcx2>=256) {
            srcx2=256-dx;
        }
    
        if (dy<0) {
            srcy1-=dy;
        }
        if (dy+srcy2>=240) {
            srcy2=240-dy;
        }
    
        if (!flipHorizontal && !flipVertical) {
        
            this.fbIndex = (dy<<8)+dx;
            this.tIndex = 0;
            for (this.y=0;this.y<8;this.y++) {
                for (this.x=0;this.x<8;this.x++) {
                    if (this.x>=srcx1 && this.x<srcx2 && this.y>=srcy1 && this.y<srcy2) {
                        this.palIndex = this.pix[this.tIndex];
                        this.tpri = priTable[this.fbIndex];
                        if (this.palIndex!==0 && pri<=(this.tpri&0xFF)) {
                            //console.log("Rendering upright tile to buffer");
                            buffer[this.fbIndex] = palette[this.palIndex+palAdd];
                            this.tpri = (this.tpri&0xF00)|pri;
                            priTable[this.fbIndex] =this.tpri;
                        }
                    }
                    this.fbIndex++;
                    this.tIndex++;
                }
                this.fbIndex-=8;
                this.fbIndex+=256;
            }
        
        }else if (flipHorizontal && !flipVertical) {
        
            this.fbIndex = (dy<<8)+dx;
            this.tIndex = 7;
            for (this.y=0;this.y<8;this.y++) {
                for (this.x=0;this.x<8;this.x++) {
                    if (this.x>=srcx1 && this.x<srcx2 && this.y>=srcy1 && this.y<srcy2) {
                        this.palIndex = this.pix[this.tIndex];
                        this.tpri = priTable[this.fbIndex];
                        if (this.palIndex!==0 && pri<=(this.tpri&0xFF)) {
                            buffer[this.fbIndex] = palette[this.palIndex+palAdd];
                            this.tpri = (this.tpri&0xF00)|pri;
                            priTable[this.fbIndex] =this.tpri;
                        }
                    }
                    this.fbIndex++;
                    this.tIndex--;
                }
                this.fbIndex-=8;
                this.fbIndex+=256;
                this.tIndex+=16;
            }
        
        }
        else if(flipVertical && !flipHorizontal) {
        
            this.fbIndex = (dy<<8)+dx;
            this.tIndex = 56;
            for (this.y=0;this.y<8;this.y++) {
                for (this.x=0;this.x<8;this.x++) {
                    if (this.x>=srcx1 && this.x<srcx2 && this.y>=srcy1 && this.y<srcy2) {
                        this.palIndex = this.pix[this.tIndex];
                        this.tpri = priTable[this.fbIndex];
                        if (this.palIndex!==0 && pri<=(this.tpri&0xFF)) {
                            buffer[this.fbIndex] = palette[this.palIndex+palAdd];
                            this.tpri = (this.tpri&0xF00)|pri;
                            priTable[this.fbIndex] =this.tpri;
                        }
                    }
                    this.fbIndex++;
                    this.tIndex++;
                }
                this.fbIndex-=8;
                this.fbIndex+=256;
                this.tIndex-=16;
            }
        
        }
        else {
            this.fbIndex = (dy<<8)+dx;
            this.tIndex = 63;
            for (this.y=0;this.y<8;this.y++) {
                for (this.x=0;this.x<8;this.x++) {
                    if (this.x>=srcx1 && this.x<srcx2 && this.y>=srcy1 && this.y<srcy2) {
                        this.palIndex = this.pix[this.tIndex];
                        this.tpri = priTable[this.fbIndex];
                        if (this.palIndex!==0 && pri<=(this.tpri&0xFF)) {
                            buffer[this.fbIndex] = palette[this.palIndex+palAdd];
                            this.tpri = (this.tpri&0xF00)|pri;
                            priTable[this.fbIndex] =this.tpri;
                        }
                    }
                    this.fbIndex++;
                    this.tIndex--;
                }
                this.fbIndex-=8;
                this.fbIndex+=256;
            }
        
        }
    
    },
    
    isTransparent: function(x, y){
        return (this.pix[(y << 3) + x] === 0);
    },
    
    toJSON: function() {
        return {
            'opaque': this.opaque,
            'pix': this.pix
        };
    },

    fromJSON: function(s) {
        this.opaque = s.opaque;
        this.pix = s.pix;
    }
};

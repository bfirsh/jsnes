function PPU(nes) {
    this.nes = nes;
    this.timer = null;
    this.ppuMem = null;
    this.sprMem = null;
    
    // Rendering Options:
    this.showSpr0Hit = false;
    this.showSoundBuffer = false;
    this.clipToTvSize = true;
    
    
    // Control Flags Register 1:
    this.f_nmiOnVblank = null;    // NMI on VBlank. 0=disable, 1=enable
    this.f_spriteSize = null;     // Sprite size. 0=8x8, 1=8x16
    this.f_bgPatternTable = null; // Background Pattern Table address. 0=0x0000,1=0x1000
    this.f_spPatternTable = null; // Sprite Pattern Table address. 0=0x0000,1=0x1000
    this.f_addrInc = null;        // PPU Address Increment. 0=1,1=32
    this.f_nTblAddress = null;    // Name Table Address. 0=0x2000,1=0x2400,2=0x2800,3=0x2C00
    
    
    // Control Flags Register 2:
    this.f_color = null;             // Background color. 0=black, 1=blue, 2=green, 4=red
    this.f_spVisibility = null;   // Sprite visibility. 0=not displayed,1=displayed
    this.f_bgVisibility = null;   // Background visibility. 0=Not Displayed,1=displayed
    this.f_spClipping = null;     // Sprite clipping. 0=Sprites invisible in left 8-pixel column,1=No clipping
    this.f_bgClipping = null;     // Background clipping. 0=BG invisible in left 8-pixel column, 1=No clipping
    this.f_dispType = null;       // Display type. 0=color, 1=monochrome


    // Status flags:
    this.STATUS_VRAMWRITE = 4;
    this.STATUS_SLSPRITECOUNT = 5;
    this.STATUS_SPRITE0HIT = 6;
    this.STATUS_VBLANK = 7;
    
    
    // VRAM I/O:
    this.vramAddress = null;
    this.vramTmpAddress = null;
    this.vramBufferedReadValue = null;
    this.firstWrite=true;       // VRAM/Scroll Hi/Lo latch
    
    
    this.vramMirrorTable = null;            // Mirroring Lookup Table.
    this.i = null;
    
    // SPR-RAM I/O:
    this.sramAddress = null; // 8-bit only.
    
    // Counters:
    this.cntFV = null;
    this.cntV = null;
    this.cntH = null;
    this.cntVT = null;
    this.cntHT = null;
    
    // Registers:
    this.regFV = null;
    this.regV = null;
    this.regH = null;
    this.regVT = null;
    this.regHT = null;
    this.regFH = null;
    this.regS = null;
    
    this.curX = null;
    this.scanline = null;
    this.lastRenderedScanline = null;
    this.mapperIrqCounter = null;
    
    
    // Sprite data:
    this.sprX = null;               // X coordinate
    this.sprY = null;               // Y coordinate
    this.sprTile = null;            // Tile Index (into pattern table)
    this.sprCol = null;         // Upper two bits of color
    this.vertFlip = null;       // Vertical Flip
    this.horiFlip = null;       // Horizontal Flip
    this.bgPriority = null; // Background priority
    this.spr0HitX = null;   // Sprite #0 hit X coordinate
    this.spr0HitY = null;   // Sprite #0 hit Y coordinate
    this.hitSpr0 = null;
    
    // Tiles:
    this.ptTile = null;
    
    
    // Name table data:
    this.ntable1 = new Array(4);
    this.nameTable = null;
    this.currentMirroring=-1;
    
    // Palette data:
    this.sprPalette = new Array(16);
    this.imgPalette = new Array(16);
    
    
    // Misc:
    this.scanlineAlreadyRendered = null;
    this.requestEndFrame = null;
    this.nmiOk = null;
    this.nmiCounter = null;
    this.tmp = null;
    this.dummyCycleToggle = null;
    
    // Vars used when updating regs/address:
    this.address = null;
    this.b1 = null;
    this.b2 = null;
    
    
    
    
    // Variables used when rendering:
    this.attrib = new Array(32);
    this.bgbuffer = new Array(256*240);
    this.pixrendered = new Array(256*240);
    this.spr0dummybuffer = new Array(256*240);
    this.dummyPixPriTable = new Array(256*240);
    this.oldFrame = new Array(256*240);
    this.buffer = new Array(256*240);
    this.tpix = null;
    
    this.scanlineChanged = Array(240);
    this.requestRenderAll=false;
    this.validTileData = null;
    this.att = null;
    
    this.scantile = new Array(32);
    this.t = null;
    
    
    
    
    // These are temporary variables used in rendering and sound procedures.
    // Their states outside of those procedures can be ignored.
    this.curNt = null;
    this.destIndex = null;
    this.x = null;
    this.y = null;
    this.sx = null;
    this.si = null;
    this.ei = null;
    this.tile = null;
    this.col = null;
    this.baseTile = null;
    this.tscanoffset = null;
    this.srcy1 = null;
    this.srcy2 = null;
    this.bufferSize = null;
    this.available = null;
    this.scale = null;
    
    this.init = function() {
        // Get the memory:
        this.ppuMem = this.nes.ppuMem;
        this.sprMem = this.nes.sprMem;
        
        this.updateControlReg1(0);
        this.updateControlReg2(0);
        
        // Initialize misc vars:
        this.scanline = 0;
        
        // Create sprite arrays:
        this.sprX = new Array(64);
        this.sprY = new Array(64);
        this.sprTile = new Array(64);
        this.sprCol = new Array(64);
        this.vertFlip = new Array(64);
        this.horiFlip = new Array(64);
        this.bgPriority = new Array(64);
        
        // Create pattern table tile buffers:
        if(this.ptTile==null){
            this.ptTile = new Array(512);
            for(var i=0;i<512;i++){
                this.ptTile[i] = new Tile();
            }
        }
        
        // Create nametable buffers:
        this.nameTable = new Array(4);
        for(var i=0;i<4;i++){
            this.nameTable[i] = new NameTable(32,32,"Nt"+i);
        }
        
        // Initialize mirroring lookup table:
        this.vramMirrorTable = new Array(0x8000);
        for(var i=0;i<0x8000;i++){
            this.vramMirrorTable[i] = i;
        }
        
        this.lastRenderedScanline = -1;
        this.curX = 0;
        
        // Initialize old frame buffer:
        for(var i=0;i<this.oldFrame.length;i++){
            this.oldFrame[i]=-1;
        }
    }
    
    
    // Sets Nametable mirroring.
    this.setMirroring = function(mirroring){
    
        if(mirroring == this.currentMirroring){
            return;
        }
        
        this.currentMirroring = mirroring;
        this.triggerRendering();
    
        // Remove mirroring:
        if(this.vramMirrorTable==null){
            this.vramMirrorTable = new Array(0x8000);
        }
        for(var i=0;i<0x8000;i++){
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
    
        if(mirroring == this.nes.rom.HORIZONTAL_MIRRORING){
            
            
            // Horizontal mirroring.
            
            this.ntable1[0] = 0;
            this.ntable1[1] = 0;
            this.ntable1[2] = 1;
            this.ntable1[3] = 1;
            
            this.defineMirrorRegion(0x2400,0x2000,0x400);
            this.defineMirrorRegion(0x2c00,0x2800,0x400);
            
        }else if(mirroring == this.nes.rom.VERTICAL_MIRRORING){
            
            // Vertical mirroring.
            
            this.ntable1[0] = 0;
            this.ntable1[1] = 1;
            this.ntable1[2] = 0;
            this.ntable1[3] = 1;
            
            this.defineMirrorRegion(0x2800,0x2000,0x400);
            this.defineMirrorRegion(0x2c00,0x2400,0x400);
            
        }else if(mirroring == this.nes.rom.SINGLESCREEN_MIRRORING){
            
            // Single Screen mirroring
            
            this.ntable1[0] = 0;
            this.ntable1[1] = 0;
            this.ntable1[2] = 0;
            this.ntable1[3] = 0;
            
            this.defineMirrorRegion(0x2400,0x2000,0x400);
            this.defineMirrorRegion(0x2800,0x2000,0x400);
            this.defineMirrorRegion(0x2c00,0x2000,0x400);
            
        }else if(mirroring == this.nes.rom.SINGLESCREEN_MIRRORING2){
            
            
            this.ntable1[0] = 1;
            this.ntable1[1] = 1;
            this.ntable1[2] = 1;
            this.ntable1[3] = 1;
            
            this.defineMirrorRegion(0x2400,0x2400,0x400);
            this.defineMirrorRegion(0x2800,0x2400,0x400);
            this.defineMirrorRegion(0x2c00,0x2400,0x400);
            
        }else{
            
            // Assume Four-screen mirroring.
            
            this.ntable1[0] = 0;
            this.ntable1[1] = 1;
            this.ntable1[2] = 2;
            this.ntable1[3] = 3;
            
        }   
        
    }
    
    
    // Define a mirrored area in the address lookup table.
    // Assumes the regions don't overlap.
    // The 'to' region is the region that is physically in memory.
    this.defineMirrorRegion = function(fromStart, toStart, size){
        
        for(var i=0;i<size;i++){
            this.vramMirrorTable[fromStart+i] = toStart+i;
        }
        
    }
    
    this.startVBlank = function(){
        
        // Do NMI:
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NMI);
        
        // Make sure everything is rendered:
        if(this.lastRenderedScanline < 239){
            this.renderFramePartially(
                this.lastRenderedScanline+1,240-this.lastRenderedScanline
            );
        }
        
        // End frame:
        this.endFrame();
        
        // Reset scanline counter:
        this.lastRenderedScanline = -1;
        
        
    }
    
    this.endScanline = function(){
        switch (this.scanline) {
            case 19:
                // Dummy scanline.
                // May be variable length:
                if(this.dummyCycleToggle){

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

                if(this.f_bgVisibility == 1 || this.f_spVisibility==1){

                    // Update counters:
                    this.cntFV = this.regFV;
                    this.cntV = this.regV;
                    this.cntH = this.regH;
                    this.cntVT = this.regVT;
                    this.cntHT = this.regHT;

                    if(this.f_bgVisibility==1){
                        // Render dummy scanline:
                        this.renderBgScanline(false,0);
                    }   

                }

                if(this.f_bgVisibility==1 && this.f_spVisibility==1){

                    // Check sprite 0 hit for first scanline:
                    this.checkSprite0(0);

                }

                if(this.f_bgVisibility==1 || this.f_spVisibility==1){
                    // Clock mapper IRQ Counter:
                    this.nes.memMapper.clockIrqCounter();
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
                if(this.scanline>=21 && this.scanline<=260){

                    // Render normally:
                    if(this.f_bgVisibility == 1){

                        if(!this.scanlineAlreadyRendered){
                            // update scroll:
                            this.cntHT = this.regHT;
                            this.cntH = this.regH;
                            this.renderBgScanline(true,this.scanline+1-21);
                        }
                        this.scanlineAlreadyRendered=false;

                        // Check for sprite 0 (next scanline):
                        if(!this.hitSpr0 && this.f_spVisibility==1){
                            if(this.sprX[0]>=-7 && this.sprX[0]<256 && this.sprY[0]+1<=(this.scanline-20) && (this.sprY[0]+1+(this.f_spriteSize==0?8:16))>=(this.scanline-20)){

                                if(this.checkSprite0(
                                            this.scanline-20)){
                                    //console.log("found spr0. curscan="+this.scanline+" hitscan="+this.spr0HitY);
                                    this.hitSpr0 = true;
                                }
                            }
                        }

                    }

                    if(this.f_bgVisibility==1 || this.f_spVisibility==1){
                        // Clock mapper IRQ Counter:
                        this.nes.memMapper.clockIrqCounter();
                    }
                }
        }
        
        this.scanline++;
        this.regsToAddress();
        this.cntsToAddress();
        
    }
    
    
    this.startFrame = function(){
        
        // Set background color:
        var bgColor=0;
        
        if(this.f_dispType == 0){
            
            // Color display.
            // f_color determines color emphasis.
            // Use first entry of image palette as BG color.
            bgColor = this.imgPalette[0];
            
        }else{
            
            // Monochrome display.
            // f_color determines the bg color.
            switch(this.f_color){
                case 0:{
                    // Black
                    bgColor = 0x00000;
                    break;
                }
                case 1:{
                    // Green
                    bgColor = 0x00FF00;
                }
                case 2:{
                    // Blue
                    bgColor = 0xFF0000;
                }
                case 3:{
                    // Invalid. Use black.
                    bgColor = 0x000000;
                }
                case 4:{
                    // Red
                    bgColor = 0x0000FF;
                }
                default:{
                    // Invalid. Use black.
                    bgColor = 0x0;
                }   
            }
            
        }
        
        for(var i=0;i<this.buffer.length;i++) {
            this.writePixel(i, bgColor);
        }
        for(var i=0;i<this.pixrendered.length;i++) {
            this.pixrendered[i]=65;
        }
        
    }
    
    this.endFrame = function(){
        
        // Draw spr#0 hit coordinates:
        if(this.showSpr0Hit){
            // Spr 0 position:
            if(this.sprX[0]>=0 && this.sprX[0]<256 && this.sprY[0]>=0 && this.sprY[0]<240){
                for(var i=0;i<256;i++){ 
                    this.writePixel((this.sprY[0]<<8)+i, 0xFF5555);
                }
                for(var i=0;i<240;i++){
                    this.writePixel((i<<8)+this.sprX[0], 0xFF5555);
                }
            }
            // Hit position:
            if(this.spr0HitX>=0 && this.spr0HitX<256 && this.spr0HitY>=0 && this.spr0HitY<240){
                for(var i=0;i<256;i++){ 
                    this.writePixel((this.spr0HitY<<8)+i, 0x55FF55);
                }
                for(var i=0;i<240;i++){
                    this.writePixel((i<<8)+this.spr0HitX, 0x55FF55);
                }
            }
        }
        
        // This is a bit lazy..
        // if either the sprites or the background should be clipped,
        // both are clipped after rendering is finished.
        if(this.clipToTvSize || this.f_bgClipping==0 || this.f_spClipping==0){
            // Clip left 8-pixels column:
            for(var y=0;y<240;y++){
                for(var x=0;x<8;x++){
                    this.writePixel((y<<8)+x, 0);
                }
            }
        }
        
        if(this.clipToTvSize){
            // Clip right 8-pixels column too:
            for(var y=0;y<240;y++){
                for(var x=0;x<8;x++){
                    this.writePixel((y<<8)+255-x, 0);
                }
            }
        }
        
        // Clip top and bottom 8 pixels:
        if(this.clipToTvSize){
            for(var y=0;y<8;y++){
                for(var x=0;x<256;x++){
                    this.writePixel((y<<8)+x, 0);
                    this.writePixel(((239-y)<<8)+x, 0);
                }
            }
        }
        
    }
    
    this.updateControlReg1 = function(value){
        
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
        
    }
    
    
    
    this.updateControlReg2 = function(value){
        
        this.triggerRendering();
        
        this.f_color =       (value>>5)&7;
        this.f_spVisibility = (value>>4)&1;
        this.f_bgVisibility = (value>>3)&1;
        this.f_spClipping =   (value>>2)&1;
        this.f_bgClipping =   (value>>1)&1;
        this.f_dispType =      value&1;
        
        if(this.f_dispType == 0){
            this.nes.palTable.setEmphasis(this.f_color);
        }
        this.updatePalettes();
        
    }
    
    
    this.setStatusFlag = function(flag, value){
        var n = 1<<flag;
        this.nes.cpuMem[0x2002] = 
            ((this.nes.cpuMem[0x2002]&(255-n))|(value?n:0));
    }
    
    // CPU Register $2002:
    // Read the Status Register.
    this.readStatusRegister = function(){
        
        this.tmp = this.nes.cpuMem[0x2002];
        
        // Reset scroll & VRAM Address toggle:
        this.firstWrite = true;
        
        // Clear VBlank flag:
        this.setStatusFlag(this.STATUS_VBLANK,false);
        
        // Fetch status data:
        return this.tmp;
        
    }
    
    
    
    // CPU Register $2003:
    // Write the SPR-RAM address that is used for sramWrite (Register 0x2004 in CPU memory map)
    this.writeSRAMAddress = function(address){
        this.sramAddress = address;
    }
    
    
    // CPU Register $2004 (R):
    // Read from SPR-RAM (Sprite RAM).
    // The address should be set first.
    this.sramLoad = function(){
        /*short tmp = sprMem.load(sramAddress);
        sramAddress++; // Increment address
        sramAddress%=0x100;
        return tmp;*/
        return this.sprMem[this.sramAddress]
    }
    
    
    // CPU Register $2004 (W):
    // Write to SPR-RAM (Sprite RAM).
    // The address should be set first.
    this.sramWrite = function(value){
        this.sprMem[this.sramAddress] = value;
        this.spriteRamWriteUpdate(this.sramAddress,value);
        this.sramAddress++; // Increment address
        this.sramAddress%=0x100;
    }
    
    
    // CPU Register $2005:
    // Write to scroll registers.
    // The first write is the vertical offset, the second is the
    // horizontal offset:
    this.scrollWrite = function(value){
        this.triggerRendering();
        
        if(this.firstWrite){
            // First write, horizontal scroll:
            this.regHT = (value>>3)&31;
            this.regFH = value&7;
            
        }else{
            
            // Second write, vertical scroll:
            this.regFV = value&7;
            this.regVT = (value>>3)&31;
            
        }
        this.firstWrite = !this.firstWrite;
        
    }
    
    
    
    // CPU Register $2006:
    // Sets the adress used when reading/writing from/to VRAM.
    // The first write sets the high byte, the second the low byte.
    this.writeVRAMAddress = function(address){
        
        if(this.firstWrite){
            
            this.regFV = (address>>4)&3;
            this.regV = (address>>3)&1;
            this.regH = (address>>2)&1;
            this.regVT = (this.regVT&7) | ((address&3)<<3);
            
        }else{
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
        if(this.vramAddress < 0x2000){
            this.nes.memMapper.latchAccess(this.vramAddress);
        }   
    }
    
    
    // CPU Register $2007(R):
    // Read from PPU memory. The address should be set first.
    this.vramLoad = function(){
        
        this.cntsToAddress();
        this.regsToAddress();
        
        // If address is in range 0x0000-0x3EFF, return buffered values:
        if(this.vramAddress <= 0x3EFF){
            
            var tmp = this.vramBufferedReadValue;
        
            // Update buffered value:
            if(this.vramAddress < 0x2000){
                this.vramBufferedReadValue = this.ppuMem[this.vramAddress];
            }else{
                this.vramBufferedReadValue = this.mirroredLoad(this.vramAddress);
            }
            
            // Mapper latch access:
            if(this.vramAddress < 0x2000){
                this.nes.memMapper.latchAccess(this.vramAddress);
            }
            
            // Increment by either 1 or 32, depending on d2 of Control Register 1:
            this.vramAddress += (this.f_addrInc==1?32:1);
            
            this.cntsFromAddress();
            this.regsFromAddress();
            return tmp; // Return the previous buffered value.
            
        }
            
        // No buffering in this mem range. Read normally.
        var tmp = this.mirroredLoad(this.vramAddress);
        
        // Increment by either 1 or 32, depending on d2 of Control Register 1:
        this.vramAddress += (this.f_addrInc==1?32:1); 
        
        this.cntsFromAddress();
        this.regsFromAddress();
        
        return tmp;
        
    }
    
    // CPU Register $2007(W):
    // Write to PPU memory. The address should be set first.
    this.vramWrite = function(value){
        
        this.triggerRendering();
        this.cntsToAddress();
        this.regsToAddress();
        
        if(this.vramAddress >= 0x2000){
            // Mirroring is used.
            this.mirroredWrite(this.vramAddress,value);
        }else{
            
            // Write normally.
            this.writeMem(this.vramAddress,value);
            
            // Invoke mapper latch:
            this.nes.memMapper.latchAccess(this.vramAddress);
            
        }
        
        // Increment by either 1 or 32, depending on d2 of Control Register 1:
        this.vramAddress += (this.f_addrInc==1?32:1);
        this.regsFromAddress();
        this.cntsFromAddress();
        
    }
    
    // CPU Register $4014:
    // Write 256 bytes of main memory
    // into Sprite RAM.
    this.sramDMA = function(value){
        var baseAddress = value * 0x100;
        var data;
        for(var i=this.sramAddress;i<256;i++){
            data = this.nes.cpuMem[baseAddress+i];
            this.sprMem[i] = data;
            this.spriteRamWriteUpdate(i, data);
        }
        
        this.nes.cpu.haltCycles(513);
        
    }
    
    // Updates the scroll registers from a new VRAM address.
    this.regsFromAddress = function(){
        
        this.address = (this.vramTmpAddress>>8)&0xFF;
        this.regFV = (this.address>>4)&7;
        this.regV = (this.address>>3)&1;
        this.regH = (this.address>>2)&1;
        this.regVT = (this.regVT&7) | ((this.address&3)<<3);
        
        this.address = this.vramTmpAddress&0xFF;
        this.regVT = (this.regVT&24) | ((this.address>>5)&7);
        this.regHT = this.address&31;
    }
    
    // Updates the scroll registers from a new VRAM address.
    this.cntsFromAddress = function(){
        
        this.address = (this.vramAddress>>8)&0xFF;
        this.cntFV = (this.address>>4)&3;
        this.cntV = (this.address>>3)&1;
        this.cntH = (this.address>>2)&1;
        this.cntVT = (this.cntVT&7) | ((this.address&3)<<3);        
        
        this.address = this.vramAddress&0xFF;
        this.cntVT = (this.cntVT&24) | ((this.address>>5)&7);
        this.cntHT = this.address&31;
        
    }
    
    this.regsToAddress = function(){
        this.b1  = (this.regFV&7)<<4;
        this.b1 |= (this.regV&1)<<3;
        this.b1 |= (this.regH&1)<<2;
        this.b1 |= (this.regVT>>3)&3;
        
        this.b2  = (this.regVT&7)<<5;
        this.b2 |= this.regHT&31;
        
        this.vramTmpAddress = ((this.b1<<8) | this.b2)&0x7FFF;
    }
    
    this.cntsToAddress = function(){
        this.b1  = (this.cntFV&7)<<4;
        this.b1 |= (this.cntV&1)<<3;
        this.b1 |= (this.cntH&1)<<2;
        this.b1 |= (this.cntVT>>3)&3;
        
        this.b2  = (this.cntVT&7)<<5;
        this.b2 |= this.cntHT&31;
        
        this.vramAddress = ((this.b1<<8) | this.b2)&0x7FFF;
    }
    
    this.incTileCounter = function(count){
        
        for(this.i=count;this.i!=0;this.i--){
            this.cntHT++;
            if(this.cntHT==32){
                this.cntHT=0;
                this.cntVT++;
                if(this.cntVT>=30){
                    this.cntH++;
                    if(this.cntH==2){
                        this.cntH=0;
                        this.cntV++;
                        if(this.cntV==2){
                            this.cntV=0;
                            this.cntFV++;
                            this.cntFV&=0x7;
                        }
                    }
                }
            }
        }
        
    }
    
    // Reads from memory, taking into account
    // mirroring/mapping of address ranges.
    this.mirroredLoad = function(address){
        return this.ppuMem[this.vramMirrorTable[address]];
    }
    
    // Writes to memory, taking into account
    // mirroring/mapping of address ranges.
    this.mirroredWrite = function(address, value){
        if(address>=0x3f00 && address<0x3f20){
            // Palette write mirroring.
            if(address==0x3F00 || address==0x3F10){
                this.writeMem(0x3F00,value);
                this.writeMem(0x3F10,value);
                
            }else if(address==0x3F04 || address==0x3F14){
                
                this.writeMem(0x3F04,value);
                this.writeMem(0x3F14,value);
                
            }else if(address==0x3F08 || address==0x3F18){
                
                this.writeMem(0x3F08,value);
                this.writeMem(0x3F18,value);
                
            }else if(address==0x3F0C || address==0x3F1C){
                
                this.writeMem(0x3F0C,value);
                this.writeMem(0x3F1C,value);
                
            }else{
                this.writeMem(address,value);
            }
            
        }else{
            
            // Use lookup table for mirrored address:
            if(address<this.vramMirrorTable.length){
                this.writeMem(this.vramMirrorTable[address],value);
            }else{
                // FIXME
                alert("Invalid VRAM address: "+address.toString(16));
            }
            
        }
        
    }
    
    this.triggerRendering = function(){
        
        if(this.scanline >= 21 && this.scanline <= 260){
            
            // Render sprites, and combine:
            this.renderFramePartially(
                this.lastRenderedScanline+1,
                this.scanline-21-this.lastRenderedScanline
            );
            
            // Set last rendered scanline:
            this.lastRenderedScanline = this.scanline-21;
            
        }
        
    }
    
    this.renderFramePartially = function(startScan, scanCount){
        
        if(this.f_spVisibility == 1){
            this.renderSpritesPartially(startScan,scanCount,true);
        }
        
        if(this.f_bgVisibility == 1){
            this.si = startScan<<8;
            this.ei = (startScan+scanCount)<<8;
            if(this.ei>0xF000) this.ei=0xF000;
            for(this.destIndex=this.si;this.destIndex<this.ei;this.destIndex++){
                if(this.pixrendered[this.destIndex]>0xFF){
                    //console.log("Writing "+this.imgPalette[this.col+this.att].toString(16)+" to buffer at "+this.destIndex.toString(16));
                    this.writePixel(this.destIndex, 
                                    this.bgbuffer[this.destIndex]);
                }
            }
        }
        
        if(this.f_spVisibility == 1){
            this.renderSpritesPartially(startScan,scanCount,false);
        }
        
        /*BufferView screen = nes.getGui().getScreenView();
        if(screen.scalingEnabled() && !screen.useHWScaling() && !requestRenderAll){
            
            // Check which scanlines have changed, to try to
            // speed up scaling:
            int j,jmax;
            if(startScan+scanCount>240)scanCount=240-startScan;
            for(int i=startScan;i<startScan+scanCount;i++){
                scanlineChanged[i]=false;
                si = i<<8;
                jmax = si+256;
                for(j=si;j<jmax;j++){
                    if(buffer[j]!=oldFrame[j]){
                        scanlineChanged[i]=true;
                        break;
                    }
                    oldFrame[j]=buffer[j];
                }
                System.arraycopy(buffer,j,oldFrame,j,jmax-j);
            }
            
        }*/
        
        this.validTileData = false;
        
    }
    
    this.renderBgScanline = function(bgbuffer, scan){

        this.baseTile = (this.regS==0?0:256);
        this.destIndex = (scan<<8)-this.regFH;
        this.curNt = this.ntable1[this.cntV+this.cntV+this.cntH];
        
        this.cntHT = this.regHT;
        this.cntH = this.regH;
        this.curNt = this.ntable1[this.cntV+this.cntV+this.cntH];
        
        if(scan<240 && (scan-this.cntFV)>=0){
            
            this.tscanoffset = this.cntFV<<3;
            this.y = scan-this.cntFV;
            for(this.tile=0;this.tile<32;this.tile++){
                
                if(scan>=0){
                
                    // Fetch tile & attrib data:
                    if(this.validTileData){
                        // Get data from array:
                        this.t = this.scantile[this.tile];
                        this.tpix = this.t.pix;
                        this.att = this.attrib[this.tile];
                    }else{
                        // Fetch data:
                        this.t = this.ptTile[this.baseTile+this.nameTable[this.curNt].getTileIndex(this.cntHT,this.cntVT)];
                        this.tpix = this.t.pix;
                        this.att = this.nameTable[this.curNt].getAttrib(this.cntHT,this.cntVT);
                        this.scantile[this.tile] = this.t;
                        this.attrib[this.tile] = this.att;
                    }
                    
                    // Render tile scanline:
                    this.sx = 0;
                    this.x = (this.tile<<3)-this.regFH;
                    if(this.x>-8){
                        if(this.x<0){
                            this.destIndex-=this.x;
                            this.sx = -this.x;
                        }
                        if(this.t.opaque[this.cntFV]){
                            for(;this.sx<8;this.sx++){
                                var pix = this.imgPalette[this.tpix[this.tscanoffset+this.sx]+this.att];
                                if (bgbuffer) {
                                    this.bgbuffer[this.destIndex] = pix;
                                }
                                else {
                                    this.writePixel(this.destIndex, pix);
                                }
                                this.pixrendered[this.destIndex] |= 256;
                                this.destIndex++;
                            }
                        }else{
                            for(;this.sx<8;this.sx++){
                                this.col = this.tpix[this.tscanoffset+this.sx];
                                if(this.col != 0){
                                    //console.log("Writing "+this.imgPalette[this.col+this.att].toString(16)+" to buffer at "+this.destIndex.toString(16));
                                    var pix = 
                                        this.imgPalette[this.col+this.att];
                                    if (bgbuffer) {
                                        this.bgbuffer[this.destIndex] = pix;
                                    }
                                    else {
                                        this.writePixel(this.destIndex, pix);
                                    }
                                    this.pixrendered[this.destIndex] |= 256;
                                }
                                this.destIndex++;
                            }
                        }
                    }
                    
                }
                    
                // Increase Horizontal Tile Counter:
                this.cntHT++;
                if(this.cntHT==32){
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
        if(this.cntFV==8){
            this.cntFV = 0;
            this.cntVT++;
            if(this.cntVT==30){
                this.cntVT = 0;
                this.cntV++;
                this.cntV%=2;
                this.curNt = this.ntable1[(this.cntV<<1)+this.cntH];
            }else if(this.cntVT==32){
                this.cntVT = 0;
            }
            
            // Invalidate fetched data:
            this.validTileData = false;
            
        }
        
    }
    
    this.renderSpritesPartially = function(startscan, scancount, bgPri){
        if(this.f_spVisibility==1){
            
            var sprT1,sprT2;
            
            for(var i=0;i<64;i++){
                if(this.bgPriority[i]==bgPri && this.sprX[i]>=0 && this.sprX[i]<256 && this.sprY[i]+8>=startscan && this.sprY[i]<startscan+scancount){
                    // Show sprite.
                    if(this.f_spriteSize == 0){
                        // 8x8 sprites
                        
                        this.srcy1 = 0;
                        this.srcy2 = 8;
                        
                        if(this.sprY[i]<startscan){
                            srcy1 = startscan - this.sprY[i]-1;
                        }
                        
                        if(this.sprY[i]+8 > startscan+scancount){
                            this.srcy2 = startscan+scancount-this.sprY[i]+1;
                        }
                        
                        if(this.f_spPatternTable==0){
                            this.ptTile[this.sprTile[i]].render(0, this.srcy1, 8, this.srcy2, this.sprX[i], this.sprY[i]+1, this.sprCol[i], this.sprPalette, this.horiFlip[i], this.vertFlip[i], i, this.pixrendered);
                        }else{
                            this.ptTile[this.sprTile[i]+256].render(0, this.srcy1, 8, this.srcy2, this.sprX[i], this.sprY[i]+1, this.sprCol[i], this.sprPalette, this.horiFlip[i], this.vertFlip[i], i, this.pixrendered);
                        }
                    }else{
                        // 8x16 sprites
                        var top = this.sprTile[i];
                        if((top&1)!=0){
                            top = this.sprTile[i]-1+256;
                        }
                        
                        this.srcy1 = 0;
                        this.srcy2 = 8;
                        
                        if(this.sprY[i]<startscan){
                            this.srcy1 = startscan - this.sprY[i]-1;
                        }
                        
                        if(this.sprY[i]+8 > startscan+scancount){
                            this.srcy2 = startscan+scancount-this.sprY[i];
                        }
                        
                        this.ptTile[top+(this.vertFlip[i]?1:0)].render(0,
                            this.srcy1,
                            8,
                            this.srcy2,
                            this.sprX[i],
                            this.sprY[i]+1,
                            this.sprCol[i],
                            this.sprPalette,
                            this.horiFlip[i],
                            this.vertFlip[i],
                            i,
                            this.pixrendered
                        );
                        
                        this.srcy1 = 0;
                        this.srcy2 = 8;
                        
                        if(this.sprY[i]+8<startscan){
                            this.srcy1 = startscan - (this.sprY[i]+8+1);
                        }
                        
                        if(this.sprY[i]+16 > startscan+scancount){
                            this.srcy2 = startscan+scancount-(this.sprY[i]+8);
                        }
                        
                        this.ptTile[top+(this.vertFlip[i]?0:1)].render(
                            0,
                            this.srcy1,
                            8,
                            this.srcy2,
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
        
    }
    
    this.checkSprite0 = function(scan){
        
        this.spr0HitX = -1;
        this.spr0HitY = -1;
        
        var toffset;
        var tIndexAdd = (this.f_spPatternTable==0?0:256);
        var x,y;
        var bufferIndex;
        var col;
        var bgPri;
        var t;
        
        x = this.sprX[0];
        y = this.sprY[0]+1;
        
        if(this.f_spriteSize==0){
            // 8x8 sprites.

            // Check range:
            if(y<=scan && y+8>scan && x>=-7 && x<256){
                
                // Sprite is in range.
                // Draw scanline:
                t = this.ptTile[this.sprTile[0]+tIndexAdd];
                col = this.sprCol[0];
                bgPri = this.bgPriority[0];
                
                if(this.vertFlip[0]){
                    toffset = 7-(scan-y);
                }else{
                    toffset = scan-y;
                }
                toffset*=8;
                
                bufferIndex = scan*256+x;
                if(this.horiFlip[0]){
                    for(var i=7;i>=0;i--){
                        if(x>=0 && x<256){
                            if(bufferIndex>=0 && bufferIndex<61440 && this.pixrendered[bufferIndex]!=0){
                                if(t.pix[toffset+i] != 0){
                                    this.spr0HitX = bufferIndex%256;
                                    this.spr0HitY = scan;
                                    return true;
                                }
                            }
                        }
                        x++;
                        bufferIndex++;
                    }
                    
                }else{
                    for(var i=0;i<8;i++){
                        if(x>=0 && x<256){
                            if(bufferIndex>=0 && bufferIndex<61440 && this.pixrendered[bufferIndex]!=0){
                                if(t.pix[toffset+i] != 0){
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
        }else{
            // 8x16 sprites:
        
            // Check range:
            if(y<=scan && y+16>scan && x>=-7 && x<256){
                
                // Sprite is in range.
                // Draw scanline:
                
                if(this.vertFlip[0]){
                    toffset = 15-(scan-y);
                }else{
                    toffset = scan-y;
                }
                
                if(toffset<8){
                    // first half of sprite.
                    t = this.ptTile[this.sprTile[0]+(this.vertFlip[0]?1:0)+((this.sprTile[0]&1)!=0?255:0)];
                }else{
                    // second half of sprite.
                    t = this.ptTile[this.sprTile[0]+(this.vertFlip[0]?0:1)+((this.sprTile[0]&1)!=0?255:0)];
                    if(this.vertFlip[0]){
                        toffset = 15-toffset;
                    }else{
                        toffset -= 8;
                    }
                }
                toffset*=8;
                col = this.sprCol[0];
                bgPri = this.bgPriority[0];
                
                bufferIndex = scan*256+x;
                if(this.horiFlip[0]){
                    for(var i=7;i>=0;i--){
                        if(x>=0 && x<256){
                            if(bufferIndex>=0 && bufferIndex<61440 && this.pixrendered[bufferIndex]!=0){
                                if(t.pix[toffset+i] != 0){
                                    this.spr0HitX = bufferIndex%256;
                                    this.spr0HitY = scan;
                                    return true;
                                }
                            }
                        }
                        x++;
                        bufferIndex++;
                    }
                    
                }else{
                    
                    for(var i=0;i<8;i++){
                        if(x>=0 && x<256){
                            if(bufferIndex>=0 && bufferIndex<61440 && this.pixrendered[bufferIndex]!=0){
                                if(t.pix[toffset+i] != 0){
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
        
    }
    
    // This will write to PPU memory, and
    // update internally buffered data
    // appropriately.
    this.writeMem = function(address, value){
        
        this.ppuMem[address] = value;
        
        // Update internally buffered data:
        if(address < 0x2000){
            
            this.ppuMem[address] = value;
            this.patternWrite(address,value);
            
        }else if(address >=0x2000 && address <0x23c0){
            
            this.nameTableWrite(this.ntable1[0],address-0x2000,value);
            
        }else if(address >=0x23c0 && address <0x2400){
            
            this.attribTableWrite(this.ntable1[0],address-0x23c0,value);
            
        }else if(address >=0x2400 && address <0x27c0){
            
            this.nameTableWrite(this.ntable1[1],address-0x2400,value);
            
        }else if(address >=0x27c0 && address <0x2800){
            
            this.attribTableWrite(this.ntable1[1],address-0x27c0,value);
            
        }else if(address >=0x2800 && address <0x2bc0){
            
            this.nameTableWrite(this.ntable1[2],address-0x2800,value);
            
        }else if(address >=0x2bc0 && address <0x2c00){
            
            this.attribTableWrite(this.ntable1[2],address-0x2bc0,value);
            
        }else if(address >=0x2c00 && address <0x2fc0){
            
            this.nameTableWrite(this.ntable1[3],address-0x2c00,value);
            
        }else if(address >=0x2fc0 && address <0x3000){
            
            this.attribTableWrite(this.ntable1[3],address-0x2fc0,value);
            
        }else if(address >=0x3f00 && address <0x3f20){
            
            this.updatePalettes();
            
        }
        
    }
    
    // Reads data from $3f00 to $f20 
    // into the two buffered palettes.
    this.updatePalettes = function(){
        
        for(var i=0;i<16;i++){
            if(this.f_dispType == 0){
                this.imgPalette[i] = this.nes.palTable.getEntry(
                                        this.ppuMem[0x3f00+i]&63);
            }else{
                this.imgPalette[i] = this.nes.palTable.getEntry(
                                        this.ppuMem[0x3f00+i]&32);
            }
        }
        for(var i=0;i<16;i++){
            if(this.f_dispType == 0){
                this.sprPalette[i] = this.nes.palTable.getEntry(
                                        this.ppuMem[0x3f10+i]&63);
            }else{
                this.sprPalette[i] = this.nes.palTable.getEntry(
                                        this.ppuMem[0x3f10+i]&32);
            }
        }
        
        //renderPalettes();
        
    }
    
    // Updates the internal pattern
    // table buffers with this new byte.
    // In vNES, there is a version of this with 4 arguments which isn't used.
    this.patternWrite = function(address, value){
        var tileIndex = parseInt(address/16);
        var leftOver = address%16;
        if(leftOver<8){
            this.ptTile[tileIndex].setScanline(
                leftOver, value, this.ppuMem[address+8]);
        }else{
            this.ptTile[tileIndex].setScanline(
                leftOver-8, this.ppuMem[address-8], value);
        }
    }
    
    this.invalidateFrameCache = function(){
        
        // Clear the no-update scanline buffer:
        for(var i=0;i<240;i++) this.scanlineChanged[i]=true;
        
        for(var i=0;i<this.oldFrame.length;i++) this.oldFrame[i]=-1;
        this.requestRenderAll = true;
        
    }

    // Updates the internal name table buffers
    // with this new byte.
    this.nameTableWrite = function(index, address, value){
        this.nameTable[index].tile[address] = value;
        
        // Update Sprite #0 hit:
        //updateSpr0Hit();
        this.checkSprite0(this.scanline-20);
        
    }
    
    // Updates the internal pattern
    // table buffers with this new attribute
    // table byte.
    this.attribTableWrite = function(index, address, value){
        this.nameTable[index].writeAttrib(address,value);
    }
    
    // Updates the internally buffered sprite
    // data with this new byte of info.
    this.spriteRamWriteUpdate = function(address, value){
        
        var tIndex = parseInt(address/4);
        
        if(tIndex == 0){
            //updateSpr0Hit();
            this.checkSprite0(this.scanline-20);
        }
        
        if(address%4 == 0){
            // Y coordinate
            this.sprY[tIndex] = value;
        }else if(address%4 == 1){
            // Tile index
            this.sprTile[tIndex] = value;
        }else if(address%4 == 2){
            // Attributes
            this.vertFlip[tIndex] = ((value&0x80)!=0);
            this.horiFlip[tIndex] = ((value&0x40)!=0);
            this.bgPriority[tIndex] = ((value&0x20)!=0);
            this.sprCol[tIndex] = (value&3)<<2;
            
        }else if(address%4 == 3){
            // X coordinate
            this.sprX[tIndex] = value;
        }
        
    }
    
    this.doNMI = function(){
        
        // Set VBlank flag:
        this.setStatusFlag(this.STATUS_VBLANK,true);
        //nes.getCpu().doNonMaskableInterrupt();
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NMI);
        
    }
    
    this.writePixel = function(index, value){
        var j = index*4;
        this.nes.imageData.data[j] = value&0xFF;
        this.nes.imageData.data[j+1] = (value>>8)&0xFF;
        this.nes.imageData.data[j+2] = (value>>16)&0xFF;
    }
    
    this.reset = function() {
        
        this.vramBufferedReadValue = 0;
        this.sramAddress           = 0;
        this.curX                  = 0;
        this.scanline              = 0;
        this.lastRenderedScanline  = 0;
        this.spr0HitX              = 0;
        this.spr0HitY              = 0;
        this.mapperIrqCounter     = 0;
        
        this.currentMirroring = -1;
        
        this.firstWrite = true;
        this.requestEndFrame = false;
        this.nmiOk = false;
        this.hitSpr0 = false;
        this.dummyCycleToggle = false;
        this.validTileData = false;
        this.nmiCounter = 0;
        this.tmp = 0;
        this.att = 0;
        this.i = 0;
        
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
        
        for (var i=0; i<this.scanlineChanged.length;i++)
            this.scanlineChanged[i] = true;
        for (var i=0; i<this.oldFrame.length;i++)
            this.oldFrame[i] = -1;
        
        // Initialize stuff:
        this.init();
        
    }
}
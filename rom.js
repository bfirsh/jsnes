function ROM(nes) {
    this.nes = nes;
    
    // Mirroring types:
	this.VERTICAL_MIRRORING     = 0;
	this.HORIZONTAL_MIRRORING   = 1;
	this.FOURSCREEN_MIRRORING   = 2;
	this.SINGLESCREEN_MIRRORING = 3;
	this.SINGLESCREEN_MIRRORING2= 4;
	this.SINGLESCREEN_MIRRORING3= 5;
	this.SINGLESCREEN_MIRRORING4= 6;
	this.CHRROM_MIRRORING       = 7;
	
	this.failedSaveFile=false;
	this.saveRamUpToDate=true;
	
	this.header = null;
	this.rom = null;
	this.vrom = null;
	this.saveRam = null;
	this.vromTile = null;
	
    this.romCount = null;
    this.vromCount = null;
    this.mirroring = null;
    this.batteryRam = null;
    this.trainer = null;
    this.fourScreen = null;
    this.mapperType = null;
    this.fileName = null;
    this.raFile = null;
	this.enableSave = true;
	this.valid = false;
	
	this.mapperName = new Array(92);
	this.supportedMappers = new Array(92);
	
	for(var i=0;i<92;i++)
		this.mapperName[i] = "Unknown Mapper";
	this.mapperName[ 0] = "Direct Access";
	this.mapperName[ 1] = "Nintendo MMC1";
	this.mapperName[ 2] = "UNROM";
	this.mapperName[ 3] = "CNROM";
	this.mapperName[ 4] = "Nintendo MMC3";
	this.mapperName[ 5] = "Nintendo MMC5";
	this.mapperName[ 6] = "FFE F4xxx";
	this.mapperName[ 7] = "AOROM";
	this.mapperName[ 8] = "FFE F3xxx";
	this.mapperName[ 9] = "Nintendo MMC2";
	this.mapperName[10] = "Nintendo MMC4";
	this.mapperName[11] = "Color Dreams Chip";
	this.mapperName[12] = "FFE F6xxx";
	this.mapperName[15] = "100-in-1 switch";
	this.mapperName[16] = "Bandai chip";
	this.mapperName[17] = "FFE F8xxx";
	this.mapperName[18] = "Jaleco SS8806 chip";
	this.mapperName[19] = "Namcot 106 chip";
	this.mapperName[20] = "Famicom Disk System";
	this.mapperName[21] = "Konami VRC4a";
	this.mapperName[22] = "Konami VRC2a";
	this.mapperName[23] = "Konami VRC2a";
	this.mapperName[24] = "Konami VRC6";
	this.mapperName[25] = "Konami VRC4b";
	this.mapperName[32] = "Irem G-101 chip";
	this.mapperName[33] = "Taito TC0190/TC0350";
	this.mapperName[34] = "32kB ROM switch";
	
	this.mapperName[64] = "Tengen RAMBO-1 chip";
	this.mapperName[65] = "Irem H-3001 chip";
	this.mapperName[66] = "GNROM switch";
	this.mapperName[67] = "SunSoft3 chip";
	this.mapperName[68] = "SunSoft4 chip";
	this.mapperName[69] = "SunSoft5 FME-7 chip";
	this.mapperName[71] = "Camerica chip";
	this.mapperName[78] = "Irem 74HC161/32-based";
	this.mapperName[91] = "Pirate HK-SF3 chip";
	
	// The mappers supported:
	this.supportedMappers[0] = true; // No Mapper
	this.supportedMappers[1] = true; // MMC1
	this.supportedMappers[2] = true; // UNROM
	/*this.supportedMappers[3] = true; // CNROM*/
	this.supportedMappers[4] = true; // MMC3
	/*this.supportedMappers[7] = true; // AOROM
	this.supportedMappers[9] = true; // MMC2
	this.supportedMappers[10] = true; // MMC4
	this.supportedMappers[11] = true; // ColorDreams
	this.supportedMappers[66] = true; // GNROM
	this.supportedMappers[68] = true; // SunSoft4 chip
	this.supportedMappers[71] = true; // Camerica*/
	
	this.load = function(fileName) {
	    this.fileName = fileName;
	    if (!roms[fileName]) {
	        alert("ROM does not exist.");
	        return;
	    }
	    b = roms[fileName]
	    if (b.indexOf("NES\x1a") == -1) {
            alert("Not a valid NES ROM.");
            return;
        }
	    this.header = new Array(16);
        for (var i = 0; i < 16; i++)
            this.header[i] = b.charCodeAt(i);
        this.romCount = this.header[4];
		this.vromCount = this.header[5]*2; // Get the number of 4kB banks, not 8kB
		this.mirroring = ((this.header[6]&1)!=0?1:0);
		this.batteryRam = (this.header[6]&2)!=0;
		this.trainer =    (this.header[6]&4)!=0;
		this.fourScreen = (this.header[6]&8)!=0;
		this.mapperType = (this.header[6]>>4)|(this.header[7]&0xF0);
		/* TODO
		if (this.batteryRam)
		    this.loadBatteryRam();*/
		// Check whether byte 8-15 are zero's:
		var foundError = false;
		for(var i=8;i<16;i++){
			if(this.header[i]!=0){
				foundError = true;
				break;
			}
		}
		if (foundError)
		    mapperType &= 0xF; // Ignore byte 7
	    // Load PRG-ROM banks:
		this.rom = new Array(this.romCount);
		var offset = 16;
		for (var i=0; i<this.romCount;i++) {
		    this.rom[i] = new Array(16384);
		    for(var j=0;j<16384;j++){
				if(offset+j >= b.length){
					break;
				}
				this.rom[i][j] = b.charCodeAt(offset+j);
			}
			offset+=16384;
		}
		// Load CHR-ROM banks:
		this.vrom = new Array(this.vromCount);
		for(var i=0;i<this.vromCount;i++){
		    this.vrom[i] = new Array(4096);
			for(var j=0;j<4096;j++){
				if(offset+j >= b.length){
					break;
				}
				this.vrom[i][j] = b.charCodeAt(offset+j);
			}
			offset+=4096;
		}
		
		// Create VROM tiles:
		this.vromTile = new Array(this.vromCount);
		for(var i=0;i<this.vromCount;i++){
		    this.vromTile[i] = new Array(256);
			for(var j=0;j<256;j++){
				this.vromTile[i][j] = new Tile();
			}
		}
		
		// Convert CHR-ROM banks to tiles:
		//System.out.println("Converting CHR-ROM image data..");
		//System.out.println("VROM bank count: "+vromCount);
		var tileIndex;
		var leftOver;
		for(var v=0;v<this.vromCount;v++){
			for(var i=0;i<4096;i++){
				tileIndex = i>>4;
				leftOver = i%16;
				if(leftOver<8){
					this.vromTile[v][tileIndex].setScanline(
					        leftOver,this.vrom[v][i],this.vrom[v][i+8]);
				}else{
					this.vromTile[v][tileIndex].setScanline(
					        leftOver-8,this.vrom[v][i-8],this.vrom[v][i]);
				}
			}
		}
		
		this.valid = true;
	}
	
	this.getMirroringType = function() {
	    if (this.fourScreen)
			return this.FOURSCREEN_MIRRORING;
		if (this.mirroring == 0) 
			return this.HORIZONTAL_MIRRORING;
		return this.VERTICAL_MIRRORING;
	}
	
	this.getMapperName = function() {
	    if (this.mapperType>=0 && this.mapperType<this.mapperName.length){
			return this.mapperName[this.mapperType];
		}
		return "Unknown Mapper, "+this.mapperType;
	}
	
	this.mapperSupported = function() {
		if (this.mapperType<this.supportedMappers.length && this.mapperType>=0){
			return this.supportedMappers[this.mapperType];
		}
		return false;
	}
	
	this.closeRom = function() {
	    
	}
	
	this.createMapper = function() {
	    if (this.mapperSupported()) {
	        switch(this.mapperType) {
	            case 0: // No mapper
	                return new MapperDefault(this.nes);
	            case 1: // MMC1
	                return new Mapper001(this.nes);
	            case 2: // UNROM
	                return new Mapper002(this.nes);
	            case 4: // MMC3
	                return new Mapper004(this.nes);
	        }
	    }
	    else {
	        alert("Mapper not supported: "+this.mapperType);
	        return null;
	    }
	}
}
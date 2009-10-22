function ChannelDM(papu) {
	this.papu = papu;
	
	this.MODE_NORMAL = 0;
	this.MODE_LOOP = 1;
	this.MODE_IRQ = 2;
	
	this.isEnabled = null;
	this.hasSample = null;
	this.irqGenerated=false;
	
	this.playMode = null;
	this.dmaFrequency = null;
	this.dmaCounter = null;
	this.deltaCounter = null;
	this.playStartAddress = null;
	this.playAddress = null;
	this.playLength = null;
	this.playLengthCounter = null;
	this.shiftCounter = null;
	this.reg4012 = null;
	this.reg4013 = null;
	this.sample = null;
	this.dacLsb = null;
	this.data = null;
	
	this.reset();
}	
	
ChannelDM.prototype.clockDmc = function(){
	
	// Only alter DAC value if the sample buffer has data:
	if(this.hasSample){
		
		if((this.data&1)===0){
			
			// Decrement delta:
			if(this.deltaCounter>0) {
			    this.deltaCounter--;
		    }
			
		}else{
			
			// Increment delta:
			if(this.deltaCounter<63) {
			    this.deltaCounter++;
		    }
			
		}
		
		// Update sample value:
		this.sample = this.isEnabled ? (this.deltaCounter<<1)+this.dacLsb : 0;
		
		// Update shift register:
		this.data>>=1;
		
	}
	
	this.dmaCounter--;
	if(this.dmaCounter <= 0){
		
		// No more sample bits.
		this.hasSample = false;
		this.endOfSample();
		this.dmaCounter = 8;
		
	}
	
	if(this.irqGenerated){
		this.papu.nes.cpu.requestIrq(this.papu.nes.cpu.IRQ_NORMAL);
	}
	
};

ChannelDM.prototype.endOfSample = function(){
	
	
	if(this.playLengthCounter===0 && this.playMode==this.MODE_LOOP){
		
		// Start from beginning of sample:
		this.playAddress = this.playStartAddress;
		this.playLengthCounter = this.playLength;
		
	}
	
	if(this.playLengthCounter > 0){
		
		// Fetch next sample:
		this.nextSample();
		
		if(this.playLengthCounter == 0){
		
			// Last byte of sample fetched, generate IRQ:
			if(this.playMode == this.MODE_IRQ){
				
				// Generate IRQ:
				this.irqGenerated = true;
				
			}
			
		}
		
	}
	
};

ChannelDM.prototype.nextSample = function(){
	
	// Fetch byte:
	this.data = this.papu.nes.memMapper.load(this.playAddress);
	this.papu.nes.cpu.haltCycles(4);
	
	this.playLengthCounter--;
	this.playAddress++;
	if(this.playAddress>0xFFFF){
		this.playAddress = 0x8000;
	}
	
	this.hasSample = true;
	
};

ChannelDM.prototype.writeReg = function(address, value){
	
	if(address == 0x4010){
		
		// Play mode, DMA Frequency
		if((value>>6)==0){
			this.playMode = this.MODE_NORMAL;
		}else if(((value>>6)&1)==1){
			this.playMode = this.MODE_LOOP;
		}else if((value>>6)==2){
			this.playMode = this.MODE_IRQ;
		}
		
		if((value&0x80)==0){
			this.irqGenerated = false;
		}
		
		this.dmaFrequency = this.papu.getDmcFrequency(value&0xF);
		
	}else if(address == 0x4011){
		
		// Delta counter load register:
		this.deltaCounter = (value>>1)&63;
		this.dacLsb = value&1;
		this.sample = ((this.deltaCounter<<1)+this.dacLsb); // update sample value
		
	}else if(address == 0x4012){
		
		// DMA address load register
		this.playStartAddress = (value<<6)|0x0C000;
		this.playAddress = this.playStartAddress;
		this.reg4012 = value;
		
	}else if(address == 0x4013){
		
		// Length of play code
		this.playLength = (value<<4)+1;
		this.playLengthCounter = this.playLength;
		this.reg4013 = value;
		
	}else if(address == 0x4015){
		
		// DMC/IRQ Status
		if(((value>>4)&1)==0){
			// Disable:
			this.playLengthCounter = 0;
		}else{
			// Restart:
			this.playAddress = this.playStartAddress;
			this.playLengthCounter = this.playLength;
		}
		this.irqGenerated = false;
	}
	
};

ChannelDM.prototype.setEnabled = function(value){
	
	if((!this.isEnabled) && value){
		this.playLengthCounter = this.playLength;
	}
	this.isEnabled = value;
	
};

ChannelDM.prototype.getLengthStatus = function(){
	return ((this.playLengthCounter==0 || !this.isEnabled)?0:1);
};

ChannelDM.prototype.getIrqStatus = function(){
	return (this.irqGenerated?1:0);
};

ChannelDM.prototype.reset = function(){

	this.isEnabled = false;
	this.irqGenerated = false;
	this.playMode = this.MODE_NORMAL;
	this.dmaFrequency = 0;
	this.dmaCounter = 0;
	this.deltaCounter = 0;
	this.playStartAddress = 0;
	this.playAddress = 0;
	this.playLength = 0;
	this.playLengthCounter = 0;
	this.sample = 0;
	this.dacLsb = 0;
	this.shiftCounter = 0;
	this.reg4012 = 0;
	this.reg4013 = 0;
	this.data = 0;
	
};


function ChannelNoise(papu) {
	this.papu = papu;
	
	this.isEnabled = null;
	this.envDecayDisable = null;
	this.envDecayLoopEnable = null;
	this.lengthCounterEnable = null;
	this.envReset = null;
	this.shiftNow = null;
	
	this.lengthCounter = null;
	this.progTimerCount = null;
	this.progTimerMax = null;
	this.envDecayRate = null;
	this.envDecayCounter = null;
	this.envVolume = null;
	this.masterVolume = null;
	this.shiftReg = 1<<14;
	this.randomBit = null;
	this.randomMode = null;
	this.sampleValue = null;
	this.accValue=0;
	this.accCount=1;
	this.tmp = null;
	
	this.reset();
}

ChannelNoise.prototype.reset = function(){
	this.progTimerCount = 0;
	this.progTimerMax = 0;
	this.isEnabled = false;
	this.lengthCounter = 0;
	this.lengthCounterEnable = false;
	this.envDecayDisable = false;
	this.envDecayLoopEnable = false;
	this.shiftNow = false;
	this.envDecayRate = 0;
	this.envDecayCounter = 0;
	this.envVolume = 0;
	this.masterVolume = 0;
	this.shiftReg = 1;
	this.randomBit = 0;
	this.randomMode = 0;
	this.sampleValue = 0;
	this.tmp = 0;
};

ChannelNoise.prototype.clockLengthCounter = function(){
	if(this.lengthCounterEnable && this.lengthCounter>0){
		this.lengthCounter--;
		if(this.lengthCounter == 0) this.updateSampleValue();
	}
};

ChannelNoise.prototype.clockEnvDecay = function(){
	
	if(this.envReset){
	    
		// Reset envelope:
		this.envReset = false;
		this.envDecayCounter = this.envDecayRate + 1;
		this.envVolume = 0xF;
	}else if(--this.envDecayCounter <= 0){
		
		// Normal handling:
		this.envDecayCounter = this.envDecayRate + 1;
		if(this.envVolume>0){
			this.envVolume--;
		}else{
			this.envVolume = this.envDecayLoopEnable ? 0xF : 0;
		}	
	}
	this.masterVolume = this.envDecayDisable ? this.envDecayRate : this.envVolume;
	this.updateSampleValue();
};

ChannelNoise.prototype.updateSampleValue = function(){
	if(this.isEnabled && this.lengthCounter>0){
		this.sampleValue = this.randomBit * this.masterVolume;
	}
};

ChannelNoise.prototype.writeReg = function(address, value){
	
	if(address == 0x400C){
		
		// Volume/Envelope decay:
		this.envDecayDisable = ((value&0x10)!=0);
		this.envDecayRate = value&0xF;
		this.envDecayLoopEnable = ((value&0x20)!=0);
		this.lengthCounterEnable = ((value&0x20)==0);
		this.masterVolume = this.envDecayDisable?this.envDecayRate:this.envVolume;
		
	}else if(address == 0x400E){
		
		// Programmable timer:
		this.progTimerMax = this.papu.getNoiseWaveLength(value&0xF);
		this.randomMode = value>>7;
		
	}else if(address == 0x400F){
		
		// Length counter
		this.lengthCounter = this.papu.getLengthMax(value&248);
		this.envReset = true;
		
	}
	
	// Update:
	//updateSampleValue();
	
};

ChannelNoise.prototype.setEnabled = function(value){
	this.isEnabled = value;
	if(!value) this.lengthCounter = 0;
	this.updateSampleValue();
};

ChannelNoise.prototype.getLengthStatus = function(){
	return ((this.lengthCounter==0 || !this.isEnabled)?0:1);
};


function ChannelSquare(papu, square1){
	this.papu = papu;
	
	this.dutyLookup = [
		 0, 1, 0, 0, 0, 0, 0, 0,
		 0, 1, 1, 0, 0, 0, 0, 0,
		 0, 1, 1, 1, 1, 0, 0, 0,
		 1, 0, 0, 1, 1, 1, 1, 1
	];
	this.impLookup = [
		 1,-1, 0, 0, 0, 0, 0, 0,
		 1, 0,-1, 0, 0, 0, 0, 0,
		 1, 0, 0, 0,-1, 0, 0, 0,
		-1, 0, 1, 0, 0, 0, 0, 0
	];
	
	this.sqr1 = square1;
	this.isEnabled = null;
	this.lengthCounterEnable = null;
	this.sweepActive = null;
	this.envDecayDisable = null;
	this.envDecayLoopEnable = null;
	this.envReset = null;
	this.sweepCarry = null;
	this.updateSweepPeriod = null;
	
	this.progTimerCount = null;
	this.progTimerMax = null;
	this.lengthCounter = null;
	this.squareCounter = null;
	this.sweepCounter = null;
	this.sweepCounterMax = null;
	this.sweepMode = null;
	this.sweepShiftAmount = null;
	this.envDecayRate = null;
	this.envDecayCounter = null;
	this.envVolume = null;
	this.masterVolume = null;
	this.dutyMode = null;
	this.sweepResult = null;
	this.sampleValue = null;
	this.vol = null;
	
	this.reset();
}


ChannelSquare.prototype.reset = function() {
	this.progTimerCount = 0;
	this.progTimerMax = 0;
	this.lengthCounter = 0;
	this.squareCounter = 0;
	this.sweepCounter = 0;
	this.sweepCounterMax = 0;
	this.sweepMode = 0;
	this.sweepShiftAmount = 0;
	this.envDecayRate = 0;
	this.envDecayCounter = 0;
	this.envVolume = 0;
	this.masterVolume = 0;
	this.dutyMode = 0;
	this.vol = 0;
	
	this.isEnabled = false;
	this.lengthCounterEnable = false;
	this.sweepActive = false;
	this.sweepCarry = false;
	this.envDecayDisable = false;
	this.envDecayLoopEnable = false;
};

ChannelSquare.prototype.clockLengthCounter = function(){
	
	if(this.lengthCounterEnable && this.lengthCounter>0){
		this.lengthCounter--;
		if(this.lengthCounter==0) this.updateSampleValue();
	}
	
};

ChannelSquare.prototype.clockEnvDecay = function() {
	
	if(this.envReset){
		
		// Reset envelope:
		this.envReset = false;
		this.envDecayCounter = this.envDecayRate + 1;
		this.envVolume = 0xF;
		
	}else if((--this.envDecayCounter) <= 0){
		
		// Normal handling:
		this.envDecayCounter = this.envDecayRate + 1;
		if(this.envVolume>0){
			this.envVolume--;
		}else{
			this.envVolume = this.envDecayLoopEnable ? 0xF : 0;
		}
		
	}
	
	this.masterVolume = this.envDecayDisable ? this.envDecayRate : this.envVolume;
	this.updateSampleValue();

};

ChannelSquare.prototype.clockSweep = function() {
	
	if(--this.sweepCounter<=0){
		
		this.sweepCounter = this.sweepCounterMax + 1;
		if(this.sweepActive && this.sweepShiftAmount>0 && this.progTimerMax>7){
			
			// Calculate result from shifter:
			this.sweepCarry = false;
			if(this.sweepMode==0){
				this.progTimerMax += (this.progTimerMax>>this.sweepShiftAmount);
				if(this.progTimerMax > 4095){
					this.progTimerMax = 4095;
					this.sweepCarry = true;
				}
			}else{
				this.progTimerMax = this.progTimerMax - ((this.progTimerMax>>this.sweepShiftAmount)-(this.sqr1?1:0));
			}
			
		}
			
	}
	
	if(this.updateSweepPeriod){
		this.updateSweepPeriod = false;
		this.sweepCounter = this.sweepCounterMax + 1;
	}
	
};

ChannelSquare.prototype.updateSampleValue = function() {
	
	if(this.isEnabled && this.lengthCounter>0 && this.progTimerMax>7){
		
		if(this.sweepMode==0 && (this.progTimerMax + (this.progTimerMax>>this.sweepShiftAmount)) > 4095){
		//if(this.sweepCarry){
			this.sampleValue = 0;
		}else{
			this.sampleValue = this.masterVolume*this.dutyLookup[(this.dutyMode<<3)+this.squareCounter];	
		}
	}else{
		this.sampleValue = 0;
	}
	
};

ChannelSquare.prototype.writeReg = function(address, value){
	
	var addrAdd = (this.sqr1?0:4);
	if(address == 0x4000+addrAdd){
		
		// Volume/Envelope decay:
		this.envDecayDisable = ((value&0x10)!=0);
		this.envDecayRate = value & 0xF;
		this.envDecayLoopEnable = ((value&0x20)!=0);
		this.dutyMode = (value>>6)&0x3;
		this.lengthCounterEnable = ((value&0x20)==0);
		this.masterVolume = this.envDecayDisable?this.envDecayRate:this.envVolume;
		this.updateSampleValue();
		
	}else if(address == 0x4001+addrAdd){
		
		// Sweep:
		this.sweepActive = ((value&0x80)!=0);
		this.sweepCounterMax = ((value>>4)&7);
		this.sweepMode = (value>>3)&1;
		this.sweepShiftAmount = value&7;
		this.updateSweepPeriod = true;
		
	}else if(address == 0x4002+addrAdd){
		
		// Programmable timer:
		this.progTimerMax &= 0x700;
		this.progTimerMax |= value;
		
	}else if(address == 0x4003+addrAdd){
		
		// Programmable timer, length counter
		this.progTimerMax &= 0xFF;
		this.progTimerMax |= ((value&0x7)<<8);
		
		if(this.isEnabled){
			this.lengthCounter = this.papu.getLengthMax(value&0xF8);
		}
		
		this.envReset  = true;
		
	}
	
};

ChannelSquare.prototype.setEnabled = function(value){
	this.isEnabled = value;
	if(!value) this.lengthCounter = 0;
	this.updateSampleValue();
};

ChannelSquare.prototype.getLengthStatus = function() {
	return ((this.lengthCounter==0 || !this.isEnabled)?0:1);
};


function ChannelTriangle(papu) {
	this.papu = papu;
	
	this.isEnabled = null;
	this.sampleCondition = null;
	this.lengthCounterEnable = null;
	this.lcHalt = null;
	this.lcControl = null;
	
	this.progTimerCount = null;
	this.progTimerMax = null;
	this.triangleCounter = null;
	this.lengthCounter = null;
	this.linearCounter = null;
	this.lcLoadValue = null;
	this.sampleValue = null;
	this.tmp = null;
    
    this.reset();
}

ChannelTriangle.prototype.reset = function(){
	this.progTimerCount = 0;
	this.progTimerMax = 0;
	this.triangleCounter = 0;
	this.isEnabled = false;
	this.sampleCondition = false;
	this.lengthCounter = 0;
	this.lengthCounterEnable = false;
	this.linearCounter = 0;
	this.lcLoadValue = 0;
	this.lcHalt = true;
	this.lcControl = false;
	this.tmp = 0;
	this.sampleValue = 0xF;
};

ChannelTriangle.prototype.clockLengthCounter = function(){
	if(this.lengthCounterEnable && this.lengthCounter>0){
		this.lengthCounter--;
		if(this.lengthCounter==0){
			this.updateSampleCondition();
		}
	}
};

ChannelTriangle.prototype.clockLinearCounter = function(){
	if(this.lcHalt){
		// Load:
		this.linearCounter = this.lcLoadValue;
		this.updateSampleCondition();
	}else if(this.linearCounter > 0){
		// Decrement:
		this.linearCounter--;
		this.updateSampleCondition();
	}
	if(!this.lcControl){
		// Clear halt flag:
		this.lcHalt = false;
	}
};

ChannelTriangle.prototype.getLengthStatus = function(){
	return ((this.lengthCounter === 0 || !this.isEnabled)?0:1);
};

ChannelTriangle.prototype.readReg = function(address){
	return 0;
};

ChannelTriangle.prototype.writeReg = function(address, value){
	
	if(address == 0x4008){
		
		// New values for linear counter:
		this.lcControl 	= (value&0x80)!==0;
		this.lcLoadValue =  value&0x7F;
		
		// Length counter enable:
		this.lengthCounterEnable = !this.lcControl;
		
	}else if(address == 0x400A){
		
		// Programmable timer:
		this.progTimerMax &= 0x700;
		this.progTimerMax |= value;
		
	}else if(address == 0x400B){
		
		// Programmable timer, length counter
		this.progTimerMax &= 0xFF;
		this.progTimerMax |= ((value&0x07)<<8);
		this.lengthCounter = this.papu.getLengthMax(value&0xF8);
		this.lcHalt = true;
		
	}
	
	this.updateSampleCondition();
	
};

ChannelTriangle.prototype.clockProgrammableTimer = function(nCycles){
	
	if(this.progTimerMax>0){
		this.progTimerCount += nCycles;
		while(this.progTimerMax > 0 && this.progTimerCount >= this.progTimerMax){
			this.progTimerCount-=this.progTimerMax;
			if(this.isEnabled && this.lengthCounter>0 && this.linearCounter>0){
				this.clockTriangleGenerator();
			}
		}
	}
	
};

ChannelTriangle.prototype.clockTriangleGenerator = function(){
	this.triangleCounter++;
	this.triangleCounter &= 0x1F;
};

ChannelTriangle.prototype.setEnabled = function(value){
	this.isEnabled = value;
	if(!value) this.lengthCounter = 0;
	this.updateSampleCondition();
};

ChannelTriangle.prototype.updateSampleCondition = function(){
	this.sampleCondition = 
		this.isEnabled 		&& 
		this.progTimerMax>7 	&&
		this.linearCounter>0 && 
		this.lengthCounter>0
	;
};



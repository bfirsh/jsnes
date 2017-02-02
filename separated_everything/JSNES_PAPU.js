JSNES.PAPU = function(nes) {
    if (!(this instanceof JSNES.PAPU)) return new JSNES.PAPU(nes)
    this.nes = nes;

    this.square1 = new JSNES.PAPU.ChannelSquare(this, true);
    this.square2 = new JSNES.PAPU.ChannelSquare(this, false);
    this.triangle = new JSNES.PAPU.ChannelTriangle(this);
    this.noise = new JSNES.PAPU.ChannelNoise(this);
    this.dmc = new JSNES.PAPU.ChannelDM(this);

    this.frameIrqCounter = null;
    this.frameIrqCounterMax = 4;
    this.initCounter = 2048;
    this.channelEnableValue = null;

    this.bufferSize = 8192;
    this.bufferIndex = 0;
    this.sampleRate = 44100;

    this.lengthLookup = null;
    this.dmcFreqLookup = null;
    this.noiseWavelengthLookup = null;
    this.square_table = null;
    this.tnd_table = null;
    this.sampleBuffer = new Array(this.bufferSize*2);

    this.frameIrqEnabled = false;
    this.frameIrqActive = null;
    this.frameClockNow = null;
    this.startedPlaying=false;
    this.recordOutput = false;
    this.initingHardware = false;

    this.masterFrameCounter = null;
    this.derivedFrameCounter = null;
    this.countSequence = null;
    this.sampleTimer = null;
    this.frameTime = null;
    this.sampleTimerMax = null;
    this.sampleCount = null;
    this.triValue = 0;

    this.smpSquare1 = null;
    this.smpSquare2 = null;
    this.smpTriangle = null;
    this.smpDmc = null;
    this.accCount = null;

    // DC removal vars:
    this.prevSampleL = 0;
    this.prevSampleR = 0;
    this.smpAccumL = 0;
    this.smpAccumR = 0;

    // DAC range:
    this.dacRange = 0;
    this.dcValue = 0;

    // Master volume:
    this.masterVolume = 256;

    // Stereo positioning:
    this.stereoPosLSquare1 = null;
    this.stereoPosLSquare2 = null;
    this.stereoPosLTriangle = null;
    this.stereoPosLNoise = null;
    this.stereoPosLDMC = null;
    this.stereoPosRSquare1 = null;
    this.stereoPosRSquare2 = null;
    this.stereoPosRTriangle = null;
    this.stereoPosRNoise = null;
    this.stereoPosRDMC = null;

    this.extraCycles = null;

    this.maxSample = null;
    this.minSample = null;

    // Panning:
    this.panning = [80, 170, 100, 150, 128];
    this.setPanning(this.panning);

    // Initialize lookup tables:
    this.initLengthLookup();
    this.initDmcFrequencyLookup();
    this.initNoiseWavelengthLookup();
    this.initDACtables();

    // Init sound registers:
    for (var i = 0; i < 0x14; i++) {
        if (i === 0x10){
            this.writeReg(0x4010, 0x10);
        }
        else {
            this.writeReg(0x4000 + i, 0);
        }
    }

    this.reset();
};

JSNES.PAPU.prototype = {
    reset: function() {
        this.sampleRate = this.nes.opts.sampleRate;
        this.sampleTimerMax = Math.floor(
            (1024.0 * this.nes.opts.CPU_FREQ_NTSC *
                this.nes.opts.preferredFrameRate) /
                (this.sampleRate * 60.0)
        );

        this.frameTime = Math.floor(
            (14915.0 * this.nes.opts.preferredFrameRate) / 60.0
        );

        this.sampleTimer = 0;
        this.bufferIndex = 0;

        this.updateChannelEnable(0);
        this.masterFrameCounter = 0;
        this.derivedFrameCounter = 0;
        this.countSequence = 0;
        this.sampleCount = 0;
        this.initCounter = 2048;
        this.frameIrqEnabled = false;
        this.initingHardware = false;

        this.resetCounter();

        this.square1.reset();
        this.square2.reset();
        this.triangle.reset();
        this.noise.reset();
        this.dmc.reset();

        this.bufferIndex = 0;
        this.accCount = 0;
        this.smpSquare1 = 0;
        this.smpSquare2 = 0;
        this.smpTriangle = 0;
        this.smpDmc = 0;

        this.frameIrqEnabled = false;
        this.frameIrqCounterMax = 4;

        this.channelEnableValue = 0xFF;
        this.startedPlaying = false;
        this.prevSampleL = 0;
        this.prevSampleR = 0;
        this.smpAccumL = 0;
        this.smpAccumR = 0;

        this.maxSample = -500000;
        this.minSample = 500000;
    },

    readReg: function(address){
        // Read 0x4015:
        var tmp = 0;
        tmp |= (this.square1.getLengthStatus()   );
        tmp |= (this.square2.getLengthStatus() <<1);
        tmp |= (this.triangle.getLengthStatus()<<2);
        tmp |= (this.noise.getLengthStatus()   <<3);
        tmp |= (this.dmc.getLengthStatus()     <<4);
        tmp |= (((this.frameIrqActive && this.frameIrqEnabled)? 1 : 0) << 6);
        tmp |= (this.dmc.getIrqStatus()        <<7);

        this.frameIrqActive = false;
        this.dmc.irqGenerated = false;

        return tmp & 0xFFFF;
    },

    writeReg: function(address, value){
        if (address >= 0x4000 && address < 0x4004) {
            // Square Wave 1 Control
            this.square1.writeReg(address, value);
            ////System.out.println("Square Write");
        }
        else if (address >= 0x4004 && address < 0x4008) {
            // Square 2 Control
            this.square2.writeReg(address, value);
        }
        else if (address >= 0x4008 && address < 0x400C) {
            // Triangle Control
            this.triangle.writeReg(address, value);
        }
        else if (address >= 0x400C && address <= 0x400F) {
            // Noise Control
            this.noise.writeReg(address, value);
        }
        else if (address === 0x4010){
            // DMC Play mode & DMA frequency
            this.dmc.writeReg(address, value);
        }
        else if (address === 0x4011){
            // DMC Delta Counter
            this.dmc.writeReg(address, value);
        }
        else if (address === 0x4012){
            // DMC Play code starting address
            this.dmc.writeReg(address, value);
        }
        else if (address === 0x4013){
            // DMC Play code length
            this.dmc.writeReg(address, value);
        }
        else if (address === 0x4015){
            // Channel enable
            this.updateChannelEnable(value);

            if (value !== 0 && this.initCounter > 0) {
                // Start hardware initialization
                this.initingHardware = true;
            }

            // DMC/IRQ Status
            this.dmc.writeReg(address, value);
        }
        else if (address === 0x4017) {
            // Frame counter control
            this.countSequence = (value>>7)&1;
            this.masterFrameCounter = 0;
            this.frameIrqActive = false;

            if (((value>>6)&0x1)===0){
                this.frameIrqEnabled = true;
            }
            else {
                this.frameIrqEnabled = false;
            }

            if (this.countSequence === 0) {
                // NTSC:
                this.frameIrqCounterMax = 4;
                this.derivedFrameCounter = 4;
            }
            else {
                // PAL:
                this.frameIrqCounterMax = 5;
                this.derivedFrameCounter = 0;
                this.frameCounterTick();
            }
        }
    },

    resetCounter: function(){
        if (this.countSequence === 0) {
            this.derivedFrameCounter = 4;
        }else{
            this.derivedFrameCounter = 0;
        }
    },

    // Updates channel enable status.
    // This is done on writes to the
    // channel enable register (0x4015),
    // and when the user enables/disables channels
    // in the GUI.
    updateChannelEnable: function(value){
        this.channelEnableValue = value&0xFFFF;
        this.square1.setEnabled((value&1) !== 0);
        this.square2.setEnabled((value&2) !== 0);
        this.triangle.setEnabled((value&4) !== 0);
        this.noise.setEnabled((value&8) !== 0);
        this.dmc.setEnabled((value&16) !== 0);
    },

    // Clocks the frame counter. It should be clocked at
    // twice the cpu speed, so the cycles will be
    // divided by 2 for those counters that are
    // clocked at cpu speed.
    clockFrameCounter: function(nCycles){
        if (this.initCounter > 0) {
            if (this.initingHardware) {
                this.initCounter -= nCycles;
                if (this.initCounter <= 0) {
                    this.initingHardware = false;
                }
                return;
            }
        }

        // Don't process ticks beyond next sampling:
        nCycles += this.extraCycles;
        var maxCycles = this.sampleTimerMax-this.sampleTimer;
        if ((nCycles<<10) > maxCycles) {

            this.extraCycles = ((nCycles<<10) - maxCycles)>>10;
            nCycles -= this.extraCycles;

        }else{

            this.extraCycles = 0;

        }

        var dmc = this.dmc;
        var triangle = this.triangle;
        var square1 = this.square1;
        var square2 = this.square2;
        var noise = this.noise;

        // Clock DMC:
        if (dmc.isEnabled) {

            dmc.shiftCounter-=(nCycles<<3);
            while(dmc.shiftCounter<=0 && dmc.dmaFrequency>0){
                dmc.shiftCounter += dmc.dmaFrequency;
                dmc.clockDmc();
            }

        }

        // Clock Triangle channel Prog timer:
        if (triangle.progTimerMax>0) {

            triangle.progTimerCount -= nCycles;
            while(triangle.progTimerCount <= 0){

                triangle.progTimerCount += triangle.progTimerMax+1;
                if (triangle.linearCounter>0 && triangle.lengthCounter>0) {

                    triangle.triangleCounter++;
                    triangle.triangleCounter &= 0x1F;

                    if (triangle.isEnabled) {
                        if (triangle.triangleCounter>=0x10) {
                            // Normal value.
                            triangle.sampleValue = (triangle.triangleCounter&0xF);
                        }else{
                            // Inverted value.
                            triangle.sampleValue = (0xF - (triangle.triangleCounter&0xF));
                        }
                        triangle.sampleValue <<= 4;
                    }
                }
            }
        }

        // Clock Square channel 1 Prog timer:
        square1.progTimerCount -= nCycles;
        if (square1.progTimerCount <= 0) {

            square1.progTimerCount += (square1.progTimerMax+1)<<1;

            square1.squareCounter++;
            square1.squareCounter&=0x7;
            square1.updateSampleValue();

        }

        // Clock Square channel 2 Prog timer:
        square2.progTimerCount -= nCycles;
        if (square2.progTimerCount <= 0) {

            square2.progTimerCount += (square2.progTimerMax+1)<<1;

            square2.squareCounter++;
            square2.squareCounter&=0x7;
            square2.updateSampleValue();

        }

        // Clock noise channel Prog timer:
        var acc_c = nCycles;
        if (noise.progTimerCount-acc_c > 0) {

            // Do all cycles at once:
            noise.progTimerCount -= acc_c;
            noise.accCount       += acc_c;
            noise.accValue       += acc_c * noise.sampleValue;

        }else{

            // Slow-step:
            while((acc_c--) > 0){

                if (--noise.progTimerCount <= 0 && noise.progTimerMax>0) {

                    // Update noise shift register:
                    noise.shiftReg <<= 1;
                    noise.tmp = (((noise.shiftReg << (noise.randomMode===0?1:6)) ^ noise.shiftReg) & 0x8000 );
                    if (noise.tmp !== 0) {

                        // Sample value must be 0.
                        noise.shiftReg |= 0x01;
                        noise.randomBit = 0;
                        noise.sampleValue = 0;

                    }else{

                        // Find sample value:
                        noise.randomBit = 1;
                        if (noise.isEnabled && noise.lengthCounter>0) {
                            noise.sampleValue = noise.masterVolume;
                        }else{
                            noise.sampleValue = 0;
                        }

                    }

                    noise.progTimerCount += noise.progTimerMax;

                }

                noise.accValue += noise.sampleValue;
                noise.accCount++;

            }
        }


        // Frame IRQ handling:
        if (this.frameIrqEnabled && this.frameIrqActive){
            this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
        }

        // Clock frame counter at double CPU speed:
        this.masterFrameCounter += (nCycles<<1);
        if (this.masterFrameCounter >= this.frameTime) {
            // 240Hz tick:
            this.masterFrameCounter -= this.frameTime;
            this.frameCounterTick();
        }

        // Accumulate sample value:
        this.accSample(nCycles);

        // Clock sample timer:
        this.sampleTimer += nCycles<<10;
        if (this.sampleTimer>=this.sampleTimerMax) {
            // Sample channels:
            this.sample();
            this.sampleTimer -= this.sampleTimerMax;
        }
    },

    accSample: function(cycles) {
        // Special treatment for triangle channel - need to interpolate.
        if (this.triangle.sampleCondition) {
            this.triValue = Math.floor((this.triangle.progTimerCount << 4) /
                    (this.triangle.progTimerMax + 1));
            if (this.triValue > 16) {
                this.triValue = 16;
            }
            if (this.triangle.triangleCounter >= 16) {
                this.triValue = 16 - this.triValue;
            }

            // Add non-interpolated sample value:
            this.triValue += this.triangle.sampleValue;
        }

        // Now sample normally:
        if (cycles === 2) {

            this.smpTriangle += this.triValue                << 1;
            this.smpDmc      += this.dmc.sample         << 1;
            this.smpSquare1  += this.square1.sampleValue    << 1;
            this.smpSquare2  += this.square2.sampleValue    << 1;
            this.accCount    += 2;

        }else if (cycles === 4) {

            this.smpTriangle += this.triValue                << 2;
            this.smpDmc      += this.dmc.sample         << 2;
            this.smpSquare1  += this.square1.sampleValue    << 2;
            this.smpSquare2  += this.square2.sampleValue    << 2;
            this.accCount    += 4;

        }else{

            this.smpTriangle += cycles * this.triValue;
            this.smpDmc      += cycles * this.dmc.sample;
            this.smpSquare1  += cycles * this.square1.sampleValue;
            this.smpSquare2  += cycles * this.square2.sampleValue;
            this.accCount    += cycles;

        }

    },

    frameCounterTick: function(){

        this.derivedFrameCounter++;
        if (this.derivedFrameCounter >= this.frameIrqCounterMax) {
            this.derivedFrameCounter = 0;
        }

        if (this.derivedFrameCounter===1 || this.derivedFrameCounter===3) {

            // Clock length & sweep:
            this.triangle.clockLengthCounter();
            this.square1.clockLengthCounter();
            this.square2.clockLengthCounter();
            this.noise.clockLengthCounter();
            this.square1.clockSweep();
            this.square2.clockSweep();

        }

        if (this.derivedFrameCounter >= 0 && this.derivedFrameCounter < 4) {

            // Clock linear & decay:
            this.square1.clockEnvDecay();
            this.square2.clockEnvDecay();
            this.noise.clockEnvDecay();
            this.triangle.clockLinearCounter();

        }

        if (this.derivedFrameCounter === 3 && this.countSequence===0) {

            // Enable IRQ:
            this.frameIrqActive = true;

        }


        // End of 240Hz tick

    },


    // Samples the channels, mixes the output together,
    // writes to buffer and (if enabled) file.
    sample: function(){
        var sq_index, tnd_index;

        if (this.accCount > 0) {

            this.smpSquare1 <<= 4;
            this.smpSquare1 = Math.floor(this.smpSquare1 / this.accCount);

            this.smpSquare2 <<= 4;
            this.smpSquare2 = Math.floor(this.smpSquare2 / this.accCount);

            this.smpTriangle = Math.floor(this.smpTriangle / this.accCount);

            this.smpDmc <<= 4;
            this.smpDmc = Math.floor(this.smpDmc / this.accCount);

            this.accCount = 0;
        }
        else {
            this.smpSquare1 = this.square1.sampleValue << 4;
            this.smpSquare2 = this.square2.sampleValue << 4;
            this.smpTriangle = this.triangle.sampleValue;
            this.smpDmc = this.dmc.sample << 4;
        }

        var smpNoise = Math.floor((this.noise.accValue << 4) /
                this.noise.accCount);
        this.noise.accValue = smpNoise >> 4;
        this.noise.accCount = 1;

        // Stereo sound.

        // Left channel:
        sq_index  = (
                this.smpSquare1 * this.stereoPosLSquare1 +
                this.smpSquare2 * this.stereoPosLSquare2
            ) >> 8;
        tnd_index = (
                3 * this.smpTriangle * this.stereoPosLTriangle +
                (smpNoise<<1) * this.stereoPosLNoise + this.smpDmc *
                this.stereoPosLDMC
            ) >> 8;
        if (sq_index >= this.square_table.length) {
            sq_index  = this.square_table.length-1;
        }
        if (tnd_index >= this.tnd_table.length) {
            tnd_index = this.tnd_table.length - 1;
        }
        var sampleValueL = this.square_table[sq_index] +
                this.tnd_table[tnd_index] - this.dcValue;

        // Right channel:
        sq_index = (this.smpSquare1 * this.stereoPosRSquare1 +
                this.smpSquare2 * this.stereoPosRSquare2
            ) >> 8;
        tnd_index = (3 * this.smpTriangle * this.stereoPosRTriangle +
                (smpNoise << 1) * this.stereoPosRNoise + this.smpDmc *
                this.stereoPosRDMC
            ) >> 8;
        if (sq_index >= this.square_table.length) {
            sq_index = this.square_table.length - 1;
        }
        if (tnd_index >= this.tnd_table.length) {
            tnd_index = this.tnd_table.length - 1;
        }
        var sampleValueR = this.square_table[sq_index] +
                this.tnd_table[tnd_index] - this.dcValue;

        // Remove DC from left channel:
        var smpDiffL = sampleValueL - this.prevSampleL;
        this.prevSampleL += smpDiffL;
        this.smpAccumL += smpDiffL - (this.smpAccumL >> 10);
        sampleValueL = this.smpAccumL;

        // Remove DC from right channel:
        var smpDiffR     = sampleValueR - this.prevSampleR;
        this.prevSampleR += smpDiffR;
        this.smpAccumR  += smpDiffR - (this.smpAccumR >> 10);
        sampleValueR = this.smpAccumR;

        // Write:
        if (sampleValueL > this.maxSample) {
            this.maxSample = sampleValueL;
        }
        if (sampleValueL < this.minSample) {
            this.minSample = sampleValueL;
        }
        this.sampleBuffer[this.bufferIndex++] = sampleValueL;
        this.sampleBuffer[this.bufferIndex++] = sampleValueR;

        // Write full buffer
        if (this.bufferIndex === this.sampleBuffer.length) {
            this.nes.ui.writeAudio(this.sampleBuffer);
            this.sampleBuffer = new Array(this.bufferSize*2);
            this.bufferIndex = 0;
        }

        // Reset sampled values:
        this.smpSquare1 = 0;
        this.smpSquare2 = 0;
        this.smpTriangle = 0;
        this.smpDmc = 0;

    },

    getLengthMax: function(value){
        return this.lengthLookup[value >> 3];
    },

    getDmcFrequency: function(value){
        if (value >= 0 && value < 0x10) {
            return this.dmcFreqLookup[value];
        }
        return 0;
    },

    getNoiseWaveLength: function(value){
        if (value >= 0 && value < 0x10) {
            return this.noiseWavelengthLookup[value];
        }
        return 0;
    },

    setPanning: function(pos){
        for (var i = 0; i < 5; i++) {
            this.panning[i] = pos[i];
        }
        this.updateStereoPos();
    },

    setMasterVolume: function(value){
        if (value < 0) {
            value = 0;
        }
        if (value > 256) {
            value = 256;
        }
        this.masterVolume = value;
        this.updateStereoPos();
    },

    updateStereoPos: function(){
        this.stereoPosLSquare1 = (this.panning[0] * this.masterVolume) >> 8;
        this.stereoPosLSquare2 = (this.panning[1] * this.masterVolume) >> 8;
        this.stereoPosLTriangle = (this.panning[2] * this.masterVolume) >> 8;
        this.stereoPosLNoise = (this.panning[3] * this.masterVolume) >> 8;
        this.stereoPosLDMC = (this.panning[4] * this.masterVolume) >> 8;

        this.stereoPosRSquare1 = this.masterVolume - this.stereoPosLSquare1;
        this.stereoPosRSquare2 = this.masterVolume - this.stereoPosLSquare2;
        this.stereoPosRTriangle = this.masterVolume - this.stereoPosLTriangle;
        this.stereoPosRNoise = this.masterVolume - this.stereoPosLNoise;
        this.stereoPosRDMC = this.masterVolume - this.stereoPosLDMC;
    },

    initLengthLookup: function(){

        this.lengthLookup = [
            0x0A, 0xFE,
            0x14, 0x02,
            0x28, 0x04,
            0x50, 0x06,
            0xA0, 0x08,
            0x3C, 0x0A,
            0x0E, 0x0C,
            0x1A, 0x0E,
            0x0C, 0x10,
            0x18, 0x12,
            0x30, 0x14,
            0x60, 0x16,
            0xC0, 0x18,
            0x48, 0x1A,
            0x10, 0x1C,
            0x20, 0x1E
        ];
    },

    initDmcFrequencyLookup: function(){

        this.dmcFreqLookup = new Array(16);

        this.dmcFreqLookup[0x0] = 0xD60;
        this.dmcFreqLookup[0x1] = 0xBE0;
        this.dmcFreqLookup[0x2] = 0xAA0;
        this.dmcFreqLookup[0x3] = 0xA00;
        this.dmcFreqLookup[0x4] = 0x8F0;
        this.dmcFreqLookup[0x5] = 0x7F0;
        this.dmcFreqLookup[0x6] = 0x710;
        this.dmcFreqLookup[0x7] = 0x6B0;
        this.dmcFreqLookup[0x8] = 0x5F0;
        this.dmcFreqLookup[0x9] = 0x500;
        this.dmcFreqLookup[0xA] = 0x470;
        this.dmcFreqLookup[0xB] = 0x400;
        this.dmcFreqLookup[0xC] = 0x350;
        this.dmcFreqLookup[0xD] = 0x2A0;
        this.dmcFreqLookup[0xE] = 0x240;
        this.dmcFreqLookup[0xF] = 0x1B0;
        //for(int i=0;i<16;i++)dmcFreqLookup[i]/=8;

    },

    initNoiseWavelengthLookup: function(){

        this.noiseWavelengthLookup = new Array(16);

        this.noiseWavelengthLookup[0x0] = 0x004;
        this.noiseWavelengthLookup[0x1] = 0x008;
        this.noiseWavelengthLookup[0x2] = 0x010;
        this.noiseWavelengthLookup[0x3] = 0x020;
        this.noiseWavelengthLookup[0x4] = 0x040;
        this.noiseWavelengthLookup[0x5] = 0x060;
        this.noiseWavelengthLookup[0x6] = 0x080;
        this.noiseWavelengthLookup[0x7] = 0x0A0;
        this.noiseWavelengthLookup[0x8] = 0x0CA;
        this.noiseWavelengthLookup[0x9] = 0x0FE;
        this.noiseWavelengthLookup[0xA] = 0x17C;
        this.noiseWavelengthLookup[0xB] = 0x1FC;
        this.noiseWavelengthLookup[0xC] = 0x2FA;
        this.noiseWavelengthLookup[0xD] = 0x3F8;
        this.noiseWavelengthLookup[0xE] = 0x7F2;
        this.noiseWavelengthLookup[0xF] = 0xFE4;

    },

    initDACtables: function(){
        var value, ival, i;
        var max_sqr = 0;
        var max_tnd = 0;

        this.square_table = new Array(32*16);
        this.tnd_table = new Array(204*16);

        for (i = 0; i < 32 * 16; i++) {
            value = 95.52 / (8128.0 / (i/16.0) + 100.0);
            value *= 0.98411;
            value *= 50000.0;
            ival = Math.floor(value);

            this.square_table[i] = ival;
            if (ival > max_sqr) {
                max_sqr = ival;
            }
        }

        for (i = 0; i < 204 * 16; i++) {
            value = 163.67 / (24329.0 / (i/16.0) + 100.0);
            value *= 0.98411;
            value *= 50000.0;
            ival = Math.floor(value);

            this.tnd_table[i] = ival;
            if (ival > max_tnd) {
                max_tnd = ival;
            }

        }

        this.dacRange = max_sqr+max_tnd;
        this.dcValue = this.dacRange/2;

    }
};

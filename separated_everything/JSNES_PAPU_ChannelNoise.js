JSNES.PAPU.ChannelNoise = function(papu) {
    if (!(this instanceof JSNES.PAPU.ChannelNoise)) return new JSNES.PAPU.ChannelNoise(papu)
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
};

JSNES.PAPU.ChannelNoise.prototype = {
    reset: function() {
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
    },

    clockLengthCounter: function(){
        if (this.lengthCounterEnable && this.lengthCounter>0){
            this.lengthCounter--;
            if (this.lengthCounter === 0) {
                this.updateSampleValue();
            }
        }
    },

    clockEnvDecay: function() {
        if(this.envReset) {
            // Reset envelope:
            this.envReset = false;
            this.envDecayCounter = this.envDecayRate + 1;
            this.envVolume = 0xF;
        }
        else if (--this.envDecayCounter <= 0) {
            // Normal handling:
            this.envDecayCounter = this.envDecayRate + 1;
            if(this.envVolume>0) {
                this.envVolume--;
            }
            else {
                this.envVolume = this.envDecayLoopEnable ? 0xF : 0;
            }
        }
        this.masterVolume = this.envDecayDisable ? this.envDecayRate : this.envVolume;
        this.updateSampleValue();
    },

    updateSampleValue: function() {
        if (this.isEnabled && this.lengthCounter>0) {
            this.sampleValue = this.randomBit * this.masterVolume;
        }
    },

    writeReg: function(address, value){
        if(address === 0x400C) {
            // Volume/Envelope decay:
            this.envDecayDisable = ((value&0x10) !== 0);
            this.envDecayRate = value&0xF;
            this.envDecayLoopEnable = ((value&0x20) !== 0);
            this.lengthCounterEnable = ((value&0x20)===0);
            this.masterVolume = this.envDecayDisable?this.envDecayRate:this.envVolume;

        }else if(address === 0x400E) {
            // Programmable timer:
            this.progTimerMax = this.papu.getNoiseWaveLength(value&0xF);
            this.randomMode = value>>7;

        }else if(address === 0x400F) {
            // Length counter
            this.lengthCounter = this.papu.getLengthMax(value&248);
            this.envReset = true;
        }
        // Update:
        //updateSampleValue();
    },

    setEnabled: function(value){
        this.isEnabled = value;
        if (!value) {
            this.lengthCounter = 0;
        }
        this.updateSampleValue();
    },

    getLengthStatus: function() {
        return ((this.lengthCounter===0 || !this.isEnabled)?0:1);
    }
};

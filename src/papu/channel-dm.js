import { fromJSON, toJSON } from "../utils.js";

class ChannelDM {
  static MODE_NORMAL = 0;
  static MODE_LOOP = 1;
  static MODE_IRQ = 2;

  static JSON_PROPERTIES = [
    "isEnabled",
    "hasSample",
    "irqGenerated",
    "playMode",
    "dmaFrequency",
    "dmaCounter",
    "deltaCounter",
    "playStartAddress",
    "playAddress",
    "playLength",
    "playLengthCounter",
    "shiftCounter",
    "reg4012",
    "reg4013",
    "sample",
    "dacLsb",
    "data",
    "lastFetchedByte",
  ];

  constructor(papu) {
    this.papu = papu;

    this.isEnabled = false;
    this.hasSample = false;
    this.irqGenerated = false;
    this.playMode = ChannelDM.MODE_NORMAL;
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
    this.lastFetchedByte = 0;
  }

  clockDmc() {
    // Only alter DAC value if the sample buffer has data:
    if (this.hasSample) {
      if ((this.data & 1) === 0) {
        // Decrement delta:
        if (this.deltaCounter > 0) {
          this.deltaCounter--;
        }
      } else {
        // Increment delta:
        if (this.deltaCounter < 63) {
          this.deltaCounter++;
        }
      }

      // Update sample value:
      this.sample = this.isEnabled ? (this.deltaCounter << 1) + this.dacLsb : 0;

      // Update shift register:
      this.data >>= 1;
    }

    this.dmaCounter--;
    if (this.dmaCounter <= 0) {
      // No more sample bits.
      this.hasSample = false;
      this.endOfSample();
      this.dmaCounter = 8;
    }

    if (this.irqGenerated) {
      this.papu.nes.cpu.requestIrq(this.papu.nes.cpu.IRQ_NORMAL);
    }
  }

  endOfSample() {
    if (this.playLengthCounter === 0 && this.playMode === ChannelDM.MODE_LOOP) {
      // Start from beginning of sample:
      this.playAddress = this.playStartAddress;
      this.playLengthCounter = this.playLength;
    }

    if (this.playLengthCounter > 0) {
      // Fetch next sample:
      this.nextSample();

      if (this.playLengthCounter === 0) {
        // Last byte of sample fetched, generate IRQ:
        if (this.playMode === ChannelDM.MODE_IRQ) {
          // Generate IRQ:
          this.irqGenerated = true;
        }
      }
    }
  }

  nextSample() {
    // Fetch byte:
    this.data = this.papu.nes.mmap.load(this.playAddress);
    // On real hardware, the DMA fetch puts this byte on the CPU data bus.
    // Store it so cpu.load() can detect DMA bus hijacking mid-instruction.
    // See https://www.nesdev.org/wiki/APU_DMC#Memory_reader
    this.lastFetchedByte = this.data;
    this.papu.nes.cpu.haltCycles(4);

    this.playLengthCounter--;
    this.playAddress++;
    if (this.playAddress > 0xffff) {
      this.playAddress = 0x8000;
    }

    this.hasSample = true;
  }

  writeReg(address, value) {
    if (address === 0x4010) {
      // Play mode, DMA Frequency
      if (value >> 6 === 0) {
        this.playMode = ChannelDM.MODE_NORMAL;
      } else if (((value >> 6) & 1) === 1) {
        this.playMode = ChannelDM.MODE_LOOP;
      } else if (value >> 6 === 2) {
        this.playMode = ChannelDM.MODE_IRQ;
      }

      if ((value & 0x80) === 0) {
        this.irqGenerated = false;
      }

      this.dmaFrequency = this.papu.getDmcFrequency(value & 0xf);
    } else if (address === 0x4011) {
      // Delta counter load register:
      this.deltaCounter = (value >> 1) & 63;
      this.dacLsb = value & 1;
      this.sample = (this.deltaCounter << 1) + this.dacLsb; // update sample value
    } else if (address === 0x4012) {
      // DMA address load register.
      // Only updates the start address register — the active playAddress is
      // loaded from playStartAddress when a sample restart occurs (via $4015).
      // See https://www.nesdev.org/wiki/APU_DMC
      this.playStartAddress = (value << 6) | 0x0c000;
      this.reg4012 = value;
    } else if (address === 0x4013) {
      // Length of play code.
      // Only updates the length register — the active playLengthCounter is
      // loaded from playLength when a sample restart occurs (via $4015 or
      // loop). Writing $4013 does not affect a currently playing sample.
      // See https://www.nesdev.org/wiki/APU_DMC
      this.playLength = (value << 4) + 1;
      this.reg4013 = value;
    } else if (address === 0x4015) {
      // DMC/IRQ Status
      // Writing $4015 always clears the DMC IRQ flag first, before any
      // other effects. On real hardware, the flag clear occurs on the
      // write cycle, while DMA fetches happen 3-4 cycles later — so a
      // DMA fetch triggered by this write CAN set a new IRQ flag.
      // See https://www.nesdev.org/wiki/APU_DMC
      this.irqGenerated = false;

      if (((value >> 4) & 1) === 0) {
        // Disable: set bytes remaining to 0.
        this.playLengthCounter = 0;
      } else {
        // Enable: only restart the sample if bytes remaining is 0.
        // If the sample is still playing (bytes remaining > 0), this
        // write has no effect on playback.
        if (this.playLengthCounter === 0) {
          this.playAddress = this.playStartAddress;
          this.playLengthCounter = this.playLength;
          // On real hardware, when DMC is enabled and the sample buffer is
          // empty, a DMA fetch fires within a few CPU cycles. Trigger it
          // immediately so the DMASync loop in test ROMs can detect the
          // first fetch. See https://www.nesdev.org/wiki/APU_DMC
          if (!this.hasSample && this.playLengthCounter > 0) {
            this.nextSample();
            this.dmaCounter = 8;
            this.shiftCounter = this.dmaFrequency;
            // If the immediate DMA fetch consumed the last byte (e.g. a
            // 1-byte sample), set the IRQ flag just like endOfSample does.
            if (
              this.playLengthCounter === 0 &&
              this.playMode === ChannelDM.MODE_IRQ
            ) {
              this.irqGenerated = true;
            }
          }
        }
      }
    }
  }

  setEnabled(value) {
    // Just track the enable flag. The restart logic (reloading address and
    // length counter) is handled in writeReg for $4015, which is always
    // called after setEnabled in the $4015 write path.
    this.isEnabled = value;
  }

  getLengthStatus() {
    return this.playLengthCounter === 0 || !this.isEnabled ? 0 : 1;
  }

  getIrqStatus() {
    return this.irqGenerated ? 1 : 0;
  }

  toJSON() {
    return toJSON(this);
  }

  fromJSON(s) {
    fromJSON(this, s);
  }
}

export default ChannelDM;

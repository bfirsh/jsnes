import { fromJSON, toJSON } from "../utils.js";
import { IRQ_SOURCE_DMC } from "../cpu.js";

// The DMC (delta modulation channel) plays 1-bit delta-encoded samples that
// it reads directly from CPU memory using DMA.
//
// It is made of three parts:
//
// - The *memory reader* fetches sample bytes from memory (via DMA, which
//   halts the CPU for a few cycles) into a one-byte *sample buffer*. It
//   keeps track of the current address and how many bytes remain.
// - The *output unit* has an 8-bit shift register. Every time the timer
//   expires, it shifts out one bit and moves the output level up or down
//   by 2. When the shift register runs out of bits, it starts a new "output
//   cycle" by taking the byte in the sample buffer (if any). That empties
//   the buffer, which makes the memory reader request the next byte.
// - The *timer* counts CPU cycles; its period is set by $4010.
//
// The exact timing of the DMA requests is observable by the CPU (the CPU
// gets halted, and the DMA's reads can have side effects), and test ROMs
// such as AccuracyCoin use DMC DMA to synchronize themselves, so this is
// emulated per CPU cycle.
//
// See https://www.nesdev.org/wiki/APU_DMC and https://www.nesdev.org/wiki/DMA
class ChannelDM {
  static JSON_PROPERTIES = [
    "isEnabled",
    "irqEnabled",
    "loop",
    "irqFlag",
    "period",
    "timer",
    "outputLevel",
    "sample",
    "sampleAddress",
    "sampleLength",
    "currentAddress",
    "bytesRemaining",
    "buffer",
    "bufferEmpty",
    "shiftRegister",
    "bitsRemaining",
    "silence",
    "startDelay",
    "disableDelay",
    "lastFetchCycle",
  ];

  constructor(papu) {
    this.papu = papu;

    // The "enable" bit from $4015 as last written (only used for audio).
    this.isEnabled = false;

    // $4010
    this.irqEnabled = false;
    this.loop = false;
    this.period = 428; // Timer period in CPU cycles

    this.irqFlag = false;
    this.timer = 428;

    // Output unit
    this.outputLevel = 0; // 7-bit DAC level, set by $4011 or by the shifter
    this.sample = 0; // Current audio output value (= outputLevel)
    this.shiftRegister = 0;
    this.bitsRemaining = 8;
    this.silence = true;

    // Memory reader
    this.sampleAddress = 0xc000; // $4012
    this.sampleLength = 1; // $4013
    this.currentAddress = 0xc000;
    this.bytesRemaining = 0;
    this.buffer = 0;
    this.bufferEmpty = true;

    // Delays (in CPU cycles) for effects of $4015 writes. On real hardware
    // these happen on APU clock edges, so they depend on the cycle parity.
    this.startDelay = 0;
    this.disableDelay = 0;
    // CPU cycle of the most recent DMA fetch.
    this.lastFetchCycle = -100;
  }

  // Called once per CPU cycle.
  clockCycle() {
    if (this.disableDelay !== 0 && --this.disableDelay === 0) {
      // Disabling via $4015 takes effect now. If a DMA was already
      // scheduled, it gets cancelled (or aborted, if it already halted the
      // CPU).
      this.bytesRemaining = 0;
      this.papu.nes.cpu.stopDmcDma();
    }
    if (this.startDelay !== 0 && --this.startDelay === 0) {
      this._requestDma();
    }

    if (--this.timer === 0) {
      this.timer = this.period;
      this._clockOutput();
    }
  }

  // One output unit step (each time the timer expires).
  _clockOutput() {
    if (!this.silence) {
      if ((this.shiftRegister & 1) !== 0) {
        if (this.outputLevel <= 125) this.outputLevel += 2;
      } else {
        if (this.outputLevel >= 2) this.outputLevel -= 2;
      }
      this._updateSample();
    }
    this.shiftRegister >>= 1;
    if (--this.bitsRemaining === 0) {
      // Start a new output cycle.
      this.bitsRemaining = 8;
      if (this.bufferEmpty) {
        this.silence = true;
      } else {
        this.silence = false;
        this.shiftRegister = this.buffer;
        this.bufferEmpty = true;
        // The buffer is now empty: the memory reader fetches the next byte.
        this._requestDma();
      }
    }
  }

  _updateSample() {
    this.papu._flushAudio();
    this.sample = this.outputLevel;
  }

  _requestDma() {
    // While a $4015 write's start delay is counting down, the DMA can't
    // start yet (it will be requested when the delay expires).
    if (!this.bufferEmpty || this.startDelay !== 0) return;
    const cpu = this.papu.nes.cpu;
    if (this.bytesRemaining > 0) {
      cpu.startDmcDma();
    } else if (cpu.cycles - this.lastFetchCycle <= 2) {
      // "Implicit abort": the DMA unit only notices that the sample ended
      // a couple of cycles after the fetch of the last byte. If the output
      // unit empties the buffer within that window (this happens when a
      // 1-byte sample is started just before the output unit finishes its
      // cycle), a reload DMA starts but is aborted right away. It still
      // halts the CPU for one cycle (or not at all, if that cycle is a
      // write). See https://www.nesdev.org/wiki/DMA#DMC_DMA and the
      // AccuracyCoin "Implicit DMA Abort" test.
      cpu.startAbortedDmcDma();
    }
  }

  // Called by the CPU's DMA unit with the byte it read from currentAddress.
  dmaComplete(value) {
    this.lastFetchCycle = this.papu.nes.cpu.cycles;
    if (this.bytesRemaining === 0) return;
    this.buffer = value;
    this.bufferEmpty = false;
    // The address wraps from $FFFF to $8000.
    this.currentAddress =
      this.currentAddress === 0xffff ? 0x8000 : this.currentAddress + 1;
    this.bytesRemaining--;
    if (this.bytesRemaining === 0) {
      if (this.loop) {
        this._restart();
      } else if (this.irqEnabled) {
        this._setIrq(true);
      }
    }
  }

  _restart() {
    this.currentAddress = this.sampleAddress;
    this.bytesRemaining = this.sampleLength;
  }

  _setIrq(active) {
    this.irqFlag = active;
    this.papu.nes.cpu.setIrqSource(IRQ_SOURCE_DMC, active);
  }

  writeReg(address, value) {
    if (address === 0x4010) {
      // Bit 7: IRQ enable, bit 6: loop, bits 0-3: rate index
      this.irqEnabled = (value & 0x80) !== 0;
      this.loop = (value & 0x40) !== 0;
      if (!this.irqEnabled) {
        this._setIrq(false);
      }
      // (The lookup table is in units of 1/8 CPU cycle.)
      this.period = this.papu.getDmcFrequency(value & 0xf) >> 3;
    } else if (address === 0x4011) {
      // Direct load of the output level.
      this.outputLevel = value & 0x7f;
      this._updateSample();
    } else if (address === 0x4012) {
      // Sample address = $C000 + value * 64
      this.sampleAddress = 0xc000 | (value << 6);
    } else if (address === 0x4013) {
      // Sample length = value * 16 + 1 bytes
      this.sampleLength = (value << 4) | 1;
    } else if (address === 0x4015) {
      // Writing $4015 always clears the DMC interrupt flag.
      this._setIrq(false);
      // How long until the APU acts on the write depends on the phase of
      // the APU clock.
      const put = this.papu._isPutCycle();
      if ((value & 0x10) === 0) {
        // Disable: bytes remaining is set to 0 after a short delay.
        if (this.disableDelay === 0) {
          this.disableDelay = put ? 2 : 3;
        }
      } else {
        this.disableDelay = 0;
        if (this.bytesRemaining === 0) {
          // Enable with no sample playing: restart the sample. If the
          // sample buffer is empty, the first byte gets fetched shortly.
          this._restart();
          this.startDelay = put ? 2 : 3;
        }
      }
    }
  }

  setEnabled(value) {
    this.isEnabled = value;
  }

  getLengthStatus() {
    return this.bytesRemaining > 0 ? 1 : 0;
  }

  getIrqStatus() {
    return this.irqFlag ? 1 : 0;
  }

  toJSON() {
    return toJSON(this);
  }

  fromJSON(s) {
    fromJSON(this, s);
  }
}

export default ChannelDM;

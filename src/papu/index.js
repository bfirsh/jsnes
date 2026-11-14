import { fromJSON, toJSON } from "../utils.js";
import ChannelDM from "./channel-dm.js";
import ChannelNoise from "./channel-noise.js";
import ChannelSquare from "./channel-square.js";
import ChannelTriangle from "./channel-triangle.js";
import { IRQ_SOURCE_FRAME } from "../cpu.js";

const CPU_FREQ_NTSC = 1789772.5; //1789772.72727272d;
// const CPU_FREQ_PAL = 1773447.4;

// Frame counter step timing tables (in CPU cycles).
// The APU frame counter fires at these specific cycle positions within each
// sequence. On real hardware, the APU clock is half the CPU clock, so
// these correspond to APU cycles 3728.5, 7456.5, 11185.5, 14914, 14914.5 etc.
// In 4-step mode, the IRQ flag is set 1 CPU cycle before the clock event
// (at 29828 vs 29829), so step 3 is split into two sub-steps.
// See https://www.nesdev.org/wiki/APU_Frame_Counter
const FRAME_STEPS_4 = [7457, 14913, 22371, 29828, 29829];
// 5-step mode step 3 fires at 29829 per the nesdev wiki, not 29828. This is
// fine because fireFrameStep step 3 in 5-step mode is a no-op (no clock or IRQ).
const FRAME_STEPS_5 = [7457, 14913, 22371, 29829, 37281];
const FRAME_PERIOD_4 = 29830; // Total CPU cycles for 4-step sequence
const FRAME_PERIOD_5 = 37282; // Total CPU cycles for 5-step sequence

class PAPU {
  constructor(nes) {
    this.nes = nes;

    // Catch-up state (see catchUp()): the last CPU cycle the APU has been
    // clocked for, and the next cycle on which something happens.
    this.lastCycle = 0;
    this.nextEventCycle = 0;
    // The CPU cycle the APU is currently processing: the cycle of a
    // register access, or of the event cycle being clocked. (With catch-up,
    // this can be behind cpu.cycles.) Used for timing quirks that depend on
    // which cycle a write landed on (see length-counter.js).
    this.cycle = 0;

    this.square1 = new ChannelSquare(this, true);
    this.square2 = new ChannelSquare(this, false);
    this.triangle = new ChannelTriangle(this);
    this.noise = new ChannelNoise(this);
    this.dmc = new ChannelDM(this);

    this.startedPlaying = false;
    this.recordOutput = false;
    this.triValue = 0;

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

    // Panning:
    this.panning = [80, 170, 100, 150, 128];
    this.setPanning(this.panning);

    // Initialize lookup tables:
    this.initLengthLookup();
    this.initDmcFrequencyLookup();
    this.initNoiseWavelengthLookup();
    this.initDACtables();

    // Init sound registers:
    for (let i = 0; i < 0x14; i++) {
      if (i === 0x10) {
        this.writeReg(0x4010, 0x10);
      } else {
        this.writeReg(0x4000 + i, 0);
      }
    }

    this.sampleRate = this.nes.opts.sampleRate;
    // With emulateSound off, the channels' timers and the mixer aren't run
    // (everything the CPU can observe still is).
    this.emulateSound = this.nes.opts.emulateSound !== false;
    this.sampleTimerMax = Math.floor(
      (1024.0 * CPU_FREQ_NTSC) / this.sampleRate,
    );
    this.sampleTimer = 0;
    this.updateChannelEnable(0);
    this.frameCycleCounter = 0;
    this.lastCycle = 0;
    this.frameStep = 0;
    this.countSequence = 0;
    this.sampleCount = 0;
    this.frameIrqEnabled = true;
    this.frameIrqActive = false;
    // Deferred clearing of the frame IRQ flag: on real hardware, reading
    // $4015 doesn't clear bit 6 immediately. The clear takes effect at the
    // next APU "get" cycle (the APU clock runs at half the CPU rate, so
    // get/put phases alternate every CPU cycle). This matters when $4015 is
    // read twice in quick succession (e.g., by the SLO RMW instruction's
    // dummy read + actual read, which are 1 CPU cycle apart). Depending on
    // the APU phase alignment, the second read may or may not still see
    // the flag. See AccuracyCoin test 0x0467 subtests 6 and 7.
    // https://www.nesdev.org/wiki/APU_Frame_Counter
    this.frameIrqClearPending = false;
    // CPU cycles until a pending frame IRQ flag clear takes effect.
    this.frameIrqClearDelay = 0;
    // Counter value at which the frame counter next has something to do.
    this.nextFrameEvent = FRAME_STEPS_4[0];
    // CPU cycles not yet run through the audio synthesis (_flushAudio), and
    // how many to accumulate before running them.
    this.pendingAudioCycles = 0;
    this.audioFlushAt = 1;
    this.accCount = 0;
    this.smpSquare1 = 0;
    this.smpSquare2 = 0;
    this.smpTriangle = 0;
    this.smpDmc = 0;
    this.channelEnableValue = 0xff;
    this.maxSample = -500000;
    this.minSample = 500000;

    this._scheduleNextEvent();
  }

  // Read $4015 (APU status). Called by the CPU's bus.
  readReg(address) {
    this.catchUp(this.nes.cpu.cycles);
    this.cycle = this.nes.cpu.cycles;
    const value = this._readStatus(address);
    this._scheduleNextEvent();
    return value;
  }

  // Write an APU register ($4000-$4017). Called by the CPU's bus.
  writeReg(address, value) {
    this.catchUp(this.nes.cpu.cycles);
    this.cycle = this.nes.cpu.cycles;
    this._writeRegister(address, value);
    this._scheduleNextEvent();
  }

  // The reset button. All channels are silenced as if $4015 were written
  // with 0 (which also clears the DMC IRQ flag), the frame IRQ flag is
  // cleared, and the frame counter restarts as if the last value written to
  // $4017 were written again, except that the IRQ inhibit flag is cleared.
  // Other channel registers ($4000-$4013) are unchanged. Restarting the
  // counter here, 7 cycles (the reset sequence) before the first
  // instruction, gives the same timing as at power-on, which matches
  // "as if $4017 were written 9-12 cycles before the first instruction"
  // once the write delay is accounted for.
  // See https://www.nesdev.org/wiki/CPU_power_up_state and blargg's
  // apu_reset tests.
  softReset() {
    this.catchUp(this.nes.cpu.cycles);
    this.cycle = this.nes.cpu.cycles;
    this._writeRegister(0x4015, 0);
    this.frameIrqEnabled = true;
    this.frameIrqClearPending = false;
    this._setFrameIrq(false);
    this.frameCycleCounter = 0;
    this.frameStep = 0;
    this._updateNextFrameEvent();
    this._scheduleNextEvent();
  }

  // eslint-disable-next-line no-unused-vars
  _readStatus(address) {
    // Read 0x4015:
    let tmp = 0;
    tmp |= this.square1.getLengthStatus();
    tmp |= this.square2.getLengthStatus() << 1;
    tmp |= this.triangle.getLengthStatus() << 2;
    tmp |= this.noise.getLengthStatus() << 3;
    tmp |= this.dmc.getLengthStatus() << 4;
    // Bit 5 is open bus (not driven by APU), comes from CPU data bus
    // See https://www.nesdev.org/wiki/Open_bus_behavior
    tmp |= this.nes.cpu.dataBus & 0x20;
    // Frame interrupt flag: reflects whether the flag is set, regardless of
    // the IRQ inhibit bit in $4017. The inhibit only prevents the IRQ from
    // firing, not the flag from being reported.
    tmp |= (this.frameIrqActive ? 1 : 0) << 6;
    tmp |= this.dmc.getIrqStatus() << 7;

    // Reading $4015 schedules the frame interrupt flag for clearing, but
    // the actual clear is deferred to the next APU "get" cycle. This means
    // if two reads happen 1 CPU cycle apart (e.g., dummy + actual read in
    // an RMW instruction), the second read may still see the flag depending
    // on APU clock phase alignment. The DMC interrupt flag is NOT cleared.
    // Only schedule a clear when the flag is actually set; otherwise a stale
    // pending clear could race with a future fireFrameStep that sets the flag.
    // See https://www.nesdev.org/wiki/APU#Status_($4015)
    if (this.frameIrqActive) {
      this.frameIrqClearPending = true;
      // The clear happens at the next put->get transition: after this cycle
      // if this cycle is a "put" cycle, otherwise one cycle later.
      this.frameIrqClearDelay = this._isPutCycle() ? 1 : 2;
    }

    return tmp & 0xff;
  }

  _writeRegister(address, value) {
    this._flushAudio();
    if (address >= 0x4000 && address < 0x4004) {
      // Square Wave 1 Control
      this.square1.writeReg(address, value);
      // console.log("Square Write");
    } else if (address >= 0x4004 && address < 0x4008) {
      // Square 2 Control
      this.square2.writeReg(address, value);
    } else if (address >= 0x4008 && address < 0x400c) {
      // Triangle Control
      this.triangle.writeReg(address, value);
    } else if (address >= 0x400c && address <= 0x400f) {
      // Noise Control
      this.noise.writeReg(address, value);
    } else if (address === 0x4010) {
      // DMC Play mode & DMA frequency
      this.dmc.writeReg(address, value);
    } else if (address === 0x4011) {
      // DMC Delta Counter
      this.dmc.writeReg(address, value);
    } else if (address === 0x4012) {
      // DMC Play code starting address
      this.dmc.writeReg(address, value);
    } else if (address === 0x4013) {
      // DMC Play code length
      this.dmc.writeReg(address, value);
    } else if (address === 0x4015) {
      // Channel enable
      this.updateChannelEnable(value);

      // DMC/IRQ Status
      this.dmc.writeReg(address, value);
    } else if (address === 0x4017) {
      // Frame counter control
      // Bit 7: sequence mode (0=4-step, 1=5-step)
      // Bit 6: IRQ inhibit (0=IRQs enabled, 1=IRQs disabled)
      // See https://www.nesdev.org/wiki/APU_Frame_Counter
      this.countSequence = (value >> 7) & 1;
      // Writing $4017 resets the frame counter's internal divider, but on
      // real hardware the reset is delayed after the write cycle. The delay
      // depends on the APU clock phase at the write:
      //   "get" phase (odd parity): reset after 3 CPU cycles
      //   "put" phase (even parity): reset after 4 CPU cycles
      // Since the emulator clocks the full STA instruction's cycles (4 for
      // STA absolute) after writeReg, we compensate by starting the counter
      // negative so it reaches 0 at the true reset point.
      // See https://www.nesdev.org/wiki/APU_Frame_Counter
      // The counter is clocked at the end of this (write) cycle. The reset
      // takes effect 3 CPU cycles after a write on a put cycle, or 4 after
      // a write on a get cycle.
      this.frameCycleCounter = this._isPutCycle() ? -3 : -4;
      this.frameStep = 0;
      this._updateNextFrameEvent();

      if (value & 0x40) {
        // IRQ inhibit set: clear the frame interrupt flag and prevent
        // future frame IRQs from firing
        this.frameIrqEnabled = false;
        this.frameIrqClearPending = false;
        this._setFrameIrq(false);
      } else {
        // IRQ inhibit clear: enable frame IRQs (flag is not affected)
        this.frameIrqEnabled = true;
        this._setFrameIrq(this.frameIrqActive);
      }

      if (this.countSequence === 1) {
        // 5-step mode: immediately clock all quarter-frame and half-frame
        // units on the write cycle
        this.clockQuarterFrame();
        this.clockHalfFrame();
      }
    }
  }

  // Updates channel enable status.
  // This is done on writes to the
  // channel enable register (0x4015),
  // and when the user enables/disables channels
  // in the GUI.
  updateChannelEnable(value) {
    this.channelEnableValue = value & 0xffff;
    this.square1.setEnabled((value & 1) !== 0);
    this.square2.setEnabled((value & 2) !== 0);
    this.triangle.setEnabled((value & 4) !== 0);
    this.noise.setEnabled((value & 8) !== 0);
    this.dmc.setEnabled((value & 16) !== 0);
  }

  // Clock the APU by one CPU cycle. Called by the CPU at the end of every
  // CPU cycle (after that cycle's bus access).
  //
  // Everything that the CPU can observe (the frame counter, length counter
  // status, IRQ flags and DMC DMA requests) is updated exactly, every cycle.
  // The parts that only affect the audio output (square/triangle/noise
  // timers and the output mixer) are batched up and run every few cycles
  // by _flushAudio() for speed.
  // --- Catch-up ---
  //
  // Like the PPU (see PPU.catchUp()), the APU isn't clocked every CPU cycle.
  // Between "events" (a frame counter step, the DMC timer expiring, an
  // audio sample being due, the short delays after a $4015/$4017 access),
  // all it does is count, so it can be advanced in bulk. The CPU calls
  // catchUp() on the cycle of the next event, and before any access to the
  // APU's registers.

  // Clock the APU up to and including CPU cycle `cycle`.
  catchUp(cycle) {
    while (this.lastCycle < cycle) {
      let next = this.nextEventCycle;
      if (next <= this.lastCycle) next = this.lastCycle + 1;
      if (next > cycle) {
        this._advance(cycle - this.lastCycle);
        this.lastCycle = cycle;
        return;
      }
      if (next - 1 > this.lastCycle) {
        this._advance(next - 1 - this.lastCycle);
        this.lastCycle = next - 1;
      }
      this.clockCycle(next);
      this.lastCycle = next;
      this._scheduleNextEvent();
    }
  }

  // Advance by n cycles, none of which is an event cycle, so only the
  // counters move.
  _advance(n) {
    if (this.emulateSound) this.pendingAudioCycles += n;
    this.frameCycleCounter += n;
    // The DMC timer counts on even cycles (see clockCycle()).
    const a = this.lastCycle;
    this.dmc.timer -= 2 * (((a + n) >> 1) - (a >> 1));
  }

  // Work out the next cycle (after lastCycle) on which clockCycle() has
  // more to do than count.
  _scheduleNextEvent() {
    const last = this.lastCycle;
    const dmc = this.dmc;
    if ((this.frameIrqClearDelay | dmc.disableDelay | dmc.startDelay) !== 0) {
      // A short delay is counting down: clock every cycle.
      this.nextEventCycle = last + 1;
      return;
    }
    // Frame counter step.
    let next = last + (this.nextFrameEvent - this.frameCycleCounter);
    // Audio output sample.
    if (this.emulateSound) {
      const a = last + (this.audioFlushAt - this.pendingAudioCycles);
      if (a < next) next = a;
    }
    // DMC timer expiry: it loses 2 on each even cycle.
    let even = last + 1;
    if (even & 1) even++;
    const steps = (dmc.timer + 1) >> 1;
    const d = steps > 1 ? even + 2 * (steps - 1) : even;
    if (d < next) next = d;
    this.nextEventCycle = next > last ? next : last + 1;
  }

  // Clock the APU by one CPU cycle (an event cycle; see catchUp()).
  clockCycle(cycle) {
    this.cycle = cycle;
    // Batched audio synthesis (skipped entirely if sound is off).
    if (this.emulateSound && ++this.pendingAudioCycles >= this.audioFlushAt) {
      this._flushAudio();
    }

    const dmc = this.dmc;
    // Rarely-active countdowns: the deferred clear of the frame interrupt
    // flag after a $4015 read, and the DMC's $4015 start/disable delays.
    if ((this.frameIrqClearDelay | dmc.disableDelay | dmc.startDelay) !== 0) {
      this._clockDelays();
    }

    // Frame counter.
    if (++this.frameCycleCounter >= this.nextFrameEvent) {
      this._advanceFrameSteps();
    }

    // The DMC timer is clocked by the APU clock, i.e. on every other CPU
    // cycle (the "get" cycles), so DMA requests always line up the same way
    // with the get/put phase. Its period is in CPU cycles (always even).
    if ((cycle & 1) === 0) {
      dmc.timer -= 2;
      if (dmc.timer <= 0) {
        dmc.timer = dmc.period;
        dmc._clockOutput();
      }
    }
  }

  _clockDelays() {
    if (this.frameIrqClearDelay !== 0 && --this.frameIrqClearDelay === 0) {
      if (this.frameIrqClearPending) {
        this.frameIrqClearPending = false;
        this._setFrameIrq(false);
      }
    }
    this.dmc.clockDelays();
  }

  // Run the audio-only parts of the APU for the cycles accumulated since
  // the last flush. Called before anything that changes channel state
  // (register writes, frame counter clocks) so those take effect at
  // (nearly) the right time in the audio output.
  _flushAudio() {
    let nCycles = this.pendingAudioCycles;
    this.pendingAudioCycles = 0;
    while (nCycles > 0) {
      // Don't process channel ticks beyond the next output sample.
      let n = this._cyclesToNextSample();
      if (nCycles < n) n = nCycles;
      this._clockChannels(n);
      nCycles -= n;
    }
    // Unless something changes channel state first, run the next batch
    // when the next output sample is due.
    this.audioFlushAt = this._cyclesToNextSample();
  }

  // CPU cycles until the next output sample is produced (at least 1).
  _cyclesToNextSample() {
    const n = ((this.sampleTimerMax - this.sampleTimer) >> 10) + 1;
    return n < 1 ? 1 : n;
  }

  // Clocks the square, triangle and noise channel timers and the audio
  // sample accumulator by nCycles CPU cycles.
  _clockChannels(nCycles) {
    let triangle = this.triangle;
    let square1 = this.square1;
    let square2 = this.square2;
    let noise = this.noise;

    // Clock Triangle channel Prog timer:
    if (triangle.progTimerMax > 0) {
      triangle.progTimerCount -= nCycles;
      while (triangle.progTimerCount <= 0) {
        triangle.progTimerCount += triangle.progTimerMax + 1;
        if (triangle.linearCounter > 0 && triangle.lengthCounter > 0) {
          triangle.triangleCounter++;
          triangle.triangleCounter &= 0x1f;

          if (triangle.isEnabled) {
            if (triangle.triangleCounter >= 0x10) {
              // Normal value.
              triangle.sampleValue = triangle.triangleCounter & 0xf;
            } else {
              // Inverted value.
              triangle.sampleValue = 0xf - (triangle.triangleCounter & 0xf);
            }
            triangle.sampleValue <<= 4;
          }
        }
      }
    }

    // Clock the square channels. Their output is accumulated exactly (each
    // value weighted by how many cycles it lasted), so the batch can span
    // several steps of the waveform.
    this.smpSquare1 += this._clockSquare(square1, nCycles);
    this.smpSquare2 += this._clockSquare(square2, nCycles);

    // Clock the noise channel.
    this._clockNoise(noise, nCycles);

    // Accumulate sample value:
    this.accSample(nCycles);

    // Clock sample timer:
    this.sampleTimer += nCycles << 10;
    if (this.sampleTimer >= this.sampleTimerMax) {
      // Sample channels:
      this.sample();
      this.sampleTimer -= this.sampleTimerMax;
    }
  }

  // Run a square channel's timer for nCycles CPU cycles. Returns the sum of
  // its output over those cycles.
  _clockSquare(square, nCycles) {
    const period = (square.progTimerMax + 1) << 1;
    let count = square.progTimerCount;
    if (count < 0) count = 0;
    let remaining = nCycles;
    if (!(
      square.isEnabled &&
      square.lengthCounter > 0 &&
      square.progTimerMax > 7
    )) {
      // Silent (see ChannelSquare.updateSampleValue()): the output is 0 on
      // every step, so just work out where the waveform ends up.
      if (count > remaining) {
        square.progTimerCount = count - remaining;
      } else {
        const rest = remaining - count;
        const steps = 1 + Math.floor(rest / period);
        square.squareCounter = (square.squareCounter + steps) & 0x7;
        square.progTimerCount = period - (rest % period);
        square.sampleValue = 0;
      }
      return 0;
    }
    let sum = 0;
    // The waveform steps when the timer reaches 0.
    while (count <= remaining) {
      sum += square.sampleValue * count;
      remaining -= count;
      count = period;
      square.squareCounter = (square.squareCounter + 1) & 0x7;
      square.updateSampleValue();
    }
    square.progTimerCount = count - remaining;
    return sum + square.sampleValue * remaining;
  }

  // Run the noise channel's timer for nCycles CPU cycles, accumulating its
  // output into noise.accValue/accCount. The output changes on the cycle
  // the timer reaches 0, and that cycle already counts with the new value.
  _clockNoise(noise, nCycles) {
    noise.accCount += nCycles;
    if (noise.progTimerMax <= 0) {
      noise.progTimerCount -= nCycles;
      noise.accValue += nCycles * noise.sampleValue;
      return;
    }
    let count = noise.progTimerCount;
    if (count < 1) count = 1;
    let remaining = nCycles;
    let sum = 0;
    while (count <= remaining) {
      sum += noise.sampleValue * (count - 1);
      remaining -= count;
      // Step the 15-bit shift register (the "random" bit generator).
      noise.shiftReg <<= 1;
      noise.tmp =
        ((noise.shiftReg << (noise.randomMode === 0 ? 1 : 6)) ^
          noise.shiftReg) &
        0x8000;
      if (noise.tmp !== 0) {
        noise.shiftReg |= 0x01;
        noise.randomBit = 0;
        noise.sampleValue = 0;
      } else {
        noise.randomBit = 1;
        noise.sampleValue =
          noise.isEnabled && noise.lengthCounter > 0 ? noise.masterVolume : 0;
      }
      sum += noise.sampleValue;
      count = noise.progTimerMax;
    }
    noise.progTimerCount = count - remaining;
    noise.accValue += sum + noise.sampleValue * remaining;
  }

  // Set or clear the frame interrupt flag, updating the CPU's IRQ line.
  // The line is only asserted if IRQs are not inhibited by $4017 bit 6.
  _setFrameIrq(active) {
    this.frameIrqActive = active;
    this.nes.cpu.setIrqSource(IRQ_SOURCE_FRAME, active && this.frameIrqEnabled);
  }

  // The APU is clocked at half the CPU rate, so each CPU cycle is either the
  // first ("get") or second ("put") half of an APU cycle. The DMA unit
  // (which shares this clock) reads on get cycles and writes on put cycles,
  // so after an OAM DMA the CPU is always on a known phase; test ROMs rely
  // on this to time their $4015/$4017 accesses.
  // Returns true if the current CPU cycle is a "put" cycle.
  // See https://www.nesdev.org/wiki/APU#Glossary and https://www.nesdev.org/wiki/DMA
  _isPutCycle() {
    return (this.nes.cpu.cycles & 1) === 1;
  }

  // Fire any frame counter steps that are due. The step loop and period
  // wrap are separate: steps fire when the counter reaches each step's
  // cycle position, and the period wrap occurs when the counter reaches the
  // full period length (not immediately after the last step). This matters
  // because in 4-step mode, the last step fires at 29829 but the period wrap
  // (and 3rd IRQ assertion) occurs at 29830.
  // See https://www.nesdev.org/wiki/APU_Frame_Counter
  _advanceFrameSteps() {
    let steps = this.countSequence === 0 ? FRAME_STEPS_4 : FRAME_STEPS_5;
    let period = this.countSequence === 0 ? FRAME_PERIOD_4 : FRAME_PERIOD_5;
    for (;;) {
      if (
        this.frameStep < steps.length &&
        this.frameCycleCounter >= steps[this.frameStep]
      ) {
        this.fireFrameStep(this.frameStep);
        this.frameStep++;
      } else if (
        this.frameStep >= steps.length &&
        this.frameCycleCounter >= period
      ) {
        // Period wrap: reset the frame counter for the next sequence.
        this.frameStep = 0;
        this.frameCycleCounter -= period;
        // In 4-step mode, the IRQ flag is asserted for 3 consecutive CPU
        // cycles: at 29828 (step 3), 29829 (step 4), and 29830 (period wrap).
        // On the 3rd cycle (period wrap), the flag is set only if the IRQ
        // inhibit flag is clear. If inhibit is set, the flag is actively
        // cleared (it was unconditionally set on cycles 29828-29829).
        // See https://www.nesdev.org/wiki/APU_Frame_Counter
        if (this.countSequence === 0) {
          this.frameIrqClearPending = false;
          this._setFrameIrq(this.frameIrqEnabled);
        }
      } else {
        break;
      }
    }
    this._updateNextFrameEvent();
  }

  // Cache the counter value at which _advanceFrameSteps next has work to
  // do, so clockCycle() only needs a single comparison.
  _updateNextFrameEvent() {
    let steps = this.countSequence === 0 ? FRAME_STEPS_4 : FRAME_STEPS_5;
    let period = this.countSequence === 0 ? FRAME_PERIOD_4 : FRAME_PERIOD_5;
    this.nextFrameEvent =
      this.frameStep < steps.length ? steps[this.frameStep] : period;
  }

  accSample(cycles) {
    // Special treatment for triangle channel - need to interpolate.
    if (this.triangle.sampleCondition) {
      this.triValue = Math.floor(
        (this.triangle.progTimerCount << 4) / (this.triangle.progTimerMax + 1),
      );
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
    // (The square channels are accumulated in _clockChannels().)
    this.smpTriangle += cycles * this.triValue;
    this.smpDmc += cycles * this.dmc.sample;
    this.accCount += cycles;
  }

  // Fire a frame counter step. Each step clocks different APU units depending
  // on the mode and step number.
  // See https://www.nesdev.org/wiki/APU_Frame_Counter
  fireFrameStep(step) {
    if (this.countSequence === 0) {
      // Mode 0 (4-step):
      //   Step 0 (7457): quarter frame (envelope + linear counter)
      //   Step 1 (14913): half frame (quarter + length counter + sweep)
      //   Step 2 (22371): quarter frame
      //   Step 3 (29828): set frame IRQ flag only (1 cycle before clock)
      //   Step 4 (29829): half frame + set frame IRQ flag
      // On real hardware, the IRQ flag is asserted 1 CPU cycle before the
      // clock event at the end of the 4-step sequence. This is why step 3
      // is split from step 4.
      // See https://www.nesdev.org/wiki/APU_Frame_Counter
      switch (step) {
        case 0:
          this.clockQuarterFrame();
          break;
        case 1:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          break;
        case 2:
          this.clockQuarterFrame();
          break;
        case 3:
          // IRQ flag is UNCONDITIONALLY set 1 CPU cycle before the half-frame
          // clock, regardless of the IRQ inhibit flag ($4017 bit 6). On real
          // hardware, the flag is driven high by the frame counter output for
          // cycles 29828-29829 even when inhibit is set; only the period wrap
          // at 29830 respects the inhibit flag. Cancel any pending deferred
          // clear since the flag is being re-asserted by hardware.
          // See AccuracyCoin tests I-L.
          this.frameIrqClearPending = false;
          this._setFrameIrq(true);
          break;
        case 4:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          // IRQ flag continues to be unconditionally asserted on this cycle.
          this.frameIrqClearPending = false;
          this._setFrameIrq(true);
          break;
      }
    } else {
      // Mode 1 (5-step):
      //   Step 0: quarter frame
      //   Step 1: half frame
      //   Step 2: quarter frame
      //   Step 3: nothing (no clocking, no IRQ)
      //   Step 4: half frame
      switch (step) {
        case 0:
          this.clockQuarterFrame();
          break;
        case 1:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          break;
        case 2:
          this.clockQuarterFrame();
          break;
        case 3:
          // Nothing happens at step 4 in 5-step mode
          break;
        case 4:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          break;
      }
    }
  }

  // Quarter frame: clock envelopes and triangle linear counter (~240Hz)
  clockQuarterFrame() {
    this._flushAudio();
    this.square1.clockEnvDecay();
    this.square2.clockEnvDecay();
    this.noise.clockEnvDecay();
    this.triangle.clockLinearCounter();
  }

  // Half frame: clock length counters and sweep units (~120Hz)
  clockHalfFrame() {
    this.triangle.clockLengthCounter();
    this.square1.clockLengthCounter();
    this.square2.clockLengthCounter();
    this.noise.clockLengthCounter();
    this.square1.clockSweep();
    this.square2.clockSweep();
  }

  // Samples the channels, mixes the output together, then writes to buffer.
  sample() {
    let sq_index, tnd_index;

    if (this.accCount > 0) {
      this.smpSquare1 <<= 4;
      this.smpSquare1 = Math.floor(this.smpSquare1 / this.accCount);

      this.smpSquare2 <<= 4;
      this.smpSquare2 = Math.floor(this.smpSquare2 / this.accCount);

      this.smpTriangle = Math.floor(this.smpTriangle / this.accCount);

      this.smpDmc <<= 4;
      this.smpDmc = Math.floor(this.smpDmc / this.accCount);

      this.accCount = 0;
    } else {
      this.smpSquare1 = this.square1.sampleValue << 4;
      this.smpSquare2 = this.square2.sampleValue << 4;
      this.smpTriangle = this.triangle.sampleValue;
      this.smpDmc = this.dmc.sample << 4;
    }

    let smpNoise = Math.floor((this.noise.accValue << 4) / this.noise.accCount);
    this.noise.accValue = smpNoise >> 4;
    this.noise.accCount = 1;

    // Stereo sound.

    // Left channel:
    sq_index =
      (this.smpSquare1 * this.stereoPosLSquare1 +
        this.smpSquare2 * this.stereoPosLSquare2) >>
      8;
    tnd_index =
      (3 * this.smpTriangle * this.stereoPosLTriangle +
        (smpNoise << 1) * this.stereoPosLNoise +
        this.smpDmc * this.stereoPosLDMC) >>
      8;
    if (sq_index >= this.square_table.length) {
      sq_index = this.square_table.length - 1;
    }
    if (tnd_index >= this.tnd_table.length) {
      tnd_index = this.tnd_table.length - 1;
    }
    let sampleValueL =
      this.square_table[sq_index] + this.tnd_table[tnd_index] - this.dcValue;

    // Right channel:
    sq_index =
      (this.smpSquare1 * this.stereoPosRSquare1 +
        this.smpSquare2 * this.stereoPosRSquare2) >>
      8;
    tnd_index =
      (3 * this.smpTriangle * this.stereoPosRTriangle +
        (smpNoise << 1) * this.stereoPosRNoise +
        this.smpDmc * this.stereoPosRDMC) >>
      8;
    if (sq_index >= this.square_table.length) {
      sq_index = this.square_table.length - 1;
    }
    if (tnd_index >= this.tnd_table.length) {
      tnd_index = this.tnd_table.length - 1;
    }
    let sampleValueR =
      this.square_table[sq_index] + this.tnd_table[tnd_index] - this.dcValue;

    // Remove DC from left channel:
    let smpDiffL = sampleValueL - this.prevSampleL;
    this.prevSampleL += smpDiffL;
    this.smpAccumL += smpDiffL - (this.smpAccumL >> 10);
    sampleValueL = this.smpAccumL;

    // Remove DC from right channel:
    let smpDiffR = sampleValueR - this.prevSampleR;
    this.prevSampleR += smpDiffR;
    this.smpAccumR += smpDiffR - (this.smpAccumR >> 10);
    sampleValueR = this.smpAccumR;

    // Write:
    if (sampleValueL > this.maxSample) {
      this.maxSample = sampleValueL;
    }
    if (sampleValueL < this.minSample) {
      this.minSample = sampleValueL;
    }

    if (this.nes.opts.onAudioSample) {
      this.nes.opts.onAudioSample(sampleValueL / 32768, sampleValueR / 32768);
    }

    // Reset sampled values:
    this.smpSquare1 = 0;
    this.smpSquare2 = 0;
    this.smpTriangle = 0;
    this.smpDmc = 0;
  }

  getLengthMax(value) {
    return this.lengthLookup[value >> 3];
  }

  getDmcFrequency(value) {
    if (value >= 0 && value < 0x10) {
      return this.dmcFreqLookup[value];
    }
    return 0;
  }

  getNoiseWaveLength(value) {
    if (value >= 0 && value < 0x10) {
      return this.noiseWavelengthLookup[value];
    }
    return 0;
  }

  // Recalculate the sample timer for a non-standard host frame rate.
  // At 60fps the timer fires once per (CPU_FREQ / sampleRate) cycles. If the
  // host calls frame() at a different rate, scale proportionally so the total
  // audio output per second stays constant.
  setFrameRate(rate) {
    this.sampleTimerMax = Math.floor(
      (1024.0 * CPU_FREQ_NTSC * rate) / (this.sampleRate * 60.0),
    );
  }

  setPanning(pos) {
    for (let i = 0; i < 5; i++) {
      this.panning[i] = pos[i];
    }
    this.updateStereoPos();
  }

  setMasterVolume(value) {
    if (value < 0) {
      value = 0;
    }
    if (value > 256) {
      value = 256;
    }
    this.masterVolume = value;
    this.updateStereoPos();
  }

  updateStereoPos() {
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
  }

  initLengthLookup() {
    // prettier-ignore
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
  }

  initDmcFrequencyLookup() {
    this.dmcFreqLookup = new Array(16);

    this.dmcFreqLookup[0x0] = 0xd60;
    this.dmcFreqLookup[0x1] = 0xbe0;
    this.dmcFreqLookup[0x2] = 0xaa0;
    this.dmcFreqLookup[0x3] = 0xa00;
    this.dmcFreqLookup[0x4] = 0x8f0;
    this.dmcFreqLookup[0x5] = 0x7f0;
    this.dmcFreqLookup[0x6] = 0x710;
    this.dmcFreqLookup[0x7] = 0x6b0;
    this.dmcFreqLookup[0x8] = 0x5f0;
    this.dmcFreqLookup[0x9] = 0x500;
    this.dmcFreqLookup[0xa] = 0x470;
    this.dmcFreqLookup[0xb] = 0x400;
    this.dmcFreqLookup[0xc] = 0x350;
    this.dmcFreqLookup[0xd] = 0x2a0;
    this.dmcFreqLookup[0xe] = 0x240;
    this.dmcFreqLookup[0xf] = 0x1b0;
    //for(int i=0;i<16;i++)dmcFreqLookup[i]/=8;
  }

  initNoiseWavelengthLookup() {
    this.noiseWavelengthLookup = new Array(16);

    this.noiseWavelengthLookup[0x0] = 0x004;
    this.noiseWavelengthLookup[0x1] = 0x008;
    this.noiseWavelengthLookup[0x2] = 0x010;
    this.noiseWavelengthLookup[0x3] = 0x020;
    this.noiseWavelengthLookup[0x4] = 0x040;
    this.noiseWavelengthLookup[0x5] = 0x060;
    this.noiseWavelengthLookup[0x6] = 0x080;
    this.noiseWavelengthLookup[0x7] = 0x0a0;
    this.noiseWavelengthLookup[0x8] = 0x0ca;
    this.noiseWavelengthLookup[0x9] = 0x0fe;
    this.noiseWavelengthLookup[0xa] = 0x17c;
    this.noiseWavelengthLookup[0xb] = 0x1fc;
    this.noiseWavelengthLookup[0xc] = 0x2fa;
    this.noiseWavelengthLookup[0xd] = 0x3f8;
    this.noiseWavelengthLookup[0xe] = 0x7f2;
    this.noiseWavelengthLookup[0xf] = 0xfe4;
  }

  initDACtables() {
    let value, ival, i;
    let max_sqr = 0;
    let max_tnd = 0;

    this.square_table = new Array(32 * 16);
    this.tnd_table = new Array(204 * 16);

    for (i = 0; i < 32 * 16; i++) {
      value = 95.52 / (8128.0 / (i / 16.0) + 100.0);
      value *= 0.98411;
      value *= 50000.0;
      ival = Math.floor(value);

      this.square_table[i] = ival;
      if (ival > max_sqr) {
        max_sqr = ival;
      }
    }

    for (i = 0; i < 204 * 16; i++) {
      value = 163.67 / (24329.0 / (i / 16.0) + 100.0);
      value *= 0.98411;
      value *= 50000.0;
      ival = Math.floor(value);

      this.tnd_table[i] = ival;
      if (ival > max_tnd) {
        max_tnd = ival;
      }
    }

    this.dacRange = max_sqr + max_tnd;
    this.dcValue = this.dacRange / 2;
  }

  toJSON() {
    this.catchUp(this.nes.cpu.cycles);
    let obj = toJSON(this);
    obj.dmc = this.dmc.toJSON();
    obj.noise = this.noise.toJSON();
    obj.square1 = this.square1.toJSON();
    obj.square2 = this.square2.toJSON();
    obj.triangle = this.triangle.toJSON();
    return obj;
  }

  fromJSON(s) {
    fromJSON(this, s);
    this.dmc.fromJSON(s.dmc);
    this.noise.fromJSON(s.noise);
    this.square1.fromJSON(s.square1);
    this.square2.fromJSON(s.square2);
    this.triangle.fromJSON(s.triangle);
    this._scheduleNextEvent();
  }

  static JSON_PROPERTIES = [
    "channelEnableValue",
    "sampleRate",
    "frameIrqEnabled",
    "frameIrqActive",
    "frameIrqClearPending",
    "frameIrqClearDelay",
    "nextFrameEvent",
    "pendingAudioCycles",
    "lastCycle",
    "audioFlushAt",
    "startedPlaying",
    "recordOutput",
    "frameCycleCounter",
    "frameStep",
    "countSequence",
    "sampleTimer",
    "sampleTimerMax",
    "sampleCount",
    "triValue",
    "smpSquare1",
    "smpSquare2",
    "smpTriangle",
    "smpDmc",
    "accCount",
    "prevSampleL",
    "prevSampleR",
    "smpAccumL",
    "smpAccumR",
    "masterVolume",
    "stereoPosLSquare1",
    "stereoPosLSquare2",
    "stereoPosLTriangle",
    "stereoPosLNoise",
    "stereoPosLDMC",
    "stereoPosRSquare1",
    "stereoPosRSquare2",
    "stereoPosRTriangle",
    "stereoPosRNoise",
    "stereoPosRDMC",
    "maxSample",
    "minSample",
    "panning",
  ];
}

export default PAPU;

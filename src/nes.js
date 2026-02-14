import CPU from "./cpu.js";
import Controller from "./controller.js";
import PPU from "./ppu/index.js";
import PAPU from "./papu/index.js";
import GameGenie from "./gamegenie.js";
import ROM from "./rom.js";

class NES {
  constructor(opts) {
    this.opts = {
      onFrame: function () {},
      onAudioSample: null,
      onStatusUpdate: function () {},
      onBatteryRamWrite: function () {},

      // FIXME: not actually used except for in PAPU
      preferredFrameRate: 60,

      emulateSound: true,
      sampleRate: 48000, // Sound sample rate in hz

      ...opts,
    };

    this.frameTime = 1000 / this.opts.preferredFrameRate;

    this.ui = {
      writeFrame: this.opts.onFrame,
      updateStatus: this.opts.onStatusUpdate,
    };
    this.cpu = new CPU(this);
    this.ppu = new PPU(this);
    this.papu = new PAPU(this);
    this.gameGenie = new GameGenie();
    this.gameGenie.onChange = () => this.cpu._updateCartridgeLoader();
    this.mmap = null;
    this.controllers = {
      1: new Controller(),
      2: new Controller(),
    };

    this.fpsFrameCount = 0;
    this.romData = null;

    this.ui.updateStatus("Ready to load a ROM.");
  }

  // Resets the system
  reset() {
    this.cpu = new CPU(this);
    this.ppu = new PPU(this);
    this.papu = new PAPU(this);

    if (this.mmap !== null) {
      this.mmap = this.rom.createMapper();
    }

    this.lastFpsTime = null;
    this.fpsFrameCount = 0;

    this.crashed = false;
  }

  frame = () => {
    if (this.crashed) {
      throw new Error(
        "Game has crashed. Call reset() or loadROM() to restart.",
      );
    }
    this.ppu.startFrame();
    let cycles = 0;
    const cpu = this.cpu;
    const ppu = this.ppu;
    const papu = this.papu;
    try {
      FRAMELOOP: for (;;) {
        if (cpu.cyclesToHalt === 0) {
          // Execute a CPU instruction
          cycles = cpu.emulate();
          // Pass the full cycle count for channel timers, but tell the
          // frame counter how many cycles were already advanced by APU
          // catch-up (advanceFrameCounter) mid-instruction.
          papu.clockFrameCounter(cycles, cpu.apuCatchupCycles);
          cpu.apuCatchupCycles = 0;
          // Convert CPU cycles to PPU dots (3:1 ratio), subtracting any
          // dots already advanced mid-instruction by PPU catch-up.
          // See cpu._ppuCatchUp() and https://www.nesdev.org/wiki/Catch-up
          cycles = cycles * 3 - cpu.ppuCatchupDots;
          cpu.ppuCatchupDots = 0;
          if (cpu.ppuFrameEnded) {
            // VBlank NMI was triggered during mid-instruction catch-up.
            // The frame is already rendered — break out of the frame loop.
            // Preserve remaining PPU dots so the dot position carries over
            // to the next frame. Real NES frames are 89342 PPU dots, but
            // sync loops take ~89343. Without preserving these leftover
            // dots, the 1-dot-per-frame slip that lets sync routines
            // converge on VBlank is lost.
            // See https://www.nesdev.org/wiki/PPU_frame_timing
            if (cpu.nmiRaised) {
              // NMI delay depends on which PPU dot within the CPU cycle
              // VBL fired at: >= 5 remaining dots means the edge propagates
              // in time for the final-cycle poll (0-delay), <= 4 means it
              // doesn't (1-delay). See cpu.js NMI comment.
              if (cycles >= 5) {
                cpu.nmiImmediate = true;
              } else {
                cpu.nmiPending = true;
              }
              cpu.nmiRaised = false;
            }
            ppu.curX += cycles;
            cpu.ppuFrameEnded = false;
            break FRAMELOOP;
          }
        } else {
          if (cpu.cyclesToHalt > 8) {
            cycles = 24;
            papu.clockFrameCounter(8);
            cpu.cyclesToHalt -= 8;
          } else {
            cycles = cpu.cyclesToHalt * 3;
            papu.clockFrameCounter(cpu.cyclesToHalt);
            cpu.cyclesToHalt = 0;
          }
        }

        const finalCurX = ppu.curX + cycles;
        // Fast path: skip dot-by-dot loop when no per-dot events can occur.
        // Must go dot-by-dot near VBlank set (scanline 0, dot 1), VBlank
        // clear (scanline 20, dot 1), sprite 0 hit, or scanline boundaries.
        if (
          !(ppu.scanline === 0 && ppu.vblankPending && ppu.curX <= 1 && finalCurX > 1) &&
          !(ppu.scanline === 20 && ppu.curX <= 1 && finalCurX > 1) &&
          finalCurX < 341 &&
          (ppu.spr0HitX < ppu.curX || ppu.spr0HitX >= finalCurX)
        ) {
          ppu.curX = finalCurX;
          continue FRAMELOOP;
        }

        for (; cycles > 0; cycles--) {
          // VBlank set at dot 1 of scanline 0 (NES scanline 241), gated on
          // vblankPending to ensure a full frame has been processed first.
          // See https://www.nesdev.org/wiki/PPU_frame_timing
          if (ppu.scanline === 0 && ppu.curX === 1 && ppu.vblankPending) {
            ppu.vblankPending = false;
            if (!ppu.nmiSuppressed) {
              ppu.setStatusFlag(ppu.STATUS_VBLANK, true);
              ppu._updateNmiOutput();
            }
            ppu.nmiSuppressed = false;
            // NMI delay depends on which PPU dot within the CPU cycle
            // VBL fired at: >= 5 remaining dots means the edge propagates
            // in time for the final-cycle poll (0-delay), <= 4 means it
            // doesn't (1-delay). See cpu.js NMI comment.
            if (cpu.nmiRaised) {
              if (cycles >= 5) {
                cpu.nmiImmediate = true;
              } else {
                cpu.nmiPending = true;
              }
              cpu.nmiRaised = false;
            }
            ppu.startVBlank();
            // Preserve remaining PPU dots (same rationale as ppuFrameEnded
            // path above — prevents losing the 1-dot-per-frame slip).
            ppu.curX += cycles;
            break FRAMELOOP;
          }

          // VBlank clear at dot 1 of scanline 20 (NES scanline 261, pre-render).
          if (ppu.scanline === 20 && ppu.curX === 1) {
            ppu.setStatusFlag(ppu.STATUS_VBLANK, false);
            ppu.setStatusFlag(ppu.STATUS_SPRITE0HIT, false);
            ppu.hitSpr0 = false;
            ppu.spr0HitX = -1;
            ppu.spr0HitY = -1;
            ppu._updateNmiOutput();
            // Promote falling edge cancellation immediately
            if (cpu.nmiRaised) {
              cpu.nmiPending = true;
              cpu.nmiRaised = false;
            }
          }

          if (
            ppu.curX === ppu.spr0HitX &&
            ppu.f_spVisibility === 1 &&
            ppu.scanline - 21 === ppu.spr0HitY
          ) {
            // Set sprite 0 hit flag:
            ppu.setStatusFlag(ppu.STATUS_SPRITE0HIT, true);
          }

          ppu.curX++;
          if (ppu.curX === 341) {
            ppu.curX = 0;
            ppu.endScanline();
          }
        }
      }
    } catch (e) {
      this.crashed = true;
      throw e;
    }
    this.fpsFrameCount++;
  };

  buttonDown = (controller, button) => {
    this.controllers[controller].buttonDown(button);
  };

  buttonUp = (controller, button) => {
    this.controllers[controller].buttonUp(button);
  };

  zapperMove = (x, y) => {
    if (!this.mmap) return;
    this.mmap.zapperX = x;
    this.mmap.zapperY = y;
  };

  zapperFireDown = () => {
    if (!this.mmap) return;
    this.mmap.zapperFired = true;
  };

  zapperFireUp = () => {
    if (!this.mmap) return;
    this.mmap.zapperFired = false;
  };

  getFPS() {
    const now = Date.now();
    let fps = null;
    if (this.lastFpsTime) {
      fps = this.fpsFrameCount / ((now - this.lastFpsTime) / 1000);
    }
    this.fpsFrameCount = 0;
    this.lastFpsTime = now;
    return fps;
  }

  reloadROM() {
    if (this.romData !== null) {
      this.loadROM(this.romData);
    }
  }

  // Loads a ROM file into the CPU and PPU.
  // The ROM file is validated first.
  loadROM(data) {
    // Load ROM file:
    this.rom = new ROM(this);
    this.rom.load(data);

    this.reset();
    this.mmap = this.rom.createMapper();
    this.mmap.loadROM();
    this.ppu.setMirroring(this.rom.getMirroringType());
    this.romData = data;
  }

  setFramerate(rate) {
    this.opts.preferredFrameRate = rate;
    this.frameTime = 1000 / rate;
    this.papu.setSampleRate(this.opts.sampleRate, false);
  }

  toJSON() {
    return {
      // romData: this.romData,
      cpu: this.cpu.toJSON(),
      mmap: this.mmap.toJSON(),
      ppu: this.ppu.toJSON(),
      papu: this.papu.toJSON(),
    };
  }

  fromJSON(s) {
    this.reset();
    // this.romData = s.romData;
    this.cpu.fromJSON(s.cpu);
    this.mmap.fromJSON(s.mmap);
    this.ppu.fromJSON(s.ppu);
    this.papu.fromJSON(s.papu);
  }
}

export default NES;

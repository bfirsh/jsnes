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

      emulateSound: true,
      sampleRate: 48000, // Sound sample rate in hz

      ...opts,
    };

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

  // The frame loop. PPU is advanced inline after every CPU bus operation
  // (in cpu.load/write/push/pull). APU is clocked in bulk after each
  // instruction for compatibility with its sample timing logic.
  frame = () => {
    if (this.crashed) {
      throw new Error(
        "Game has crashed. Call reset() or loadROM() to restart.",
      );
    }
    this.controllers[1].clock();
    this.controllers[2].clock();
    this.ppu.startFrame();
    let cycles;
    const cpu = this.cpu;
    const ppu = this.ppu;
    const papu = this.papu;
    try {
      for (;;) {
        if (cpu.cyclesToHalt === 0) {
          // Execute a CPU instruction. PPU advancement happens inline
          // inside the bus operations (load/write/push/pull).
          cycles = cpu.emulate();

          // Clock APU with the full cycle count. The frame counter portion
          // subtracts any cycles already advanced by APU catch-up.
          papu.clockFrameCounter(cycles, cpu.apuCatchupCycles);
          cpu.apuCatchupCycles = 0;

          // Check if VBlank fired during inline PPU stepping.
          if (ppu.frameEnded) {
            ppu.frameEnded = false;
            break;
          }
        } else {
          // DMA halt cycles: step PPU per cycle. APU is clocked in bulk.
          let chunk = Math.min(cpu.cyclesToHalt, 8);
          for (let i = 0; i < chunk; i++) {
            ppu.advanceDots(3);
          }
          papu.clockFrameCounter(chunk);
          cpu.cyclesToHalt -= chunk;

          if (ppu.frameEnded) {
            ppu.frameEnded = false;
            break;
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

  // Adjust audio sample timing for a non-standard host frame rate. At the
  // default 60fps each frame() produces ~800 samples at 48kHz. If the host
  // calls frame() less often (e.g. 30fps), the sample timer must fire more
  // frequently per CPU cycle so each frame still fills the audio buffer.
  setFramerate(rate) {
    this.papu.setFrameRate(rate);
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

import CPU from "./cpu.js";
import Controller from "./controller.js";
import PPU from "./ppu/index.js";
import PAPU from "./papu/index.js";
import GameGenie from "./gamegenie.js";
import ROM from "./rom.js";

const SAVE_STATE_VERSION = 2;

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
    this.cpu.ppu = this.ppu;
    this.cpu.papu = this.papu;
    this.gameGenie = new GameGenie();
    this.gameGenie.onChange = () => this.cpu._updateCartridgeLoader();
    this.mmap = null;
    this.controllers = {
      1: new Controller(),
      2: new Controller(),
    };

    this.fpsFrameCount = 0;
    this.rom = null;
    this.romData = null;

    this.ui.updateStatus("Ready to load a ROM.");
  }

  // Power-cycles the console: switches it off and on again with the same
  // cartridge inserted. Every component (CPU, PPU, APU and the cartridge's
  // mapper) is rebuilt in its power-on state, and the ROM's PRG/CHR banks
  // are copied into the fresh memory, so this is equivalent to calling
  // loadROM() again with the same ROM data. It's also how to recover after
  // the emulator has crashed (see `crashed`).
  //
  // This is *not* the console's reset button, which only resets the CPU and
  // a few registers and leaves RAM, the PPU and the cartridge's state alone.
  // See https://www.nesdev.org/wiki/CPU_power_up_state
  //
  // Cartridge RAM at $6000-$7FFF (including battery-backed save RAM) is
  // cleared too, as it is by loadROM(). Hosts that persist save RAM do so
  // through the onBatteryRamWrite callback.
  reset() {
    this.cpu = new CPU(this);
    this.ppu = new PPU(this);
    this.papu = new PAPU(this);
    this.cpu.ppu = this.ppu;
    this.cpu.papu = this.papu;

    this.mmap = null;
    if (this.rom !== null) {
      // The mapper copies the initial PRG-ROM banks into cpu.mem and the
      // CHR banks into PPU memory, and requests the reset interrupt so the
      // CPU starts at the address in the reset vector ($FFFC).
      this.mmap = this.rom.createMapper();
      this.mmap.loadROM();
      // The CPU reads PRG-ROM straight out of cpu.mem when it can; that
      // depends on the mapper and on whether Game Genie codes are active,
      // both of which belong to the new CPU.
      this.cpu._updateCartridgeLoader();
      this.ppu.setMirroring(this.rom.getMirroringType());
    }

    this.lastFpsTime = null;
    this.fpsFrameCount = 0;

    this.crashed = false;
  }

  // The frame loop. Runs CPU instructions until the PPU reaches the start
  // of VBlank. The CPU is cycle-stepped: every bus access it makes advances
  // the PPU (3 dots) and the APU (1 cycle), and DMA transfers happen inside
  // the CPU's read cycles, so all we need to do here is run instructions.
  frame = () => {
    if (this.crashed) {
      throw new Error(
        "Game has crashed. Call reset() or loadROM() to restart.",
      );
    }
    this.controllers[1].clock();
    this.controllers[2].clock();
    this.ppu.startFrame();
    const cpu = this.cpu;
    const ppu = this.ppu;
    try {
      if (this.mmap === null) return;
      while (!ppu.frameEnded) {
        cpu.emulate();
      }
      ppu.frameEnded = false;
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

  // Inserts a cartridge and powers the console on. The ROM file is parsed
  // and validated first, so an invalid file throws and leaves the current
  // cartridge (if any) in place.
  loadROM(data) {
    const rom = new ROM(this);
    rom.load(data);

    this.rom = rom;
    this.romData = data;
    // reset() builds the mapper for this.rom and loads it into memory.
    this.reset();
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
      // Bumped when the save state format changes incompatibly. Version 2
      // is the cycle-accurate CPU/PPU/APU.
      version: SAVE_STATE_VERSION,
      // romData: this.romData,
      cpu: this.cpu.toJSON(),
      mmap: this.mmap.toJSON(),
      ppu: this.ppu.toJSON(),
      papu: this.papu.toJSON(),
      controllers: {
        1: this.controllers[1].toJSON(),
        2: this.controllers[2].toJSON(),
      },
    };
  }

  fromJSON(s) {
    if (s.version !== SAVE_STATE_VERSION) {
      throw new Error(
        "This save state was made with an incompatible version of JSNES.",
      );
    }
    this.reset();
    // this.romData = s.romData;
    this.cpu.fromJSON(s.cpu);
    this.mmap.fromJSON(s.mmap);
    // Recompute the CPU's PRG read path now the mapper state is restored.
    this.cpu._updateCartridgeLoader();
    this.ppu.fromJSON(s.ppu);
    this.papu.fromJSON(s.papu);
    if (s.controllers) {
      if (s.controllers[1]) this.controllers[1].fromJSON(s.controllers[1]);
      if (s.controllers[2]) this.controllers[2].fromJSON(s.controllers[2]);
    }
  }
}

export default NES;

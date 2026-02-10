var CPU = require("./cpu");
var Controller = require("./controller");
var PPU = require("./ppu");
var PAPU = require("./papu");
var GameGenie = require("./gamegenie");
var ROM = require("./rom");

var NES = function (opts) {
  this.opts = {
    onFrame: function () {},
    onAudioSample: null,
    onStatusUpdate: function () {},
    onBatteryRamWrite: function () {},

    // FIXME: not actually used except for in PAPU
    preferredFrameRate: 60,

    emulateSound: true,
    sampleRate: 48000, // Sound sample rate in hz
  };
  if (typeof opts !== "undefined") {
    var key;
    for (key in this.opts) {
      if (typeof opts[key] !== "undefined") {
        this.opts[key] = opts[key];
      }
    }
  }

  this.frameTime = 1000 / this.opts.preferredFrameRate;

  this.ui = {
    writeFrame: this.opts.onFrame,
    updateStatus: this.opts.onStatusUpdate,
  };
  this.cpu = new CPU(this);
  this.ppu = new PPU(this);
  this.papu = new PAPU(this);
  this.gameGenie = new GameGenie();
  this.mmap = null; // set in loadROM()
  this.controllers = {
    1: new Controller(),
    2: new Controller(),
  };

  this.ui.updateStatus("Ready to load a ROM.");

  this.frame = this.frame.bind(this);
  this.buttonDown = this.buttonDown.bind(this);
  this.buttonUp = this.buttonUp.bind(this);
  this.zapperMove = this.zapperMove.bind(this);
  this.zapperFireDown = this.zapperFireDown.bind(this);
  this.zapperFireUp = this.zapperFireUp.bind(this);
};

NES.prototype = {
  fpsFrameCount: 0,
  romData: null,

  // Resets the system
  reset: function () {
    if (this.mmap !== null) {
      this.mmap.reset();
    }

    this.cpu.reset();
    this.ppu.reset();
    this.papu.reset();

    this.lastFpsTime = null;
    this.fpsFrameCount = 0;

    this.crashed = false;
  },

  frame: function () {
    if (this.crashed) {
      throw new Error(
        "Game has crashed. Call reset() or loadROM() to restart.",
      );
    }
    this.ppu.startFrame();
    var cycles = 0;
    var cpu = this.cpu;
    var ppu = this.ppu;
    var papu = this.papu;
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

        var finalCurX = ppu.curX + cycles;
        if (
          !ppu.requestEndFrame &&
          finalCurX < 341 &&
          (ppu.spr0HitX < ppu.curX || ppu.spr0HitX >= finalCurX)
        ) {
          ppu.curX = finalCurX;
          continue FRAMELOOP;
        }

        for (; cycles > 0; cycles--) {
          if (
            ppu.curX === ppu.spr0HitX &&
            ppu.f_spVisibility === 1 &&
            ppu.scanline - 21 === ppu.spr0HitY
          ) {
            // Set sprite 0 hit flag:
            ppu.setStatusFlag(ppu.STATUS_SPRITE0HIT, true);
          }

          if (ppu.requestEndFrame) {
            ppu.nmiCounter--;
            if (ppu.nmiCounter === 0) {
              ppu.requestEndFrame = false;
              ppu.startVBlank();
              break FRAMELOOP;
            }
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
  },

  buttonDown: function (controller, button) {
    this.controllers[controller].buttonDown(button);
  },

  buttonUp: function (controller, button) {
    this.controllers[controller].buttonUp(button);
  },

  zapperMove: function (x, y) {
    if (!this.mmap) return;
    this.mmap.zapperX = x;
    this.mmap.zapperY = y;
  },

  zapperFireDown: function () {
    if (!this.mmap) return;
    this.mmap.zapperFired = true;
  },

  zapperFireUp: function () {
    if (!this.mmap) return;
    this.mmap.zapperFired = false;
  },

  getFPS: function () {
    var now = +new Date();
    var fps = null;
    if (this.lastFpsTime) {
      fps = this.fpsFrameCount / ((now - this.lastFpsTime) / 1000);
    }
    this.fpsFrameCount = 0;
    this.lastFpsTime = now;
    return fps;
  },

  reloadROM: function () {
    if (this.romData !== null) {
      this.loadROM(this.romData);
    }
  },

  // Loads a ROM file into the CPU and PPU.
  // The ROM file is validated first.
  loadROM: function (data) {
    // Load ROM file:
    this.rom = new ROM(this);
    this.rom.load(data);

    this.reset();
    this.mmap = this.rom.createMapper();
    this.mmap.loadROM();
    this.ppu.setMirroring(this.rom.getMirroringType());
    this.romData = data;
  },

  setFramerate: function (rate) {
    this.opts.preferredFrameRate = rate;
    this.frameTime = 1000 / rate;
    this.papu.setSampleRate(this.opts.sampleRate, false);
  },

  toJSON: function () {
    return {
      // romData: this.romData,
      cpu: this.cpu.toJSON(),
      mmap: this.mmap.toJSON(),
      ppu: this.ppu.toJSON(),
      papu: this.papu.toJSON(),
    };
  },

  fromJSON: function (s) {
    this.reset();
    // this.romData = s.romData;
    this.cpu.fromJSON(s.cpu);
    this.mmap.fromJSON(s.mmap);
    this.ppu.fromJSON(s.ppu);
    this.papu.fromJSON(s.papu);
  },
};

module.exports = NES;

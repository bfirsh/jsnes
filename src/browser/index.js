import NES from "../nes.js";
import Screen from "./screen.js";
import Speakers from "./speakers.js";
import FrameTimer from "./frame-timer.js";
import KeyboardController from "./keyboard.js";
import GamepadController from "./gamepad.js";

// Debug logging, enabled via localStorage.jsnes_debug = 1
let debugEnabled = false;
try {
  debugEnabled = !!localStorage.getItem("jsnes_debug");
} catch {
  // localStorage not available
}
function debug(...args) {
  if (debugEnabled) console.log(...args);
}

/**
 * Browser-based NES emulator that handles canvas rendering, audio output,
 * keyboard/gamepad input, and frame timing.
 *
 * Usage:
 *   const browser = new jsnes.Browser({
 *     container: document.getElementById("nes"),
 *     romData: romData,
 *     onError: (e) => console.error(e),
 *   });
 *
 * If romData is omitted, call browser.loadROM(data) then browser.start().
 */
export default class Browser {
  constructor(options = {}) {
    this._options = options;

    // Create screen (creates <canvas> inside container)
    this._screen = new Screen(options.container, {
      onMouseDown: (x, y) => {
        this.nes.zapperMove(x, y);
        this.nes.zapperFireDown();
      },
      onMouseUp: () => {
        this.nes.zapperFireUp();
      },
    });
    this._screen.fitInParent();

    // Create speakers
    this._speakers = new Speakers({
      onBufferUnderrun: () => {
        // Generate extra frames so audio remains consistent. This happens for
        // a variety of reasons:
        // - Frame rate is not quite 60fps, so sometimes buffer empties
        // - Page is not visible, so requestAnimationFrame doesn't get fired.
        //   In this case emulator still runs at full speed, but timing is
        //   done by audio instead of requestAnimationFrame.
        // - System can't run emulator at full speed. In this case it'll stop
        //    firing requestAnimationFrame.
        debug("Buffer underrun, running extra frames to catch up");

        // The NES produces ~800 samples per frame at 48kHz. Run two frames
        // to ensure the worklet buffer is refilled.
        this._frameTimer.generateFrame();
        this._frameTimer.generateFrame();
      },
    });

    // Create NES
    this.nes = new NES({
      onFrame: this._screen.setBuffer,
      onStatusUpdate: debug,
      onAudioSample: this._speakers.writeSample,
      onBatteryRamWrite: options.onBatteryRamWrite || (() => {}),
      sampleRate: this._speakers.getSampleRate(),
    });

    // Create frame timer
    this._frameTimer = new FrameTimer({
      onGenerateFrame: () => {
        try {
          this.nes.frame();
          this._speakers.flush();
        } catch (e) {
          this.stop();
          if (this._options.onError) {
            this._options.onError(e);
          }
        }
      },
      onWriteFrame: this._screen.writeBuffer,
    });

    // Set up gamepad and keyboard
    this.gamepad = new GamepadController({
      onButtonDown: this.nes.buttonDown,
      onButtonUp: this.nes.buttonUp,
    });
    this.gamepad.loadGamepadConfig();
    this._gamepadPolling = this.gamepad.startPolling();

    this.keyboard = new KeyboardController({
      onButtonDown: this.gamepad.disableIfGamepadEnabled(this.nes.buttonDown),
      onButtonUp: this.gamepad.disableIfGamepadEnabled(this.nes.buttonUp),
    });
    this.keyboard.loadKeys();

    // Bind keyboard events
    document.addEventListener("keydown", this.keyboard.handleKeyDown);
    document.addEventListener("keyup", this.keyboard.handleKeyUp);
    document.addEventListener("keypress", this.keyboard.handleKeyPress);

    // Load ROM and start if provided
    if (options.romData) {
      this.nes.loadROM(options.romData);
      this.start();
    }
  }

  start() {
    this._frameTimer.start();
    this._speakers.start();
    this._fpsInterval = setInterval(() => {
      debug(`FPS: ${this.nes.getFPS()}`);
    }, 1000);
  }

  stop() {
    this._frameTimer.stop();
    this._speakers.stop();
    clearInterval(this._fpsInterval);
  }

  loadROM(data) {
    this.stop();
    this.nes.loadROM(data);
    this.start();
  }

  /**
   * Fill parent element with screen. Call if parent element changes size.
   */
  fitInParent() {
    this._screen.fitInParent();
  }

  screenshot() {
    return this._screen.screenshot();
  }

  /**
   * Clean up all resources: stop emulation, remove event listeners, remove canvas.
   */
  destroy() {
    this.stop();
    document.removeEventListener("keydown", this.keyboard.handleKeyDown);
    document.removeEventListener("keyup", this.keyboard.handleKeyUp);
    document.removeEventListener("keypress", this.keyboard.handleKeyPress);
    this._gamepadPolling.stop();
    this._screen.destroy();
  }

  /**
   * Load ROM data from a URL via XHR.
   */
  static loadROMFromURL(url, callback) {
    var req = new XMLHttpRequest();
    req.open("GET", url);
    req.overrideMimeType("text/plain; charset=x-user-defined");
    req.onerror = () =>
      callback(new Error(`Error loading ${url}: ${req.statusText}`));
    req.onload = function () {
      if (this.status === 200) {
        callback(null, this.responseText);
      } else if (this.status === 0) {
        // Aborted, ignore
      } else {
        req.onerror();
      }
    };
    req.send();
    return req;
  }
}

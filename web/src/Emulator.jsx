import React, { Component } from "react";
import PropTypes from "prop-types";
import { NES } from "jsnes";

import { debug } from "./debug";
import FrameTimer from "./FrameTimer";
import GamepadController from "./GamepadController";
import KeyboardController from "./KeyboardController";
import Screen from "./Screen";
import Speakers from "./Speakers";

/*
 * Runs the emulator.
 *
 * The only UI is a canvas element. It assumes it is a singleton in various ways
 * (binds to window, keyboard, speakers, etc).
 */
class Emulator extends Component {
  render() {
    return (
      <Screen
        ref={(screen) => {
          this.screen = screen;
        }}
        onGenerateFrame={() => {
          try {
            this.nes.frame();
          } catch (e) {
            this.stop();
            if (this.props.onError) {
              this.props.onError(e);
            }
          }
        }}
        onMouseDown={(x, y) => {
          this.nes.zapperMove(x, y);
          this.nes.zapperFireDown();
        }}
        onMouseUp={() => {
          this.nes.zapperFireUp();
        }}
      />
    );
  }

  componentDidMount() {
    // Initial layout
    this.fitInParent();

    this.speakers = new Speakers({
      onBufferUnderrun: (actualSize, desiredSize) => {
        if (this.props.paused) {
          return;
        }
        // Skip a video frame so audio remains consistent. This happens for
        // a variety of reasons:
        // - Frame rate is not quite 60fps, so sometimes buffer empties
        // - Page is not visible, so requestAnimationFrame doesn't get fired.
        //   In this case emulator still runs at full speed, but timing is
        //   done by audio instead of requestAnimationFrame.
        // - System can't run emulator at full speed. In this case it'll stop
        //    firing requestAnimationFrame.
        debug("Buffer underrun, running another frame to try and catch up");

        this.frameTimer.generateFrame();
        // desiredSize will be 2048, and the NES produces 1468 samples on each
        // frame so we might need a second frame to be run. Give up after that
        // though -- the system is not catching up
        if (this.speakers.buffer.size() < desiredSize) {
          debug("Still buffer underrun, running a second frame");
          this.frameTimer.generateFrame();
        }
      },
    });

    this.nes = new NES({
      onFrame: this.screen.setBuffer,
      onStatusUpdate: debug,
      onAudioSample: this.speakers.writeSample,
      sampleRate: this.speakers.getSampleRate(),
    });

    // For debugging. (["nes"] instead of .nes to avoid VS Code type errors.)
    window["nes"] = this.nes;

    this.frameTimer = new FrameTimer({
      onGenerateFrame: () => {
        try {
          this.nes.frame();
        } catch (e) {
          this.stop();
          if (this.props.onError) {
            this.props.onError(e);
          }
        }
      },
      onWriteFrame: this.screen.writeBuffer,
    });

    // Set up gamepad and keyboard
    this.gamepadController = new GamepadController({
      onButtonDown: this.nes.buttonDown,
      onButtonUp: this.nes.buttonUp,
    });

    this.gamepadController.loadGamepadConfig();
    this.gamepadPolling = this.gamepadController.startPolling();

    this.keyboardController = new KeyboardController({
      onButtonDown: this.gamepadController.disableIfGamepadEnabled(
        this.nes.buttonDown,
      ),
      onButtonUp: this.gamepadController.disableIfGamepadEnabled(
        this.nes.buttonUp,
      ),
    });

    // Load keys from localStorage (if they exist)
    this.keyboardController.loadKeys();

    document.addEventListener("keydown", this.keyboardController.handleKeyDown);
    document.addEventListener("keyup", this.keyboardController.handleKeyUp);
    document.addEventListener(
      "keypress",
      this.keyboardController.handleKeyPress,
    );

    this.nes.loadROM(this.props.romData);
    this.start();
  }

  componentWillUnmount() {
    this.stop();

    // Unbind keyboard
    document.removeEventListener(
      "keydown",
      this.keyboardController.handleKeyDown,
    );
    document.removeEventListener("keyup", this.keyboardController.handleKeyUp);
    document.removeEventListener(
      "keypress",
      this.keyboardController.handleKeyPress,
    );

    // Stop gamepad
    this.gamepadPolling.stop();

    window["nes"] = undefined;
  }

  componentDidUpdate(prevProps) {
    if (this.props.paused !== prevProps.paused) {
      if (this.props.paused) {
        this.stop();
      } else {
        this.start();
      }
    }

    // TODO: handle changing romData
  }

  start = () => {
    this.frameTimer.start();
    this.speakers.start();
    this.fpsInterval = setInterval(() => {
      debug(`FPS: ${this.nes.getFPS()}`);
    }, 1000);
  };

  stop = () => {
    this.frameTimer.stop();
    this.speakers.stop();
    clearInterval(this.fpsInterval);
  };

  /*
   * Fill parent element with screen. Typically called if parent element changes size.
   */
  fitInParent() {
    this.screen.fitInParent();
  }
}

Emulator.propTypes = {
  paused: PropTypes.bool,
  romData: PropTypes.string.isRequired,
};

export default Emulator;

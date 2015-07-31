/**
 * Modified File for JSNES Copyright 2015 Joseph Lewis <joseph@josephlewis.net>
 * Original File: Copyright 2012 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author mwichary@google.com (Marcin Wichary)
 */

var tester = {
  // If the number exceeds this in any way, we treat the label as active
  // and highlight it.
  VISIBLE_THRESHOLD: 0.1,

  // How far can a stick move on screen.
  STICK_OFFSET: 25,

  // How “deep” does an analogue button need to be depressed to consider it
  // a button down.
  ANALOGUE_BUTTON_THRESHOLD: .5,

  // From jsnes
  i: 0,

  keys : {
        KEY_A: 0,
        KEY_B: 1,
        KEY_SELECT: 2,
        KEY_START: 3,
        KEY_UP: 4,
        KEY_DOWN: 5,
        KEY_LEFT: 6,
        KEY_RIGHT: 7
    },

    state1:[0x40,0x40,0x40,0x40,0x40,0x40,0x40,0x40],
    state2:[0x40,0x40,0x40,0x40,0x40,0x40,0x40,0x40],

    setKey: function(key, value) {
        switch (key) {
            case 88: this.state1[this.keys.KEY_A] = value; break;      // X
            case 89: this.state1[this.keys.KEY_B] = value; break;      // Y (Central European keyboard)
            case 90: this.state1[this.keys.KEY_B] = value; break;      // Z
            case 17: this.state1[this.keys.KEY_SELECT] = value; break; // Right Ctrl
            case 13: this.state1[this.keys.KEY_START] = value; break;  // Enter
            case 38: this.state1[this.keys.KEY_UP] = value; break;     // Up
            case 40: this.state1[this.keys.KEY_DOWN] = value; break;   // Down
            case 37: this.state1[this.keys.KEY_LEFT] = value; break;   // Left
            case 39: this.state1[this.keys.KEY_RIGHT] = value; break;  // Right

            case 103: this.state2[this.keys.KEY_A] = value; break;     // Num-7
            case 105: this.state2[this.keys.KEY_B] = value; break;     // Num-9
            case 99: this.state2[this.keys.KEY_SELECT] = value; break; // Num-3
            case 97: this.state2[this.keys.KEY_START] = value; break;  // Num-1
            case 104: this.state2[this.keys.KEY_UP] = value; break;    // Num-8
            case 98: this.state2[this.keys.KEY_DOWN] = value; break;   // Num-2
            case 100: this.state2[this.keys.KEY_LEFT] = value; break;  // Num-4
            case 102: this.state2[this.keys.KEY_RIGHT] = value; break; // Num-6
            default: return true;
        }
        return false; // preventDefault
    },

    keyDown: function(evt) {
        if (!this.setKey(evt.keyCode, 0x41) && evt.preventDefault) {
            evt.preventDefault();
        }
    },

    keyUp: function(evt) {
        if (!this.setKey(evt.keyCode, 0x40) && evt.preventDefault) {
            evt.preventDefault();
        }
    },

    keyPress: function(evt) {
        evt.preventDefault();
    },

  init: function() {
    tester.updateMode();
    tester.updateGamepads();
  },

  /**
   * Tell the user the browser doesn’t support Gamepad API.
   */
  showNotSupported: function() {
    document.querySelector('#no-gamepad-support').classList.add('visible');
  },

  /**
   * Update the mode (visual vs. raw) if any of the radio buttons were
   * pressed.
   */
  updateMode: function() {
  },

  /**
   * Update the gamepads on the screen, creating new elements from the
   * template.
   */
  updateGamepads: function(gamepads) {
  },

  /**
   * Update a given button on the screen.
   */
  updateButton: function(button, gamepadId, id) {
    var value, pressed;

    // Older version of the gamepad API provided buttons as a floating point
    // value from 0 to 1. Newer implementations provide GamepadButton objects,
    // which contain an analog value and a pressed boolean.
    if (typeof(button) == 'object') {
      value = button.value;
      pressed = button.pressed;
    } else {
      value = button;
      pressed = button > tester.ANALOGUE_BUTTON_THRESHOLD;
    }

    // translate the value to something the JSNES keyboard understands
    value = (value == 1) ? 0x41 : 0x40;

    var keytype = -1;
    if(value == 0x41)
        console.log(id, value);

    switch(id) {
        case "button-1":
            keytype = this.keys.KEY_A;
            break;
        case "button-2":
            keytype = this.keys.KEY_B;
            break;
        case "button-start":
            keytype = this.keys.KEY_START;
            break;
        case "button-select":
            keytype = this.keys.KEY_SELECT;
            break;
        case "button-dpad-top":
            keytype = this.keys.KEY_UP;
            break;
        case "button-dpad-bottom":
            keytype = this.keys.KEY_DOWN;
            break;
        case "button-dpad-left":
            keytype = this.keys.KEY_LEFT;
            break;
        case "button-dpad-right":
            keytype = this.keys.KEY_RIGHT;
            break;
        default:
            return;
    }

    if(gamepadId == 0) {
        this.state1[keytype] = value;
    } else {
        this.state2[keytype] = value;
    }
  },

  /**
   * Update a given analogue stick on the screen.
   */
  updateAxis: function(value, gamepadId, labelId, stickId, horizontal) {
      // For snes we don't use the joysticks.
  }
};

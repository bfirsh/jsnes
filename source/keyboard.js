/*
JSNES, based on Jamie Sanders' vNES
Copyright (C) 2010 Ben Firshman

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

/** @const **/ var KEY_A = 0;
/** @const **/ var KEY_B = 1;
/** @const **/ var KEY_SELECT = 2;
/** @const **/ var KEY_START = 3;
/** @const **/ var KEY_UP = 4;
/** @const **/ var KEY_DOWN = 5;
/** @const **/ var KEY_LEFT = 6;
/** @const **/ var KEY_RIGHT = 7;

// Keyboard events are bound in the UI
/**
 * @constructor
 */
JSNES.Keyboard = function() {
  var i = 0;

  this.state1 = new Uint8Array(8);
  for (i = 0; i < 8; i++) {
    this.state1[i] = 0x40;
  }
  this.state2 = new Uint8Array(8);
  for (i = 0; i < 8; i++) {
    this.state2[i] = 0x40;
  }
};

JSNES.Keyboard.prototype = {
  setKey: function(key, value) {
    switch (key) {
      case 88: this.state1[KEY_A] = value; break;      // X
      case 89: this.state1[KEY_B] = value; break;      // Y (Central European keyboard)
      case 90: this.state1[KEY_B] = value; break;      // Z
      case 17: this.state1[KEY_SELECT] = value; break; // Right Ctrl
      case 13: this.state1[KEY_START] = value; break;  // Enter
      case 38: this.state1[KEY_UP] = value; break;     // Up
      case 40: this.state1[KEY_DOWN] = value; break;   // Down
      case 37: this.state1[KEY_LEFT] = value; break;   // Left
      case 39: this.state1[KEY_RIGHT] = value; break;  // Right

      case 103: this.state2[KEY_A] = value; break;     // Num-7
      case 105: this.state2[KEY_B] = value; break;     // Num-9
      case 99: this.state2[KEY_SELECT] = value; break; // Num-3
      case 97: this.state2[KEY_START] = value; break;  // Num-1
      case 104: this.state2[KEY_UP] = value; break;    // Num-8
      case 98: this.state2[KEY_DOWN] = value; break;   // Num-2
      case 100: this.state2[KEY_LEFT] = value; break;  // Num-4
      case 102: this.state2[KEY_RIGHT] = value; break; // Num-6
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
  }
};

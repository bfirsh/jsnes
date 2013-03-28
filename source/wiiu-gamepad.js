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

JSNES.Gamepad = function() {
    var i;

    this.keys = {
        KEY_A: 0,
        KEY_B: 1,
        KEY_SELECT: 2,
        KEY_START: 3,
        KEY_UP: 4,
        KEY_DOWN: 5,
        KEY_LEFT: 6,
        KEY_RIGHT: 7
    };

    this.gamepadkeys = {
        STICK_L_EMULATION_LEFT: 1,
        STICK_L_EMULATION_RIGHT: 2,
        STICK_L_EMULATION_UP: 3,
        STICK_L_EMULATION_DOWN: 4,
        STICK_R_EMULATION_LEFT: 5,
        STICK_R_EMULATION_RIGHT: 6,
        STICK_R_EMULATION_UP: 7,
        STICK_R_EMULATION_DOWN: 8,
        STICK_L: 13,
        STICK_R: 14,
        A: 16,
        B: 17,
        X: 18,
        Y: 19,
        LEFT: 20,
        RIGHT: 21,
        UP: 22,
        DOWN: 23,
        ZL: 24,
        ZR: 25,
        L: 26,
        R: 27,
        PLUS: 28,
        MINUS: 29
    };

    this.state1 = new Array(8);

    //Player two not supported yet
    this.state2 = new Array(8);

    for(i = 0; i < this.state1.length; i++) {
        this.state1[i] = 0x40;
        this.state2[i] = 0x40;
    }

    this.gamepadstate = new Array(32);
    for(i = 0; i < this.gamepadstate.length; i++) {
        this.gamepadstate[i] = 0;
    }
};

JSNES.Gamepad.prototype = {
    update: function() {
        var state;

        if(window.wiiu) {
            state = window.wiiu.gamepad.update();

            if(!state.isEnabled || !state.isValid) {
                state = null;
            }
        }

        if(!state) {
            return;
        }

        var i;
        var mask = 0x80000000;

        for(var button in this.gamepadkeys) {
            var buttonmask = mask << button;

            this.gamepadstate[button] = (state.hold & 0x7f86fffc & mask) ? 1: 0;
        }

        //Check for left movement
        if(this.gamepadstate[this.gamepadkeys.LEFT] || this.gamepadstate[this.gamepadkeys.STICK_L_EMULATION_LEFT]) {
            this.state1[this.keys.LEFT] = 0x41;
        } else {
            this.state1[this.keys.LEFT] = 0x40;
        }

        //Check for right movement
        if(this.gamepadstate[this.gamepadkeys.RIGHT] || this.gamepadstate[this.gamepadkeys.STICK_L_EMULATION_RIGHT]) {
            this.state1[this.keys.RIGHT] = 0x41;
        } else {
            this.state1[this.keys.RIGHT] = 0x40;
        }

        //Check for up movement
        if(this.gamepadstate[this.gamepadkeys.UP] || this.gamepadstate[this.gamepadkeys.STICK_L_EMULATION_UP]) {
            this.state1[this.keys.UP] = 0x41;
        } else {
            this.state1[this.keys.UP] = 0x40;
        }

        //Check for down movement
        if(this.gamepadstate[this.gamepadkeys.DOWN] || this.gamepadstate[this.gamepadkeys.STICK_L_EMULATION_DOWN]) {
            this.state1[this.keys.DOWN] = 0x41;
        } else {
            this.state1[this.keys.DOWN] = 0x40;
        }

        //Check for A button press
        if(this.gamepadstate[this.gamepadkeys.A]) {
            this.state1[this.keys.A] = 0x41;
        } else {
            this.state1[this.keys.A] = 0x40;
        }

        //Check for B button press
        if(this.gamepadstate[this.gamepadkeys.B]) {
            this.state1[this.keys.B] = 0x41;
        } else {
            this.state1[this.keys.B] = 0x40;
        }

        //Check for Start
        if(this.gamepadstate[this.gamepadkeys.PLUS]) {
            this.state1[this.keys.START] = 0x41;
        } else {
            this.state1[this.keys.START] = 0x40;
        }

        //Check for select
        if(this.gamepadstate[this.gamepadkeys.MINUS]) {
            this.state1[this.keys.SELECT] = 0x41;
        } else {
            this.state1[this.keys.SELECT] = 0x40;
        }

        /*for(i = 0; i < elms.length; i += 2, mask = (mask >>> 1)){
            var e = elms[i+1];
            var isHeld = (state.hold & 0x7f86fffc & mask) ? 1: 0;
        }*/
    }
};

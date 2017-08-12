JSNES.Gamepad = function() {
    var i;
    var eventPollingTime = 100;
    var gamepadPollingTime = 1000;

    this.gamepadKeys = {
        KEY_A: 0,
        KEY_B: 1,
        KEY_X: 2,
        KEY_Y: 3,
        KEY_LEFT_BUMPER: 4,
        KEY_RIGHT_BUMPER: 5,
        KEY_LEFT_TRIGGER: 6,
        KEY_RIGHT_TRIGGER: 7,
        KEY_BACK: 8,
        KEY_START: 9,
        KEY_SELECT: 10,
        KEY_SELECT: 11,
        KEY_UP: 12,
        KEY_DOWN: 13,
        KEY_LEFT: 14,
        KEY_RIGHT: 15,
        KEY_GUIDE: 16
    };

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

    this.count = 0;

    this.state1 = new Array(8);
    for (i = 0; i < this.state1.length; i++) {
        this.state1[i] = 0x40;
    }

    this.state2 = new Array(8);
    for (i = 0; i < this.state2.length; i++) {
        this.state2[i] = 0x40;
    }

    setTimeout(this.pollGamepads.bind(this), gamepadPollingTime);
    setInterval(this.pollEvents.bind(this), eventPollingTime);
    window.addEventListener('gamepadconnected', this.gamepadConnectedHandler.bind(this));
    window.addEventListener('gamepaddisconnected', this.gamepadDisconnectedHandler.bind(this));
};

JSNES.Gamepad.prototype = {
    getGamepads: function() {
        return navigator.getGamepads ? navigator.getGamepads() : (navigator.webkitGetGamepads ? navigator.webkitGetGamepads : []);
    },

    pollGamepads: function() {
        var gamepads = this.getGamepads();
        for (var i = 0; i < gamepads.length; ++i) {
            var gamepad = gamepads[i];
            if (gamepad)
                this.gamepadConnectedHandler({ 'gamepad': gamepad });
        }
    },

    getButtonState: function(button) {
        return button && button.pressed ? 0x41 : 0x40;
    },

    pollEvents: function() {
        var gamepads = this.getGamepads();
        if (this.count === 0 || !gamepads)
            return;

        var i;
        var j;
        var self = this;
        var keys = this.keys;
        var gamepadKeys = this.gamepadKeys;

        if (gamepads.length > 0 && gamepads[0] && gamepads[0].connected) {
            var buttons = gamepads[0].buttons;

            for (var key in keys) {
                this.state1[keys[key]] = this.getButtonState(buttons[gamepadKeys[key]]);
            }
        }

        if (gamepads.length > 1 && gamepads[1] && gamepads[1].connected) {
            var buttons = gamepads[0].buttons;

            for (var key in keys) {
                this.state2[keys[key]] = this.getButtonState(buttons[gamepadKeys[key]]);
            }
        }
    },

    gamepadConnectedHandler: function(gamepad) {
        ++this.count;
    },

    gamepadDisconnectedHandler: function(gamepad) {
        --this.count;
    }
};

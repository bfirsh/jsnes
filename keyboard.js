
function Keyboard() {
    this.keys = {KEY_A: 0, KEY_B: 1, KEY_SELECT: 2, KEY_START: 3, KEY_UP: 4, KEY_DOWN: 5, KEY_LEFT: 6, KEY_RIGHT: 7};
    
    this.state1 = Array(8);
    for (var i = 0; i < this.state1.length; i++) this.state1[i] = 0x40;
    this.state2 = Array(8);
    for (var i = 0; i < this.state2.length; i++) this.state2[i] = 0x40;
}

Keyboard.prototype.setKey = function(key, value) {
    switch (key) {
	    case 88: this.state1[this.keys.KEY_A] = value; break;      // X
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
	}
}

Keyboard.prototype.keyDown = function(evt) {
	this.setKey(evt.keyCode, 0x41);
	if (evt.preventDefault) evt.preventDefault();
}
Keyboard.prototype.keyUp = function(evt) {
	this.setKey(evt.keyCode, 0x40);
	if (evt.preventDefault) evt.preventDefault();
}

var keyboard = new Keyboard();
document.onkeydown = function(evt) {keyboard.keyDown(evt)}
document.onkeyup = function(evt) {keyboard.keyUp(evt)}

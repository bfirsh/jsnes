var KEY_A = 0;
var KEY_B = 1;
var KEY_SELECT = 2;
var KEY_START = 3;
var KEY_UP = 4;
var KEY_DOWN = 5;
var KEY_LEFT = 6;
var KEY_RIGHT = 7;

var keyStates1 = Array(8);
for (var i = 0; i < keyStates1.length; i++) keyStates1[i] = 0x40;
var keyStates2 = Array(8);
for (var i = 0; i < keyStates2.length; i++) keyStates2[i] = 0x40;

function setKey(key, value) {
    switch (key) {
	    case 88: keyStates1[KEY_A] = value; break;      // X
	    case 90: keyStates1[KEY_B] = value; break;      // Z
	    case 17: keyStates1[KEY_SELECT] = value; break; // Right Ctrl
	    case 13: keyStates1[KEY_START] = value; break;  // Enter
	    case 38: keyStates1[KEY_UP] = value; break;     // Up
	    case 40: keyStates1[KEY_DOWN] = value; break;   // Down
	    case 37: keyStates1[KEY_LEFT] = value; break;   // Left
	    case 39: keyStates1[KEY_RIGHT] = value; break;  // Right
	    
	    case 103: keyStates2[KEY_A] = value; break;     // Num-7
	    case 105: keyStates2[KEY_B] = value; break;     // Num-9
	    case 99: keyStates2[KEY_SELECT] = value; break; // Num-3
	    case 97: keyStates2[KEY_START] = value; break;  // Num-1
	    case 104: keyStates2[KEY_UP] = value; break;    // Num-8
	    case 98: keyStates2[KEY_DOWN] = value; break;   // Num-2
	    case 100: keyStates2[KEY_LEFT] = value; break;  // Num-4
	    case 102: keyStates2[KEY_RIGHT] = value; break; // Num-6
	}
}

function keyDown(evt) {
	setKey(evt.keyCode, 0x41);
	if (evt.preventDefault) evt.preventDefault();
}
function keyUp(evt) {
	setKey(evt.keyCode, 0x40);
	if (evt.preventDefault) evt.preventDefault();
}


document.onkeydown = keyDown;
document.onkeyup = keyUp;
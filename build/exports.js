// Required exports
window['$']=$;
$['fn']['JSNESUI'] = $['fn'].JSNESUI;

window['JSNES'] = JSNES;
JSNES.prototype['loadRom'] = JSNES.prototype.loadRom;
JSNES.prototype['start'] = JSNES.prototype.start;
JSNES.prototype['frame'] = JSNES.prototype.frame;
JSNES.prototype['reloadRom'] = JSNES.prototype.reloadRom;
JSNES.prototype['stop'] = JSNES.prototype.stop;
JSNES.prototype['toJSON'] = JSNES.prototype.toJSON;
JSNES.prototype['fromJSON'] = JSNES.prototype.fromJSON;

JSNES['CPU'] = JSNES.CPU;
JSNES['CPU'].prototype['toJSON'] = JSNES.CPU.prototype.toJSON;
JSNES['CPU'].prototype['fromJSON'] = JSNES.CPU.prototype.fromJSON;

JSNES['PPU'] = JSNES.PPU;
JSNES['PPU'].prototype['toJSON'] = JSNES.PPU.prototype.toJSON;
JSNES['PPU'].prototype['fromJSON'] = JSNES.PPU.prototype.fromJSON;

JSNES['Keyboard'] = JSNES.Keyboard;
JSNES['Keyboard'].prototype['keyDown'] = JSNES.Keyboard.prototype.keyDown;
JSNES['Keyboard'].prototype['keyUp'] = JSNES.Keyboard.prototype.keyUp;
JSNES['Keyboard'].prototype['keyPress'] = JSNES.Keyboard.prototype.keyPress;

// Optional exports
JSNES.prototype['isRunning'] = JSNES.prototype.isRunning;
JSNES.prototype['fpsFrameCount'] = JSNES.prototype.fpsFrameCount;
JSNES.prototype['limitFrames'] = JSNES.prototype.limitFrames;
JSNES.prototype['romData'] = JSNES.prototype.romData;
JSNES.prototype['reset'] = JSNES.prototype.reset;
JSNES.prototype['printFps'] = JSNES.prototype.printFps;
JSNES.prototype['resetFps'] = JSNES.prototype.resetFps;
JSNES.prototype['setFramerate'] = JSNES.prototype.setFramerate;
JSNES.prototype['setLimitFrames'] = JSNES.prototype.setLimitFrames;

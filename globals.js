var Globals = {
	preferredFrameRate: 60,
	frameTime: null, // Microsecs per frame
	memoryFlushValue: 0xFF, // What value to flush memory with on power-up
	nes: null,
	fpsInterval: 500 // Time between updating FPS in ms
}
Globals.frameTime = 1000/Globals.preferredFrameRate;

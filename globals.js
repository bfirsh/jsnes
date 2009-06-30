var Globals = {
	preferredFrameRate: 60,
	frameTime: null, // Microsecs per frame
	memoryFlushValue: 0xFF, // What value to flush memory with on power-up
	nes: null
}
Globals.frameTime = 1000/Globals.preferredFrameRate;

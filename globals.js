var Globals = {
    CPU_FREQ_NTSC: 1789772.5,//1789772.72727272d;
	CPU_FREQ_PAL: 1773447.4,
    
	preferredFrameRate: 60,
	frameTime: null, // Microsecs per frame
	memoryFlushValue: 0xFF, // What value to flush memory with on power-up
	nes: null,
	fpsInterval: 500, // Time between updating FPS in ms
	
	emulateSound: true,
	sampleRate: 44100, // Sound sample rate in hz
}
Globals.frameTime = 1000/Globals.preferredFrameRate;

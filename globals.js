var Globals = {
    
	CPU_FREQ_NTSC: 1789772, //1789772.72727272d;
	CPU_FREQ_PAL : 1773447,
	
	preferredFrameRate: 60,
	frameTime: null,	// Microsecs per frame
	audioBufferMinMultiple: 2,				// 2 times size of 2nd sound buffer
	audioBufferMaxMultiple: 3,				// 3 times size of 2nd sound buffer
	audioAdjustTime: 2000,					// # microsecs
	
	// What value to flush memory with on power-up:
	memoryFlushValue: 0xFF,
	
    debug: false,
	fsdebug: false,
	
	guiIconified: false,
	guiMaximized: false,
	
	appletMode  : true,
	showPatterns: false,
	showPalettes: false,
	showNameTables: false,
	disableSprites: false,
	recordingAudio: false,
	nsfMode: false,
	timeEmulation: true,
	frameStep: false,
	palEmulation: null,
	enableSound: true,
	
	filterBrightenDepth: 3,
	filterDarkenDepth  : 3,
	
	nes: null,
	/*public static void println(String s){
		nes.getGui().println(s);
	}*/
    
}
Globals.frameTime = 1000/Globals.preferredFrameRate;

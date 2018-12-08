var SCREEN_WIDTH = 256;
var SCREEN_HEIGHT = 240;
var FRAMEBUFFER_SIZE = SCREEN_WIDTH*SCREEN_HEIGHT;

var canvas_ctx, image;
var framebuffer_u8, framebuffer_u32;

var AUDIO_BUFFERING = 512;
var SAMPLE_COUNT = 4*1024;
var SAMPLE_MASK = SAMPLE_COUNT - 1;
var audio_samples_L = new Float32Array(SAMPLE_COUNT);
var audio_samples_R = new Float32Array(SAMPLE_COUNT);
var audio_write_cursor = 0, audio_read_cursor = 0;

var nes = new jsnes.NES({
	onFrame: function(framebuffer_24){
		for(var i = 0; i < FRAMEBUFFER_SIZE; i++) framebuffer_u32[i] = 0xFF000000 | framebuffer_24[i];
	},
	onAudioSample: function(l, r){
		audio_samples_L[audio_write_cursor] = l;
		audio_samples_R[audio_write_cursor] = r;
		audio_write_cursor = (audio_write_cursor + 1) & SAMPLE_MASK;
	},
});

function onAnimationFrame(){
	window.requestAnimationFrame(onAnimationFrame);
	
	image.data.set(framebuffer_u8);
	canvas_ctx.putImageData(image, 0, 0);
	nes.frame();
}

function audio_remain(){
	return (audio_write_cursor - audio_read_cursor) & SAMPLE_MASK;
}

function audio_callback(event){
	var dst = event.outputBuffer;
	var len = dst.length;
	
	// Attempt to avoid buffer underruns.
	if(audio_remain() < AUDIO_BUFFERING) nes.frame();
	
	var dst_l = dst.getChannelData(0);
	var dst_r = dst.getChannelData(1);
	for(var i = 0; i < len; i++){
		var src_idx = (audio_read_cursor + i) & SAMPLE_MASK;
		dst_l[i] = audio_samples_L[src_idx];
		dst_r[i] = audio_samples_R[src_idx];
	}
	
	audio_read_cursor = (audio_read_cursor + len) & SAMPLE_MASK;
}

function keyboard(callback, event){
	var player = 1;
	switch(event.keyCode){
		case 38: // UP
			callback(player, jsnes.Controller.BUTTON_UP); break;
		case 40: // Down
			callback(player, jsnes.Controller.BUTTON_DOWN); break;
		case 37: // Left
			callback(player, jsnes.Controller.BUTTON_LEFT); break;
		case 39: // Right
			callback(player, jsnes.Controller.BUTTON_RIGHT); break;
		case 65: // 'a' - qwerty, dvorak
		case 81: // 'q' - azerty
			callback(player, jsnes.Controller.BUTTON_A); break;
		case 83: // 's' - qwerty, azerty
		case 79: // 'o' - dvorak
			callback(player, jsnes.Controller.BUTTON_B); break;
		case 9: // Tab
			callback(player, jsnes.Controller.BUTTON_SELECT); break;
		case 13: // Return
			callback(player, jsnes.Controller.BUTTON_START); break;
		default: break;
	}
}

function nes_init(canvas_id){
	var canvas = document.getElementById(canvas_id);
	canvas_ctx = canvas.getContext("2d");
	image = canvas_ctx.getImageData(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
	
	canvas_ctx.fillStyle = "black";
	canvas_ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
	
	// Allocate framebuffer array.
	var buffer = new ArrayBuffer(image.data.length);
	framebuffer_u8 = new Uint8ClampedArray(buffer);
	framebuffer_u32 = new Uint32Array(buffer);
	
	// Setup audio.
	var audio_ctx = new window.AudioContext();
	var script_processor = audio_ctx.createScriptProcessor(AUDIO_BUFFERING, 0, 2);
	script_processor.onaudioprocess = audio_callback;
	script_processor.connect(audio_ctx.destination);
}

function nes_boot(rom_data){
	nes.loadROM(rom_data);
	window.requestAnimationFrame(onAnimationFrame);
}

function nes_load_data(canvas_id, rom_data){
	nes_init(canvas_id);
	nes_boot(rom_data);
}

function nes_load_url(canvas_id, path){
	nes_init(canvas_id);
	
	var req = new XMLHttpRequest();
	req.open("GET", path);
	req.overrideMimeType("text/plain; charset=x-user-defined");
	req.onerror = () => console.log(`Error loading ${path}: ${req.statusText}`);
	
	req.onload = function() {
		if (this.status === 200) {
		nes_boot(this.responseText);
		} else if (this.status === 0) {
			// Aborted, so ignore error
		} else {
			req.onerror();
		}
	};
	
	req.send();
}

document.addEventListener('keydown', (event) => {keyboard(nes.buttonDown, event)});
document.addEventListener('keyup', (event) => {keyboard(nes.buttonUp, event)});

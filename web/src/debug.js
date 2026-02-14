// Debug logging for jsnes-web.
//
// Enable in the browser console:
//   localStorage.jsnes_debug = 1
//
// Disable:
//   delete localStorage.jsnes_debug
//
// Logs FPS, audio buffer underruns/overruns, frame skips, and NES status updates.
let enabled = false;
try {
  enabled = !!localStorage.getItem("jsnes_debug");
} catch (e) {
  // localStorage not available
}

export function debug(...args) {
  if (enabled) {
    console.log(...args);
  }
}

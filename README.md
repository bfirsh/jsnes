# JSNES

A JavaScript NES emulator.

It's a library that works in both the browser and Node.js.

## Installation

For Node.js or Webpack:

    $ npm install jsnes


In the browser, you can use [unpkg](https://unpkg.com):

```html
<script type="text/javascript" src="https://unpkg.com/jsnes/dist/jsnes.min.js"></script>
```

## Usage

### Browser

The easiest way to use JSNES in a web page is with `jsnes.Browser`. It handles canvas rendering, audio, keyboard input, gamepad input, and frame timing automatically.

```html
<div id="nes" style="width: 512px; height: 480px"></div>
<script src="https://unpkg.com/jsnes/dist/jsnes.min.js"></script>
<script>
  var browser = new jsnes.Browser({
    container: document.getElementById("nes"),
    onError: function (e) {
      console.error(e);
    },
  });
  jsnes.Browser.loadROMFromURL("my-rom.nes", function (err, data) {
    if (err) {
      console.error(err);
      return;
    }
    browser.loadROM(data);
  });
</script>
```

If you already have ROM data as a string or byte array, you can pass it directly:

```javascript
var browser = new jsnes.Browser({
  container: document.getElementById("nes"),
  romData: romData,
});
```

Default keyboard controls:

| Button | Player 1 | Player 2 |
|--------|----------|----------|
| Up / Down / Left / Right | Arrow keys | Numpad 8 / 2 / 4 / 6 |
| A | X | Numpad 7 |
| B | Z | Numpad 9 |
| Start | Enter | Numpad 1 |
| Select | Right Ctrl | Numpad 3 |

Gamepads are also supported automatically.

### React

```jsx
import { Browser } from "jsnes";

function Emulator({ romData }) {
  const containerRef = useRef(null);
  const browserRef = useRef(null);

  useEffect(() => {
    browserRef.current = new Browser({
      container: containerRef.current,
      romData: romData,
    });
    return () => browserRef.current.destroy();
  }, [romData]);

  return <div ref={containerRef} />;
}
```

A full-featured React frontend is available in the `web/` directory of this repository.

### Node.js / custom integration

If you need lower-level control (custom rendering, audio handling, or running in Node.js), use the `NES` class directly:

```javascript
// Initialize and set up outputs
var nes = new jsnes.NES({
  onFrame: function(frameBuffer) {
    // ... write frameBuffer to screen
  },
  onAudioSample: function(left, right) {
    // ... play audio sample
  }
});

// Read ROM data from disk (using Node.js APIs, for the sake of this example)
const fs = require('fs');
var romData = fs.readFileSync('path/to/rom.nes', {encoding: 'binary'});

// Load ROM data as a string or byte array
nes.loadROM(romData);

// Run frames at 60 fps, or as fast as you can.
// You are responsible for reliable timing as best you can on your platform.
nes.frame();
nes.frame();
// ...

// Hook up whatever input device you have to the controller.
nes.buttonDown(1, jsnes.Controller.BUTTON_A);
nes.frame();
nes.buttonUp(1, jsnes.Controller.BUTTON_A);
nes.frame();
// ...
```

A complete embedding example is in the `example/` directory.

## API Reference

### `NES`

```javascript
var nes = new jsnes.NES(options);
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `onFrame` | `function(frameBuffer)` | Called at the end of each frame with a 256×240 pixel buffer (Int32Array of ARGB values). |
| `onAudioSample` | `function(left, right)` | Called for each audio sample with left/right channel values (-1.0 to 1.0). |
| `onStatusUpdate` | `function(status)` | Called with status messages (e.g. "Ready to load a ROM."). |
| `onBatteryRamWrite` | `function(address, value)` | Called when battery-backed SRAM is written. Use this to persist save data. |
| `emulateSound` | `boolean` | Enable/disable audio emulation. Default: `true`. |
| `sampleRate` | `number` | Audio sample rate in Hz. Default: `48000`. |
| `preferredFrameRate` | `number` | Target frame rate. Default: `60`. |

**Methods:**

| Method | Description |
|--------|-------------|
| `nes.loadROM(data)` | Load a ROM from a string, Uint8Array, or ArrayBuffer. |
| `nes.frame()` | Execute one frame of emulation. Call this at 60 fps. |
| `nes.buttonDown(player, button)` | Press a button. `player` is `1` or `2`. |
| `nes.buttonUp(player, button)` | Release a button. |
| `nes.reset()` | Reset the emulator (like pressing the reset button on the NES). |
| `nes.reloadROM()` | Reload the current ROM from scratch. |
| `nes.getFPS()` | Get the current frames-per-second count. |
| `nes.setFramerate(rate)` | Change the target frame rate. |
| `nes.toJSON()` | Serialize emulator state (for save states). |
| `nes.fromJSON(data)` | Restore emulator state from a previous `toJSON()` call. |
| `nes.zapperMove(x, y)` | Move the Zapper light gun to the given pixel coordinates. |
| `nes.zapperFireDown()` | Pull the Zapper trigger. |
| `nes.zapperFireUp()` | Release the Zapper trigger. |

**Button constants** (on `jsnes.Controller`):

`BUTTON_A`, `BUTTON_B`, `BUTTON_SELECT`, `BUTTON_START`, `BUTTON_UP`, `BUTTON_DOWN`, `BUTTON_LEFT`, `BUTTON_RIGHT`, `BUTTON_TURBO_A`, `BUTTON_TURBO_B`

### `Browser`

```javascript
var browser = new jsnes.Browser(options);
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `container` | `HTMLElement` | **Required.** The DOM element to render into. |
| `romData` | `string` | ROM data to load immediately. If omitted, call `loadROM()` later. |
| `onError` | `function(error)` | Called when the emulator encounters an error during frame execution. |
| `onBatteryRamWrite` | `function(address, value)` | Called when battery-backed SRAM is written. |

**Methods:**

| Method | Description |
|--------|-------------|
| `browser.start()` | Start emulation. Called automatically if `romData` was provided. |
| `browser.stop()` | Pause emulation. |
| `browser.loadROM(data)` | Load a new ROM and start emulation. |
| `browser.fitInParent()` | Re-layout the canvas to fill its container. |
| `browser.screenshot()` | Returns an `HTMLImageElement` of the current frame. |
| `browser.destroy()` | Full cleanup: stop emulation, remove listeners, remove canvas. |
| `Browser.loadROMFromURL(url, callback)` | Static method. Fetch ROM data from a URL. Callback is `(error, data)`. |

**Properties:**

| Property | Description |
|----------|-------------|
| `browser.nes` | The underlying `NES` instance. |
| `browser.keyboard` | The `KeyboardController` for remapping keys. |
| `browser.gamepad` | The `GamepadController` for remapping gamepad buttons. |

## Build

To build a distribution:

    $ npm run build

This will create `dist/jsnes.min.js`.

## Running tests

    $ npm test

## Formatting code

All code must conform to [Prettier](https://prettier.io/) formatting. The test suite won't pass unless it does.

To automatically format all your code, run:

    $ npm run format

## Related projects
- [NEStation](https://github.com/afska/nestation) - Multiplayer NES over the internet!

## Thanks

JSNES is based on [James Sanders' vNES](https://github.com/bfirsh/vNES), and owes an awful lot to it. It also wouldn't have happened without [Matt Wescott's JSSpeccy](http://jsspeccy.zxdemo.org/), which sparked the original idea. (Ben, circa 2008: "Hmm, I wonder what else could run in a browser?!")

# JSNES

A JavaScript NES emulator.

It's a library that works in both the browser and Node.js. The browser UI is available at [https://github.com/bfirsh/jsnes-web](https://github.com/bfirsh/jsnes-web).

## Installation

For Node.js or Webpack:

    $ npm install jsnes


In the browser, you can use [unpkg](https://unpkg.com):

```html
<script type="text/javascript" src="https://unpkg.com/jsnes/dist/jsnes.min.js"></script>
```

## Usage

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

## Build

To build a distribution:

    $ npm run build

This will create `dist/jsnes.min.js`.

## Running tests

    $ npm test

## Embedding JSNES in a web page

The easiest way to embed JSNES in a web page is with `jsnes.Browser`. It handles canvas rendering, audio, keyboard input, gamepad input, and frame timing automatically.

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

### Browser API

```javascript
browser.start();             // Start emulation (automatic if romData provided)
browser.stop();              // Pause emulation
browser.loadROM(data);       // Load a new ROM and start
browser.fitInParent();       // Re-layout canvas to fill container
browser.screenshot();        // Returns an HTMLImageElement
browser.destroy();           // Full cleanup: stop, remove listeners, remove canvas

browser.nes                  // The underlying NES instance
browser.keyboard             // KeyboardController (for remapping keys)
browser.gamepad              // GamepadController (for remapping gamepad buttons)
```

### Using with React

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

A complete embedding example is in the `example/` directory.

## Formatting code

All code must conform to [Prettier](https://prettier.io/) formatting. The test suite won't pass unless it does.

To automatically format all your code, run:

    $ npm run format

## Related projects
- [NEStation](https://github.com/afska/nestation) - Multiplayer NES over the internet!

## Thanks

JSNES is based on [James Sanders' vNES](https://github.com/bfirsh/vNES), and owes an awful lot to it. It also wouldn't have happened without [Matt Wescott's JSSpeccy](http://jsspeccy.zxdemo.org/), which sparked the original idea. (Ben, circa 2008: "Hmm, I wonder what else could run in a browser?!")

JSNES
=====

A JavaScript NES emulator.

It's a library that works in both the browser and Node.js. The browser UI is available at [https://github.com/bfirsh/jsnes-web](https://github.com/bfirsh/jsnes-web).

Installation
------------

For Node.js or Webpack:

    $ npm install jsnes

(Or `yarn add jsnes`.)

In the browser, you can use [unpkg](https://unpkg.com):

```html
<script type="text/javascript" src="https://unpkg.com/jsnes@0.1.0/dist/jsnes.min.js"></script>
```

Usage
-----

```javascript
// Initialize and set up outputs
var nes = new jsnes.NES({
  onFrame: function(frameBuffer) {
    // ... write frameBuffer to screen
  },
  onAudio: function(audioBuffer) {
    // ... play audioBuffer
  }
});

// Load ROM data as a string or byte array
nes.loadRom(romData);

// Start emulator
nes.start();

// Run frames at 60 fps, or as fast as you can.
// You are responsible for reliable timing as best you can on your platform.
nes.frame();
nes.frame();
// ...
```

Build
-----

To build a distribution:

    $ yarn run build

This will create `dist/jsnes.js` and `dist/jsnes.min.js`.

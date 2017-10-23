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
<script type="text/javascript" src="https://unpkg.com/jsnes/dist/jsnes.min.js"></script>
```

Usage
-----

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

Build
-----

To build a distribution:

    $ yarn run build

This will create `dist/jsnes.min.js`.

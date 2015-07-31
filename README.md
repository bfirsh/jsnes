JSNES
=====

A JavaScript NES emulator that includes support for saving using localstorage and gamepads.

Build
-----

To build a distribution, you will [Grunt](http://gruntjs.com):

    $ sudo npm install -g grunt-cli

Then run:

    $ npm install
    $ grunt

This will create ``jsnes.js`` and ``jsnes-min.js`` in ``build/``.

Benchmark
---------

The benchmark in ``test/benchmark.js`` is intended for testing JavaScript 
engines. It does not depend on a DOM or Canvas element etc.


JSNES
=====

A JavaScript NES emulator.

Build
-----

To build a distribution, you will need [jake](http://github.com/jcoglan/jake):

    $ sudo gem install jake

Then run:

    $ jake

This will create ``jsnes-min.js`` and ``jsnes-src.js`` in ``build/``.

Benchmark
---------

The benchmark in ``test/benchmark.js`` is intended for testing JavaScript 
engines. It does not depend on a DOM or Canvas element etc.

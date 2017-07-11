JSNES
=====

A JavaScript NES emulator.

**Note:** Current future work is happening is this branch: https://github.com/bfirsh/jsnes/tree/split-out-ui

Build
-----

To run locally:

    $ docker-compose up

And it'll be available at http://localhost

To build a distribution:

    $ docker-compose run build grunt

This will create ``jsnes.js`` and ``jsnes-min.js`` in ``build/``.

Benchmark
---------

The benchmark in ``test/benchmark.js`` is intended for testing JavaScript 
engines. It does not depend on a DOM or Canvas element etc.


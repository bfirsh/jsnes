var assert = require('chai').assert;
var fs = require('fs');
var NES = require('../src/nes');

describe('NES', function() {
  it('can be initialized', function() {
    var nes = new NES();
  });

  it('loads a ROM and runs a frame', function(done) {
    var nes = new NES();
    fs.readFile('roms/croom/croom.nes', function(err, data) {
      if (err) return done(err);
      assert(nes.loadRom(data.toString('ascii')));
      nes.isRunning = true;
      nes.frame();
      done();
    });
  });
});

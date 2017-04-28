var assert = require('chai').assert;
var fs = require('fs');
var NES = require('../src/nes');
var sinon = require('sinon');

describe('NES', function() {
  it('can be initialized', function() {
    var nes = new NES();
  });

  it('loads a ROM and runs a frame', function(done) {
    var onFrame = sinon.spy();
    var nes = new NES({onFrame: onFrame});
    fs.readFile('roms/croom/croom.nes', function(err, data) {
      if (err) return done(err);
      assert(nes.loadRom(data.toString('ascii')));
      nes.frame();
      assert(onFrame.calledOnce);
      assert.isArray(onFrame.args[0][0]);
      assert.lengthOf(onFrame.args[0][0], 256*240);
      done();
    });
  });

  describe('#getFPS()', function() {
    var nes = new NES();
    before(function(done) {
      fs.readFile('roms/croom/croom.nes', function(err, data) {
        if (err) return done(err);
        nes.loadRom(data.toString('ascii'));
        done();
      });
    });

    it('returns an FPS count when frames have been run', function() {
      assert.isNull(nes.getFPS());
      nes.frame();
      nes.frame();
      var fps = nes.getFPS();
      assert.isNumber(fps);
      assert.isAbove(fps, 0);
    });
  });
});

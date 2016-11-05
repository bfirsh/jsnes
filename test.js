
var fs = require('fs')

var nes = require('./exported_source/JSNES.js')({
  ui: {
    updateStatus: function(d){ console.log(d) }
  }
})
console.log(Object.keys(nes))

nes.loadRom(fs.readFileSync('./local-roms/Mega Man (U).nes').toString())

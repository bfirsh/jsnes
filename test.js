
var fs = require('fs')

var nes = require('./exported_source/JSNES.js')({
  ui: {
    updateStatus: function(d){ console.log(d) },
    writeFrame: function(){}
  }
})
// console.log(Object.keys(nes))


// console.log(f.toString())

var state = JSON.parse(JSON.parse(fs.readFileSync('./runs/test.json').toString('utf-8')).nes_state)
// console.log(Object.keys(m.nes_state))
// console.log(m.nes_state)
// console.log(m.nes_state.romData)
state.romData = fs.readFileSync('./local-roms/Super Mario Bros. (JU) (PRG0) [!].nes').toString('ascii')
// console.log(m.nes_state.romData.length)


// console.log(require('util').inspect(state))
// console.log(state.romData)
nes.fromJSON(state)

// nes.loadRom()

// nes.start()

var test = []
for(var i = 0; i < 1000; i++){
  console.log('begin frame')
  nes.frame()
  console.log('end frame')
  test.push(nes.cpu.mem.slice(0,10))
}

test.forEach(function(m){
  console.log(m.join('\t'))
})

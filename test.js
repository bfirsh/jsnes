var jpeg = require('jpeg-js');
var fs = require('fs')

var nes = require('./exported_source/JSNES.js')({
  ui: {
    updateStatus: function(d){ console.log(d) },
    writeFrame: function(){}
  }
})

var state = JSON.parse(JSON.parse(fs.readFileSync('./runs/test.json').toString('utf-8')).nes_state)
// state.romData = fs.readFileSync('./local-roms/Super Mario Bros. (JU) (PRG0) [!].nes').toString('utf-8')
state.romData = fs.readFileSync('./local-roms/Super Mario Bros. (JU) (PRG0) [!].nes').toString('ascii')

nes.fromJSON(state)
// nes.reset()
// nes.loadRom(state.romData)

// nes.reloadRom()

// nes.frame()
// console.log('frame done')
// process.exit()

var test = []
for(var i = 0; i < 1000; i++){
  console.log('begin frame')
  nes.frame()
  // nes.keyboard.state1[6] = 0x41
  nes.keyboard.state1[7] = 0x41
  console.log('end frame')

}
test.push(nes.ppu.buffer.slice(0,256*240))

test.forEach(function(m){
  // console.log(m.join('\t'))
  var x_pos = 0
  var y_pos = 0
  var pixel_buffer = new Buffer(m.length*4)
  var pixel_buffer_idx = 0
  m.forEach(function(v){
    // console.log(v)
    pixel_buffer[pixel_buffer_idx] = (v) & 0xFF
    pixel_buffer_idx++
    pixel_buffer[pixel_buffer_idx] = (v >> 8) & 0xFF
    pixel_buffer_idx++
    pixel_buffer[pixel_buffer_idx] = (v >> 16) & 0xFF
    pixel_buffer_idx++
    pixel_buffer[pixel_buffer_idx] = 255
    pixel_buffer_idx++
  })
  console.log(pixel_buffer_idx === pixel_buffer.length)

  var r = {
    data: pixel_buffer,
    width: 256,
    height: 240
  }

  console.log(jpeg.encode(r,100))
  fs.writeFileSync('./test.jpg', jpeg.encode(r,100).data.toString('binary'), 'binary')
})

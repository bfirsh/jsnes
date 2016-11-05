var jpeg = require('jpeg-js');
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

// console.log(m.nes_state.romData.length)


// console.log(require('util').inspect(state))
// console.log(state.romData)


state.romData = fs.readFileSync('./local-roms/Super Mario Bros. (JU) (PRG0) [!].nes').toString('utf-8')

nes.fromJSON(state)
// nes.reset()
// nes.loadRom(state.romData)

// nes.reset()
// nes.loadRom(fs.readFileSync('./local-roms/Super Mario Bros. (JU) (PRG0) [!].nes', 'utf-8'))
// nes.start()

var test = []
for(var i = 0; i < 1000; i++){
  console.log('begin frame')
  nes.frame()
  nes.keyboard.state1[6] = 0x41
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

    //     int red = (rgb >> 16) & 0xFF;
    // int green = (rgb >> 8) & 0xFF;
    // int blue = rgb & 0xFF;
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

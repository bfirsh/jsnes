var fs = require('fs')

var input_directory = './separated_everything/'
var output_directory = './exported_source/'

var file_name = 'rom.js'

var file_names = [
  'JSNES_CPU.js',
  'JSNES_Keyboard.js',
  'JSNES_PAPU_ChannelDM.js',
  'JSNES_PAPU_ChannelNoise.js',
  'JSNES_PAPU_ChannelTriangle.js',
  'JSNES_PAPU_ChannelSquare.js',
  'JSNES_PAPU.js',
  'JSNES_PPU_NameTable.js',
  'JSNES_PPU_PaletteTable.js',
  'JSNES_PPU_Tile.js',
  'JSNES_PPU.js',
  'JSNES_ROM.js',
  'JSNES.js',
]

var token_remapper = [
  ['JSNES.ROM', 'JSNES_ROM'],
  ['JSNES.PPU', 'JSNES_PPU'],
  ['JSNES.PAPU', 'JSNES_PAPU'],
  ['JSNES.CPU', 'JSNES_CPU'],
  ['JSNES.Keyboard', 'JSNES_Keyboard'],
  ['JSNES.PPU.Tile', 'JSNES_PPU_Tile'],
  ['JSNES.PPU.PaletteTable', 'JSNES_PPU_PaletteTable'],
  ['JSNES.PPU.NameTable', 'JSNES_PPU_NameTable'],
  ['JSNES.PAPU.ChannelTriangle', 'JSNES_PAPU_ChannelTriangle'],
  ['JSNES.PAPU.ChannelDM', 'JSNES_PAPU_ChannelDM'],
  ['JSNES.PAPU.ChannelNoise', 'JSNES_PAPU_ChannelNoise'],
  ['JSNES.PAPU.ChannelSquare', 'JSNES_PAPU_ChannelSquare']
]

var includes = [
  ''
]

file_names.forEach(function(l){
  convert(l)
})

function convert(file_name){
  var file_lines = fs.readFileSync(input_directory + file_name).toString().split('\n')
  // console.log(file_lines[0])

  var closing_brace_idx = []
  var beginning_constructor_line = -1
  var prototype_declaration = -1

  // find the beginning and end of the constructor and prototypes
  file_lines.forEach(function(l, idx){
    if(is_beginning_of_constructor(l) && beginning_constructor_line === -1){
      // console.log(idx,l)
      beginning_constructor_line = idx
    }
    if(is_closing_brace(l)){
      // console.log(idx,l)
      closing_brace_idx.push(idx)
    }
    if(is_prototype_declaration(l) && prototype_declaration === -1){
      // console.log(idx, l)
      prototype_declaration = idx
    }
  })

  var classname = file_lines[beginning_constructor_line]
    .split(' ')
    .filter(function(o){
      return o.indexOf('JSNES') !== -1
    })[0]

  console.log('constructor name', classname)

  // console.log('beginning_constructor_line', file_lines[beginning_constructor_line])
  // console.log('closing brace on', closing_brace_idx[0] - beginning_constructor_line, 'lines later')
  // console.log('prototype_declaration', file_lines[prototype_declaration])
  // console.log('closing brace on', closing_brace_idx[1] - prototype_declaration, 'lines later')

  var latest_indentation = -1
  var function_indexes = []
  var function_args = []

  // find all the function lines in the prototype
  file_lines.slice(prototype_declaration, closing_brace_idx[1]).forEach(function(l,idx){
    if(is_prototype_function_declaration(l)){
      var indentation = get_indentation(l)
      var function_name = get_function_name(l)
      // console.log(idx, l, get_indentation(l), get_function_name(l))
      latest_indentation = indentation
      function_indexes.push(idx + prototype_declaration)
    }
    if(is_indented_closing_brace(l, latest_indentation)){
      // console.log(idx,l)
      function_indexes.push(idx + prototype_declaration)
    }
  })

  // find all the variables declared in the initial block of the prototype an

  var prototype_vars = []
  file_lines.slice(prototype_declaration, function_indexes[0]).forEach(function(l,idx){
    if(is_prototype_variable(l)){
      // console.log(idx,l)
      prototype_vars.push(l)
    }
  })

  // prototype_vars.forEach(function(l,idx){
  //   console.log('this.'+l.trim().replace(':', ' =').replace(',', ''))
  // })



  // write the constructor but do not close it
  // write all the functions in the form
  // this.function_name = function(){
  // }
  // prepend the function name with this.
  // change the ':' to an '='
  //


  // write the constructor
  var new_lines = []

  new_lines.push('module.exports = ' + classname.replace('.', '_'))

  // include all the stuff that isn't this file
  file_names.forEach(function(_filename){
    if(_filename !== file_name){
      console.log(['var ', _filename.split('.')[0], ' = require(\'./', _filename, '\')'].join(''))
      new_lines.push(['var ', _filename.split('.')[0], ' = require(\'./', _filename, '\')'].join(''))
    }
  })

  file_lines.slice(beginning_constructor_line,closing_brace_idx[0]).forEach(function(l,idx){
    // console.log(idx,l)
    new_lines.push(l)
  })

  // write the prototype variables
  prototype_vars.forEach(function(l,idx){
    var m = ('this.'+l.trim().replace(':', ' =').replace(',', ''))
    new_lines.push(m)
  })

  // write the prototype functions into the constructor
  for(var i = 0; i < function_indexes.length; i+=2){
    var begin = function_indexes[i]
    var end = function_indexes[i+1]
    // console.log(['this.', file_lines[begin].trim().replace(':', ' =')].join(''))
    new_lines.push(['this.', file_lines[begin].trim().replace(':', ' =')].join(''))

    for(var k = begin+1; k < end; k++){
      new_lines.push(file_lines[k])
    }
    new_lines.push(file_lines[k].replace(',', ''))
  }

  // close the constructor
  new_lines.push(file_lines[closing_brace_idx[0]])

  // console.log(new_lines.join('\n'))

  var rewritten_newlines = []
  new_lines.forEach(function(l, newline_idx){
    var rewritten_line = l
    if(l.indexOf('JSNES') !== -1){
      token_remapper.forEach(function(t){
        if(l.indexOf(t[0]) !== -1){
          // console.log(l.trim(), l.replace(t[0], t[1]).trim())
          rewritten_line = l.replace(t[0], t[1])
        }
      })
      // // find the token to replace
      // var split_line = l.split(' ')
      // split_line.forEach(function(s,idx){
      //   token_remapper.forEach(function(token_map){
      //     if(s === token_map[0]){
      //       console.log(s, token_map[1], newline_idx)
      //     }
      //   })
      // })
    }
    rewritten_newlines.push(rewritten_line)
  })

  fs.writeFileSync(output_directory + file_name, rewritten_newlines.join('\n'))


  //////////////////////////////////////////////////////////////////////////////
  //////////////////////////////////////////////////////////////////////////////

  function is_prototype_variable(l){
    return (l.indexOf(':') !== -1 && l.indexOf(',') !== -1)
  }

  function is_prototype_function_declaration(l){
    return (l.indexOf(': function(') !== -1)
  }

  function get_indentation(l){
    var idx = -1
    l.split('').forEach(function(_l,i){
      if(_l !== ' ' && idx === -1){
        idx = i
      }
    })
    return idx
  }

  function is_indented_closing_brace(l,indentation){
    return (l[indentation] === '}')
  }

  function get_function_name(l){
    var begin = get_indentation(l)
    var end = l.indexOf(':')
    return l.slice(begin,end)
  }


  function is_beginning_of_constructor(l){
    if(l.indexOf('JSNES') !== -1 && l.indexOf('= function(') !== -1){
      return true
    } else {
      return false
    }
  }

  function is_prototype_declaration(l){
    if(l.indexOf('JSNES') !== -1 && l.indexOf('.prototype =') !== -1){
      return true
    } else {
      return false
    }
  }

  function is_closing_brace(l){
    return l === '};'
  }

}

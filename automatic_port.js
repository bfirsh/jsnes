var fs = require('fs')

var input_directory = './source/'
var output_directory = './exported_source/'

var file_name = 'papu.js'

var file_lines = fs.readFileSync(input_directory + file_name).toString().split('\n')
// console.log(file_lines[0])


var closing_brace_idx = []
var beginning_constructor_line = -1
var prototype_declaration = -1

file_lines.forEach(function(l, idx){
  if(is_beginning_of_constructor(l)){
    console.log(idx,l)
    beginning_constructor_line = idx
  }
  if(is_closing_brace(l)){
    console.log(idx,l)
    closing_brace_idx.push(idx)
  }
  if(is_prototype_declaration(l)){
    console.log(idx, l)
    prototype_declaration = idx
  }
})

console.log('beginning_constructor_line', file_lines[beginning_constructor_line])
console.log('closing brace on', closing_brace_idx[0] - beginning_constructor_line, 'lines later')
console.log('prototype_declaration', file_lines[prototype_declaration])
console.log('closing brace on', closing_brace_idx[1] - prototype_declaration, 'lines later')

var latest_indentation = -1
var function_indexes = []
var function_args = []

file_lines.slice(prototype_declaration, closing_brace_idx[1]).forEach(function(l,idx){
  if(is_prototype_function_declaration(l)){
    var indentation = get_indentation(l)
    var function_name = get_function_name(l)
    console.log(idx, l, get_indentation(l), get_function_name(l))
    latest_indentation = indentation
    function_indexes.push(idx + prototype_declaration)
  }
  if(is_indented_closing_brace(l, latest_indentation)){
    console.log(idx,l)
    function_indexes.push(idx + prototype_declaration)
  }
})

console.log(function_indexes)
function_indexes.forEach(function(line_number){
  console.log(file_lines[line_number])
})

// write the constructor but do not close it
// write all the functions in the form
// this.function_name = function(){
// }
// prepend the function name with this.
// change the ':' to an '='
//

var new_lines = []
file_lines.slice(beginning_constructor_line,closing_brace_idx[0]).forEach(function(l,idx){
  console.log(idx,l)
  new_lines.push(l)
})

for(var i = 0; i < function_indexes.length; i+=2){
  var begin = function_indexes[i]
  var end = function_indexes[i+1]
  console.log(['this.', file_lines[begin].trim().replace(':', ' =')].join(''))
  new_lines.push(['this.', file_lines[begin].trim().replace(':', ' =')].join(''))

  for(var k = begin+1; k < end; k++){
    new_lines.push(file_lines[k])
  }
  new_lines.push(file_lines[k].replace(',', ''))
}

new_lines.push(file_lines[closing_brace_idx[0]])

console.log(new_lines.join('\n'))

fs.writeFileSync(output_directory + file_name, new_lines.join('\n'))

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

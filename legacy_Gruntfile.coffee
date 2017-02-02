module.exports = (grunt) ->
  grunt.initConfig
    pkg: grunt.file.readJSON('package.json')
    concat:
      dist:
        src: ["source/nes.js", "source/utils.js", "source/cpu.js", "source/keyboard.js", "source/mappers.js", "source/papu.js", "source/ppu.js", "source/rom.js", "source/ui.js"]
        dest: "build/jsnes.js"
    uglify:
      dist:
        src: "build/jsnes.js"
        dest: "build/jsnes.min.js"
    jshint:
      dist:
        src: "source/*.js"

  grunt.loadNpmTasks('grunt-contrib-jshint')
  grunt.loadNpmTasks('grunt-contrib-concat')
  grunt.loadNpmTasks('grunt-contrib-uglify')

  grunt.registerTask('default', ['concat', 'uglify'])


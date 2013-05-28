module.exports = (grunt) ->
  grunt.initConfig
    pkg: grunt.file.readJSON('package.json')
    concat:
      source:
        src: "source/*.js"
        dest: "build/jsnes.js"
    uglify:
      source:
        src: "build/jsnes.js"
        dest: "build/jsnes.min.js"
    jshint:
      source:
        src: "source/*.js"

  grunt.loadNpmTasks('grunt-contrib-jshint')
  grunt.loadNpmTasks('grunt-contrib-concat')
  grunt.loadNpmTasks('grunt-contrib-uglify')

  grunt.registerTask('default', ['concat', 'uglify'])


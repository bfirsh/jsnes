module.exports = function (grunt) {
  grunt.loadNpmTasks('grunt-browserify')
  grunt.loadNpmTasks('grunt-contrib-watch')
  grunt.loadNpmTasks('grunt-contrib-concat')
  grunt.loadNpmTasks('grunt-express-server')
  grunt.loadNpmTasks('grunt-standard')

  grunt.registerTask('serve', [ 'standard', 'browserify', 'express:dev', 'watch'])
  grunt.registerTask('default', 'serve')

  grunt.initConfig({
   express: {
      options: { },
      dev: {
        options: {
          script: './express_server.js'
        }
      }
    },
    standard: {
      // options: {
      //   format: true,
      //   force: true
      // },
      // ng_dashboard: {
      //   src: [
      //     '{ng-dashboard/create/**/,ng-dashboard/resources/,ng-dashboard/create/,ng-dashboard/}*.js'
      //   ]
      // },
    },
    browserify: {
      // dashboard_v1: {
      //   src: 'dashboard/main.js',
      //   dest: 'public/js/build/dashboard.js',
      //   files: {
      //     'public/js/build/dashboard.js': ['./dashboard/*.js', './dashboard/**/*.js', './dashboard/**/**/*.js' ],
      //   },
      //   options: {
      //     transform: ['brfs'],
      //     browserifyOptions: {
      //       debug: true
      //     }
      //   }
      // },
    },
    watch: {
      // ng_dashboard: {
      //   files: [ './ng-dashboard/*.js',
      //     './ng-dashboard/**/*.js' ],
      //   tasks: [ 'standard:ng_dashboard', 'browserify:ng_dashboard' ],
      //   options: {
      //     force: true,
      //     livereload: {
      //       port: 35729
      //     }
      //   },
      // },
    }
  })
}

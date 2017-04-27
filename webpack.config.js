var path = require('path');
var webpack = require('webpack');

module.exports = {
    entry: './src/index.js',
    devtool: 'source-map',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'jsnes.min.js',
        library: 'jsnes',
        libraryTarget: 'umd',
        umdNamedDefine: true
    },
    plugins: [
      new webpack.optimize.UglifyJsPlugin()
    ]
};

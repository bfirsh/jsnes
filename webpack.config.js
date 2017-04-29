var path = require("path");
var webpack = require("webpack");

module.exports = {
  entry: "./src/index.js",
  devtool: "source-map",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "jsnes.min.js",
    library: "jsnes",
    libraryTarget: "umd",
    umdNamedDefine: true
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        enforce: "pre",
        exclude: /node_modules/,
        use: [
          {
            loader: "jshint-loader"
          }
        ]
      }
    ]
  },
  plugins: [new webpack.optimize.UglifyJsPlugin()]
};

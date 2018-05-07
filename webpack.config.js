var path = require("path");
var webpack = require("webpack");

module.exports = {
  entry: {
    "jsnes": "./src/index.js",
    "jsnes.min": "./src/index.js",
  },
  devtool: "source-map",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
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
            loader: "eslint-loader"
          }
        ]
      }
    ]
  },
  plugins: [
    new webpack.optimize.UglifyJsPlugin({
      include: /\.min\.js$/,
      sourceMap: true
    })
  ]
};

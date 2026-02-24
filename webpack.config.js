import path from "path";
import TerserPlugin from "terser-webpack-plugin";
import ESLintPlugin from "eslint-webpack-plugin";

export default {
  entry: {
    jsnes: "./src/index.js",
    "jsnes.min": "./src/index.js",
  },
  mode: "production",
  devtool: "source-map",
  output: {
    path: path.resolve(import.meta.dirname, "dist"),
    filename: "[name].js",
    library: "jsnes",
    libraryTarget: "umd",
    globalObject: "globalThis",
    umdNamedDefine: true,
    clean: true,
  },
  module: {},
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        include: /\.min\.js$/,
        extractComments: false,
      }),
    ],
  },
  plugins: [
    new ESLintPlugin({
      extensions: ["js"],
      exclude: "node_modules",
    }),
  ],
};

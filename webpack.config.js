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
    umdNamedDefine: true,
    clean: true,
  },
  module: {
    rules: [
      // Import files as raw strings with ?raw suffix (e.g. AudioWorklet code).
      // Matches Vite's built-in ?raw behavior.
      { resourceQuery: /raw/, type: "asset/source" },
    ],
  },
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

import path from "path";
import TerserPlugin from "terser-webpack-plugin";

export default {
  entry: {
    jsnes: "./src/index.ts",
    "jsnes.min": "./src/index.ts",
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
  resolve: {
    extensions: [".ts", ".js"],
    extensionAlias: {
      ".ts": [".ts", ".js"],
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: "ts-loader",
          options: {
            transpileOnly: true,
          },
        },
      },
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
  plugins: [],
};

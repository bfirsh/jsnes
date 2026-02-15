import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  js.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Browser globals
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        AudioContext: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        localStorage: "readonly",
        Image: "readonly",
        XMLHttpRequest: "readonly",
        Float32Array: "readonly",
        Uint8ClampedArray: "readonly",
        Uint32Array: "readonly",
        ArrayBuffer: "readonly",
        // Node globals
        process: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      eqeqeq: ["error", "always"],
      "no-alert": "error",
    },
  },
];

import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  js.configs.recommended,
  eslintConfigPrettier,
  // AudioWorklet processor runs in a worklet scope with its own globals
  {
    files: ["src/browser/audio-worklet-processor.js"],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: "readonly",
        registerProcessor: "readonly",
        Float32Array: "readonly",
      },
    },
  },
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
        AudioWorkletNode: "readonly",
        Blob: "readonly",
        URL: "readonly",
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

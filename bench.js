#!/usr/bin/env node

// Benchmark script for jsnes
// Usage: node bench.js [frames] [rom]
//
// Examples:
//   node bench.js              # 1000 frames, all ROMs
//   node bench.js 5000         # 5000 frames, all ROMs
//   node bench.js 1000 croom   # 1000 frames, croom only

import fs from "fs";
import path from "path";
import NES from "./src/nes.js";

const ROMS = {
  croom: "roms/croom/croom.nes",
  lj65: "roms/lj65/lj65.nes",
  nestest: "roms/nestest/nestest.nes",
};

const numFrames = parseInt(process.argv[2], 10) || 1000;
const romFilter = process.argv[3];

function benchRom(name, romPath, frames) {
  const data = fs.readFileSync(romPath, "binary");
  const nes = new NES({ emulateSound: true });
  nes.loadROM(data);

  // Warm up (let JIT compile hot paths)
  for (let i = 0; i < 20; i++) {
    nes.frame();
  }
  nes.reloadROM();

  const start = performance.now();
  for (let i = 0; i < frames; i++) {
    nes.frame();
  }
  const elapsed = performance.now() - start;

  const fps = (frames / elapsed) * 1000;
  const msPerFrame = elapsed / frames;
  const realtime = fps / 60;

  return { name, frames, elapsed, fps, msPerFrame, realtime };
}

console.log(`jsnes benchmark — ${numFrames} frames per ROM\n`);

const results = [];
for (const [name, romPath] of Object.entries(ROMS)) {
  if (romFilter && name !== romFilter) continue;
  if (!fs.existsSync(romPath)) {
    console.log(`  ${name}: ROM not found, skipping`);
    continue;
  }

  process.stdout.write(`  ${name}...`);
  const result = benchRom(name, romPath, numFrames);
  results.push(result);
  console.log(
    ` ${result.fps.toFixed(0)} fps (${result.msPerFrame.toFixed(2)} ms/frame, ${result.realtime.toFixed(1)}x realtime)`,
  );
}

if (results.length > 1) {
  const avgFps = results.reduce((sum, r) => sum + r.fps, 0) / results.length;
  const avgMs =
    results.reduce((sum, r) => sum + r.msPerFrame, 0) / results.length;
  console.log(
    `\n  avg: ${avgFps.toFixed(0)} fps (${avgMs.toFixed(2)} ms/frame, ${(avgFps / 60).toFixed(1)}x realtime)`,
  );
}

// Runs a test ROM and works out whether it passed.
//
// Test ROMs report their results in one of two ways:
//
// - Newer ROMs by blargg (and others using his framework) use a memory
//   protocol: they write $DE $B0 $61 to $6001-$6003, then keep a status
//   byte at $6000 ($80 = still running, $81 = "please press reset",
//   anything below $80 = finished, with 0 meaning passed) and a
//   zero-terminated text log at $6004.
//
// - Older ROMs only print their result on screen. Their font has ASCII
//   characters at the matching tile numbers, so we can read the screen text
//   straight out of the nametable.
//
// See e.g. roms/nes-test-roms/ppu_open_bus/readme.txt.

import fs from "fs";
import NES from "../../src/nes.js";

// Frames to wait after a ROM asks for reset before pressing it. (The ROMs
// ask for it to be pressed after the "press reset" message disappears.)
const RESET_DELAY_FRAMES = 10;

export function loadTestRom(path) {
  const nes = new NES({
    onFrame() {},
    onAudioSample() {},
    emulateSound: false,
  });
  nes.loadROM(fs.readFileSync(path).toString("binary"));
  return nes;
}

// Is the $6000 status protocol in use?
function hasStatusSignature(nes) {
  const mem = nes.cpu.mem;
  return mem[0x6001] === 0xde && mem[0x6002] === 0xb0 && mem[0x6003] === 0x61;
}

// The text log at $6004.
function statusText(nes) {
  const mem = nes.cpu.mem;
  let text = "";
  for (let addr = 0x6004; addr < 0x8000 && mem[addr] !== 0; addr++) {
    text += String.fromCharCode(mem[addr]);
  }
  // Strip the ANSI colour codes some ROMs use.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "").trim();
}

// The text on screen, read from the first nametable.
export function screenText(nes) {
  const ppu = nes.ppu;
  const lines = [];
  for (let row = 0; row < 30; row++) {
    let line = "";
    for (let col = 0; col < 32; col++) {
      const addr = 0x2000 + row * 32 + col;
      const tile = ppu.vramMem[ppu.vramMirrorTable[addr]];
      line += tile >= 0x20 && tile < 0x7f ? String.fromCharCode(tile) : " ";
    }
    lines.push(line.trimEnd());
  }
  return lines.filter((line) => line !== "").join("\n");
}

// Run a ROM that uses the $6000 status protocol until it finishes,
// pressing reset whenever it asks. Returns { status, text }; status is null
// if the ROM didn't finish within maxFrames.
export function runStatusRom(path, maxFrames = 3000) {
  const nes = loadTestRom(path);
  let prevStatus = -1;
  let resetAt = -1;
  for (let frame = 0; frame < maxFrames; frame++) {
    nes.frame();
    if (!hasStatusSignature(nes)) continue;
    const status = nes.cpu.mem[0x6000];
    if (status === 0x81 && prevStatus !== 0x81) {
      resetAt = frame + RESET_DELAY_FRAMES;
    }
    prevStatus = status;
    if (frame === resetAt) {
      nes.reset();
    }
    if (status < 0x80) {
      return { status, text: statusText(nes) };
    }
  }
  return {
    status: null,
    text: hasStatusSignature(nes) ? statusText(nes) : screenText(nes),
  };
}

// Run a ROM that only reports on screen until the screen text matches
// `doneRegex` (checked every few frames). Returns the screen text, or null
// if it didn't finish within maxFrames.
export function runScreenRom(path, doneRegex, maxFrames = 3000) {
  const nes = loadTestRom(path);
  for (let frame = 0; frame < maxFrames; frame++) {
    nes.frame();
    if (frame % 10 === 9) {
      const text = screenText(nes);
      if (doneRegex.test(text)) return text;
    }
  }
  return null;
}

// Define a node:test `it` for each test ROM in `entries`. Each entry is:
//   rom:       path relative to roms/nes-test-roms
//   screen:    for ROMs that only report on screen, { done, pass }: regexes
//              for "the result is on screen" and "the result is a pass".
//              Omit for ROMs that use the $6000 status protocol.
//   maxFrames: how long to wait for a result (default 3000, ~50s of NES
//              time)
//   skip:      reason the test is known to fail, if it is
export function defineTestRomTests(it, entries) {
  for (const entry of entries) {
    const path = "roms/nes-test-roms/" + entry.rom;
    const options = entry.skip ? { skip: entry.skip } : {};
    it(entry.rom, options, function () {
      if (entry.screen) {
        const text = runScreenRom(path, entry.screen.done, entry.maxFrames);
        if (text === null) {
          throw new Error(`${entry.rom} didn't finish`);
        }
        if (!entry.screen.pass.test(text)) {
          throw new Error(`${entry.rom} failed. Screen:\n${text}`);
        }
      } else {
        const result = runStatusRom(path, entry.maxFrames);
        if (result.status === null) {
          throw new Error(
            `${entry.rom} didn't finish. Output:\n${result.text}`,
          );
        }
        if (result.status !== 0) {
          throw new Error(
            `${entry.rom} failed with code ${result.status}. Output:\n${result.text}`,
          );
        }
      }
    });
  }
}

// Screen result formats used by blargg's older test ROMs.
// "PASSED" / "FAILED: #n" (sprite_hit_tests, vbl_nmi_timing, ...)
export const PASSED_OR_FAILED = { done: /PASSED|FAILED/, pass: /PASSED/ };
// "Passed" / "Failed #n" (newer ROMs that don't use the $6000 protocol)
export const PASSED_OR_FAILED_MIXED_CASE = {
  done: /Passed|Failed/,
  pass: /Passed/,
};
// A bare result code, where $01 means passed (2005 APU and PPU tests).
export const RESULT_CODE = { done: /\$[0-9A-F]{2}/, pass: /^\s*\$01$/m };

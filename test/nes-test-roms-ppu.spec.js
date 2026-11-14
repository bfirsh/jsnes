// PPU test ROMs from https://github.com/christopherpow/nes-test-roms
// (copied into roms/nes-test-roms, with their readmes). See
// test/helpers/test-rom-runner.js for how results are read.
import { describe, it } from "node:test";
import {
  defineTestRomTests,
  PASSED_OR_FAILED,
  RESULT_CODE,
} from "./helpers/test-rom-runner.js";

const SPRITE_HIT_TESTS = [
  "01.basics",
  "02.alignment",
  "03.corners",
  "04.flip",
  "05.left_clip",
  "06.right_edge",
  "07.screen_bottom",
  "08.double_height",
  "09.timing_basics",
  "10.timing_order",
  "11.edge_timing",
];

const VBL_NMI_TIMING_TESTS = [
  "1.frame_basics",
  "2.vbl_timing",
  "3.even_odd_frames",
  "4.vbl_clear_timing",
  "5.nmi_suppression",
  "6.nmi_disable",
  "7.nmi_timing",
];

// Tests that are known to fail, and why. They're skipped.
const KNOWN_FAILURES = {
  "blargg_ppu_tests_2005.09.15b/power_up_palette.nes":
    "palette RAM starts zeroed instead of with typical power-on contents",

  // Test 3 turns rendering off at about dot 15 of line 126 and back on 12
  // lines later, then expects the overflow caused by 9 sprites at Y=230
  // (OAM rows 4-8). But turning rendering off mid-line corrupts an OAM row
  // (here row 7 or 8, depending on the CPU/PPU alignment), which
  // AccuracyCoin's hardware-verified "OAM Corruption" test requires, and
  // that leaves only 7 sprites at Y=230. (This test is from 2005, before
  // OAM corruption was understood.)
  "sprite_overflow_tests/5.Emulator.nes":
    "conflicts with AccuracyCoin's OAM corruption test (see comment)",
};

describe("nes-test-roms: PPU", { timeout: 600000 }, function () {
  defineTestRomTests(
    it,
    [
      // VBlank flag, NMI timing and suppression, odd/even frames.
      { rom: "ppu_vbl_nmi/ppu_vbl_nmi.nes" },
      ...VBL_NMI_TIMING_TESTS.map((name) => ({
        rom: `vbl_nmi_timing/${name}.nes`,
        screen: PASSED_OR_FAILED,
      })),
      // The PPU's open bus "decay register".
      { rom: "ppu_open_bus/ppu_open_bus.nes" },
      // $2007 read buffer, VRAM/palette mirroring, open bus.
      { rom: "ppu_read_buffer/test_ppu_read_buffer.nes" },
      // OAM reads and writes.
      { rom: "oam_read/oam_read.nes" },
      { rom: "oam_stress/oam_stress.nes" },
      // blargg's 2005 PPU tests.
      ...[
        "palette_ram",
        "power_up_palette",
        "sprite_ram",
        "vbl_clear_time",
        "vram_access",
      ].map((name) => ({
        rom: `blargg_ppu_tests_2005.09.15b/${name}.nes`,
        screen: RESULT_CODE,
      })),
      // Sprite 0 hit.
      ...SPRITE_HIT_TESTS.map((name) => ({
        rom: `sprite_hit_tests_2005.10.05/${name}.nes`,
        screen: PASSED_OR_FAILED,
      })),
      // Sprite overflow flag, including the hardware's buggy OAM scan.
      { rom: "sprite_overflow_tests/1.Basics.nes", screen: PASSED_OR_FAILED },
      { rom: "sprite_overflow_tests/2.Details.nes", screen: PASSED_OR_FAILED },
      { rom: "sprite_overflow_tests/3.Timing.nes", screen: PASSED_OR_FAILED },
      { rom: "sprite_overflow_tests/4.Obscure.nes", screen: PASSED_OR_FAILED },
      { rom: "sprite_overflow_tests/5.Emulator.nes", screen: PASSED_OR_FAILED },
    ],
    KNOWN_FAILURES,
  );
});

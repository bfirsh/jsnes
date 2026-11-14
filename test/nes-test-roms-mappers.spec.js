// Mapper test ROMs from https://github.com/christopherpow/nes-test-roms
// (copied into roms/nes-test-roms, with their readmes). See
// test/helpers/test-rom-runner.js for how results are read.
import { describe, it } from "node:test";
import { defineTestRomTests } from "./helpers/test-rom-runner.js";

// Tests that are known to fail, and why. They're skipped.
const KNOWN_FAILURES = {};

describe("nes-test-roms: mappers", { timeout: 600000 }, function () {
  defineTestRomTests(
    it,
    [
      // MMC3 scanline counter: clocking by PPU A12, reload/IRQ rules and IRQ
      // timing to the PPU dot. (mmc3_test_2 also has 6-MMC3_alt, for the
      // older MMC3A behaviour; JSNES emulates the common MMC3B, so it's not
      // included.)
      { rom: "mmc3_test_2/1-clocking.nes" },
      { rom: "mmc3_test_2/2-details.nes" },
      { rom: "mmc3_test_2/3-A12_clocking.nes" },
      { rom: "mmc3_test_2/4-scanline_timing.nes" },
      { rom: "mmc3_test_2/5-MMC3.nes" },
    ],
    KNOWN_FAILURES,
  );
});

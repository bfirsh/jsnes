// APU and DMA test ROMs from https://github.com/christopherpow/nes-test-roms
// (copied into roms/nes-test-roms, with their readmes). See
// test/helpers/test-rom-runner.js for how results are read.
import { describe, it } from "node:test";
import {
  defineTestRomTests,
  PASSED_OR_FAILED_MIXED_CASE,
  pressPromptedButtons,
  RESULT_CODE,
} from "./helpers/test-rom-runner.js";

const APU_2005_TESTS = [
  "01.len_ctr",
  "02.len_table",
  "03.irq_flag",
  "04.clock_jitter",
  "05.len_timing_mode0",
  "06.len_timing_mode1",
  "07.irq_flag_timing",
  "08.irq_timing",
  "09.reset_timing",
  "10.len_halt_timing",
  "11.len_reload_timing",
];

// The dmc_dma_during_read4 ROMs print the values read and a CRC of them.
// Some of them depend on the CPU/PPU alignment at power-on, so the source
// lists every CRC real hardware can give; the others print "Passed".
// See roms/nes-test-roms/dmc_dma_during_read4/readme.txt.
function dmcDmaScreen(...crcs) {
  return {
    done: /Passed|Failed|^ [0-9A-F]{8}$/m,
    pass: new RegExp(`Passed|^ (${crcs.join("|") || "-"})$`, "m"),
  };
}

// Tests that are known to fail, and why. They're skipped.
const KNOWN_FAILURES = {
  "apu_reset/4015_cleared.nes":
    "nes.reset() doesn't emulate the reset button yet",
  "apu_reset/4017_timing.nes":
    "nes.reset() doesn't emulate the reset button yet",
  "apu_reset/4017_written.nes":
    "nes.reset() doesn't emulate the reset button yet",
  "apu_reset/irq_flag_cleared.nes":
    "nes.reset() doesn't emulate the reset button yet",
  "apu_reset/len_ctrs_enabled.nes":
    "nes.reset() doesn't emulate the reset button yet",
  "apu_reset/works_immediately.nes":
    "nes.reset() doesn't emulate the reset button yet",
  "blargg_apu_2005.07.30/09.reset_timing.nes":
    "nes.reset() doesn't emulate the reset button yet",

  "blargg_apu_2005.07.30/10.len_halt_timing.nes":
    "length counter writes just before a length clock aren't emulated yet",
  "blargg_apu_2005.07.30/11.len_reload_timing.nes":
    "length counter writes just before a length clock aren't emulated yet",
};

describe("nes-test-roms: APU and DMA", { timeout: 600000 }, function () {
  defineTestRomTests(
    it,
    [
      // Length counters, frame counter, IRQ flag, DMC.
      { rom: "apu_test/apu_test.nes" },
      // APU state at power-on and after reset.
      ...[
        "4015_cleared",
        "4017_timing",
        "4017_written",
        "irq_flag_cleared",
        "len_ctrs_enabled",
        "works_immediately",
      ].map((name) => ({ rom: `apu_reset/${name}.nes` })),
      // blargg's 2005 APU tests (frame counter and length counter timing).
      ...APU_2005_TESTS.map((name) => ({
        rom: `blargg_apu_2005.07.30/${name}.nes`,
        screen: RESULT_CODE,
      })),
      // DMC DMA stealing cycles from CPU reads of I/O registers.
      {
        rom: "dmc_dma_during_read4/dma_2007_read.nes",
        screen: dmcDmaScreen("159A7A8F", "5E3DF9C4"),
      },
      {
        rom: "dmc_dma_during_read4/dma_2007_write.nes",
        screen: dmcDmaScreen(),
      },
      { rom: "dmc_dma_during_read4/dma_4016_read.nes", screen: dmcDmaScreen() },
      {
        rom: "dmc_dma_during_read4/double_2007_read.nes",
        screen: dmcDmaScreen("85CFD627", "F018C287", "440EF923", "E52F41A5"),
      },
      {
        rom: "dmc_dma_during_read4/read_write_2007.nes",
        screen: dmcDmaScreen(),
      },
      // OAM DMA and DMC DMA at the same time.
      { rom: "sprdma_and_dmc_dma/sprdma_and_dmc_dma.nes" },
      { rom: "sprdma_and_dmc_dma/sprdma_and_dmc_dma_512.nes" },
      // Controller reads, including while DMC DMA is running.
      {
        rom: "read_joy3/thorough_test.nes",
        screen: PASSED_OR_FAILED_MIXED_CASE,
      },
      // Asks for each button to be pressed in turn.
      {
        rom: "read_joy3/test_buttons.nes",
        screen: PASSED_OR_FAILED_MIXED_CASE,
        input: pressPromptedButtons,
      },
    ],
    KNOWN_FAILURES,
  );
});

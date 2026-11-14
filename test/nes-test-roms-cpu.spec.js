// CPU test ROMs from https://github.com/christopherpow/nes-test-roms
// (copied into roms/nes-test-roms, with their readmes). See
// test/helpers/test-rom-runner.js for how results are read.
import { describe, it } from "node:test";
import {
  defineTestRomTests,
  PASSED_OR_FAILED,
  PASSED_OR_FAILED_MIXED_CASE,
} from "./helpers/test-rom-runner.js";

describe("nes-test-roms: CPU", { timeout: 600000 }, function () {
  defineTestRomTests(it, [
    // Every official and unofficial instruction.
    { rom: "instr_test-v5/all_instrs.nes", maxFrames: 4000 },
    // Instruction timing, including page crossing and branch timing.
    { rom: "instr_timing/instr_timing.nes", maxFrames: 4000 },
    // Wraparound, dummy reads.
    { rom: "instr_misc/instr_misc.nes" },
    // CLI/SEI/PLP latency, NMI/IRQ/BRK interactions, IRQ during DMA.
    { rom: "cpu_interrupts_v2/cpu_interrupts.nes" },
    {
      rom: "cpu_dummy_reads/cpu_dummy_reads.nes",
      screen: PASSED_OR_FAILED_MIXED_CASE,
    },
    { rom: "cpu_dummy_writes/cpu_dummy_writes_oam.nes" },
    { rom: "cpu_dummy_writes/cpu_dummy_writes_ppumem.nes" },
    // Executing code from I/O registers (open bus).
    { rom: "cpu_exec_space/test_cpu_exec_space_apu.nes" },
    { rom: "cpu_exec_space/test_cpu_exec_space_ppuio.nes" },
    // Register state at power and after pressing reset.
    { rom: "cpu_reset/registers.nes" },
    { rom: "cpu_reset/ram_after_reset.nes" },
    // Older timing tests that report on screen.
    {
      rom: "branch_timing_tests/1.Branch_Basics.nes",
      screen: PASSED_OR_FAILED,
    },
    {
      rom: "branch_timing_tests/2.Backward_Branch.nes",
      screen: PASSED_OR_FAILED,
    },
    {
      rom: "branch_timing_tests/3.Forward_Branch.nes",
      screen: PASSED_OR_FAILED,
    },
    { rom: "cpu_timing_test6/cpu_timing_test.nes", screen: PASSED_OR_FAILED },
  ]);
});

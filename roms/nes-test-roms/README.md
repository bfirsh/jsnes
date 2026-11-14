# nes-test-roms

A selection of NES emulator test ROMs, mostly by Shay Green (blargg), copied
from the [christopherpow/nes-test-roms](https://github.com/christopherpow/nes-test-roms)
collection (commit `95d8f621ae55cee0d09b91519a8989ae0e64753b`). Each directory
has the original readme explaining what its ROMs test and what each error
code means. The assembly source for most of them is in the collection.

They're run by `test/nes-test-roms-*.spec.js` (see
`test/helpers/test-rom-runner.js` for how the results are read). The
[nesdev wiki's list of emulator tests](https://www.nesdev.org/wiki/Emulator_tests)
describes these and others.

Left out on purpose:

- Older versions of tests that are included here in a newer version (e.g.
  `instr_test-v3`, `nes_instr_test`, `mmc3_test`, `mmc3_irq_tests`).
- Single-test ROMs (`rom_singles/`) where the combined ROM is included,
  except for `mmc3_test_2`, which has no combined ROM.
- Tests for hardware variants JSNES doesn't emulate: PAL (`pal_apu_tests`),
  the MMC3A and MMC6 IRQ behaviour (`mmc3_test_2/6-MMC3_alt`), and mappers
  JSNES doesn't support.
- Tests whose results can only be judged by eye or ear (`apu_mixer`,
  `dmc_tests`, `full_palette`, `scanline`, ...) or that need someone to press
  buttons (`read_joy3/test_buttons`).

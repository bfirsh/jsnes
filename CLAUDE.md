# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Style
- This codebase should be readable by somebody who's not familiar with the NES or emulation, so add more comments and documentation than you might otherwise do, and explain context.

## Essential Commands

- `npm test` - Run code formatting check and tests (required before commits)
- `npm run build` - Build distribution files (`dist/jsnes.js` and `dist/jsnes.min.js`)
- `npm run format` - Auto-format all code (core and web) with Prettier
- `npm run test:watch` - Run tests in watch mode for development
- `npm run typecheck` - TypeScript type checking (verifies `.d.ts` files)
- `node bench.js` - Run performance benchmark (~900 fps on a small cloud VM; compare against `master` on the same machine rather than an absolute number). Run this on major changes or when you suspect a performance regression/improvement. The CPU/PPU/APU inner loops are the hot paths.

## Code Architecture

JSNES is a JavaScript NES emulator with component-based architecture mirroring actual NES hardware:

### Core Components (all in `src/`)

**Main Orchestrator**: `nes.js` - Central class that coordinates all emulation components. Accepts callback functions for frame rendering, audio output, and status updates.

**CPU**: `cpu.js` - Cycle-stepped 6502. Every bus access is one `read()`/`write()` call = one CPU cycle, which clocks the APU, advances the PPU 3 dots and samples the interrupt lines. Also contains the DMA unit (OAM and DMC DMA), since DMA works by halting the CPU.

**PPU**: `ppu/index.js` - Dot-stepped Picture Processing Unit: loopy v/t/x/w scroll registers, background fetch/shift-register pipeline, per-dot sprite evaluation and sprite output units, 256x240 frame buffer output.

**PAPU**: `papu/` - Audio Processing Unit with NES's 5 audio channels (2 square waves, triangle, noise, DMC). Everything the CPU can observe (frame counter, length counters, IRQ flags, DMC DMA requests) is exact to the CPU cycle. Like the PPU it runs lazily: counters advance in bulk and `clockCycle()` runs only on event cycles (see `catchUp()`). Audio synthesis runs once per output sample in `_flushAudio()`, with each channel's output averaged exactly over the cycles in between.

**Memory Mappers**: `mappers/` - Implements cartridge memory mappers (0-180) using inheritance hierarchy. All mappers inherit from Mapper 0 (`mapper0.js`, which also handles the CPU-side I/O registers $2000-$4017) and override specific banking/memory mapping behavior.

**ROM Loader**: `rom.js` - Parses iNES format ROM files, extracts PRG-ROM/CHR-ROM, and determines appropriate mapper.

**Tile cache**: `tile.js` - Pre-decoded 8x8 pattern tiles (`ppu.ptTile`). The PPU renders from raw pattern bytes, but mappers maintain this cache and MMC5's extended attribute mode uses it.

**Controller**: `controller.js` - Button state management for 2 controllers with 8 buttons each (A, B, SELECT, START, UP, DOWN, LEFT, RIGHT) and serial strobe protocol.

**Utilities**: `utils.js` - Helper functions for state serialization (`toJSON()`/`fromJSON()`) used across CPU, PPU, PAPU, and mappers for save state support.

### Key Architectural Patterns

- **Event-driven design**: Main NES class uses callbacks (`onFrame`, `onAudioSample`, `onStatusUpdate`, `onBatteryRamWrite`)
- **Component separation**: Each NES subsystem is a separate class with clear interfaces
- **Inheritance for mappers**: Code reuse while supporting cartridge-specific behavior
- **Frame-based execution**: `nes.frame()` runs CPU instructions until the PPU starts VBlank. Timing within the frame is exact (cycle/dot level).

### Usage Pattern
```javascript
var nes = new jsnes.NES({
  onFrame: function(frameBuffer) { /* render 256x240 pixels */ },
  onAudioSample: function(left, right) { /* play audio */ }
});
nes.loadROM(romData);
nes.frame(); // Execute one frame
nes.buttonDown(1, jsnes.Controller.BUTTON_A); // Handle input
```

## Testing

Tests use `node:test` + `node:assert/strict` (Node's built-in test runner):
- `test/nes.spec.js` - Basic initialization, ROM loading, frame generation with regression testing using `croom.nes` test ROM, frame buffer validation, error handling
- `test/cpu.spec.js` - Comprehensive CPU instruction testing (based on upstream wedNESday and nintengo test suites)
- `test/mappers.spec.js` - Mapper functionality tests (ROM protection, SRAM writes, RAM mirroring)
- `test/nestest.spec.js` - Full nestest.nes ROM harness with detailed error code mappings for all CPU instructions and addressing modes
- `test/accuracycoin.spec.js` - AccuracyCoin test ROM harness (134 hardware accuracy tests)
- `test/nes-test-roms-{cpu,ppu,apu,mappers}.spec.js` - blargg's test ROMs and others from the nes-test-roms collection (runner in `test/helpers/test-rom-runner.js`, which understands both the `$6000` status protocol and on-screen results, and can press reset and controller buttons)

Test ROMs:
- `roms/croom/` - Simple test ROM for automated testing
- `roms/AccuracyCoin/` - Comprehensive accuracy test ROM (134 tests covering CPU, PPU, APU behavior)
- `roms/nestest/` - CPU instruction test ROM (official + unofficial opcodes)
- `roms/nes-test-roms/` - ~80 test ROMs from https://github.com/christopherpow/nes-test-roms, each directory with its readme (see `roms/nes-test-roms/README.md` for what was left out and why)
- `local-roms/` - Collection of ROMs for manual testing

All 134 AccuracyCoin tests pass. If one ever has to be skipped, list it in the `KNOWN_FAILURES` object in `test/accuracycoin.spec.js`. Tests from nes-test-roms that don't pass are listed, with the reason, in the `KNOWN_FAILURES` map in each `test/nes-test-roms-*.spec.js` file; they're older than AccuracyCoin, so if the two ever disagree, AccuracyCoin wins. `roms/AccuracyCoin/AccuracyCoin.asm` is fully commented and is the best documentation of what each test expects; when a test fails, read its source and instrument the emulator (e.g. log the relevant register accesses with `cpu.cycles` and `ppu.line`/`ppu.dot`) rather than guessing.

Remember that AccuracyCoin, nestest and blargg's tests are DEFINITELY correct. They pass on a real NES. Don't blame the ROM for being wrong. (The one exception so far is a 2005 blargg test that predates the discovery of OAM corruption; see `KNOWN_FAILURES` in `test/nes-test-roms-ppu.spec.js`.)

## Build Process

Webpack configuration creates UMD modules compatible with browsers and Node.js:
- Entry point: `src/index.js` (exports NES and Controller classes)
- Output: `dist/jsnes.js` (regular) and `dist/jsnes.min.js` (minified)
- Includes ESLint checking and source map generation
- Library name: `jsnes` (global variable in browsers)
- TypeScript type definitions: `src/nes.d.ts` and `src/controller.d.ts` provide public API types
- CI: GitHub Actions (`.github/workflows/ci.yaml`) runs build and tests on push/PR with Node.js 22.x

## Code Quality Requirements

- All code must be formatted with Prettier (enforced by test suite)
- ESLint rules are enforced during build
- Tests must pass before commits
- Frame buffer regression tests prevent rendering regressions

## Documentation and reference for the NES

The nesdev wiki has tons of information about the NES. You should browse this before implementing something to understand how it works: https://www.nesdev.org/wiki/NES_reference_guide

## NES Hardware Accuracy

The emulator implements several hardware-accurate behaviors verified by the AccuracyCoin test ROM. 

### Open Bus

The NES data bus retains the last value from any read/write. Reading from unmapped or write-only addresses returns this "open bus" value. The CPU tracks this in `cpu.dataBus`, updated on every load, write, push, pull, opcode fetch, and interrupt vector fetch.

- **CPU open bus regions**: $4018-$5FFF (unmapped expansion), $4000-$4014 (write-only APU registers)
- **PPU open bus**: The PPU has its own internal I/O latch (`ppu.openBusLatch`), updated on every PPU register write. Write-only PPU registers ($2000, $2001, $2003, $2005, $2006) return this latch. $2002 returns status in bits 7-5 with the latch in bits 4-0.
- **Controller open bus**: $4016/$4017 only drive bits 0-4; bits 5-7 come from the CPU data bus
- **$4015 bit 5**: Not driven by APU; comes from the CPU data bus

Key reference: https://www.nesdev.org/wiki/Open_bus_behavior

### Dummy Reads and Writes

The 6502 performs "dummy reads" during addressing — extra bus cycles that read from intermediate/incorrect addresses while the CPU computes the final effective address. These are real bus operations visible on the bus: they update the data bus and trigger I/O side effects (e.g., reading $4015 clears interrupt flags). See https://www.nesdev.org/wiki/CPU_addressing_modes

Dummy reads occur in:
- **Absolute indexed** (cases 8, 9): On page crossing, reads from address with uncorrected high byte
- **Zero page indexed** (cases 6, 7): Reads from unindexed zero-page address while adding X/Y
- **Pre-indexed indirect** (case 10): Reads from pointer address before adding X
- **Post-indexed indirect** (case 11): Same page-crossing behavior as absolute indexed
- **Stores** (STA/STX/STY) and **RMW instructions**: Always perform the indexed dummy read, even without page crossing

RMW instructions (ASL, LSR, ROL, ROR, INC, DEC, and unofficial SLO, SRE, RLA, RRA, DCP, ISC) also perform a "dummy write" — they write the original value back to the address before writing the modified value. This is documented in the ASL implementation (case 2) in `cpu.js`.

### Cycle stepping and PPU catch-up

On real hardware the CPU, PPU and APU run in lockstep: each CPU cycle is 3 PPU dots and 1 APU cycle. The emulator models this directly:

- Every CPU bus access is a full cycle (`cpu.read()`/`cpu.write()`). Instructions are written out cycle by cycle, including dummy reads/writes, so cycle counts are never looked up from a table.
- Within a cycle the order is: DMA check (reads only), APU clock, the bus access, then the PPU's 3 dots. The CPU samples NMI after the first of those 3 dots, and IRQ at the end of the cycle. These orderings are calibrated against AccuracyCoin; changing them breaks VBlank/NMI/APU timing tests.
- Interrupts are polled every cycle; an instruction services an interrupt if one was pending at the end of its *second-to-last* cycle (`prevNeedNmi`/`prevRunIrq`). CLI/SEI/PLP latency, RTI, the branch delay quirk and NMI hijacking of BRK/IRQ all follow from this.
- For speed the PPU runs lazily ("catch-up"): it is owed 3 dots per CPU cycle (`ppu.dotTarget`, topped up from `cpu.cycles - cpu.ppuCycles` in `_endCycle()`/`_syncPpu()`), and runs them in a batch (`ppu.catchUp()`) whenever something could observe it — PPU register access, cartridge/mapper access ($4020+, except ROM reads), $4017 (Zapper). The PPU predicts its next CPU-visible event (`_scheduleNextEvent()`: VBlank set/clear, the odd-frame dot skip, the mapper scanline clock that might raise an IRQ (`mmap.irqClocksUntilIrq()`), a pending $2001 change) and runs in exact step for that one cycle (`runCycleExact()`). Only $2000-$2002 accesses and mapper register writes (for scanline-counting mappers) re-check the events. If you add PPU behaviour that the CPU can see without a register access, add it as an event there.
- The APU works the same way: `papu.catchUp()` advances counters in bulk and runs `clockCycle()` exactly on event cycles (frame counter steps, DMC timer expiry while the DMC isn't idle, $4015/$4017 delays). APU register reads/writes catch up first. Audio output samples are *not* events: synthesis (`_flushAudio()`) runs before anything changes channel state, and at the end of each frame. Silent square/noise channels and the idle DMC timer are advanced lazily. New APU behaviour the CPU can observe must be an event in `_scheduleNextEvent()`.
- **Fast and slow cycles** (`cpu.nextEvent`, see `cpu.js`): most cycles are RAM/PRG ROM accesses with no DMA pending, no APU/PPU event and quiet interrupt lines, and `read()`/`write()` do only the access for them. `_updateNextEvent()` works out the first cycle that isn't like that at the end of every slow cycle. Anything that changes DMA, interrupt or event state from outside a slow cycle must set `cpu.nextEvent = 0` (always safe).
- **Idle loops** (`cpu._idleLoopCheck()`): if an iteration of a loop did no writes and only fast reads (or `$2002` reads answered from the PPU's prediction) and left registers and flags unchanged, the CPU adds the cycles of as many identical iterations as fit before the next event. Writes and slow reads count as `cpu.sideEffects`.
- **`$2002` polling** (`ppu.predictStatus()`): after a `$2002` read the PPU works out how far ahead the status flags can't change (sprite 0 hit dot, overflow, VBlank), and later reads before that point don't catch the PPU up. Any other PPU/cartridge access drops the prediction.
- On visible lines the PPU renders whole tiles at a time (`_renderTiles()`), draws sprites from a precomputed sprite line (`_buildSpriteLine()`) in a separate pass, and evaluates sprites from a per-line cache of which sprites are on each line (`_oamLineCache()`, rebuilt when OAM changes); anything that would disturb those (rendering toggled mid-line) falls back to exact per-dot state.
- When optimizing, verify with AccuracyCoin from several power-on alignments and compare frame buffers / audio output (and save state round trips) with `master` frame by frame, for many frames (the benchmark ROMs change behaviour after ~1500 frames). Run `node bench.js` before and after; it's noisy, so repeat it.

See https://www.nesdev.org/wiki/Catch-up and https://www.nesdev.org/wiki/CPU_interrupts

### DMA

OAM DMA ($4014) and DMC DMA both halt the CPU on its next *read* cycle (`cpu._runDma()`). While halted, the CPU repeats its pending read on halt/dummy/alignment cycles, which has side effects on registers like $2002, $2007, $4015 and $4016. DMA reads happen on "get" (even) cycles and OAM writes on "put" (odd) cycles. If the CPU was halted while reading $4000-$401F, DMA reads also hit the 2A03's internal registers (low 5 address bits) — see `_dmaFetch()`. DMC DMA requests, start/disable delays and the 1-cycle "implicit abort" live in `papu/channel-dm.js`. See https://www.nesdev.org/wiki/DMA

### JSR Cycle Order

The real 6502 reads JSR's target high byte *after* pushing the return address, making it the last bus operation before entering the target. This matters when JSR targets unmapped addresses — the data bus value on entry is the high byte of the target.

### APU Frame IRQ

In 4-step mode the frame interrupt flag (`frameIrqActive`) is asserted on 3 consecutive CPU cycles at the end of the sequence (29828, 29829, 29830). The first two set it regardless of the IRQ inhibit bit; the third leaves it set only if IRQs aren't inhibited. Writing $4017 with bit 6 set clears it. Reading $4015 clears it at the next put->get boundary, not immediately. See https://www.nesdev.org/wiki/APU_Frame_Counter

### SHx opcodes and DMA

SHA/SHX/SHY/SHS store `register & (H+1)`, where H is the high byte of the base address. If a DMA halted the CPU on the cycle just before the write, the `& (H+1)` term is lost (`cpu._shx()`).

### PPU rendering quirks

The PPU emulates the real fetch/shift pipeline, so most quirks follow naturally. Ones that needed explicit handling (all tested by AccuracyCoin, documented in `ppu/index.js`):
- Rendering-disabled behaviour: BG shifters and sprite shifters freeze, but sprite X counters keep counting; if rendering is off at dot 340 the X counters are zeroed.
- BG shifters shift in 0 (low plane) / 1 (high plane); a skipped reload shows these bits.
- Sprite evaluation is a byte-level state machine (misaligned OAMADDR, X-coordinate range check, overflow bug, "sprite 0" = first sprite found at dot 66).
- The pre-render line fetches sprites using line 261 & 255 = 5 for range checks; skipping dot 340 on odd frames skips loading the sprite X counters.
- Disabling rendering mid-line schedules OAM corruption (row = secondary OAM address), applied on the next rendering dot.
- $2001 writes reach the pipeline 2 dots later (`MASK_DELAY`).

### Unofficial Opcodes

The CPU implements the full set of unofficial 6502 opcodes needed to pass nestest: ALR, ANC, ARR, AXS, LAX, SAX, DCP, ISC, RLA, RRA, SLO, SRE, SKB, IGN, SHA, SHX, SHY, SHS, LAE, ANE and LXA. KIL/JAM opcodes throw.

## State Serialization

Full save state support via `toJSON()`/`fromJSON()` on the NES class, which serializes/deserializes CPU, PPU, PAPU, and mapper state. Battery-backed SRAM is surfaced via the `onBatteryRamWrite()` callback.

## Zapper (Light Gun) Support

The NES class exposes `zapperMove(x, y)`, `zapperFireDown()`, and `zapperFireUp()` for light gun input. The PPU's `isPixelWhite()` method handles light detection at the zapper's position.

## Error Recovery

The NES has a `crashed` flag that prevents further frame execution after exceptions. Users must call `reset()` or `loadROM()` to recover.

## Development Notes

- The `example/` directory contains a basic web implementation but is noted as flawed compared to jsnes-web
- For web integration, prefer jsnes-web repository over the local example
- ROMs should be loaded as binary strings or byte arrays
- Timing management is the responsibility of the integrating application (60 FPS)
- Controller input uses simple button state management with 8 buttons per controller
- Liberally document things with comments, particularly if it's not obvious why something is like it is. Link to documentation and references (e.g. nesdev wiki pages) where it makes sense.
- Update CLAUDE.md if you make mistakes and you want to remind yourself in the future not to do something. Only put it in CLAUDE.md if it's high-level architecture and things that apply to several parts of the codebase. If it's about a particular part of the code or tests, just add it as comments.
- Keep `README.md` up to date when changing the public API (adding/removing/renaming methods, options, or exports). The README contains usage examples and an API reference for both the `NES` and `Browser` classes.

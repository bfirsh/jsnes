# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

- `npm test` - Run code formatting check and tests (required before commits)
- `npm run build` - Build distribution files (`dist/jsnes.js` and `dist/jsnes.min.js`)
- `npm run format` - Auto-format all source code with Prettier
- `npm run test:watch` - Run tests in watch mode for development
- `npm run typecheck` - TypeScript type checking (verifies `.d.ts` files)

## Code Architecture

JSNES is a JavaScript NES emulator with component-based architecture mirroring actual NES hardware:

### Core Components (all in `src/`)

**Main Orchestrator**: `nes.js` - Central class that coordinates all emulation components. Accepts callback functions for frame rendering, audio output, and status updates.

**CPU**: `cpu.js` - Implements 6502 processor with 64KB address space, instruction execution, and interrupt handling (NMI, IRQ, reset).

**PPU**: `ppu.js` - Picture Processing Unit handles 256x240 graphics rendering, VRAM management, background/sprite rendering, and scrolling.

**PAPU**: `papu.js` - Audio Processing Unit implements NES's 5 audio channels (2 square waves, triangle, noise, DMC) with 44.1kHz/48kHz sample generation.

**Memory Mappers**: `mappers.js` - Implements cartridge memory mappers (0-180) using inheritance hierarchy. All mappers inherit from Mapper 0 and override specific banking/memory mapping behavior.

**ROM Loader**: `rom.js` - Parses iNES format ROM files, extracts PRG-ROM/CHR-ROM, and determines appropriate mapper.

**Tile Renderer**: `tile.js` - Handles 8x8 pixel tile rendering with sprite flipping (horizontal/vertical), alpha-blending priority, and scanline-based rendering.

**Controller**: `controller.js` - Button state management for 2 controllers with 8 buttons each (A, B, SELECT, START, UP, DOWN, LEFT, RIGHT) and serial strobe protocol.

**Utilities**: `utils.js` - Helper functions for state serialization (`toJSON()`/`fromJSON()`) used across CPU, PPU, PAPU, and mappers for save state support.

### Key Architectural Patterns

- **Event-driven design**: Main NES class uses callbacks (`onFrame`, `onAudioSample`, `onStatusUpdate`, `onBatteryRamWrite`)
- **Component separation**: Each NES subsystem is a separate class with clear interfaces
- **Inheritance for mappers**: Code reuse while supporting cartridge-specific behavior
- **Frame-based execution**: 60 FPS timing with proper CPU cycle counting

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

Tests use Mocha + Chai + Sinon:
- `test/nes.spec.js` - Basic initialization, ROM loading, frame generation with regression testing using `croom.nes` test ROM, frame buffer validation, error handling
- `test/cpu.spec.js` - Comprehensive CPU instruction testing (based on upstream wedNESday and nintengo test suites)
- `test/mappers.spec.js` - Mapper functionality tests (ROM protection, SRAM writes, RAM mirroring)
- `test/nestest.spec.js` - Full nestest.nes ROM harness with detailed error code mappings for all CPU instructions and addressing modes
- `test/accuracycoin.spec.js` - AccuracyCoin test ROM harness (134 hardware accuracy tests)

Test ROMs:
- `roms/croom/` - Simple test ROM for automated testing
- `roms/AccuracyCoin/` - Comprehensive accuracy test ROM (134 tests covering CPU, PPU, APU behavior)
- `roms/nestest/` - CPU instruction test ROM (official + unofficial opcodes)
- `local-roms/` - Collection of ROMs for manual testing

Known AccuracyCoin failures are listed in the `KNOWN_FAILURES` object in `test/accuracycoin.spec.js`.

Remember that AccuracyCoin and nestest are DEFINITELY correct. They pass on a real NES. Don't blame the ROM for being wrong.

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

### PPU Catch-up

On real hardware, the CPU and PPU advance in lockstep (3 PPU dots per CPU cycle). The emulator runs CPU instructions atomically for performance, then advances the PPU afterward. This means PPU register reads mid-instruction (e.g., reading VBlank status from `$2002`) would see stale PPU state.

To fix this, `cpu.load()` and `cpu.write()` call `_ppuCatchUp()` before any PPU register access ($2000-$3FFF). This method advances the PPU by `instrBusCycles * 3` dots — the number of PPU dots that should have elapsed based on how many bus operations the instruction has completed so far. The frame loop in `nes.js` then subtracts the already-advanced dots from the total.

See https://www.nesdev.org/wiki/Catch-up

### JSR Cycle Order

The real 6502 reads JSR's target high byte *after* pushing the return address, making it the last bus operation before entering the target. This matters when JSR targets unmapped addresses — the data bus value on entry is the high byte of the target.

### APU Frame IRQ

The frame interrupt flag (`frameIrqActive`) is set in step 4 of the 4-step frame counter sequence, but ONLY when the IRQ inhibit flag is clear (`frameIrqEnabled` is true). Writing $4017 with bit 6 set prevents the flag from being set entirely — it doesn't just suppress the IRQ, it prevents the flag from appearing in $4015 bit 6. See https://www.nesdev.org/wiki/APU_Frame_Counter

### DMC DMA Bus Hijacking

The DMC channel's DMA transfer can hijack CPU bus cycles, which interacts with certain unofficial opcodes (SHx family). During DMA, the value on the data bus affects these instructions' output since they AND the high byte of the target address with the accumulator/register. The implementation handles this interaction to match real hardware behavior.

### Unofficial Opcodes

The CPU implements the full set of unofficial 6502 opcodes needed to pass nestest: ALR, ANC, ARR, AXS, LAX, SAX, DCP, ISC, RLA, RRA, SLO, SRE, SKB, IGN, SHA, SHX, SHY, SHS, LAE, ANE, LXA, and DUMMY (cycle halt). The SHx/SHA family have complex bus interactions documented in the code.

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

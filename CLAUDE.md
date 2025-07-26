# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

- `npm test` - Run code formatting check and tests (required before commits)
- `npm run build` - Build distribution files (`dist/jsnes.js` and `dist/jsnes.min.js`)
- `npm run format` - Auto-format all source code with Prettier
- `npm run test:watch` - Run tests in watch mode for development

## Code Architecture

JSNES is a JavaScript NES emulator with component-based architecture mirroring actual NES hardware:

### Core Components (all in `src/`)

**Main Orchestrator**: `nes.js` - Central class that coordinates all emulation components. Accepts callback functions for frame rendering, audio output, and status updates.

**CPU**: `cpu.js` - Implements 6502 processor with 64KB address space, instruction execution, and interrupt handling (NMI, IRQ, reset).

**PPU**: `ppu.js` - Picture Processing Unit handles 256x240 graphics rendering, VRAM management, background/sprite rendering, and scrolling.

**PAPU**: `papu.js` - Audio Processing Unit implements NES's 5 audio channels (2 square waves, triangle, noise, DMC) with 44.1kHz/48kHz sample generation.

**Memory Mappers**: `mappers.js` - Implements cartridge memory mappers (0-180) using inheritance hierarchy. All mappers inherit from Mapper 0 and override specific banking/memory mapping behavior.

**ROM Loader**: `rom.js` - Parses iNES format ROM files, extracts PRG-ROM/CHR-ROM, and determines appropriate mapper.

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

Tests use Mocha + Chai + Sinon in `test/nes.spec.js`:
- Basic initialization and ROM loading
- Frame generation with regression testing using `croom.nes` test ROM
- Frame buffer validation to ensure rendering consistency
- Error handling for invalid ROMs

Test ROMs:
- `roms/croom/` - Simple test ROM for automated testing
- `local-roms/` - Collection of ROMs for manual testing

## Build Process

Webpack configuration creates UMD modules compatible with browsers and Node.js:
- Entry point: `src/index.js` (exports NES and Controller classes)
- Output: `dist/jsnes.js` (regular) and `dist/jsnes.min.js` (minified)
- Includes ESLint checking and source map generation
- Library name: `jsnes` (global variable in browsers)

## Code Quality Requirements

- All code must be formatted with Prettier (enforced by test suite)
- ESLint rules are enforced during build
- Tests must pass before commits
- Frame buffer regression tests prevent rendering regressions

## Development Notes

- The `example/` directory contains a basic web implementation but is noted as flawed compared to jsnes-web
- For web integration, prefer jsnes-web repository over the local example
- ROMs should be loaded as binary strings or byte arrays
- Timing management is the responsibility of the integrating application (60 FPS)
- Controller input uses simple button state management with 8 buttons per controller
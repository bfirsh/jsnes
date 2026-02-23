# Suggested Improvements for JSNES

After a thorough analysis of the codebase, here are the improvements I'd suggest, organized by priority and effort.

---

## 1. Hardware Accuracy (High Impact)

### 1a. Cycle-accurate DMA emulation

The biggest cluster of AccuracyCoin failures (10 of ~35 known failures) relates to DMA being handled atomically rather than with bus-level interleaving. On real hardware, OAM DMA and DMC DMA steal individual CPU cycles and interact with the bus — reads from $2002, $4015, $4016, and $2007 during DMA see real bus values, and DMC DMA can hijack OAM DMA cycles.

Currently `cpu.js` handles DMA as a simple `cyclesToHalt` counter. Implementing proper cycle-by-cycle DMA with bus interleaving would fix:
- DMA + open bus (`0x046c`)
- DMA + $2002/$2007/$4015/$4016 reads (`0x0488`, `0x044c`, `0x045d`, `0x045e`)
- DMA + $2007 write (`0x044f`)
- DMC DMA bus conflicts (`0x046b`)
- DMC DMA + OAM DMA interaction (`0x0477`)
- Explicit/implicit DMA abort (`0x0479`, `0x0478`)

**Effort**: Large — requires rearchitecting how CPU cycles are driven.
**Reference**: https://www.nesdev.org/wiki/DMA

### 1b. Sprite evaluation accuracy

7 failures relate to PPU sprite evaluation. The current implementation doesn't accurately model the OAM evaluation state machine that runs during visible scanlines (dots 65-256). Proper sprite evaluation would fix sprite overflow bugs, sprite 0 hit edge cases, OAM corruption during rendering, and $2004 read behavior.

**Effort**: Medium — well-documented on nesdev wiki.
**Reference**: https://www.nesdev.org/wiki/PPU_sprite_evaluation

### 1c. VBlank/NMI timing precision

3 failures relate to NMI suppression and VBlank edge cases. The current implementation handles the common cases but misses some dot-level interactions like reading $2002 on the exact dot VBlank is set (which suppresses both the flag and NMI).

**Effort**: Medium — requires careful dot-level timing in the PPU catch-up path.
**Reference**: https://www.nesdev.org/wiki/PPU_frame_timing

### 1d. Instruction timing accuracy

The `0x0460` failure indicates accumulated cycle counting errors. A pass through all addressing modes and instructions to audit cycle counts against the nesdev reference would help. The branch dummy read TODO in `cpu.js:1422` is one known gap.

**Effort**: Medium — tedious but well-documented.
**Reference**: https://www.nesdev.org/wiki/6502_cycle_times

---

## 2. Code Quality & Maintainability (High Value)

### 2a. Extract duplicated PPU dot-advance loop

The PPU dot-by-dot loop that handles VBlank set/clear, sprite 0 hit, and scanline boundaries is duplicated between:
- `nes.js:146-205` (frame loop)
- `cpu.js:1864-1935` (`_ppuCatchUp()`)

These two copies must stay in sync — a bug fix in one must be mirrored in the other. Extract a shared `ppu.advanceDots(count)` method that both call sites use. This is the single biggest maintainability risk in the codebase.

### 2b. Extract CPU status flag encoding/decoding

The pattern of manually encoding/decoding the CPU status register byte from individual flag fields is repeated in at least 4 places in `cpu.js` (interrupt handling, PHP, PLP, flag restore). Extract `packStatus()` / `unpackStatus()` helper methods.

### 2c. Break up the CPU instruction switch

`cpu.js` is 2,719 lines with a single switch statement spanning ~1,200 lines (lines 377-1583). While this is functional and V8 optimizes large switches well, it makes the file hard to navigate. Consider:
- Moving addressing mode resolution into a lookup table
- Grouping related instructions (loads, stores, arithmetic, branches, etc.) into clearly commented sections (already partially done, but could be more systematic)

**Note**: Be careful with performance here — the CPU is the hot path. Benchmark before/after any refactor.

### 2d. Fix Mapper 3 (CNROM) redundant bank loading

In `src/mappers/mapper3.js:24-27`, the CHR bank switch does three loads:
```javascript
let bank = (value % (this.nes.rom.vromCount / 2)) * 2;
this.loadVromBank(bank, 0x0000);        // Load 4KB bank
this.loadVromBank(bank + 1, 0x1000);    // Load next 4KB bank
this.load8kVromBank(value * 2, 0x0000); // Overwrites both of the above!
```

The `load8kVromBank` call on line 27 overwrites both of the `loadVromBank` calls above it. Either the first two calls are dead code, or the third call is a leftover from an older implementation. CNROM simply switches an 8KB CHR bank, so only one of these approaches is needed.

### 2f. Complete the Mapper 5 (MMC5) implementation

`src/mappers/mapper5.js` is explicitly marked as a stub. The write handler has placeholders (`// vram write`, `// additional ram write`) with no actual implementation. MMC5 is used by notable games (Castlevania III, Just Breed). Either complete it or clearly document it as unsupported and handle it gracefully at ROM load time.

### 2g. Implement battery RAM loading

`rom.js:57-59` has a commented-out TODO for `loadBatteryRam()`. The `batteryRam` flag is parsed from the ROM header but never acted on. The `onBatteryRamWrite` callback exists in the NES options, so the save path works — but there's no corresponding load path for restoring battery RAM on ROM load.

---

## 3. TypeScript & API (Medium Impact)

### 3a. Fix TypeScript definitions

Several issues in the `.d.ts` files:

1. **`nes.d.ts` declares `stop()` but it doesn't exist** in the implementation. Either add the method or remove it from the type definitions.

2. **`controller.d.ts` has wrong parameter types** — `buttonDown(key: ControllerKey)` uses `ControllerKey` (which is `1 | 2` for player number) but should use `ButtonKey` (0-7). The NES class correctly takes both parameters: `buttonDown(controller, button)`.

3. **`onFrame` callback type uses `Buffer`** — should be `Uint32Array` since that's what the emulator actually produces (`ppu.buffer` is a `Uint32Array`).

4. **`EmulatorData` properties typed as `string`** — the `toJSON()` output contains nested objects, not strings. Each property should be a proper type or `object`.

### 3b. Add JSDoc to public API methods

The NES class methods (`frame()`, `loadROM()`, `buttonDown()`, etc.) have no JSDoc comments. Adding parameter descriptions, return types, and usage notes would help consumers and could auto-generate better TypeScript definitions.

---

## 4. Testing (Medium Impact)

### 4a. Add PPU unit tests

There are no unit tests for the PPU outside of the ROM-based integration tests. Unit tests for specific behaviors would catch regressions faster:
- Nametable mirroring modes
- Scrolling register behavior ($2005/$2006 writes)
- Palette reads/writes
- VRAM address increment modes

### 4b. Add PAPU unit tests

The audio subsystem has zero dedicated tests. Basic tests could verify:
- Channel enable/disable via $4015
- Length counter behavior
- Sweep unit calculations
- DMC sample fetching

### 4c. Add controller unit tests

`controller.js` is simple but untested. Quick tests for button state management and strobe protocol would prevent regressions.

### 4d. Add mapper-specific tests

The existing mapper tests are basic (ROM protection, SRAM writes). Individual mapper tests would be valuable for:
- Bank switching correctness (Mapper 1/MMC1 shift register)
- IRQ timing (Mapper 4/MMC3 scanline counter)
- CHR banking modes

---

## 5. Performance (Lower Priority — Already Good)

### 5a. Profile the PPU catch-up hot path

`_ppuCatchUp()` is called on every PPU register access and iterates dot-by-dot. The fast-path optimization in `nes.js:131-144` skips the loop when no events are pending, but the catch-up path in `cpu.js` doesn't have this optimization. Adding a similar fast-path check could speed up games that read PPU registers frequently.

### 5b. Optimize tile rendering

`tile.js` has 4 separate render paths for the combinations of horizontal/vertical flipping (lines 63-145). These could potentially be unified with a computed index transformation, though the current approach is straightforward and branch-prediction-friendly.

### 5c. Consider TypedArray for CPU RAM

The CPU uses plain arrays for some internal state. Where applicable, using `Uint8Array` consistently (already done for main RAM) could improve performance through better memory layout and avoiding boxing.

---

## 6. Build & Infrastructure (Low Effort, Nice to Have)

### 6a. Clean up the `preferredFrameRate` FIXME

`nes.js:16` has a FIXME noting that `preferredFrameRate` is only used in PAPU. Either properly integrate frame rate throughout (PPU timing, frame loop) or remove the option and hardcode 60fps with the sample rate as the only configurable audio parameter.

### 6b. Add NES 2.0 ROM header support

The ROM parser only supports iNES 1.0 format. NES 2.0 headers provide more accurate mapper/submapper identification, PRG/CHR RAM sizes, and other metadata. This would improve compatibility with modern ROM dumps.

**Reference**: https://www.nesdev.org/wiki/NES_2.0

### 6c. Add npm cache and coverage to CI

The GitHub Actions workflow (`ci.yaml`) reinstalls all dependencies from scratch on every run. Adding the `actions/cache` step for `node_modules` would speed up CI. Additionally, there's no code coverage tracking — adding `c8` or similar would help identify untested paths and prevent coverage regressions.

### 6d. Run benchmarks in CI

`bench.js` exists but only runs manually. Running it in CI and tracking results over time would catch performance regressions early, especially since the CPU is a sensitive hot path where small changes can have outsized effects.

### 6e. Expand the README

The README is minimal. Adding these sections would help users and contributors:
- Supported mapper list (which mappers work, which are stubs)
- Known limitations
- Architecture overview for contributors
- Save state and Game Genie usage examples
- Zapper (light gun) support documentation

---

## Summary: Recommended Priority Order

| # | Improvement | Impact | Effort |
|---|-----------|--------|--------|
| 1 | Fix Mapper 3 redundant bank loading (2d) | High | Tiny |
| 2 | Extract duplicated PPU dot loop (2a) | High | Small |
| 3 | Fix TypeScript definitions (3a) | High | Small |
| 4 | Clean up preferredFrameRate FIXME (6a) | Low | Small |
| 5 | Extract CPU status flag helpers (2b) | Medium | Small |
| 6 | Add PPU/PAPU/controller unit tests (4a-c) | Medium | Medium |
| 7 | Sprite evaluation accuracy (1b) | High | Medium |
| 8 | VBlank/NMI timing (1c) | High | Medium |
| 9 | Instruction timing audit (1d) | Medium | Medium |
| 10 | Cycle-accurate DMA (1a) | High | Large |
| 11 | NES 2.0 header support (6b) | Medium | Medium |
| 12 | Complete Mapper 5 (2f) | Medium | Large |

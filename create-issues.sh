#!/usr/bin/env bash
#
# Creates GitHub issues for all known bugs and improvements in jsnes.
# Run after authenticating with: gh auth login
#
# Usage: bash create-issues.sh
#
set -euo pipefail

REPO="bfirsh/jsnes"

# Create labels (idempotent - gh label create fails silently if exists)
echo "Creating labels..."
gh label create "priority: critical" --color "B60205" --description "Causes crashes, data corruption, or completely broken behavior" --repo "$REPO" 2>/dev/null || true
gh label create "priority: high" --color "D93F0B" --description "Significantly wrong behavior affecting many games" --repo "$REPO" 2>/dev/null || true
gh label create "priority: medium" --color "FBCA04" --description "Incorrect behavior for specific games or edge cases" --repo "$REPO" 2>/dev/null || true
gh label create "priority: low" --color "0E8A16" --description "Minor inaccuracy or code quality issue" --repo "$REPO" 2>/dev/null || true
gh label create "difficulty: easy" --color "C2E0C6" --description "Small, localized change (1-2 lines)" --repo "$REPO" 2>/dev/null || true
gh label create "difficulty: medium" --color "FEF2C0" --description "Moderate change requiring understanding of one subsystem" --repo "$REPO" 2>/dev/null || true
gh label create "difficulty: hard" --color "F9D0C4" --description "Complex change spanning multiple subsystems or requiring deep NES knowledge" --repo "$REPO" 2>/dev/null || true
gh label create "component: rom" --color "D4C5F9" --description "ROM loader (rom.js)" --repo "$REPO" 2>/dev/null || true
gh label create "component: cpu" --color "BFDADC" --description "CPU emulation (cpu.js)" --repo "$REPO" 2>/dev/null || true
gh label create "component: ppu" --color "BFD4F2" --description "PPU / graphics (ppu/)" --repo "$REPO" 2>/dev/null || true
gh label create "component: apu" --color "D4E6F1" --description "APU / audio (papu/)" --repo "$REPO" 2>/dev/null || true
gh label create "component: mapper" --color "E6CCB3" --description "Memory mappers (mappers/)" --repo "$REPO" 2>/dev/null || true
gh label create "component: browser" --color "C5DEF5" --description "Browser integration (browser/)" --repo "$REPO" 2>/dev/null || true
gh label create "accuracy" --color "1D76DB" --description "Hardware accuracy improvement" --repo "$REPO" 2>/dev/null || true
gh label create "enhancement" --color "A2EEEF" --description "New feature or capability" --repo "$REPO" 2>/dev/null || true
echo "Labels created."

echo ""
echo "Creating issues..."

# --- ROM LOADER ---

gh issue create --repo "$REPO" \
  --title "ROM loader: trainer offset not applied" \
  --label "bug,priority: critical,difficulty: easy,component: rom,good first issue" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

ROMs with a 512-byte trainer between the header and PRG data are completely broken. The trainer flag is parsed (`rom.js:54`) but the data offset is never adjusted.

## Current behavior

```javascript
let offset = 16; // rom.js:73 — always starts at byte 16
```

When a trainer is present, PRG-ROM and CHR-ROM data are shifted by 512 bytes, producing completely garbled output.

## Expected behavior

```javascript
let offset = 16 + (this.trainer ? 512 : 0);
```

## Impact

Any ROM with a trainer (bit 2 of header byte 6) will be completely broken. While trainers are uncommon in commercial ROMs, they appear frequently in ROM hacks and some dumps.

## References

- [iNES header format](https://www.nesdev.org/wiki/INES#Trainer)
ISSUE_EOF
)"

gh issue create --repo "$REPO" \
  --title "ROM loader: header zeroing heuristic breaks NES 2.0 ROMs" \
  --label "bug,priority: high,difficulty: medium,component: rom" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

If any byte from 8-15 in the iNES header is non-zero, the code masks the mapper number to 4 bits (0-15 only), ignoring the high nibble from byte 7. This was a reasonable heuristic for early iNES dumps with garbage in the unused header bytes (like "DiskDude!"), but it breaks NES 2.0 ROMs which legitimately use bytes 8-15.

## Current behavior

```javascript
// rom.js:61-70
let foundError = false;
for (i = 8; i < 16; i++) {
  if (this.header[i] !== 0) { foundError = true; break; }
}
if (foundError) {
  this.mapperType &= 0xf; // Ignore byte 7
}
```

NES 2.0 ROMs use bytes 8-15 for:
- Submapper numbers (critical for distinguishing MMC3 variants, bus-conflict boards)
- Extended mapper numbers (>255)
- PRG-RAM/CHR-RAM size
- NTSC/PAL timing mode

## Expected behavior

Detect NES 2.0 first and only apply the heuristic for iNES 1.0:

```javascript
if ((this.header[7] & 0x0C) === 0x08) {
  // NES 2.0: parse extended fields, don't apply zeroing heuristic
} else {
  // iNES 1.0: apply the header zeroing heuristic
}
```

## References

- [NES 2.0 format](https://www.nesdev.org/wiki/NES_2.0)
- [NES 2.0 submappers](https://www.nesdev.org/wiki/NES_2.0_submappers)
ISSUE_EOF
)"

# --- MMC3 (MAPPER 4) ---

gh issue create --repo "$REPO" \
  --title "MMC3: register address decoding uses exact addresses instead of masking" \
  --label "bug,priority: critical,difficulty: easy,component: mapper,accuracy" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

The MMC3 \`write()\` method uses exact address matching (\`switch (address)\`) but real MMC3 only decodes address bits A0, A13, and A14. Games that write to non-canonical addresses (e.g. \`$8002\` instead of \`$8000\`) are silently ignored.

## Current behavior

```javascript
// mapper4.js:39
switch (address) {
  case 0x8000: ...  // Only matches exactly $8000
  case 0x8001: ...  // Only matches exactly $8001
  ...
}
```

Writes to \`$8002\`, \`$8100\`, \`$9FFE\`, etc. fall through to the \`default\` case and are ignored.

## Expected behavior

```javascript
switch (address & 0xE001) {
  case 0x8000: ...  // Bank select (even addresses in $8000-$9FFF)
  case 0x8001: ...  // Bank data (odd addresses in $8000-$9FFF)
  case 0xA000: ...  // Mirroring
  case 0xA001: ...  // PRG RAM protect
  case 0xC000: ...  // IRQ latch
  case 0xC001: ...  // IRQ reload
  case 0xE000: ...  // IRQ disable
  case 0xE001: ...  // IRQ enable
}
```

## Impact

MMC3 is used by ~587 games (24% of the NES library). While most games write to canonical addresses, some do not. This also affects Mapper 118 (TxSROM) and Mapper 119 (TQROM) which inherit from Mapper 4.

## References

- [MMC3 wiki](https://www.nesdev.org/wiki/MMC3)
- [MMC3 pinout](https://www.nesdev.org/wiki/MMC3_pinout)
ISSUE_EOF
)"

gh issue create --repo "$REPO" \
  --title "MMC3: IRQ counter has multiple correctness issues" \
  --label "bug,priority: critical,difficulty: hard,component: mapper,accuracy" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

The MMC3 scanline IRQ counter has several fundamental issues that affect split-screen effects in games like Super Mario Bros. 3, Kirby's Adventure, and many others.

### Issue 1: \$C000/\$C001 register roles are swapped

Per nesdev, \`\$C000\` sets the **latch** (reload value) and \`\$C001\` triggers a **reload**. The code has them backwards:

\`\`\`javascript
case 0xc000:
  this.irqCounter = value;      // WRONG: should set irqLatchValue
  break;
case 0xc001:
  this.irqLatchValue = value;   // WRONG: should set irqReload flag
  break;
\`\`\`

### Issue 2: Counter logic is fundamentally wrong

Current (\`mapper4.js:221-231\`):
\`\`\`javascript
clockIrqCounter() {
  if (this.irqEnable === 1) {
    this.irqCounter--;
    if (this.irqCounter < 0) {
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
      this.irqCounter = this.irqLatchValue;
    }
  }
}
\`\`\`

Problems:
1. Always decrements instead of reloading from latch when counter=0 or reload flag is set
2. No reload flag tracked at all
3. IRQ fires on **underflow** (<0) instead of when counter **reaches** 0
4. Counter logic skipped entirely when IRQ is disabled (should still clock)

### Issue 3: \$E000 doesn't acknowledge pending IRQ

Writing to \`\$E000\` should both disable IRQs AND acknowledge any pending IRQ. Current code only disables.

### Correct behavior

Per [nesdev MMC3 wiki](https://www.nesdev.org/wiki/MMC3), when the IRQ counter is clocked:
1. If counter is 0 OR reload flag is set → reload counter from latch, clear reload flag
2. Otherwise → decrement counter
3. If counter is 0 AND IRQs enabled → trigger IRQ

## References

- [MMC3 wiki](https://www.nesdev.org/wiki/MMC3)
- [MMC3 IRQ behavior](https://forums.nesdev.org/viewtopic.php?t=19413)
ISSUE_EOF
)"

# --- MMC5 ---

gh issue create --repo "$REPO" \
  --title "MMC5 (Mapper 5): completely non-functional stub" \
  --label "bug,priority: high,difficulty: hard,component: mapper" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

The Mapper 5 (MMC5) implementation calls methods that don't exist anywhere in the codebase. Any game using this mapper will crash immediately.

## Missing methods called

- \`this.SetBank_SRAM(3, value & 3)\` — line 61
- \`this.SetBank_CPU(address, value)\` — line 67
- \`this.SetBank_PPU()\` — lines 79, 88
- \`this.nes.cpu.ClearIRQ()\` — lines 101, 105

## Other issues

- Many instance properties used but never initialized (\`nametable_type\`, \`chr_page\`, \`chr_mode\`, \`irq_status\`, etc.)
- \`loadROM()\` error message says "UNROM" instead of "MMC5"
- No battery RAM loading

## Affected games

Castlevania III: Dracula's Curse, Just Breed, Laser Invasion, Metal Slader Glory, Uncharted Waters

## Recommendation

Either implement MMC5 properly or remove it from the mapper list with a clear error message explaining it's unsupported. The current stub is worse than no support because it crashes silently.

## References

- [MMC5 wiki](https://www.nesdev.org/wiki/MMC5)
ISSUE_EOF
)"

# --- MMC1 ---

gh issue create --repo "$REPO" \
  --title "MMC1: multiple shift register and mirroring bugs" \
  --label "bug,priority: medium,difficulty: medium,component: mapper,accuracy" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

The MMC1 (Mapper 1) implementation has several correctness issues:

### 1. Bit-7 reset is conditional on address (mapper1.js:50)

\`\`\`javascript
if (this.getRegNumber(address) === 0) {
  this.prgSwitchingArea = 1;
  this.prgSwitchingSize = 1;
}
\`\`\`

Per nesdev, writing with bit 7 set should **unconditionally** set control register bits 2-3 (PRG bank mode 3) regardless of the write address. A reset write to \`\$C000\` or \`\$E000\` should still update PRG switching mode.

### 2. Missing consecutive-write filtering

Real MMC1 ignores writes on consecutive CPU cycles. RMW instructions (INC, DEC, etc.) write twice — the first write (with bit 7 set) resets the shift register, and the second write must be ignored. Without filtering, games like **Bill & Ted's Excellent Adventure** and **Shinsenden** crash.

### 3. Single-screen mirroring ignores page select (mapper1.js:85)

\`\`\`javascript
if ((this.mirroring & 2) === 0) {
  this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING);
}
\`\`\`

Mirroring value 0 should select lower bank (page 0), value 1 should select upper bank (page 1). Both currently map to the same page.

## References

- [MMC1 wiki](https://www.nesdev.org/wiki/MMC1)
- [MMC1 consecutive write behavior](https://forums.nesdev.org/viewtopic.php?t=12195)
ISSUE_EOF
)"

# --- MINOR MAPPER BUGS ---

gh issue create --repo "$REPO" \
  --title "Minor mapper bugs: Mapper 180 initial bank, CNROM duplicate load, dead battery RAM code" \
  --label "bug,priority: low,difficulty: easy,component: mapper,good first issue" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

Three small mapper bugs that are easy to fix independently:

### 1. Mapper 180 (UNROM variant): wrong initial bank at \$C000

\`mapper180.js:35\`:
\`\`\`javascript
this.loadRomBank(this.nes.rom.romCount - 1, 0xc000); // loads last bank
\`\`\`
Should load bank 0 at \$C000 on power-up per [nesdev](https://www.nesdev.org/wiki/INES_Mapper_180):
\`\`\`javascript
this.loadRomBank(0, 0xc000);
\`\`\`

### 2. CNROM (Mapper 3): CHR bank loaded twice

\`mapper3.js:24-27\`:
\`\`\`javascript
let bank = (value % (this.nes.rom.vromCount / 2)) * 2;
this.loadVromBank(bank, 0x0000);       // First load
this.loadVromBank(bank + 1, 0x1000);   // First load
this.load8kVromBank(value * 2, 0x0000); // Second load (redundant)
\`\`\`
The first two \`loadVromBank\` calls are redundant — remove them and keep only \`load8kVromBank\`.

### 3. Battery RAM loading is dead code

\`mapper0.js:359-367\`: \`this.nes.rom.batteryRam\` is a **boolean** (set at \`rom.js:53\`), not an array. The check \`ram.length === 0x2000\` always fails since \`true\` has no \`.length\` property. Battery RAM loading silently does nothing.

## References

- [Mapper 180](https://www.nesdev.org/wiki/INES_Mapper_180)
- [CNROM](https://www.nesdev.org/wiki/INES_Mapper_003)
ISSUE_EOF
)"

# --- MISSING MAPPERS ---

gh issue create --repo "$REPO" \
  --title "Add missing popular mappers (206, VRC, FME-7, MMC4)" \
  --label "enhancement,priority: medium,difficulty: hard,component: mapper" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

Several popular mappers are missing. The highest-impact additions would be:

| Mapper | Name | Games | Notes |
|--------|------|-------|-------|
| **206** | Namcot 108/DxROM | ~44 | 7th most popular mapper. Simplified MMC3 (no IRQ, no mirroring). Straightforward to add based on existing Mapper 4. |
| **10** | MMC4 (FxROM) | ~3 | Similar to MMC2 (Mapper 9). Used by Fire Emblem. |
| **69** | Sunsoft FME-7 | ~10 | Used by Gimmick!, Batman: Return of the Joker |
| **21/23/25** | VRC4 (Konami) | ~16 | Wai Wai World 2, Gradius II |
| **24/26** | VRC6 (Konami) | ~3 | Castlevania III (JP), includes expansion audio |
| **85** | VRC7 (Konami) | ~2 | Lagrange Point (JP), includes expansion audio |
| **19** | Namco 163 | ~17 | Various Namco titles, expansion audio |
| **33/48** | Taito TC0190 | ~14 | Various Taito titles |

### Recommendation

Start with **Mapper 206** — it's the highest impact (most games) and simplest (subset of existing MMC3 code). Then MMC4 (similar to existing MMC2), then FME-7.

## References

- [Mapper list with game counts](https://forums.nesdev.org/viewtopic.php?t=20019)
- [Mapper 206 wiki](https://www.nesdev.org/wiki/INES_Mapper_206)
- [FME-7 wiki](https://www.nesdev.org/wiki/Sunsoft_FME-7)
ISSUE_EOF
)"

# --- MAPPER SERIALIZATION ---

gh issue create --repo "$REPO" \
  --title "Most mappers missing toJSON/fromJSON — save states lose bank state" \
  --label "bug,priority: medium,difficulty: medium,component: mapper" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

Only 6 of 21 mapper implementations have custom \`toJSON()\`/\`fromJSON()\` methods. The rest inherit from Mapper0, which only serializes base class state. Mapper-specific bank registers, IRQ state, and other fields are lost on save/restore.

## Affected mappers

Missing serialization: Mapper 2 (UxROM), 3 (CNROM), 5 (MMC5), 7 (AxROM), 11 (Color Dreams), 34 (BNROM), 66 (GxROM), 71 (Camerica), 79 (NINA), 94 (UN1ROM), 180 (UNROM variant), 240, 241

## Impact

Save states with these mappers will restore to the wrong bank configuration, causing games to crash or show garbled graphics after loading a save state.

## Fix

Each mapper needs to serialize its bank registers and any other mutable state. For simple mappers like UxROM (just a bank number), this is a one-line addition.
ISSUE_EOF
)"

# --- CPU ---

gh issue create --repo "$REPO" \
  --title "CPU: NMI handler doesn't set I flag" \
  --label "bug,priority: high,difficulty: easy,component: cpu,accuracy,good first issue" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

In \`doNonMaskableInterrupt()\` at \`cpu.js:1966\`, the line that sets the interrupt disable flag is **commented out**:

\`\`\`javascript
//this.F_INTERRUPT_NEW = 1;
\`\`\`

Real 6502 hardware sets I=1 during NMI, just like it does during IRQ. Without this, a pending IRQ can interrupt the NMI handler — something that never happens on real hardware.

## Impact

Affects games that use both NMI (VBlank) and mapper IRQs simultaneously. Most MMC3 games do this (Mega Man 3, Castlevania III, Kirby's Adventure, etc.). The IRQ can fire during the NMI handler, corrupting the stack or jumping to the wrong code.

## Fix

Uncomment the line:
\`\`\`javascript
this.F_INTERRUPT_NEW = 1;
\`\`\`

## References

- [6502 interrupt handling](https://www.nesdev.org/wiki/CPU_interrupts)
ISSUE_EOF
)"

gh issue create --repo "$REPO" \
  --title "CPU: IRQ and reset interrupt handlers missing proper cycle timing" \
  --label "bug,priority: medium,difficulty: medium,component: cpu,accuracy" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

### doIrq() missing dummy read PPU cycles

\`doNonMaskableInterrupt()\` correctly has 2 dummy PPU steps at the start (cycles 1-2 of the interrupt sequence), but \`doIrq()\` jumps straight to pushing the return address. The PPU is 6 dots short during IRQ handling.

### doResetInterrupt() incomplete

Missing:
- 3 dummy push cycles (stack pointer decrement without writing)
- I flag set to 1
- 5 of the 7 PPU step cycles (only has the 2 for vector fetch)

These affect PPU-CPU synchronization during interrupts.

## References

- [CPU interrupts](https://www.nesdev.org/wiki/CPU_interrupts)
ISSUE_EOF
)"

gh issue create --repo "$REPO" \
  --title "CPU: CLI/SEI/PLP interrupt inhibit delay and BRK/NMI hijacking not implemented" \
  --label "enhancement,priority: low,difficulty: hard,component: cpu,accuracy" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

Two advanced interrupt timing behaviors are not implemented:

### 1. Interrupt inhibit delay

Changes to the I flag via CLI, SEI, or PLP should take effect **after** the current instruction's interrupt poll. This means CLI followed by an immediately pending IRQ should not take the IRQ until the next instruction.

### 2. BRK/IRQ NMI hijacking

When NMI coincides with BRK or IRQ, real hardware redirects to the NMI vector instead. The BRK instruction still pushes the B flag, but the vector used is \$FFFA instead of \$FFFE.

Both are known AccuracyCoin failures and affect a small number of games/demos.

## References

- [CPU interrupts](https://www.nesdev.org/wiki/CPU_interrupts)
ISSUE_EOF
)"

# --- PPU ---

gh issue create --repo "$REPO" \
  --title "PPU: no 8-sprite-per-scanline limit or sprite overflow flag" \
  --label "bug,priority: high,difficulty: medium,component: ppu,accuracy" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

The PPU renders all 64 sprites on every scanline. Real hardware only evaluates 8 sprites per scanline — additional sprites are hidden (with the overflow flag set in \$2002 bit 5).

## Impact

### Missing sprite limit
Games that rely on sprite flickering look wrong. Many action games deliberately rotate sprite priority each frame so that flickering makes all sprites visible. Without the limit, there's no flicker and all sprites render simultaneously, which can look correct but also produces visual differences.

### Missing overflow flag
The sprite overflow flag (\$2002 bit 5) is never set. Games or demos that poll this flag will hang or behave incorrectly.

## Implementation notes

Sprite evaluation should:
1. Walk OAM to find sprites on the current scanline (secondary OAM evaluation)
2. Stop after finding 8 sprites
3. Set the overflow flag if more than 8 are found
4. Only render the first 8 found sprites

The [sprite overflow bug](https://www.nesdev.org/wiki/PPU_sprite_evaluation#Sprite_overflow_bug) (incorrect evaluation after finding 8 sprites) should also be considered for accuracy.

## References

- [PPU sprite evaluation](https://www.nesdev.org/wiki/PPU_sprite_evaluation)
- [PPU OAM](https://www.nesdev.org/wiki/PPU_OAM)
ISSUE_EOF
)"

gh issue create --repo "$REPO" \
  --title "PPU: color emphasis bits are rotated (wrong colors)" \
  --label "bug,priority: high,difficulty: easy,component: ppu,accuracy,good first issue" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

The color emphasis bit mapping in \`palette-table.js:32-43\` is rotated. Every game using color emphasis displays wrong colors.

## Current behavior (wrong)

\`\`\`javascript
if ((emph & 1) !== 0) { rFactor = 0.75; bFactor = 0.75; } // Emphasizes G
if ((emph & 2) !== 0) { rFactor = 0.75; gFactor = 0.75; } // Emphasizes B
if ((emph & 4) !== 0) { gFactor = 0.75; bFactor = 0.75; } // Emphasizes R
\`\`\`

Bit 0 of the emphasis value (PPUMASK bit 5) emphasizes Green instead of Red, etc.

## Expected behavior (NTSC)

Per [nesdev](https://www.nesdev.org/wiki/PPU_registers): bit 5=Red, bit 6=Green, bit 7=Blue.

"Emphasize Red" means darken Green and Blue:

\`\`\`javascript
if ((emph & 1) !== 0) { gFactor = 0.75; bFactor = 0.75; } // bit 5 = Red
if ((emph & 2) !== 0) { rFactor = 0.75; bFactor = 0.75; } // bit 6 = Green
if ((emph & 4) !== 0) { rFactor = 0.75; gFactor = 0.75; } // bit 7 = Blue
\`\`\`

## Impact

Any game using color emphasis (screen darkening, color tinting, fade effects) displays wrong colors. Many games use emphasis for fade-to-black effects.

## References

- [PPU registers - PPUMASK](https://www.nesdev.org/wiki/PPU_registers)
- [Colour emphasis](https://www.nesdev.org/wiki/Colour_emphasis)
ISSUE_EOF
)"

gh issue create --repo "$REPO" \
  --title "PPU: grayscale mode mask is wrong (\`& 32\` should be \`& 0x30\`)" \
  --label "bug,priority: medium,difficulty: easy,component: ppu,accuracy,good first issue" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

When monochrome/grayscale mode is enabled (PPUMASK bit 0), palette lookups use \`& 32\` instead of \`& 0x30\`.

## Current behavior

\`\`\`javascript
// ppu/index.js:1570, 1581
this.vramMem[0x3f00 + i] & 32
\`\`\`

This masks with \`0x20\` (binary \`100000\`), which only preserves bit 5. Since NES palette entries are 0-63 (6 bits), masking with \`0x20\` yields either 0 or 32 — so grayscale mode renders almost everything as black (\`$00\`) or a single gray (\`$20\`).

## Expected behavior

\`\`\`javascript
this.vramMem[0x3f00 + i] & 0x30
\`\`\`

Masking with \`0x30\` (\`110000\`) preserves bits 4-5, giving palette indices \`$00\`, \`$10\`, \`$20\`, \`$30\` — the four grayscale values in the NES palette (black, dark gray, light gray, white).

## References

- [PPU registers - PPUMASK](https://www.nesdev.org/wiki/PPU_registers)
- [PPU palettes](https://www.nesdev.org/wiki/PPU_palettes)
ISSUE_EOF
)"

gh issue create --repo "$REPO" \
  --title "PPU: minor rendering issues (odd-frame skip, monochrome bg, sprite 0 left-column)" \
  --label "bug,priority: low,difficulty: easy,component: ppu,accuracy" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

Three small PPU issues:

### 1. Odd-frame cycle skip is dead code (ppu/index.js:402-406)

\`dummyCycleToggle\` is initialized to \`false\` and never set to \`true\` anywhere, so odd frames are never shortened by 1 dot. Real NTSC NES alternates between 341-dot and 340-dot frames (when rendering is enabled).

### 2. Monochrome mode background color is nonsensical (ppu/index.js:502-527)

When \`f_dispType === 1\` (monochrome), the code picks hardcoded RGB colors (green, blue, red) based on the emphasis bits. Real hardware doesn't work this way — emphasis attenuates color channels regardless of greyscale mode.

### 3. Sprite 0 hit missing left-column and x=255 checks

Per [nesdev](https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits), sprite 0 hit should not fire when:
- Background or sprite left-column clipping is active (left 8 pixels hidden via PPUMASK bits 1-2)
- At x=255

The current \`checkSprite0()\` doesn't check these conditions.
ISSUE_EOF
)"

# --- APU ---

gh issue create --repo "$REPO" \
  --title "APU: square channel sweep unit has wrong negate formula and muting threshold" \
  --label "bug,priority: high,difficulty: easy,component: apu,accuracy" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

Two bugs in the square channel sweep unit (\`channel-square.js\`):

### 1. Negate formula inverted for Pulse 1 (line 100-103)

\`\`\`javascript
this.progTimerMax =
  this.progTimerMax -
  ((this.progTimerMax >> this.sweepShiftAmount) -
    (this.sqr1 ? 1 : 0));
\`\`\`

This computes \`period - shifted + 1\` for Pulse 1. Per [nesdev](https://www.nesdev.org/wiki/APU_Sweep), Pulse 1 uses ones' complement (bitwise NOT): the result should be \`period + (~shifted)\` which equals \`period - shifted - 1\`. The \`- 1\` should be \`+ 1\` (or more precisely, the formula should be \`period - (period >> shift) - 1\` for Pulse 1).

### 2. Sweep muting threshold is wrong (line 95, 118)

\`\`\`javascript
if (this.progTimerMax > 4095)  // Wrong
\`\`\`

The muting cutoff should be \`> 0x7FF\` (2047), not 4095. The target period check in \`updateSampleValue()\` (line 118) also uses \`> 4095\`. This allows frequencies that should be silenced, producing audible artifacts.

## Impact

Audible pitch errors in any game using sweep effects. The negate difference between Pulse 1 and Pulse 2 is what allows them to produce different sweep sounds — getting this wrong makes them sound identical.

## References

- [APU Sweep](https://www.nesdev.org/wiki/APU_Sweep)
ISSUE_EOF
)"

gh issue create --repo "$REPO" \
  --title "APU: various channel bugs (sequencer reset, length counter gating, timer stepping, noise LFSR)" \
  --label "bug,priority: medium,difficulty: medium,component: apu,accuracy" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

Several APU channel bugs:

### 1. Square sequencer not reset on \$4003/\$4007 write

Per [nesdev APU Pulse](https://www.nesdev.org/wiki/APU_Pulse), writing the 4th register (\$4003 or \$4007) resets the duty cycle sequencer to step 0. The code (\`channel-square.js:158-168\`) only sets \`envReset = true\` but never resets \`squareCounter\`. This affects note attack timing.

### 2. Triangle/Noise length counters loaded when channel disabled

\`channel-triangle.js:72\` and \`channel-noise.js:85\` load the length counter without checking \`isEnabled\`. Per the wiki, the length counter should only be loaded when the channel's enable flag (\$4015) is set.

### 3. Square timer uses \`if\` instead of \`while\` (papu/index.js:256, 266)

The triangle channel correctly uses \`while\` for its timer, but the square channels use \`if\`. At high frequencies with long CPU instructions, multiple sequencer steps can be missed within a single timer period.

### 4. Noise LFSR shifts left instead of right (papu/index.js:286)

Real hardware shifts the 15-bit LFSR right with feedback from bit 0. The code shifts left and tests bit 15. While both produce pseudo-random sequences, the exact output differs.

## References

- [APU Pulse](https://www.nesdev.org/wiki/APU_Pulse)
- [APU Triangle](https://www.nesdev.org/wiki/APU_Triangle)
- [APU Noise](https://www.nesdev.org/wiki/APU_Noise)
ISSUE_EOF
)"

# --- TYPE DEFINITIONS ---

gh issue create --repo "$REPO" \
  --title "TypeScript type definitions are incorrect" \
  --label "bug,priority: medium,difficulty: easy,component: browser" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

Several issues in \`src/nes.d.ts\`:

1. **\`onFrame\` callback types \`Buffer\`** (line 11) but the actual frame buffer is a \`Uint32Array\` (or a plain \`number[]\`). Using \`Buffer\` (a Node.js type) is wrong for both browser and Node environments.

2. **\`EmulatorData\` types all properties as \`string\`** (lines 3-8) but they're objects returned by \`toJSON()\` on CPU, PPU, PAPU, and mapper.

3. **Declares \`stop()\` method** (line 21) that doesn't exist on the NES class.

4. **Missing \`GameGenie\` type declarations** — no \`.d.ts\` file for \`gamegenie.js\`.

## Fix

\`\`\`typescript
export interface EmulatorData {
  cpu: object;
  mmap: object;
  ppu: object;
  papu: object;
}

export interface NESOptions {
  onFrame?: (buffer: Uint32Array) => void;
  // ...
}

export class NES {
  // Remove stop(), it doesn't exist
  // Add gameGenie property
  gameGenie: GameGenie;
  // ...
}
\`\`\`
ISSUE_EOF
)"

# --- PACKAGE.JSON ---

gh issue create --repo "$REPO" \
  --title "package.json: \`main\` points to ESM source, deprecated \`prepublish\`, missing \`files\`" \
  --label "bug,priority: low,difficulty: easy" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

Several package.json issues:

1. **\`\"main\": \"src/index.js\"\`** points to ESM source, not the UMD bundle. Node.js \`require('jsnes')\` may fail since the file uses \`import\`/\`export\`. Should point to \`dist/jsnes.js\` for CJS consumers, or add an \`\"exports\"\` field for dual CJS/ESM support.

2. **\`\"prepublish\"\`** is deprecated. Should be \`\"prepublishOnly\"\`.

3. **No \`\"files\"\` field** — everything gets published to npm including test ROMs (which may have copyright concerns), the \`web/\` directory, etc.

4. **No \`\"exports\"\` field** for modern Node.js dual CJS/ESM resolution.
ISSUE_EOF
)"

# --- BROWSER ---

gh issue create --repo "$REPO" \
  --title "KeyboardController.handleKeyPress prevents ALL keyboard input on the page" \
  --label "bug,priority: medium,difficulty: easy,component: browser,good first issue" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

In \`browser/keyboard.js:71-73\`:

\`\`\`javascript
handleKeyPress = (e) => {
  e.preventDefault();
};
\`\`\`

This fires on **every** keypress event, not just mapped keys. This breaks text input in any input field, search bar, or dev tools on the same page.

## Fix

Only prevent default for mapped keys, matching the behavior of \`handleKeyDown\` and \`handleKeyUp\`:

\`\`\`javascript
handleKeyPress = (e) => {
  if (this.keys[e.keyCode]) {
    e.preventDefault();
  }
};
\`\`\`

Or remove \`handleKeyPress\` entirely — \`handleKeyDown\` already prevents default for mapped keys, and the \`keypress\` event is deprecated.
ISSUE_EOF
)"

gh issue create --repo "$REPO" \
  --title "Speakers.getSampleRate() wastefully creates/destroys AudioContext" \
  --label "enhancement,priority: low,difficulty: easy,component: browser" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

\`browser/speakers.js:21-29\`:

\`\`\`javascript
getSampleRate() {
  if (!window.AudioContext) return 44100;
  let myCtx = new window.AudioContext();
  let sampleRate = myCtx.sampleRate;
  myCtx.close();
  return sampleRate;
}
\`\`\`

Creates and immediately destroys an AudioContext just to read the sample rate. This is wasteful and can trigger browser autoplay warnings.

## Fix

Cache the sample rate, or defer reading it until \`start()\` is called and the AudioContext is created anyway:

\`\`\`javascript
getSampleRate() {
  if (this.audioCtx) return this.audioCtx.sampleRate;
  return 44100; // Default until start() is called
}
\`\`\`
ISSUE_EOF
)"

# --- STATE SERIALIZATION ---

gh issue create --repo "$REPO" \
  --title "State serialization gaps: CPU dataBus, controller state not saved" \
  --label "bug,priority: low,difficulty: easy,component: cpu" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

### CPU dataBus not serialized

\`cpu.js\` \`JSON_PROPERTIES\` does not include \`dataBus\`. The open bus value resets to 0 on save state restore. Games reading open bus immediately after a load could behave differently.

### Controller state not serialized in NES.toJSON()

\`nes.js:177-185\` serializes CPU, PPU, PAPU, and mapper state but not controller state. Button states, turbo state, and strobe protocol state are lost on save/restore. While usually minor (buttons are transient), the strobe state matters for correct controller reads immediately after restoring.

## Fix

Add \`dataBus\` to \`CPU.JSON_PROPERTIES\` and serialize controller state in \`NES.toJSON()\`/\`NES.fromJSON()\`.
ISSUE_EOF
)"

# --- NES.RESET() ---

gh issue create --repo "$REPO" \
  --title "NES.reset() creates new CPU/PPU/PAPU objects, breaking external references" \
  --label "bug,priority: medium,difficulty: medium" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

\`nes.js:44-47\`:
\`\`\`javascript
reset() {
  this.cpu = new CPU(this);
  this.ppu = new PPU(this);
  this.papu = new PAPU(this);
  ...
}
\`\`\`

This creates entirely new objects. Any external code holding references to \`nes.cpu\`, \`nes.ppu\`, or \`nes.papu\` will be pointing at stale objects after reset.

## Expected behavior

Reset should reinitialize state on the existing objects rather than creating new ones. Each subsystem class should have a \`reset()\` method that clears state back to power-on defaults.
ISSUE_EOF
)"

# --- GAMEGENIE ---

gh issue create --repo "$REPO" \
  --title "GameGenie.addCode() doesn't validate decode() result" \
  --label "bug,priority: low,difficulty: easy,good first issue" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

\`gamegenie.js:31-33\`:
\`\`\`javascript
addCode(code) {
  this.patches.push(this.decode(code));
  ...
}
\`\`\`

If \`decode()\` calls \`decodeHex()\` and the regex doesn't match, \`decodeHex()\` returns \`null\` (line 115). This \`null\` gets pushed into \`patches\`, causing a crash in \`applyCodes()\` when it tries to access \`null.addr\`.

## Fix

\`\`\`javascript
addCode(code) {
  const patch = this.decode(code);
  if (!patch) throw new Error(\`Invalid Game Genie code: \${code}\`);
  this.patches.push(patch);
  ...
}
\`\`\`
ISSUE_EOF
)"

# --- TEST COVERAGE ---

gh issue create --repo "$REPO" \
  --title "Test coverage gaps: PPU, APU, controllers, mappers, browser, state serialization" \
  --label "enhancement,priority: medium,difficulty: hard" \
  --body "$(cat <<'ISSUE_EOF'
## Summary

Current test coverage is limited to:
- CPU instructions (\`cpu.spec.js\`)
- Basic NES initialization and ROM loading (\`nes.spec.js\`)
- Mapper 0 basics (\`mappers.spec.js\`)
- nestest and AccuracyCoin ROM harnesses

Missing test files for:
- **PPU**: register behavior, VRAM mirroring, sprite evaluation, scrolling, palette
- **APU**: channel behavior, frame counter, mixer, sweep unit
- **Controllers**: turbo button logic, clock(), strobe protocol
- **ROM parser**: trainer ROMs, truncated data, NES 2.0 headers
- **Mappers 1-241**: MMC1, MMC3, MMC5, etc. have zero unit tests
- **State serialization**: no round-trip toJSON()/fromJSON() tests
- **Browser layer**: Screen, Speakers, KeyboardController, GamepadController
- **GameGenie**: decode/encode round-trip, invalid input handling

The highest-value additions would be:
1. MMC3 IRQ counter unit tests (most complex and bug-prone mapper code)
2. PPU register behavior tests
3. State serialization round-trip tests
4. APU sweep unit tests
ISSUE_EOF
)"

echo ""
echo "All issues created successfully!"

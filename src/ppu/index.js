import Tile from "../tile.js";
import { fromJSON, toJSON } from "../utils.js";
import NameTable from "./nametable.js";
import PaletteTable from "./palette-table.js";

class PPU {
  // Status flags:
  STATUS_VRAMWRITE = 4;
  STATUS_SLSPRITECOUNT = 5;
  STATUS_SPRITE0HIT = 6;
  STATUS_VBLANK = 7;

  constructor(nes) {
    this.nes = nes;

    // Rendering Options:
    this.showSpr0Hit = false;
    this.clipToTvSize = true;

    let i;

    // Memory (Uint8Array is zero-initialized)
    this.vramMem = new Uint8Array(0x8000);
    this.spriteMem = new Uint8Array(0x100);

    // VRAM I/O:
    this.vramAddress = null;
    this.vramTmpAddress = null;
    this.vramBufferedReadValue = 0;
    this.firstWrite = true; // VRAM/Scroll Hi/Lo latch
    // PPU has its own internal I/O bus. All PPU register writes update this
    // latch. Reading write-only registers ($2000,$2001,$2003,$2005,$2006)
    // returns this value. $2002 uses bits 4-0 from this latch.
    // On real hardware the latch decays to 0 per-bit after ~600ms.
    this.openBusLatch = 0;
    this.openBusDecayFrames = 0;

    // SPR-RAM I/O:
    this.sramAddress = 0; // 8-bit only.

    this.currentMirroring = -1;
    // NMI edge detection state. On real hardware, /NMI is level-sensitive but
    // the PPU only asserts it on a rising edge: when (vblankFlag AND nmiEnabled)
    // transitions from false to true. See https://www.nesdev.org/wiki/NMI
    this.nmiOutput = false; // Current NMI output level
    this.nmiSuppressed = false; // Suppresses VBlank set when $2002 read at dot 0
    // Set by endScanline(261) to indicate that a full frame has been rendered
    // and VBlank should fire at dot 1 of scanline 0. Prevents premature VBlank
    // on the first frame when the PPU starts at scanline 0.
    this.vblankPending = false;
    // Set by step() when VBlank fires, signals frame loop to break.
    this.frameEnded = false;
    this.dummyCycleToggle = false;
    this.validTileData = false;
    this.scanlineAlreadyRendered = null;

    // Control Flags Register 1:
    this.f_nmiOnVblank = 0; // NMI on VBlank. 0=disable, 1=enable
    this.f_spriteSize = 0; // Sprite size. 0=8x8, 1=8x16
    this.f_bgPatternTable = 0; // Background Pattern Table address. 0=0x0000,1=0x1000
    this.f_spPatternTable = 0; // Sprite Pattern Table address. 0=0x0000,1=0x1000
    this.f_addrInc = 0; // PPU Address Increment. 0=1,1=32
    this.f_nTblAddress = 0; // Name Table Address. 0=0x2000,1=0x2400,2=0x2800,3=0x2C00

    // Control Flags Register 2:
    this.f_color = 0; // Background color. 0=black, 1=blue, 2=green, 4=red
    this.f_spVisibility = 0; // Sprite visibility. 0=not displayed,1=displayed
    this.f_bgVisibility = 0; // Background visibility. 0=Not Displayed,1=displayed
    this.f_spClipping = 0; // Sprite clipping. 0=Sprites invisible in left 8-pixel column,1=No clipping
    this.f_bgClipping = 0; // Background clipping. 0=BG invisible in left 8-pixel column, 1=No clipping
    this.f_dispType = 0; // Display type. 0=color, 1=monochrome

    // Counters:
    this.cntFV = 0;
    this.cntV = 0;
    this.cntH = 0;
    this.cntVT = 0;
    this.cntHT = 0;

    // Registers:
    this.regFV = 0;
    this.regV = 0;
    this.regH = 0;
    this.regVT = 0;
    this.regHT = 0;
    this.regFH = 0;
    this.regS = 0;

    // These are temporary variables used in rendering and sound procedures.
    // Their states outside of those procedures can be ignored.
    // TODO: the use of this is a bit weird, investigate
    this.curNt = null;

    // Variables used when rendering:
    this.attrib = new Uint8Array(32);
    this.buffer = new Uint32Array(256 * 240);
    this.bgbuffer = new Uint32Array(256 * 240);
    this.pixrendered = new Uint32Array(256 * 240);

    this.validTileData = null;

    this.scantile = new Array(32);

    // Initialize misc vars:
    this.scanline = 0;
    this.lastRenderedScanline = -1;
    this.curX = 0;

    // Sprite data (unpacked from primary OAM for quick access):
    this.sprX = new Uint8Array(64); // X coordinate
    this.sprY = new Uint8Array(64); // Y coordinate
    this.sprTile = new Uint8Array(64); // Tile Index (into pattern table)
    this.sprCol = new Uint8Array(64); // Upper two bits of color
    this.vertFlip = new Uint8Array(64); // Vertical Flip (0/1)
    this.horiFlip = new Uint8Array(64); // Horizontal Flip (0/1)
    this.bgPriority = new Uint8Array(64); // Background priority (0/1)
    this.spr0HitX = 0; // Sprite #0 hit X coordinate
    this.spr0HitY = 0; // Sprite #0 hit Y coordinate
    this.hitSpr0 = false;

    // Secondary OAM: 32 bytes (8 sprites × 4 bytes each).
    // On real hardware, the PPU evaluates sprites during cycles 65-256 of each
    // visible scanline, copying in-range sprites into this buffer. Only these
    // sprites (max 8) are rendered on the next scanline.
    // This buffer persists across scanlines — it is NOT cleared on the
    // pre-render scanline, so stale data from the last evaluation can cause
    // sprites to appear on NES scanline 0.
    // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
    this.secondaryOAM = new Uint8Array(32);
    this.secondaryOAM.fill(0xff); // $FF = no valid sprites (matches hardware clear)
    // How many sprites were found during the last evaluation (0-8).
    this.spritesFound = 0;
    // Whether sprite 0 (relative to OAMADDR) was in the last evaluation.
    // This determines whether sprite 0 hit detection is active.
    this.sprite0InSecondary = false;

    // Per-scanline sprite evaluation results. Evaluation on visible scanline N
    // determines which sprites appear on scanline N+1. Because jsnes uses
    // batched/lazy sprite rendering, we store results per scanline so the
    // renderer can look them up when it runs later.
    // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
    //
    // Storage layout: 240 scanlines × up to 8 sprites × 4 bytes = flat arrays.
    this.scanlineSpriteCount = new Uint8Array(241); // +1 for buffer
    this.scanlineSecondaryOAM = new Uint8Array(241 * 32);
    this.scanlineSprite0 = new Uint8Array(241); // 1 if sprite 0 present

    // Palette data:
    this.sprPalette = new Uint32Array(16);
    this.imgPalette = new Uint32Array(16);

    // Create pattern table tile buffers:
    this.ptTile = new Array(512);
    for (i = 0; i < 512; i++) {
      this.ptTile[i] = new Tile();
    }

    // Create nametable buffers:
    // Name table data:
    this.ntable1 = new Array(4);
    this.currentMirroring = -1;
    this.nameTable = new Array(4);
    for (i = 0; i < 4; i++) {
      this.nameTable[i] = new NameTable(32, 32, `Nt${i}`);
    }

    // Initialize mirroring lookup table:
    this.vramMirrorTable = new Uint16Array(0x8000);
    for (i = 0; i < 0x8000; i++) {
      this.vramMirrorTable[i] = i;
    }

    this.palTable = new PaletteTable();
    this.palTable.loadNTSCPalette();
    //this.palTable.loadDefaultPalette();

    this.updateControlReg1(0);
    this.updateControlReg2(0);
  }

  // Sets Nametable mirroring.
  setMirroring(mirroring) {
    if (mirroring === this.currentMirroring) {
      return;
    }

    this.currentMirroring = mirroring;
    this.triggerRendering();

    // Remove mirroring:
    if (this.vramMirrorTable === null) {
      this.vramMirrorTable = new Uint16Array(0x8000);
    }
    for (let i = 0; i < 0x8000; i++) {
      this.vramMirrorTable[i] = i;
    }

    // Palette mirroring:
    this.defineMirrorRegion(0x3f20, 0x3f00, 0x20);
    this.defineMirrorRegion(0x3f40, 0x3f00, 0x20);
    this.defineMirrorRegion(0x3f80, 0x3f00, 0x20);
    this.defineMirrorRegion(0x3fc0, 0x3f00, 0x20);

    // Additional mirroring:
    this.defineMirrorRegion(0x3000, 0x2000, 0xf00);
    this.defineMirrorRegion(0x4000, 0x0000, 0x4000);

    if (mirroring === this.nes.rom.HORIZONTAL_MIRRORING) {
      // Horizontal mirroring.

      this.ntable1[0] = 0;
      this.ntable1[1] = 0;
      this.ntable1[2] = 1;
      this.ntable1[3] = 1;

      this.defineMirrorRegion(0x2400, 0x2000, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2800, 0x400);
    } else if (mirroring === this.nes.rom.VERTICAL_MIRRORING) {
      // Vertical mirroring.

      this.ntable1[0] = 0;
      this.ntable1[1] = 1;
      this.ntable1[2] = 0;
      this.ntable1[3] = 1;

      this.defineMirrorRegion(0x2800, 0x2000, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2400, 0x400);
    } else if (mirroring === this.nes.rom.SINGLESCREEN_MIRRORING) {
      // Single Screen mirroring

      this.ntable1[0] = 0;
      this.ntable1[1] = 0;
      this.ntable1[2] = 0;
      this.ntable1[3] = 0;

      this.defineMirrorRegion(0x2400, 0x2000, 0x400);
      this.defineMirrorRegion(0x2800, 0x2000, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2000, 0x400);
    } else if (mirroring === this.nes.rom.SINGLESCREEN_MIRRORING2) {
      this.ntable1[0] = 1;
      this.ntable1[1] = 1;
      this.ntable1[2] = 1;
      this.ntable1[3] = 1;

      this.defineMirrorRegion(0x2400, 0x2400, 0x400);
      this.defineMirrorRegion(0x2800, 0x2400, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2400, 0x400);
    } else {
      // Assume Four-screen mirroring.

      this.ntable1[0] = 0;
      this.ntable1[1] = 1;
      this.ntable1[2] = 2;
      this.ntable1[3] = 3;
    }
  }

  // Define a mirrored area in the address lookup table.
  // Assumes the regions don't overlap.
  // The 'to' region is the region that is physically in memory.
  defineMirrorRegion(fromStart, toStart, size) {
    for (let i = 0; i < size; i++) {
      this.vramMirrorTable[fromStart + i] = toStart + i;
    }
  }

  startVBlank() {
    // NMI is now handled by _updateNmiOutput() edge detection — the VBlank
    // flag is set at dot 1 of scanline 0 in the frame/catch-up loops, which
    // call _updateNmiOutput() to fire NMI on the rising edge.

    // PPU open bus latch decay: on real hardware each bit decays to 0
    // after ~600ms (~36 frames). We use a simple per-latch frame counter.
    if (this.openBusDecayFrames > 0) {
      this.openBusDecayFrames--;
      if (this.openBusDecayFrames === 0) {
        this.openBusLatch = 0;
      }
    }

    // Make sure everything is rendered:
    if (this.lastRenderedScanline < 239) {
      this.renderFramePartially(
        this.lastRenderedScanline + 1,
        240 - this.lastRenderedScanline,
      );
    }

    // End frame:
    this.endFrame();

    // Reset scanline counter:
    this.lastRenderedScanline = -1;
  }

  // Fire the VBlank set event at dot 1 of scanline 0 (NES scanline 241).
  // dotsRemaining is the number of dots left in the current advanceDots()
  // call (including the VBlank dot), used for NMI delay calculation.
  // 0 means VBlank fires at the boundary between steps.
  _fireVblankSet(cpu, dotsRemaining) {
    this.vblankPending = false;
    if (!this.nmiSuppressed) {
      this.setStatusFlag(this.STATUS_VBLANK, true);
      this._updateNmiOutput();
      if (cpu.nmiRaised) {
        cpu.nmiDotsRemainingInStep = dotsRemaining;
      }
    }
    this.nmiSuppressed = false;
    this.startVBlank();
    this.frameEnded = true;
  }

  // Fire the VBlank clear event at dot 1 of scanline 20 (NES scanline 261,
  // pre-render). isLastDot indicates whether this is the last dot of the
  // current advanceDots() call. The 6502's NMI edge detector samples at φ2
  // (~2/3 through the bus cycle), so we only promote nmiRaised to nmiPending
  // when φ2 has had time to sample the rising edge — i.e., on the last dot.
  // See https://www.nesdev.org/wiki/NMI
  _fireVblankClear(cpu, isLastDot) {
    if (cpu.nmiRaised && isLastDot) {
      cpu.nmiPending = true;
      cpu.nmiRaised = false;
    }
    this.setStatusFlag(this.STATUS_VBLANK, false);
    this.setStatusFlag(this.STATUS_SPRITE0HIT, false);
    // Sprite overflow flag is cleared at the same time as VBlank and
    // sprite 0 hit, at dot 1 of the pre-render scanline.
    // See https://www.nesdev.org/wiki/PPU_registers#PPUSTATUS
    this.setStatusFlag(this.STATUS_SLSPRITECOUNT, false);
    this.hitSpr0 = false;
    this.spr0HitX = -1;
    this.spr0HitY = -1;
    this._updateNmiOutput();
  }

  // Advance the PPU by the given number of dots. Called after every CPU bus
  // cycle with dots=3 (PPU runs at 3x CPU clock). Handles all per-dot events:
  // VBlank set/clear, sprite 0 hit, and scanline boundaries.
  //
  // Sets this.frameEnded = true when VBlank fires (scanline 0, dot 1),
  // signaling the frame loop to break after the current instruction.
  advanceDots(dots) {
    let finalCurX = this.curX + dots;

    // Fast path: skip dot-by-dot when no per-dot events can fire.
    // This handles ~99% of calls since VBlank, sprite 0, and scanline
    // boundaries are rare relative to total dots per frame.
    if (
      finalCurX < 341 &&
      !(
        this.scanline === 0 &&
        this.vblankPending &&
        this.curX <= 1 &&
        finalCurX >= 1
      ) &&
      !(this.scanline === 20 && this.curX <= 1 && finalCurX >= 1) &&
      (this.spr0HitX < this.curX || this.spr0HitX >= finalCurX)
    ) {
      this.curX = finalCurX;
      return;
    }

    // Slow path: advance dot-by-dot checking for events.
    let cpu = this.nes.cpu;
    for (let i = 0; i < dots; i++) {
      // VBlank set at dot 1 of scanline 0 (NES scanline 241).
      if (this.scanline === 0 && this.curX === 1 && this.vblankPending) {
        this._fireVblankSet(cpu, dots - i);
        this.curX++;
        continue;
      }

      // VBlank clear at dot 1 of scanline 20 (NES scanline 261, pre-render).
      if (this.scanline === 20 && this.curX === 1) {
        this._fireVblankClear(cpu, i === dots - 1);
      }

      // Sprite 0 hit check. On real hardware, sprite 0 hit requires BOTH
      // background and sprite rendering to be enabled at the hit dot.
      // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
      if (
        this.curX === this.spr0HitX &&
        this.f_bgVisibility === 1 &&
        this.f_spVisibility === 1 &&
        this.scanline - 21 === this.spr0HitY
      ) {
        this.setStatusFlag(this.STATUS_SPRITE0HIT, true);
      }

      this.curX++;
      if (this.curX === 341) {
        this.curX = 0;
        this.endScanline();
      }
    }

    // Post-loop boundary checks: if curX landed on a VBlank or VBlank-clear
    // dot after the loop exhausted all dots, fire the event now. This handles
    // the case where the last iteration incremented curX to 1 but the loop
    // exited before the VBlank check could run at the START of the next
    // iteration. On real hardware, VBL is set at the START of dot 1, so
    // reads at that dot must see the updated state.
    // See https://www.nesdev.org/wiki/PPU_frame_timing
    if (this.scanline === 0 && this.curX === 1 && this.vblankPending) {
      this._fireVblankSet(cpu, 0);
    }
    if (this.scanline === 20 && this.curX === 1) {
      // isLastDot=true: the loop exhausted all dots so φ2 has sampled.
      this._fireVblankClear(cpu, true);
    }
  }

  endScanline() {
    switch (this.scanline) {
      case 19:
        // Dummy scanline.
        // May be variable length:
        if (this.dummyCycleToggle) {
          // Remove dead cycle at end of scanline,
          // for next scanline:
          this.curX = 1;
          this.dummyCycleToggle = !this.dummyCycleToggle;
        }
        break;

      case 20:
        // Pre-render scanline (NES scanline 261). VBlank and sprite 0 hit
        // flags are cleared at dot 1, handled by the frame loop and catch-up
        // loop for cycle-accurate timing.

        // OAM corruption: if OAMADDR != 0 at the beginning of the pre-render
        // scanline, the 8 bytes at (OAMADDR & $F8) overwrite OAM[0..7].
        // This happens BEFORE the OAMADDR reset at cycles 257-320.
        // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_0_corruption
        this.performOAMCorruption();

        if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
          // Update counters:
          this.cntFV = this.regFV;
          this.cntV = this.regV;
          this.cntH = this.regH;
          this.cntVT = this.regVT;
          this.cntHT = this.regHT;

          // On real hardware, the PPU runs a unified rendering pipeline
          // whenever either BG or sprites is enabled. BG tile fetches and
          // shift register loading happen regardless of which specific layer
          // flag is set. The individual visibility flags only affect the
          // final pixel output stage.
          // See https://www.nesdev.org/wiki/PPU_rendering
          if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
            // Render dummy scanline:
            this.renderBgScanline(false, 0);
          }

          // Sprite evaluation does NOT happen on the pre-render scanline, and
          // secondary OAM is NOT cleared either. The pre-render scanline's sprite
          // tile loading (cycles 257-320) reads from the stale secondary OAM left
          // over from the last visible scanline's evaluation. If any stale sprites
          // happen to be at Y=0, they will render on NES scanline 0.
          // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
          //
          // Buffer row 0 is the pre-render dummy row (no sprites).
          this.scanlineSpriteCount[0] = 0;
          this.scanlineSprite0[0] = 0;
          for (let i = 0; i < 32; i++) {
            this.scanlineSecondaryOAM[i] = 0xff;
          }

          // Buffer row 1 = NES scanline 0. Copy stale secondary OAM data from
          // the last evaluation (preserved in this.secondaryOAM). On real hardware,
          // the secondary OAM register persists and the pre-render scanline doesn't
          // clear it, allowing stale sprites to appear on scanline 0.
          // See AccuracyCoin "Sprites on Scanline 0" test.
          let scanline0Base = 1 * 32;
          for (let i = 0; i < 32; i++) {
            this.scanlineSecondaryOAM[scanline0Base + i] = this.secondaryOAM[i];
          }
          this.scanlineSpriteCount[1] = this.spritesFound;
          this.scanlineSprite0[1] = this.sprite0InSecondary ? 1 : 0;

          // OAMADDR is reset to 0 during sprite tile loading (cycles 257-320).
          this.sramAddress = 0;
        }

        if (this.f_bgVisibility === 1 && this.f_spVisibility === 1) {
          // Check sprite 0 hit for dummy scanline (buffer row 0).
          this.checkSprite0(0);
        }

        // Pre-compute sprite 0 hit for the first visible scanline (buffer
        // row 1). The dummy render above advanced the scroll counters to point
        // at row 1's vertical position, and the secondary OAM for row 1 was
        // set up from stale data above. This allows the dot-by-dot loop in
        // step() to detect the hit at the correct PPU dot during scanline 21.
        if (
          !this.hitSpr0 &&
          this.f_bgVisibility === 1 &&
          this.f_spVisibility === 1
        ) {
          if (this._precomputeSprite0Hit(1)) {
            this.hitSpr0 = true;
          }
        }

        if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
          // Clock mapper IRQ Counter:
          this.nes.mmap.clockIrqCounter();
        }
        break;

      case 261:
        // Post-render scanline (NES scanline 240), no rendering.
        // VBlank flag is set at dot 1 of the NEXT scanline (scanline 0 / NES 241)
        // by the frame loop and catch-up loop, gated on vblankPending.
        this.vblankPending = true;

        // Wrap around:
        this.scanline = -1; // will be incremented to 0

        break;

      default:
        if (this.scanline >= 21 && this.scanline <= 260) {
          // NES visible scanline index (0-239). The PPU's internal scanline
          // counter starts at 0 for VBlank, 20 for pre-render, 21 for the
          // first visible scanline. The buffer row is scanline - 20 (1-240),
          // offset by 1 because the pre-render scanline renders row 0.
          let bufferScan = this.scanline + 1 - 21;

          // OAM corruption at the start of each visible scanline.
          // Normally OAMADDR is 0 here (reset by evaluation on the previous
          // scanline), but writes to $2003 during rendering can trigger this.
          this.performOAMCorruption();

          // Render normally. On real hardware the PPU runs a unified
          // rendering pipeline when either BG or sprites is enabled — BG
          // tile fetches, shift register loading, and VRAM address
          // increments all happen regardless of which layer flag is set.
          // The individual visibility flags only suppress the final pixel
          // output. We must always populate bgbuffer/pixrendered so that
          // sprite 0 hit detection works even when BG was briefly disabled.
          // See https://www.nesdev.org/wiki/PPU_rendering
          if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
            if (!this.scanlineAlreadyRendered) {
              // update scroll:
              this.cntHT = this.regHT;
              this.cntH = this.regH;
              this.renderBgScanline(true, bufferScan);
            }
            this.scanlineAlreadyRendered = false;

            // Check for sprite 0 hit on this scanline.
            // Only check if sprite 0 is in the secondary OAM for this scanline
            // (determined by evaluation on the previous scanline).
            // Sprite 0 hit requires BOTH BG and sprite rendering to be enabled.
            if (
              !this.hitSpr0 &&
              this.f_bgVisibility === 1 &&
              this.f_spVisibility === 1 &&
              this.scanlineSprite0[bufferScan]
            ) {
              if (this.checkSprite0(bufferScan)) {
                this.hitSpr0 = true;
              }
            }
          }

          // Evaluate sprites for the NEXT scanline. On real hardware this
          // happens during cycles 65-256 of each visible scanline. Evaluation
          // on scanline N determines sprites for scanline N+1.
          // The evaluation target is bufferScan+1 because sprites have a +1 Y
          // offset (sprite Y=0 renders on display row 1, not row 0).
          // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
          if (bufferScan < 240) {
            this.evaluateSprites(bufferScan + 1);
          }

          // Pre-compute sprite 0 hit for the NEXT visible scanline. The BG
          // render above advanced the scroll counters to the next row, and
          // evaluateSprites just set up the secondary OAM for the next row.
          // By detecting the hit now, step()'s dot loop will see spr0HitX/Y
          // when processing the next scanline's dots, allowing the hit flag
          // to be set at the correct PPU cycle.
          if (
            !this.hitSpr0 &&
            this.f_bgVisibility === 1 &&
            this.f_spVisibility === 1
          ) {
            this._precomputeSprite0Hit(bufferScan + 1);
            if (this.spr0HitX !== -1) {
              this.hitSpr0 = true;
            }
          }

          if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
            // Clock mapper IRQ Counter:
            this.nes.mmap.clockIrqCounter();
          }
        }
    }

    this.scanline++;
    this.regsToAddress();
    this.cntsToAddress();
  }

  startFrame() {
    // Clear per-scanline sprite evaluation data from the previous frame.
    // scanlineSpriteCount is set to 0 so no sprites render on un-evaluated
    // scanlines. scanlineSprite0 is cleared to prevent stale sprite 0 hits.
    // Note: the pre-render scanline handler (case 20 in endScanline) may
    // later set scanlineSpriteCount[1] with stale data from the hardware
    // secondary OAM, allowing sprites to appear on NES scanline 0.
    // We don't need to clear scanlineSecondaryOAM here because:
    // - Evaluated scanlines fill it in evaluateSprites() (phase 1 clear)
    // - The pre-render handler fills row 1 from stale secondaryOAM
    // - scanlineSecondaryOAM for other non-evaluated rows is never read
    //   because their scanlineSpriteCount is 0
    this.scanlineSpriteCount.fill(0);
    this.scanlineSprite0.fill(0);

    // Set background color:
    let bgColor;

    if (this.f_dispType === 0) {
      // Color display.
      // f_color determines color emphasis.
      // Use first entry of image palette as BG color.
      bgColor = this.imgPalette[0];
    } else {
      // Monochrome display.
      // f_color determines the bg color.
      switch (this.f_color) {
        case 0:
          // Black
          bgColor = 0x00000;
          break;
        case 1:
          // Green
          bgColor = 0x00ff00;
          break;
        case 2:
          // Blue
          bgColor = 0x0000ff;
          break;
        case 3:
          // Invalid. Use black.
          bgColor = 0x000000;
          break;
        case 4:
          // Red
          bgColor = 0xff0000;
          break;
        default:
          // Invalid. Use black.
          bgColor = 0x0;
      }
    }

    this.buffer.fill(bgColor);
    this.pixrendered.fill(65);
  }

  endFrame() {
    let i, y;
    let buffer = this.buffer;

    // Draw spr#0 hit coordinates:
    if (this.showSpr0Hit) {
      // Spr 0 position:
      if (
        this.sprX[0] >= 0 &&
        this.sprX[0] < 256 &&
        this.sprY[0] >= 0 &&
        this.sprY[0] < 240
      ) {
        for (i = 0; i < 256; i++) {
          buffer[(this.sprY[0] << 8) + i] = 0xff5555;
        }
        for (i = 0; i < 240; i++) {
          buffer[(i << 8) + this.sprX[0]] = 0xff5555;
        }
      }
      // Hit position:
      if (
        this.spr0HitX >= 0 &&
        this.spr0HitX < 256 &&
        this.spr0HitY >= 0 &&
        this.spr0HitY < 240
      ) {
        for (i = 0; i < 256; i++) {
          buffer[(this.spr0HitY << 8) + i] = 0x55ff55;
        }
        for (i = 0; i < 240; i++) {
          buffer[(i << 8) + this.spr0HitX] = 0x55ff55;
        }
      }
    }

    // This is a bit lazy..
    // if either the sprites or the background should be clipped,
    // both are clipped after rendering is finished.
    if (
      this.clipToTvSize ||
      this.f_bgClipping === 0 ||
      this.f_spClipping === 0
    ) {
      // Clip left 8-pixels column:
      for (y = 0; y < 240; y++) {
        buffer.fill(0, y << 8, (y << 8) + 8);
      }
    }

    if (this.clipToTvSize) {
      // Clip right 8-pixels column too:
      for (y = 0; y < 240; y++) {
        buffer.fill(0, (y << 8) + 248, (y << 8) + 256);
      }

      // Clip top and bottom 8 pixels:
      buffer.fill(0, 0, 8 << 8);
      buffer.fill(0, 232 << 8, 240 << 8);
    }

    this.nes.ui.writeFrame(buffer);
  }

  updateControlReg1(value) {
    this.triggerRendering();

    this.f_nmiOnVblank = (value >> 7) & 1;
    this.f_spriteSize = (value >> 5) & 1;
    this.f_bgPatternTable = (value >> 4) & 1;
    this.f_spPatternTable = (value >> 3) & 1;
    this.f_addrInc = (value >> 2) & 1;
    this.f_nTblAddress = value & 3;

    this.regV = (value >> 1) & 1;
    this.regH = value & 1;
    this.regS = (value >> 4) & 1;

    // Writing $2000 can toggle NMI enable while VBlank is active. If NMI is
    // enabled during VBlank, a rising edge fires NMI. If disabled, a pending
    // NMI is cancelled. See https://www.nesdev.org/wiki/NMI
    this._updateNmiOutput();
  }

  // Recomputes the NMI output level from (vblankFlag AND nmiEnabled).
  // On a false→true transition (rising edge), sets nmiRaised on the CPU.
  // On a true→false transition (falling edge), may cancel a not-yet-latched
  // NMI edge.
  //
  // On real 6502 hardware, the NMI edge detector samples the /NMI line at
  // φ2 of each CPU cycle. Once a falling edge is detected (line goes low),
  // the internal NMI signal is latched and held until the NMI handler
  // begins executing — even if /NMI goes back high on the very next cycle.
  //
  // The edge detector needs the NMI output to be stably asserted before φ2
  // to latch. Two cases where the edge is NOT latched:
  //
  // 1. Same bus cycle: NMI output went high→low within one bus cycle.
  //    The edge detector never saw a stable assertion at φ2.
  //
  // 2. Post-loop boundary: NMI output went high at the very end of a
  //    step() call (post-loop check, nmiDotsRemainingInStep=0), right at
  //    the φ2 boundary. If the NEXT bus cycle immediately causes a falling
  //    edge (e.g., $2002 read clearing VBL) BEFORE its step() runs, the
  //    edge detector at the next φ2 sees the line deasserted. This models
  //    the PPU→CPU propagation delay for NMI output changes right at φ2.
  //
  // nmiPending (promoted from a previous instruction) is never cleared.
  // See https://www.nesdev.org/wiki/NMI
  _updateNmiOutput() {
    let vblank = (this.nes.cpu.mem[0x2002] & 0x80) !== 0;
    let newOutput = this.f_nmiOnVblank !== 0 && vblank;
    if (newOutput && !this.nmiOutput) {
      // Rising edge: set nmiRaised. At the end of the current instruction,
      // the CPU checks how many bus cycles remained after this edge to
      // determine 0-delay (immediate) vs 1-delay NMI.
      this.nes.cpu.nmiRaised = true;
      this.nes.cpu.nmiRaisedAtCycle = this.nes.cpu.instrBusCycles;
    } else if (!newOutput && this.nmiOutput) {
      // Falling edge: cancel nmiRaised only if it hasn't been latched yet.
      if (this.nes.cpu.nmiRaised) {
        let busCycleDiff =
          this.nes.cpu.instrBusCycles - this.nes.cpu.nmiRaisedAtCycle;
        if (
          busCycleDiff === 0 ||
          (busCycleDiff === 1 && this.nes.cpu.nmiDotsRemainingInStep === 0)
        ) {
          // Case 1: same bus cycle, or Case 2: post-loop edge on the
          // immediately previous bus cycle. Edge not latched — cancel.
          this.nes.cpu.nmiRaised = false;
        }
        // else: edge was latched at a previous φ2, don't cancel.
      }
    }
    this.nmiOutput = newOutput;
  }

  updateControlReg2(value) {
    this.triggerRendering();

    this.f_color = (value >> 5) & 7;
    this.f_spVisibility = (value >> 4) & 1;
    this.f_bgVisibility = (value >> 3) & 1;
    this.f_spClipping = (value >> 2) & 1;
    this.f_bgClipping = (value >> 1) & 1;
    this.f_dispType = value & 1;

    // When both BG and sprite rendering become enabled mid-scanline,
    // re-check sprite 0 hit. The unified PPU pipeline populates BG shift
    // registers whenever either flag is set, so BG tile data exists in
    // pixrendered even if only sprites were previously enabled. Re-enabling
    // BG mid-scanline can trigger sprite 0 hit against this data.
    if (
      !this.hitSpr0 &&
      this.f_bgVisibility === 1 &&
      this.f_spVisibility === 1 &&
      this.scanline >= 21 &&
      this.scanline <= 260
    ) {
      let bufferScan = this.scanline + 1 - 21;
      if (this.scanlineSprite0[bufferScan]) {
        if (this.checkSprite0(bufferScan)) {
          this.hitSpr0 = true;
        }
      }
    }

    if (this.f_dispType === 0) {
      this.palTable.setEmphasis(this.f_color);
    }
    this.updatePalettes();
  }

  setStatusFlag(flag, value) {
    let n = 1 << flag;
    this.nes.cpu.mem[0x2002] =
      (this.nes.cpu.mem[0x2002] & (255 - n)) | (value ? n : 0);
  }

  // CPU Register $2002:
  // Read the Status Register.
  readStatusRegister() {
    let tmp = this.nes.cpu.mem[0x2002];

    // Reset scroll & VRAM Address toggle:
    this.firstWrite = true;

    // NMI suppression: reading $2002 one PPU dot BEFORE VBlank is set
    // (curX=0 of scanline 0 / NES scanline 241) causes the VBL flag to
    // never be set for this frame, suppressing both the flag and NMI.
    // The read itself correctly returns VBL=0 (it hasn't been set yet).
    //
    // At curX=1 (the exact VBL set dot), the post-loop check in
    // _ppuCatchUp() already fired VBlank, so VBL=1 here. The read sees
    // VBL=1, clears the flag, and _updateNmiOutput() below cancels NMI
    // (the flag was held for less than 1 CPU cycle). This matches Mesen's
    // behavior where VBL reads as SET at the simultaneous dot.
    //
    // See https://www.nesdev.org/wiki/PPU_frame_timing
    if (this.scanline === 0 && this.curX === 0) {
      this.nmiSuppressed = true;
    }

    // Clear VBlank flag:
    this.setStatusFlag(this.STATUS_VBLANK, false);

    // Clearing VBlank may cause a falling edge on NMI output, cancelling
    // any pending NMI.
    this._updateNmiOutput();

    // Only bits 7-5 come from the status register; bits 4-0 are open bus.
    tmp = (tmp & 0xe0) | (this.openBusLatch & 0x1f);
    this.openBusLatch = tmp;
    this.openBusDecayFrames = 36; // ~600ms at 60fps

    // Fetch status data:
    return tmp;
  }

  // CPU Register $2003:
  // Write the SPR-RAM address that is used for sramWrite (Register 0x2004 in CPU memory map)
  writeSRAMAddress(address) {
    this.sramAddress = address;
  }

  // CPU Register $2004 (R):
  // Read from SPR-RAM (Sprite RAM / OAM).
  // During rendering, returns phase-dependent values instead of normal OAM:
  //  - Cycles 1-64 (secondary OAM clear): returns $FF
  //  - Cycles 65-256 (sprite evaluation): returns the byte being read
  //  - Cycles 257-320 (sprite tile loading): returns secondary OAM data
  // During VBlank or when rendering is disabled, returns OAM[OAMADDR] normally.
  // Bits 2-4 of byte 2 (attributes) always read as 0 (unimplemented bits).
  // See https://www.nesdev.org/wiki/PPU_registers#OAMDATA
  sramLoad() {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;

    // During visible or pre-render scanlines with rendering enabled,
    // $2004 reads return internal PPU sprite data, not OAM directly.
    // See https://www.nesdev.org/wiki/PPU_registers#OAMDATA
    if (renderingEnabled && this.scanline >= 20 && this.scanline <= 260) {
      let dot = this.curX;
      if (dot <= 64) {
        // Dots 0-64: secondary OAM clear phase (dots 1-64, plus idle dot 0).
        // $2004 reads always return $FF because the internal clear signal
        // forces the OAM read bus to $FF.
        return 0xff;
      } else if (dot <= 256) {
        // Dots 65-256: sprite evaluation phase. $2004 returns the OAM byte
        // currently being read by the evaluation logic. We approximate this
        // by returning OAM[OAMADDR] since OAMADDR tracks the evaluation
        // read pointer during this phase.
        // Bits 2-4 of attribute bytes (byte 2 of each entry) always read as 0.
        let val = this.spriteMem[this.sramAddress];
        if ((this.sramAddress & 3) === 2) {
          val &= 0xe3;
        }
        return val;
      } else {
        // Dots 257-340: sprite tile loading and background prefetch.
        // $2004 reads return $FF during this entire phase. The PPU's
        // internal OAM read bus is not driven by the evaluation logic.
        // See AccuracyCoin "$2004 behavior" test.
        return 0xff;
      }
    }

    // Normal read during VBlank or rendering disabled.
    // Bits 2-4 of attribute byte are unimplemented, always read as 0.
    let value = this.spriteMem[this.sramAddress];
    if ((this.sramAddress & 3) === 2) {
      value &= 0xe3;
    }
    return value;
  }

  // CPU Register $2004 (W):
  // Write to SPR-RAM (Sprite RAM).
  // The address should be set first.
  sramWrite(value) {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;

    if (renderingEnabled && this.scanline >= 20 && this.scanline <= 260) {
      // During rendering on visible/pre-render scanlines, writes to $2004
      // are suppressed (value is NOT stored to OAM). Instead, OAMADDR is
      // incremented by 4 and ANDed with $FC, matching the hardware's
      // internal evaluation counter behavior.
      // See https://www.nesdev.org/wiki/PPU_registers#OAMDATA
      this.sramAddress = (this.sramAddress + 4) & 0xfc;
    } else {
      // Normal write during VBlank or rendering disabled
      this.spriteMem[this.sramAddress] = value;
      this.spriteRamWriteUpdate(this.sramAddress, value);
      this.sramAddress++;
      this.sramAddress %= 0x100;
    }
  }

  // CPU Register $2005:
  // Write to scroll registers.
  // The first write is the vertical offset, the second is the
  // horizontal offset:
  scrollWrite(value) {
    this.triggerRendering();

    if (this.firstWrite) {
      // First write, horizontal scroll:
      this.regHT = (value >> 3) & 31;
      this.regFH = value & 7;
    } else {
      // Second write, vertical scroll:
      this.regFV = value & 7;
      this.regVT = (value >> 3) & 31;
    }
    this.firstWrite = !this.firstWrite;
  }

  // CPU Register $2006:
  // Sets the adress used when reading/writing from/to VRAM.
  // The first write sets the high byte, the second the low byte.
  writeVRAMAddress(address) {
    if (this.firstWrite) {
      this.regFV = (address >> 4) & 3;
      this.regV = (address >> 3) & 1;
      this.regH = (address >> 2) & 1;
      this.regVT = (this.regVT & 7) | ((address & 3) << 3);
    } else {
      this.triggerRendering();

      this.regVT = (this.regVT & 24) | ((address >> 5) & 7);
      this.regHT = address & 31;

      this.cntFV = this.regFV;
      this.cntV = this.regV;
      this.cntH = this.regH;
      this.cntVT = this.regVT;
      this.cntHT = this.regHT;

      this.checkSprite0(this.scanline + 1 - 21);
    }

    this.firstWrite = !this.firstWrite;

    // Invoke mapper latch:
    this.cntsToAddress();
    if (this.vramAddress < 0x2000) {
      this.nes.mmap.latchAccess(this.vramAddress);
    }
  }

  // CPU Register $2007(R):
  // Read from PPU memory. The address should be set first.
  vramLoad() {
    let tmp;

    this.cntsToAddress();
    this.regsToAddress();

    // If address is in range 0x0000-0x3EFF, return buffered values:
    if (this.vramAddress <= 0x3eff) {
      tmp = this.vramBufferedReadValue;

      // Update buffered value:
      if (this.vramAddress < 0x2000) {
        this.vramBufferedReadValue = this.vramMem[this.vramAddress];
      } else {
        this.vramBufferedReadValue = this.mirroredLoad(this.vramAddress);
      }

      // Mapper latch access:
      if (this.vramAddress < 0x2000) {
        this.nes.mmap.latchAccess(this.vramAddress);
      }

      this._incrementVramAddress();

      this.cntsFromAddress();
      this.regsFromAddress();

      return tmp; // Return the previous buffered value.
    }

    // Palette RAM ($3F00-$3FFF): value is returned directly (no buffer
    // delay), but the read buffer is loaded with the nametable data
    // "behind" the palette at (address & $2FFF).
    // Palette RAM is only 32 bytes; addresses mirror every $20 bytes.
    // Backdrop mirrors: $3F10/$3F14/$3F18/$3F1C → $3F00/$3F04/$3F08/$3F0C.
    // Values are 6-bit; upper 2 bits come from the PPU open bus latch.
    // See https://www.nesdev.org/wiki/PPU_palettes
    let palIdx = this.vramAddress & 0x1f;
    if ((palIdx & 0x13) === 0x10) {
      palIdx &= 0x0f; // backdrop mirror
    }
    tmp = (this.vramMem[0x3f00 + palIdx] & 0x3f) | (this.openBusLatch & 0xc0);

    // Update buffer with nametable data behind the palette
    this.vramBufferedReadValue = this.mirroredLoad(this.vramAddress & 0x2fff);

    this._incrementVramAddress();

    this.cntsFromAddress();
    this.regsFromAddress();

    return tmp;
  }

  // CPU Register $2007(W):
  // Write to PPU memory. The address should be set first.
  vramWrite(value) {
    this.triggerRendering();
    this.cntsToAddress();
    this.regsToAddress();

    if (this.vramAddress >= 0x2000) {
      // Mirroring is used.
      this.mirroredWrite(this.vramAddress, value);
    } else {
      // Pattern table ($0000-$1FFF): writable if CHR RAM is mapped here.
      // The mapper decides — most mappers allow writes only when there's no
      // CHR ROM at all, but some (e.g. TQROM/mapper 119) have both CHR ROM
      // and CHR RAM and allow writes to CHR RAM-mapped regions.
      if (this.nes.mmap.canWriteChr(this.vramAddress)) {
        this.writeMem(this.vramAddress, value);
      }

      // Invoke mapper latch:
      this.nes.mmap.latchAccess(this.vramAddress);
    }

    this._incrementVramAddress();
    this.regsFromAddress();
    this.cntsFromAddress();
  }

  // CPU Register $4014:
  // Write 256 bytes of main memory into Sprite RAM (OAM).
  // DMA always copies exactly 256 bytes from CPU page $XX00-$XXFF.
  // The destination starts at the current OAMADDR and wraps within OAM.
  // See https://www.nesdev.org/wiki/PPU_registers#OAMDMA
  sramDMA(value) {
    let baseAddress = value * 0x100;
    let data;
    for (let i = 0; i < 256; i++) {
      data = this.nes.cpu.mem[baseAddress + i];
      let oamAddr = (this.sramAddress + i) & 0xff;
      this.spriteMem[oamAddr] = data;
      this.spriteRamWriteUpdate(oamAddr, data);
    }

    // OAM DMA takes 513 CPU cycles (1 wait + 256 read/write pairs), plus
    // an extra alignment cycle if the CPU is on an odd cycle (a "put" cycle).
    // This ensures the DMA always begins on an even cycle, synchronizing the
    // CPU to a known cycle parity. The AccuracyCoin controller strobe test
    // relies on this alignment to verify APU-clock-gated OUT0 behavior.
    // See https://www.nesdev.org/wiki/DMA#OAM_DMA
    let cpu = this.nes.cpu;
    let currentCycle = cpu._cpuCycleBase + cpu.instrBusCycles;
    let cycles = currentCycle % 2 === 0 ? 514 : 513;
    cpu.haltCycles(cycles);
  }

  // Updates the scroll registers from a new VRAM address.
  regsFromAddress() {
    let address = (this.vramTmpAddress >> 8) & 0xff;
    this.regFV = (address >> 4) & 7;
    this.regV = (address >> 3) & 1;
    this.regH = (address >> 2) & 1;
    this.regVT = (this.regVT & 7) | ((address & 3) << 3);

    address = this.vramTmpAddress & 0xff;
    this.regVT = (this.regVT & 24) | ((address >> 5) & 7);
    this.regHT = address & 31;
  }

  // Increments the VRAM address after a $2007 read or write. During active
  // rendering (either BG or sprites enabled on a visible/pre-render scanline),
  // the increment behaves differently: instead of the normal +1 or +32 linear
  // increment, the PPU performs simultaneous coarse X and Y increments with
  // proper wrapping. This is because the v register is being used as part of
  // the rendering address logic, not as a simple pointer.
  // See https://www.nesdev.org/wiki/PPU_scrolling#$2007_reads_and_writes
  // See https://www.nesdev.org/wiki/PPU_registers#PPUDATA
  _incrementVramAddress() {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;
    // jsnes scanlines 20-260 = NES pre-render + visible scanlines
    let onRenderingScanline = this.scanline >= 20 && this.scanline <= 260;

    if (renderingEnabled && onRenderingScanline) {
      // Coarse X increment (with horizontal nametable toggle on overflow)
      if ((this.vramAddress & 0x001f) === 31) {
        this.vramAddress &= ~0x001f; // coarse X = 0
        this.vramAddress ^= 0x0400; // toggle horizontal nametable
      } else {
        this.vramAddress += 1;
      }

      // Y increment: fine Y first, then coarse Y on overflow
      if ((this.vramAddress & 0x7000) !== 0x7000) {
        this.vramAddress += 0x1000; // fine Y += 1
      } else {
        this.vramAddress &= ~0x7000; // fine Y = 0
        let coarseY = (this.vramAddress >> 5) & 0x1f;
        if (coarseY === 29) {
          coarseY = 0;
          this.vramAddress ^= 0x0800; // toggle vertical nametable
        } else if (coarseY === 31) {
          coarseY = 0; // wrap without nametable toggle
        } else {
          coarseY += 1;
        }
        this.vramAddress = (this.vramAddress & ~0x03e0) | (coarseY << 5);
      }
    } else {
      // Normal linear increment outside rendering
      this.vramAddress += this.f_addrInc === 1 ? 32 : 1;
    }
  }

  // Updates the scroll registers from a new VRAM address.
  cntsFromAddress() {
    let address = (this.vramAddress >> 8) & 0xff;
    this.cntFV = (address >> 4) & 3;
    this.cntV = (address >> 3) & 1;
    this.cntH = (address >> 2) & 1;
    this.cntVT = (this.cntVT & 7) | ((address & 3) << 3);

    address = this.vramAddress & 0xff;
    this.cntVT = (this.cntVT & 24) | ((address >> 5) & 7);
    this.cntHT = address & 31;
  }

  regsToAddress() {
    let b1 = (this.regFV & 7) << 4;
    b1 |= (this.regV & 1) << 3;
    b1 |= (this.regH & 1) << 2;
    b1 |= (this.regVT >> 3) & 3;

    let b2 = (this.regVT & 7) << 5;
    b2 |= this.regHT & 31;

    this.vramTmpAddress = ((b1 << 8) | b2) & 0x7fff;
  }

  cntsToAddress() {
    let b1 = (this.cntFV & 7) << 4;
    b1 |= (this.cntV & 1) << 3;
    b1 |= (this.cntH & 1) << 2;
    b1 |= (this.cntVT >> 3) & 3;

    let b2 = (this.cntVT & 7) << 5;
    b2 |= this.cntHT & 31;

    this.vramAddress = ((b1 << 8) | b2) & 0x7fff;
  }

  incTileCounter(count) {
    for (let i = count; i !== 0; i--) {
      this.cntHT++;
      if (this.cntHT === 32) {
        this.cntHT = 0;
        this.cntVT++;
        if (this.cntVT >= 30) {
          this.cntH++;
          if (this.cntH === 2) {
            this.cntH = 0;
            this.cntV++;
            if (this.cntV === 2) {
              this.cntV = 0;
              this.cntFV++;
              this.cntFV &= 0x7;
            }
          }
        }
      }
    }
  }

  // Reads from memory, taking into account
  // mirroring/mapping of address ranges.
  mirroredLoad(address) {
    return this.vramMem[this.vramMirrorTable[address]];
  }

  // Writes to memory, taking into account
  // mirroring/mapping of address ranges.
  mirroredWrite(address, value) {
    if (address >= 0x3f00 && address < 0x3f20) {
      // Palette write mirroring.
      if (address === 0x3f00 || address === 0x3f10) {
        this.writeMem(0x3f00, value);
        this.writeMem(0x3f10, value);
      } else if (address === 0x3f04 || address === 0x3f14) {
        this.writeMem(0x3f04, value);
        this.writeMem(0x3f14, value);
      } else if (address === 0x3f08 || address === 0x3f18) {
        this.writeMem(0x3f08, value);
        this.writeMem(0x3f18, value);
      } else if (address === 0x3f0c || address === 0x3f1c) {
        this.writeMem(0x3f0c, value);
        this.writeMem(0x3f1c, value);
      } else {
        this.writeMem(address, value);
      }
    } else {
      // Use lookup table for mirrored address:
      if (address < this.vramMirrorTable.length) {
        this.writeMem(this.vramMirrorTable[address], value);
      } else {
        throw new Error(`Invalid VRAM address: ${address.toString(16)}`);
      }
    }
  }

  triggerRendering() {
    // Guard against recursion from mapper latch bank switches during rendering.
    // When the PPU is already rendering and a latch-triggered loadVromBank calls
    // triggerRendering, we must not re-enter the rendering loop.
    if (this._inRendering) return;
    if (this.scanline >= 21 && this.scanline <= 260) {
      // Render sprites, and combine:
      this.renderFramePartially(
        this.lastRenderedScanline + 1,
        this.scanline - 21 - this.lastRenderedScanline,
      );

      // Set last rendered scanline:
      this.lastRenderedScanline = this.scanline - 21;
    }
  }

  renderFramePartially(startScan, scanCount) {
    this._inRendering = true;

    // Let the mapper swap CHR banks for sprite rendering.
    // MMC5 uses separate CHR bank sets for sprites vs backgrounds.
    this.nes.mmap.onSpriteRender();

    if (this.f_spVisibility === 1) {
      this.renderSpritesPartially(startScan, scanCount, 1);
    }

    if (this.f_bgVisibility === 1) {
      let si = startScan << 8;
      let ei = (startScan + scanCount) << 8;
      if (ei > 0xf000) {
        ei = 0xf000;
      }
      let buffer = this.buffer;
      let bgbuffer = this.bgbuffer;
      let pixrendered = this.pixrendered;
      for (let destIndex = si; destIndex < ei; destIndex++) {
        if (pixrendered[destIndex] > 0xff) {
          buffer[destIndex] = bgbuffer[destIndex];
        }
      }
    }

    if (this.f_spVisibility === 1) {
      this.renderSpritesPartially(startScan, scanCount, 0);
    }

    // Restore BG CHR banks for subsequent background scanline rendering.
    this.nes.mmap.onBgRender();

    this._inRendering = false;
    this.validTileData = false;
  }

  renderBgScanline(bgbuffer, scan) {
    let baseTile = this.regS === 0 ? 0 : 256;
    // Base address for pattern table fetches (used for mapper latch triggers).
    // On real hardware, the PPU puts this address on its bus when fetching tile
    // data, and mappers like MMC2 monitor these fetches.
    let baseAddr = this.regS === 0 ? 0x0000 : 0x1000;
    let destIndex = (scan << 8) - this.regFH;

    this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];

    this.cntHT = this.regHT;
    this.cntH = this.regH;
    this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];

    if (scan < 240 && scan - this.cntFV >= 0) {
      let tscanoffset = this.cntFV << 3;
      let scantile = this.scantile;
      let attrib = this.attrib;
      let ptTile = this.ptTile;
      let nameTable = this.nameTable;
      let imgPalette = this.imgPalette;
      let pixrendered = this.pixrendered;
      let targetBuffer = bgbuffer ? this.bgbuffer : this.buffer;
      let mmap = this.nes.mmap;

      let t, tpix, att, col;

      this._inRendering = true;

      // Let the mapper swap CHR banks for background rendering.
      // MMC5 uses separate CHR bank sets for sprites vs backgrounds.
      this.nes.mmap.onBgRender();

      // Simulate unused sprite slot dummy fetches from the previous scanline.
      // On real hardware, the PPU fetches patterns for 8 sprites per scanline
      // during cycles 257-320. Unused slots fetch tile $FF. In 8x16 sprite
      // mode, tile $FF selects pattern table $1000 (bit 0 = 1) with top-half
      // tile $FE. The high-plane byte fetch at $1FE8 triggers MMC2/MMC4
      // latch 1 → $FE, resetting it before the next scanline's BG fetches.
      // Without this, latch 1 can stay at $FD from a previous BG trigger tile,
      // causing sprite corruption (e.g. in Punch-Out!!'s crowd).
      // See https://www.nesdev.org/wiki/MMC2
      if (this.f_spriteSize === 1) {
        mmap.latchAccess(0x1fe8);
      }

      for (let tile = 0; tile < 32; tile++) {
        if (scan >= 0) {
          // Look up nametable tile index (needed for both rendering and mapper
          // latch access even when tile data is cached).
          let tileIndex = nameTable[this.curNt].getTileIndex(
            this.cntHT,
            this.cntVT,
          );

          // Fetch tile & attrib data:
          if (this.validTileData) {
            // Get data from array:
            t = scantile[tile];
            if (typeof t === "undefined") {
              continue;
            }
            tpix = t.pix;
            att = attrib[tile];
          } else {
            // Fetch data:
            t = ptTile[baseTile + tileIndex];
            if (typeof t === "undefined") {
              continue;
            }
            tpix = t.pix;
            att = nameTable[this.curNt].getAttrib(this.cntHT, this.cntVT);

            // MMC5 ExRAM mode 1: per-tile CHR bank and attribute override.
            // Each ExRAM byte provides a 4KB CHR bank (bits 5-0) and palette
            // (bits 7-6) for the corresponding background tile, allowing
            // each tile to use a different CHR bank independently.
            if (mmap.bgTileOverride) {
              let override = mmap.getBgTileData(
                baseTile,
                tileIndex,
                this.cntHT,
                this.cntVT,
              );
              if (override) {
                t = override.tile;
                tpix = t.pix;
                att = override.attrib;
              }
            }

            scantile[tile] = t;
            attrib[tile] = att;
          }

          // Render tile scanline:
          let sx = 0;
          let x = (tile << 3) - this.regFH;

          if (x > -8) {
            if (x < 0) {
              destIndex -= x;
              sx = -x;
            }
            if (t.opaque[this.cntFV]) {
              for (; sx < 8; sx++) {
                targetBuffer[destIndex] =
                  imgPalette[tpix[tscanoffset + sx] + att];
                pixrendered[destIndex] |= 256;
                destIndex++;
              }
            } else {
              for (; sx < 8; sx++) {
                col = tpix[tscanoffset + sx];
                if (col !== 0) {
                  targetBuffer[destIndex] = imgPalette[col + att];
                  pixrendered[destIndex] |= 256;
                }
                destIndex++;
              }
            }
          }

          // Mapper latch access: simulate the PPU's pattern table high byte
          // fetch. On real hardware, the PPU reads the high plane byte at
          // (baseAddr + tileIndex*16 + fineY + 8), and MMC2/MMC4 monitor
          // this address to trigger CHR bank switches. The latch updates
          // AFTER the fetch, so the current tile is rendered with the old
          // bank (correct, since we already read from ptTile above) and
          // subsequent tiles will use the new bank.
          // See https://www.nesdev.org/wiki/MMC2
          mmap.latchAccess(baseAddr + tileIndex * 16 + this.cntFV + 8);
        }

        // Increase Horizontal Tile Counter:
        if (++this.cntHT === 32) {
          this.cntHT = 0;
          this.cntH++;
          this.cntH %= 2;
          this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
        }
      }
      this._inRendering = false;

      // Tile data for one row should now have been fetched,
      // so the data in the array is valid.
      this.validTileData = true;
    }

    // update vertical scroll:
    this.cntFV++;
    if (this.cntFV === 8) {
      this.cntFV = 0;
      this.cntVT++;
      if (this.cntVT === 30) {
        this.cntVT = 0;
        this.cntV++;
        this.cntV %= 2;
        this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
      } else if (this.cntVT === 32) {
        this.cntVT = 0;
      }

      // Invalidate fetched data:
      this.validTileData = false;
    }
  }

  // OAM corruption (2C02G/H hardware bug): if OAMADDR is not zero at the
  // beginning of the pre-render or any visible scanline (when rendering is
  // enabled), the 8 bytes at (OAMADDR & $F8) are copied over the first 8
  // bytes of OAM. This is a DRAM refresh glitch, separate from evaluation.
  // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_0_corruption
  performOAMCorruption() {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;
    if (!renderingEnabled) return;
    if (this.sramAddress === 0) return;

    let srcBase = this.sramAddress & 0xf8;
    for (let i = 0; i < 8; i++) {
      this.spriteMem[i] = this.spriteMem[(srcBase + i) & 0xff];
    }
    // Update unpacked sprite data for the corrupted entries
    for (let i = 0; i < 8; i++) {
      this.spriteRamWriteUpdate(i, this.spriteMem[i]);
    }
  }

  // Evaluate sprites for the given scanline, populating secondary OAM and
  // storing results in per-scanline arrays for later batch rendering.
  //
  // On real hardware this runs during cycles 65-256 of each visible scanline,
  // finding up to 8 sprites that are in range for the NEXT scanline. The
  // algorithm is a state machine with counters n (sprite index, 0-63) and
  // m (byte within sprite, 0-3). It includes the hardware sprite overflow
  // bug where both n AND m are incremented when checking for a 9th sprite.
  //
  // targetScanline: the NES scanline (0-239) whose sprites we're evaluating.
  //   Evaluation on visible scanline N finds sprites for scanline N+1.
  //   Results are stored in scanlineSecondaryOAM[targetScanline].
  //
  // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
  evaluateSprites(targetScanline) {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;

    // On real hardware, secondary OAM clear and evaluation only happen when
    // rendering is enabled. When disabled, the secondary OAM retains stale
    // data from the last evaluation, and OAMADDR is not reset. We skip
    // clearing the per-scanline data too, so stale sprites persist.
    if (!renderingEnabled) return;

    // Phase 1: Clear secondary OAM to $FF (cycles 1-64)
    let oamBase = targetScanline * 32;
    for (let i = 0; i < 32; i++) {
      this.scanlineSecondaryOAM[oamBase + i] = 0xff;
    }
    this.scanlineSpriteCount[targetScanline] = 0;
    this.scanlineSprite0[targetScanline] = 0;

    let spriteHeight = this.f_spriteSize === 0 ? 8 : 16;
    let spritesFound = 0;
    let secondaryIndex = 0; // Write pointer into secondary OAM (0-31)

    // Phase 2: Sprite evaluation (cycles 65-256)
    // Start scanning from sprite n = OAMADDR / 4.
    // The starting OAMADDR determines which sprite is treated as "sprite 0"
    // for hit detection and priority. A misaligned OAMADDR (not divisible
    // by 4) causes m to start at a non-zero value, reading the wrong byte
    // types as Y coordinates.
    let startN = (this.sramAddress >> 2) & 0x3f;
    let startM = this.sramAddress & 0x03;
    let overflowM = 0; // m counter for overflow bug (separate from startM)

    let n = startN;
    let firstSprite = true; // First sprite may have misaligned m

    // Evaluation checks sprites from startN through 63, then stops when n
    // wraps back to 0. Sprites 0 through startN-1 are never checked, making
    // them invisible. This is documented behavior:
    // "No more sprites will be found once the end of OAM is reached,
    //  effectively hiding any sprites before the starting OAMADDR."
    // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
    let evaluated = 0;
    do {
      let m;
      if (spritesFound >= 8) {
        // In overflow detection mode: use the buggy m counter
        m = overflowM;
      } else if (firstSprite) {
        // First sprite: m may be non-zero (misaligned OAMADDR)
        m = startM;
      } else {
        m = 0;
      }
      firstSprite = false;

      let yByte = this.spriteMem[(n * 4 + m) & 0xff];

      // Check if sprite is in range for the target buffer row.
      // On real hardware the comparison is NES_scanline >= Y && < Y + height.
      // Since targetScanline is in buffer coordinates (NES scanline + 1),
      // this becomes targetScanline > Y && targetScanline <= Y + height.
      // The comparison uses whatever byte we read (even if it's not Y).
      if (targetScanline > yByte && targetScanline <= yByte + spriteHeight) {
        if (spritesFound < 8) {
          // Copy 4 bytes to secondary OAM, starting from the actual read
          // address (n*4+m). When OAMADDR is misaligned (m != 0), this
          // copies garbled data: the bytes after m in this entry followed
          // by bytes from the next entry, matching hardware behavior.
          for (let b = 0; b < 4; b++) {
            this.scanlineSecondaryOAM[oamBase + secondaryIndex + b] =
              this.spriteMem[(n * 4 + m + b) & 0xff];
          }
          // The first sprite in evaluation order (at OAMADDR/4) is the one
          // that triggers sprite 0 hit, regardless of its OAM index.
          // On real hardware, setting OAMADDR to a non-zero value causes
          // the sprite at that address to act as "sprite 0" for hit detection.
          // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
          if (evaluated === 0) {
            this.scanlineSprite0[targetScanline] = 1;
          }
          spritesFound++;
          secondaryIndex += 4;
        } else {
          // 9th in-range sprite found: set sprite overflow flag.
          // On real hardware this is STATUS_SLSPRITECOUNT (bit 5 of $2002).
          this.setStatusFlag(this.STATUS_SLSPRITECOUNT, true);
          break; // After overflow is found, evaluation enters idle
        }
      } else if (spritesFound >= 8) {
        // Sprite overflow bug: when 8 sprites have been found and we're
        // checking for a 9th, a hardware bug causes BOTH n and m to be
        // incremented when the sprite is not in range. This makes the
        // evaluation read diagonally through OAM — checking tile indices,
        // attributes, and X coordinates as if they were Y coordinates.
        // This produces both false positives and false negatives for overflow.
        // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
        overflowM = (overflowM + 1) & 0x03;
      }

      n = (n + 1) & 0x3f;
      evaluated++;
    } while (n !== 0);

    this.scanlineSpriteCount[targetScanline] = spritesFound;

    // Also save to the hardware secondary OAM buffer. On real hardware,
    // secondary OAM is a physical 32-byte register that persists across
    // scanlines. It is NOT cleared on the pre-render scanline, so stale
    // data from the last visible scanline's evaluation can affect sprite
    // tile loading on the pre-render scanline, potentially causing sprites
    // to appear on NES scanline 0.
    // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
    for (let i = 0; i < 32; i++) {
      this.secondaryOAM[i] = this.scanlineSecondaryOAM[oamBase + i];
    }
    this.spritesFound = spritesFound;
    this.sprite0InSecondary = this.scanlineSprite0[targetScanline] === 1;

    // OAMADDR is set to 0 during sprite tile loading (cycles 257-320).
    // On real hardware this happens at the start of HBlank.
    this.sramAddress = 0;
  }

  // Render sprites for a range of scanlines using per-scanline secondary OAM
  // data from sprite evaluation. Only the 8 (or fewer) sprites selected by
  // evaluation are rendered, enforcing the hardware's per-scanline sprite limit.
  //
  // bgPri: 0 = render sprites with bg priority 0 (in front of background),
  //         1 = render sprites with bg priority 1 (behind background).
  //
  // Each scanline's sprites come from scanlineSecondaryOAM[], populated by
  // evaluateSprites() during endScanline(). Sprite data is read from secondary
  // OAM format: [Y, tile, attributes, X] × 8 sprites.
  renderSpritesPartially(startscan, scancount, bgPri) {
    if (this.f_spVisibility !== 1) return;

    let mmap = this.nes.mmap;
    let ptTile = this.ptTile;
    let buffer = this.buffer;
    let sprPalette = this.sprPalette;
    let pixrendered = this.pixrendered;

    for (let scan = startscan; scan < startscan + scancount; scan++) {
      if (scan < 0 || scan >= 240) continue;

      let count = this.scanlineSpriteCount[scan];
      let oamBase = scan * 32;

      for (let i = 0; i < count; i++) {
        let sprY = this.scanlineSecondaryOAM[oamBase + i * 4 + 0];
        let sprTile = this.scanlineSecondaryOAM[oamBase + i * 4 + 1];
        let sprAttr = this.scanlineSecondaryOAM[oamBase + i * 4 + 2];
        let sprX = this.scanlineSecondaryOAM[oamBase + i * 4 + 3];

        let vertFlip = (sprAttr >> 7) & 1;
        let horiFlip = (sprAttr >> 6) & 1;
        let priority = (sprAttr >> 5) & 1;
        let palAdd = (sprAttr & 3) << 2;

        if (priority !== bgPri) continue;
        if (this.f_spriteSize === 0) {
          // 8x8 sprites
          let tileIndex = this.f_spPatternTable === 0 ? sprTile : sprTile + 256;
          let sprBaseAddr = this.f_spPatternTable === 0 ? 0x0000 : 0x1000;

          // Render only the one scanline row that falls on 'scan'
          let dy = sprY + 1; // +1 because sprite Y in OAM is display line - 1
          let fineY = scan - dy;
          if (fineY < 0 || fineY >= 8) continue;

          ptTile[tileIndex].render(
            buffer,
            0,
            fineY,
            8,
            fineY + 1,
            sprX,
            dy,
            palAdd,
            sprPalette,
            horiFlip,
            vertFlip,
            i, // priority: lower index in secondary OAM = higher priority
            pixrendered,
          );

          // Mapper latch: simulate PPU's sprite pattern table fetch.
          mmap.latchAccess(sprBaseAddr + sprTile * 16 + 8);
        } else {
          // 8x16 sprites: tile index bit 0 selects pattern table ($0000/$1000),
          // top tile is (index & $FE), bottom tile is (index & $FE) + 1.
          let sprBaseAddr = (sprTile & 1) !== 0 ? 0x1000 : 0x0000;
          let topTileNum = sprTile & 0xfe;
          let top = (sprTile & 1) !== 0 ? topTileNum - 1 + 256 : topTileNum;

          let dy = sprY + 1;
          let fineY = scan - dy;
          if (fineY < 0 || fineY >= 16) continue;

          // Determine which half (top/bottom) this scanline falls in
          let tileOffset, tileFineY;
          if (fineY < 8) {
            tileOffset = vertFlip ? 1 : 0;
            tileFineY = fineY;
          } else {
            tileOffset = vertFlip ? 0 : 1;
            tileFineY = fineY - 8;
          }

          ptTile[top + tileOffset].render(
            buffer,
            0,
            tileFineY,
            8,
            tileFineY + 1,
            sprX,
            dy + (fineY < 8 ? 0 : 8),
            palAdd,
            sprPalette,
            horiFlip,
            vertFlip,
            i,
            pixrendered,
          );

          // Mapper latch: simulate fetches for both halves of 8x16 sprite.
          mmap.latchAccess(sprBaseAddr + topTileNum * 16 + 8);
          mmap.latchAccess(sprBaseAddr + (topTileNum + 1) * 16 + 8);
        }
      }
    }
  }

  // Check if sprite 0 overlaps with a background tile pixel on this scanline.
  // "Sprite 0" is the first sprite in evaluation order — normally OAM entry 0,
  // but a non-zero OAMADDR can make a different entry act as sprite 0.
  //
  // On real hardware, sprite 0 hit only fires when a non-transparent sprite
  // pixel overlaps with a non-transparent background tile pixel. We check
  // pixrendered[bufferIndex] > 0xff because bit 8 (256) is set by
  // renderBgScanline when an actual background tile pixel is rendered.
  // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
  checkSprite0(scan) {
    this.spr0HitX = -1;
    this.spr0HitY = -1;

    if (scan < 0 || scan >= 240) return false;
    if (!this.scanlineSprite0[scan]) return false;
    if (this.scanlineSpriteCount[scan] === 0) return false;

    // Read sprite 0's data from secondary OAM (first entry, slot 0).
    let oamBase = scan * 32;
    let sprY = this.scanlineSecondaryOAM[oamBase + 0];
    let sprTile = this.scanlineSecondaryOAM[oamBase + 1];
    let sprAttr = this.scanlineSecondaryOAM[oamBase + 2];
    let x = this.scanlineSecondaryOAM[oamBase + 3];
    let y = sprY + 1; // +1 because sprite Y in OAM is display line - 1

    let vertFlip = (sprAttr >> 7) & 1;
    let horiFlip = (sprAttr >> 6) & 1;

    // Sprite 0 hit has additional conditions beyond pixel overlap:
    // - No hit at x=255 (hardware doesn't check the last pixel)
    // - No hit at x=0..7 when left-side clipping is enabled for either
    //   sprites (f_spClipping===0) or background (f_bgClipping===0)
    // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
    let leftClip = this.f_spClipping === 0 || this.f_bgClipping === 0;

    // Check each pixel of the sprite for overlap with background.
    // Returns the first x position where hit occurs, or -1 if no hit.
    let toffset;
    let t;

    // Use the mapper's getSpritePatternTile() instead of ptTile directly.
    // On MMC5 in 8x16 mode, ptTile may have BG data (Set B) after
    // renderBgScanline, but sprite 0 needs sprite data (Set A).
    let mmap = this.nes.mmap;

    if (this.f_spriteSize === 0) {
      // 8x8 sprites.
      let tIndexAdd = this.f_spPatternTable === 0 ? 0 : 256;
      if (y <= scan && y + 8 > scan && x < 256) {
        t = mmap.getSpritePatternTile(sprTile + tIndexAdd);
        toffset = vertFlip ? 7 - (scan - y) : scan - y;
        toffset *= 8;
        return this._checkSpr0Pixels(t, toffset, x, horiFlip, scan, leftClip);
      }
    } else {
      // 8x16 sprites: tile index bit 0 selects pattern table.
      if (y <= scan && y + 16 > scan && x < 256) {
        toffset = vertFlip ? 15 - (scan - y) : scan - y;

        if (toffset < 8) {
          t = mmap.getSpritePatternTile(
            sprTile + (vertFlip ? 1 : 0) + ((sprTile & 1) !== 0 ? 255 : 0),
          );
        } else {
          t = mmap.getSpritePatternTile(
            sprTile + (vertFlip ? 0 : 1) + ((sprTile & 1) !== 0 ? 255 : 0),
          );
          toffset = vertFlip ? 15 - toffset : toffset - 8;
        }
        toffset *= 8;
        return this._checkSpr0Pixels(t, toffset, x, horiFlip, scan, leftClip);
      }
    }

    return false;
  }

  // Helper: scan 8 pixels of sprite 0's tile row for overlap with background.
  // Checks for non-transparent sprite pixel overlapping non-transparent BG pixel,
  // excluding x=255 and left-clipped pixels (x=0..7 when leftClip is true).
  _checkSpr0Pixels(tile, toffset, startX, horiFlip, scan, leftClip) {
    let bufferIndex = scan * 256 + startX;

    for (let px = 0; px < 8; px++) {
      let tileIdx = horiFlip ? 7 - px : px;
      let pixelX = startX + px;

      if (pixelX >= 0 && pixelX < 255) {
        // Skip left 8 pixels when clipping is enabled
        if (leftClip && pixelX < 8) {
          bufferIndex++;
          continue;
        }

        if (
          bufferIndex >= 0 &&
          bufferIndex < 61440 &&
          this.pixrendered[bufferIndex] > 0xff &&
          tile.pix[toffset + tileIdx] !== 0
        ) {
          this.spr0HitX = pixelX;
          this.spr0HitY = scan;
          return true;
        }
      }
      bufferIndex++;
    }
    return false;
  }

  // Pre-computes sprite 0 hit for the NEXT scanline by checking BG tile data
  // directly, without requiring a full BG render. This is called after
  // renderBgScanline advances the scroll counters (cntFV/cntVT/cntV) to the
  // next row's position. By detecting the hit one scanline early, the dot-by-
  // dot loop in step() can set STATUS_SPRITE0HIT at the correct PPU cycle
  // instead of one full scanline late.
  //
  // The approach: for each of sprite 0's 8 pixels, compute which BG tile
  // occupies that screen position using the scroll registers, then check if
  // both the sprite pixel and BG pixel are non-transparent.
  //
  // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
  _precomputeSprite0Hit(nextBufferScan) {
    if (nextBufferScan < 1 || nextBufferScan > 239) return false;
    if (!this.scanlineSprite0[nextBufferScan]) return false;
    if (this.scanlineSpriteCount[nextBufferScan] === 0) return false;

    // Read sprite 0 from secondary OAM for the next scanline.
    let oamBase = nextBufferScan * 32;
    let sprY = this.scanlineSecondaryOAM[oamBase + 0];
    let sprTile = this.scanlineSecondaryOAM[oamBase + 1];
    let sprAttr = this.scanlineSecondaryOAM[oamBase + 2];
    let sprX = this.scanlineSecondaryOAM[oamBase + 3];
    let y = sprY + 1; // +1 because sprite Y in OAM is display line - 1

    let vertFlip = (sprAttr >> 7) & 1;
    let horiFlip = (sprAttr >> 6) & 1;
    let leftClip = this.f_spClipping === 0 || this.f_bgClipping === 0;

    // Check if sprite 0 overlaps the next scanline.
    let spriteHeight = this.f_spriteSize === 0 ? 8 : 16;
    if (!(y <= nextBufferScan && y + spriteHeight > nextBufferScan))
      return false;
    if (sprX >= 256) return false;

    // Compute sprite tile row for this scanline.
    let sprRow = vertFlip
      ? spriteHeight - 1 - (nextBufferScan - y)
      : nextBufferScan - y;
    let sprTileObj, toffset;

    if (this.f_spriteSize === 0) {
      // 8x8 sprites.
      let tIndexAdd = this.f_spPatternTable === 0 ? 0 : 256;
      sprTileObj = this.ptTile[sprTile + tIndexAdd];
      toffset = sprRow * 8;
    } else {
      // 8x16 sprites: tile index bit 0 selects pattern table.
      let patternBase = (sprTile & 1) !== 0 ? 256 : 0;
      let baseTileIdx = sprTile & ~1;
      if (sprRow < 8) {
        sprTileObj =
          this.ptTile[baseTileIdx + patternBase + (vertFlip ? 1 : 0)];
        toffset = sprRow * 8;
      } else {
        sprTileObj =
          this.ptTile[baseTileIdx + patternBase + (vertFlip ? 0 : 1)];
        toffset = (sprRow - 8) * 8;
      }
    }
    if (!sprTileObj) return false;

    // BG vertical position: cntFV/cntVT/cntV have already been advanced to
    // the next row by renderBgScanline's scroll update.
    let bgFineY = this.cntFV;
    let bgCoarseY = this.cntVT;
    let bgNtV = this.cntV;
    let baseBgTile = this.regS === 0 ? 0 : 256;

    // Check each sprite pixel against the BG tile at that position.
    for (let px = 0; px < 8; px++) {
      let screenX = sprX + px;
      if (screenX >= 255) continue; // no hit at x=255
      if (leftClip && screenX < 8) continue;

      // Check sprite pixel non-transparent.
      let tileIdx = horiFlip ? 7 - px : px;
      if (sprTileObj.pix[toffset + tileIdx] === 0) continue;

      // Compute which BG tile covers this screen X using the horizontal
      // scroll registers (regHT/regH are reloaded at the start of each
      // visible scanline on real hardware).
      let tileOffset = (screenX + this.regFH) >> 3;
      let absCol = this.regHT + tileOffset;
      let bgNtH = this.regH;
      if (absCol >= 32) {
        absCol -= 32;
        bgNtH ^= 1; // toggle horizontal nametable
      }

      // Look up the BG tile from the nametable.
      let ntIdx = this.ntable1[(bgNtV << 1) + bgNtH];
      let bgTileIndex = this.nameTable[ntIdx].getTileIndex(absCol, bgCoarseY);
      let bgTile = this.ptTile[baseBgTile + bgTileIndex];
      if (!bgTile) continue;

      // Check BG pixel non-transparent at (fineX, fineY).
      let bgPixelX = (screenX + this.regFH) & 7;
      if (bgTile.pix[bgFineY * 8 + bgPixelX] !== 0) {
        // Hit found! Store in NES scanline coordinates for step() matching.
        // step() compares scanline - 21 against spr0HitY, where
        // scanline - 21 = bufferScan - 1, so we store nextBufferScan - 1.
        this.spr0HitX = screenX;
        this.spr0HitY = nextBufferScan - 1;
        return true;
      }
    }
    return false;
  }

  // This will write to PPU memory, and
  // update internally buffered data
  // appropriately.
  writeMem(address, value) {
    this.vramMem[address] = value;

    // Update internally buffered data:
    if (address < 0x2000) {
      this.vramMem[address] = value;
      this.patternWrite(address, value);
    } else if (address >= 0x2000 && address < 0x23c0) {
      this.nameTableWrite(this.ntable1[0], address - 0x2000, value);
    } else if (address >= 0x23c0 && address < 0x2400) {
      this.attribTableWrite(this.ntable1[0], address - 0x23c0, value);
    } else if (address >= 0x2400 && address < 0x27c0) {
      this.nameTableWrite(this.ntable1[1], address - 0x2400, value);
    } else if (address >= 0x27c0 && address < 0x2800) {
      this.attribTableWrite(this.ntable1[1], address - 0x27c0, value);
    } else if (address >= 0x2800 && address < 0x2bc0) {
      this.nameTableWrite(this.ntable1[2], address - 0x2800, value);
    } else if (address >= 0x2bc0 && address < 0x2c00) {
      this.attribTableWrite(this.ntable1[2], address - 0x2bc0, value);
    } else if (address >= 0x2c00 && address < 0x2fc0) {
      this.nameTableWrite(this.ntable1[3], address - 0x2c00, value);
    } else if (address >= 0x2fc0 && address < 0x3000) {
      this.attribTableWrite(this.ntable1[3], address - 0x2fc0, value);
    } else if (address >= 0x3f00 && address < 0x3f20) {
      this.updatePalettes();
    }
  }

  // Reads data from $3f00 to $f20
  // into the two buffered palettes.
  updatePalettes() {
    let i;

    for (i = 0; i < 16; i++) {
      if (this.f_dispType === 0) {
        this.imgPalette[i] = this.palTable.getEntry(
          this.vramMem[0x3f00 + i] & 63,
        );
      } else {
        this.imgPalette[i] = this.palTable.getEntry(
          this.vramMem[0x3f00 + i] & 0x30,
        );
      }
    }
    for (i = 0; i < 16; i++) {
      if (this.f_dispType === 0) {
        this.sprPalette[i] = this.palTable.getEntry(
          this.vramMem[0x3f10 + i] & 63,
        );
      } else {
        this.sprPalette[i] = this.palTable.getEntry(
          this.vramMem[0x3f10 + i] & 0x30,
        );
      }
    }
  }

  // Updates the internal pattern
  // table buffers with this new byte.
  // In vNES, there is a version of this with 4 arguments which isn't used.
  patternWrite(address, value) {
    let tileIndex = address >> 4;
    let leftOver = address & 15;
    if (leftOver < 8) {
      this.ptTile[tileIndex].setScanline(
        leftOver,
        value,
        this.vramMem[address + 8],
      );
    } else {
      this.ptTile[tileIndex].setScanline(
        leftOver - 8,
        this.vramMem[address - 8],
        value,
      );
    }
  }

  // Updates the internal name table buffers
  // with this new byte.
  nameTableWrite(index, address, value) {
    this.nameTable[index].tile[address] = value;

    // Update Sprite #0 hit:
    let bufferScan = this.scanline + 1 - 21;
    this.checkSprite0(bufferScan);
  }

  // Updates the internal pattern
  // table buffers with this new attribute
  // table byte.
  attribTableWrite(index, address, value) {
    this.nameTable[index].writeAttrib(address, value);
    // Also store the raw attribute byte in the tile array at offset 0x3C0
    // (= 960 = 30*32). On real hardware, when coarse Y is 30 or 31, the PPU's
    // nametable fetch address lands in the attribute table region and the raw
    // byte is used as a tile index. This is the "attributes as tiles" quirk.
    // See https://www.nesdev.org/wiki/PPU_scrolling
    this.nameTable[index].tile[0x3c0 + address] = value;
  }

  // Updates the internally buffered sprite
  // data with this new byte of info.
  spriteRamWriteUpdate(address, value) {
    let tIndex = address >> 2;

    if (tIndex === 0) {
      let bufferScan = this.scanline + 1 - 21;
      this.checkSprite0(bufferScan);
    }

    switch (address & 3) {
      case 0:
        // Y coordinate
        this.sprY[tIndex] = value;
        break;
      case 1:
        // Tile index
        this.sprTile[tIndex] = value;
        break;
      case 2:
        // Attributes
        this.vertFlip[tIndex] = (value >> 7) & 1;
        this.horiFlip[tIndex] = (value >> 6) & 1;
        this.bgPriority[tIndex] = (value >> 5) & 1;
        this.sprCol[tIndex] = (value & 3) << 2;
        break;
      case 3:
        // X coordinate
        this.sprX[tIndex] = value;
        break;
    }
  }

  isPixelWhite(x, y) {
    this.triggerRendering();
    return this.nes.ppu.buffer[(y << 8) + x] === 0xffffff;
  }

  toJSON() {
    let i;
    let state = toJSON(this);

    state.nameTable = [];
    for (i = 0; i < this.nameTable.length; i++) {
      state.nameTable[i] = this.nameTable[i].toJSON();
    }

    state.ptTile = [];
    for (i = 0; i < this.ptTile.length; i++) {
      state.ptTile[i] = this.ptTile[i].toJSON();
    }

    return state;
  }

  fromJSON(state) {
    let i;

    fromJSON(this, state);

    for (i = 0; i < this.nameTable.length; i++) {
      this.nameTable[i].fromJSON(state.nameTable[i]);
    }

    for (i = 0; i < this.ptTile.length; i++) {
      this.ptTile[i].fromJSON(state.ptTile[i]);
    }

    // Sprite data:
    for (i = 0; i < this.spriteMem.length; i++) {
      this.spriteRamWriteUpdate(i, this.spriteMem[i]);
    }
  }

  static JSON_PROPERTIES = [
    // Memory
    "vramMem",
    "spriteMem",
    // Counters
    "cntFV",
    "cntV",
    "cntH",
    "cntVT",
    "cntHT",
    // Registers
    "regFV",
    "regV",
    "regH",
    "regVT",
    "regHT",
    "regFH",
    "regS",
    // VRAM addr
    "vramAddress",
    "vramTmpAddress",
    // Control/Status registers
    "f_nmiOnVblank",
    "f_spriteSize",
    "f_bgPatternTable",
    "f_spPatternTable",
    "f_addrInc",
    "f_nTblAddress",
    "f_color",
    "f_spVisibility",
    "f_bgVisibility",
    "f_spClipping",
    "f_bgClipping",
    "f_dispType",
    // VRAM I/O
    "vramBufferedReadValue",
    "firstWrite",
    "openBusLatch",
    "openBusDecayFrames",
    // Mirroring
    "currentMirroring",
    "vramMirrorTable",
    "ntable1",
    // SPR-RAM I/O
    "sramAddress",
    // Sprites. Most sprite data is rebuilt from spriteMem
    "hitSpr0",
    // Secondary OAM: persistent hardware state (not cleared on pre-render)
    "secondaryOAM",
    "spritesFound",
    "sprite0InSecondary",
    // Palettes
    "sprPalette",
    "imgPalette",
    // Rendering progression
    "curX",
    "scanline",
    "lastRenderedScanline",
    "curNt",
    "scantile",
    // Used during rendering
    "attrib",
    "buffer",
    "bgbuffer",
    "pixrendered",
    // Misc
    "nmiOutput",
    "nmiSuppressed",
    "vblankPending",
    "dummyCycleToggle",
    "validTileData",
    "scanlineAlreadyRendered",
  ];
}

export default PPU;

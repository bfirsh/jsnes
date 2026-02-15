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

    // Sprite data:
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

        if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
          // Update counters:
          this.cntFV = this.regFV;
          this.cntV = this.regV;
          this.cntH = this.regH;
          this.cntVT = this.regVT;
          this.cntHT = this.regHT;

          if (this.f_bgVisibility === 1) {
            // Render dummy scanline:
            this.renderBgScanline(false, 0);
          }
        }

        if (this.f_bgVisibility === 1 && this.f_spVisibility === 1) {
          // Check sprite 0 hit for first scanline:
          this.checkSprite0(0);
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
          // Render normally:
          if (this.f_bgVisibility === 1) {
            if (!this.scanlineAlreadyRendered) {
              // update scroll:
              this.cntHT = this.regHT;
              this.cntH = this.regH;
              this.renderBgScanline(true, this.scanline + 1 - 21);
            }
            this.scanlineAlreadyRendered = false;

            // Check for sprite 0 (next scanline):
            if (!this.hitSpr0 && this.f_spVisibility === 1) {
              if (
                this.sprX[0] >= -7 &&
                this.sprX[0] < 256 &&
                this.sprY[0] + 1 <= this.scanline - 20 &&
                this.sprY[0] + 1 + (this.f_spriteSize === 0 ? 8 : 16) >=
                  this.scanline - 20
              ) {
                if (this.checkSprite0(this.scanline - 20)) {
                  this.hitSpr0 = true;
                }
              }
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
    // Set background color:
    let bgColor = 0;

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

    let buffer = this.buffer;
    let i;
    for (i = 0; i < 256 * 240; i++) {
      buffer[i] = bgColor;
    }
    let pixrendered = this.pixrendered;
    for (i = 0; i < pixrendered.length; i++) {
      pixrendered[i] = 65;
    }
  }

  endFrame() {
    let i, x, y;
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
        for (x = 0; x < 8; x++) {
          buffer[(y << 8) + x] = 0;
        }
      }
    }

    if (this.clipToTvSize) {
      // Clip right 8-pixels column too:
      for (y = 0; y < 240; y++) {
        for (x = 0; x < 8; x++) {
          buffer[(y << 8) + 255 - x] = 0;
        }
      }
    }

    // Clip top and bottom 8 pixels:
    if (this.clipToTvSize) {
      for (y = 0; y < 8; y++) {
        for (x = 0; x < 256; x++) {
          buffer[(y << 8) + x] = 0;
          buffer[((239 - y) << 8) + x] = 0;
        }
      }
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
  // On a false→true transition (rising edge), sets nmiPending on the CPU.
  // On a true→false transition (falling edge), cancels any pending NMI.
  // This is the core NMI edge-detection mechanism matching real hardware.
  // See https://www.nesdev.org/wiki/NMI
  _updateNmiOutput() {
    let vblank = (this.nes.cpu.mem[0x2002] & 0x80) !== 0;
    let newOutput = this.f_nmiOnVblank !== 0 && vblank;
    if (newOutput && !this.nmiOutput) {
      // Rising edge: set nmiRaised. The CPU promotes this to nmiPending
      // at the start of the next emulate() call, giving the 1-instruction
      // delay that matches real 6502 NMI detection timing. The instruction
      // following the trigger always executes before NMI is serviced.
      // See https://www.nesdev.org/wiki/NMI
      this.nes.cpu.nmiRaised = true;
    } else if (!newOutput && this.nmiOutput) {
      // Falling edge: cancel any raised or pending NMI
      this.nes.cpu.nmiRaised = false;
      this.nes.cpu.nmiPending = false;
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
  // Read from SPR-RAM (Sprite RAM).
  // The address should be set first.
  sramLoad() {
    /*short tmp = sprMem.load(sramAddress);
        sramAddress++; // Increment address
        sramAddress%=0x100;
        return tmp;*/
    return this.spriteMem[this.sramAddress];
  }

  // CPU Register $2004 (W):
  // Write to SPR-RAM (Sprite RAM).
  // The address should be set first.
  sramWrite(value) {
    this.spriteMem[this.sramAddress] = value;
    this.spriteRamWriteUpdate(this.sramAddress, value);
    this.sramAddress++; // Increment address
    this.sramAddress %= 0x100;
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

      this.checkSprite0(this.scanline - 20);
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

      // Increment by either 1 or 32, depending on d2 of Control Register 1:
      this.vramAddress += this.f_addrInc === 1 ? 32 : 1;

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

    // Increment by either 1 or 32, depending on d2 of Control Register 1:
    this.vramAddress += this.f_addrInc === 1 ? 32 : 1;

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

    // Increment by either 1 or 32, depending on d2 of Control Register 1:
    this.vramAddress += this.f_addrInc === 1 ? 32 : 1;
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

    this.nes.cpu.haltCycles(513);
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

    this.validTileData = false;
  }

  renderBgScanline(bgbuffer, scan) {
    let baseTile = this.regS === 0 ? 0 : 256;
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

      let t, tpix, att, col;

      for (let tile = 0; tile < 32; tile++) {
        if (scan >= 0) {
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
            t =
              ptTile[
                baseTile +
                  nameTable[this.curNt].getTileIndex(this.cntHT, this.cntVT)
              ];
            if (typeof t === "undefined") {
              continue;
            }
            tpix = t.pix;
            att = nameTable[this.curNt].getAttrib(this.cntHT, this.cntVT);
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
        }

        // Increase Horizontal Tile Counter:
        if (++this.cntHT === 32) {
          this.cntHT = 0;
          this.cntH++;
          this.cntH %= 2;
          this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
        }
      }

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

  renderSpritesPartially(startscan, scancount, bgPri) {
    if (this.f_spVisibility === 1) {
      for (let i = 0; i < 64; i++) {
        if (
          this.bgPriority[i] === bgPri &&
          this.sprX[i] >= 0 &&
          this.sprX[i] < 256 &&
          this.sprY[i] + 8 >= startscan &&
          this.sprY[i] < startscan + scancount
        ) {
          // Show sprite.
          if (this.f_spriteSize === 0) {
            // 8x8 sprites

            this.srcy1 = 0;
            this.srcy2 = 8;

            if (this.sprY[i] < startscan) {
              this.srcy1 = startscan - this.sprY[i] - 1;
            }

            if (this.sprY[i] + 8 > startscan + scancount) {
              this.srcy2 = startscan + scancount - this.sprY[i] + 1;
            }

            if (this.f_spPatternTable === 0) {
              this.ptTile[this.sprTile[i]].render(
                this.buffer,
                0,
                this.srcy1,
                8,
                this.srcy2,
                this.sprX[i],
                this.sprY[i] + 1,
                this.sprCol[i],
                this.sprPalette,
                this.horiFlip[i],
                this.vertFlip[i],
                i,
                this.pixrendered,
              );
            } else {
              this.ptTile[this.sprTile[i] + 256].render(
                this.buffer,
                0,
                this.srcy1,
                8,
                this.srcy2,
                this.sprX[i],
                this.sprY[i] + 1,
                this.sprCol[i],
                this.sprPalette,
                this.horiFlip[i],
                this.vertFlip[i],
                i,
                this.pixrendered,
              );
            }
          } else {
            // 8x16 sprites
            let top = this.sprTile[i];
            if ((top & 1) !== 0) {
              top = this.sprTile[i] - 1 + 256;
            }

            let srcy1 = 0;
            let srcy2 = 8;

            if (this.sprY[i] < startscan) {
              srcy1 = startscan - this.sprY[i] - 1;
            }

            if (this.sprY[i] + 8 > startscan + scancount) {
              srcy2 = startscan + scancount - this.sprY[i];
            }

            this.ptTile[top + (this.vertFlip[i] ? 1 : 0)].render(
              this.buffer,
              0,
              srcy1,
              8,
              srcy2,
              this.sprX[i],
              this.sprY[i] + 1,
              this.sprCol[i],
              this.sprPalette,
              this.horiFlip[i],
              this.vertFlip[i],
              i,
              this.pixrendered,
            );

            srcy1 = 0;
            srcy2 = 8;

            if (this.sprY[i] + 8 < startscan) {
              srcy1 = startscan - (this.sprY[i] + 8 + 1);
            }

            if (this.sprY[i] + 16 > startscan + scancount) {
              srcy2 = startscan + scancount - (this.sprY[i] + 8);
            }

            this.ptTile[top + (this.vertFlip[i] ? 0 : 1)].render(
              this.buffer,
              0,
              srcy1,
              8,
              srcy2,
              this.sprX[i],
              this.sprY[i] + 1 + 8,
              this.sprCol[i],
              this.sprPalette,
              this.horiFlip[i],
              this.vertFlip[i],
              i,
              this.pixrendered,
            );
          }
        }
      }
    }
  }

  checkSprite0(scan) {
    this.spr0HitX = -1;
    this.spr0HitY = -1;

    let toffset;
    let tIndexAdd = this.f_spPatternTable === 0 ? 0 : 256;
    let x, y, t, i;
    let bufferIndex;

    x = this.sprX[0];
    y = this.sprY[0] + 1;

    if (this.f_spriteSize === 0) {
      // 8x8 sprites.

      // Check range:
      if (y <= scan && y + 8 > scan && x >= -7 && x < 256) {
        // Sprite is in range.
        // Draw scanline:
        t = this.ptTile[this.sprTile[0] + tIndexAdd];

        if (this.vertFlip[0]) {
          toffset = 7 - (scan - y);
        } else {
          toffset = scan - y;
        }
        toffset *= 8;

        bufferIndex = scan * 256 + x;
        if (this.horiFlip[0]) {
          for (i = 7; i >= 0; i--) {
            if (x >= 0 && x < 256) {
              if (
                bufferIndex >= 0 &&
                bufferIndex < 61440 &&
                this.pixrendered[bufferIndex] !== 0
              ) {
                if (t.pix[toffset + i] !== 0) {
                  this.spr0HitX = bufferIndex % 256;
                  this.spr0HitY = scan;
                  return true;
                }
              }
            }
            x++;
            bufferIndex++;
          }
        } else {
          for (i = 0; i < 8; i++) {
            if (x >= 0 && x < 256) {
              if (
                bufferIndex >= 0 &&
                bufferIndex < 61440 &&
                this.pixrendered[bufferIndex] !== 0
              ) {
                if (t.pix[toffset + i] !== 0) {
                  this.spr0HitX = bufferIndex % 256;
                  this.spr0HitY = scan;
                  return true;
                }
              }
            }
            x++;
            bufferIndex++;
          }
        }
      }
    } else {
      // 8x16 sprites:

      // Check range:
      if (y <= scan && y + 16 > scan && x >= -7 && x < 256) {
        // Sprite is in range.
        // Draw scanline:

        if (this.vertFlip[0]) {
          toffset = 15 - (scan - y);
        } else {
          toffset = scan - y;
        }

        if (toffset < 8) {
          // first half of sprite.
          t =
            this.ptTile[
              this.sprTile[0] +
                (this.vertFlip[0] ? 1 : 0) +
                ((this.sprTile[0] & 1) !== 0 ? 255 : 0)
            ];
        } else {
          // second half of sprite.
          t =
            this.ptTile[
              this.sprTile[0] +
                (this.vertFlip[0] ? 0 : 1) +
                ((this.sprTile[0] & 1) !== 0 ? 255 : 0)
            ];
          if (this.vertFlip[0]) {
            toffset = 15 - toffset;
          } else {
            toffset -= 8;
          }
        }
        toffset *= 8;

        bufferIndex = scan * 256 + x;
        if (this.horiFlip[0]) {
          for (i = 7; i >= 0; i--) {
            if (x >= 0 && x < 256) {
              if (
                bufferIndex >= 0 &&
                bufferIndex < 61440 &&
                this.pixrendered[bufferIndex] !== 0
              ) {
                if (t.pix[toffset + i] !== 0) {
                  this.spr0HitX = bufferIndex % 256;
                  this.spr0HitY = scan;
                  return true;
                }
              }
            }
            x++;
            bufferIndex++;
          }
        } else {
          for (i = 0; i < 8; i++) {
            if (x >= 0 && x < 256) {
              if (
                bufferIndex >= 0 &&
                bufferIndex < 61440 &&
                this.pixrendered[bufferIndex] !== 0
              ) {
                if (t.pix[toffset + i] !== 0) {
                  this.spr0HitX = bufferIndex % 256;
                  this.spr0HitY = scan;
                  return true;
                }
              }
            }
            x++;
            bufferIndex++;
          }
        }
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
          this.vramMem[0x3f00 + i] & 32,
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
          this.vramMem[0x3f10 + i] & 32,
        );
      }
    }
  }

  // Updates the internal pattern
  // table buffers with this new byte.
  // In vNES, there is a version of this with 4 arguments which isn't used.
  patternWrite(address, value) {
    let tileIndex = Math.floor(address / 16);
    let leftOver = address % 16;
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
    //updateSpr0Hit();
    this.checkSprite0(this.scanline - 20);
  }

  // Updates the internal pattern
  // table buffers with this new attribute
  // table byte.
  attribTableWrite(index, address, value) {
    this.nameTable[index].writeAttrib(address, value);
  }

  // Updates the internally buffered sprite
  // data with this new byte of info.
  spriteRamWriteUpdate(address, value) {
    let tIndex = Math.floor(address / 4);

    if (tIndex === 0) {
      //updateSpr0Hit();
      this.checkSprite0(this.scanline - 20);
    }

    if (address % 4 === 0) {
      // Y coordinate
      this.sprY[tIndex] = value;
    } else if (address % 4 === 1) {
      // Tile index
      this.sprTile[tIndex] = value;
    } else if (address % 4 === 2) {
      // Attributes
      this.vertFlip[tIndex] = (value >> 7) & 1;
      this.horiFlip[tIndex] = (value >> 6) & 1;
      this.bgPriority[tIndex] = (value >> 5) & 1;
      this.sprCol[tIndex] = (value & 3) << 2;
    } else if (address % 4 === 3) {
      // X coordinate
      this.sprX[tIndex] = value;
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

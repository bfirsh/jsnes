import Tile from "../tile.js";
import { fromJSON, toJSON } from "../utils.js";
import NameTable from "./nametable.js";
import PaletteTable from "./palette-table.js";

// ============================================================================
// The PPU (Picture Processing Unit, Ricoh 2C02)
// ============================================================================
//
// The PPU generates the video signal. It draws a 256x240 picture, one pixel
// per PPU clock cycle ("dot"), and runs at exactly 3x the CPU's clock. A
// frame is 262 scanlines of 341 dots each:
//
//   Scanlines 0-239   Visible picture. Dots 1-256 output pixels.
//   Scanline  240     Post-render (idle).
//   Scanlines 241-260 Vertical blanking ("VBlank"). The VBlank flag is set
//                     (and an NMI can fire) at dot 1 of scanline 241. This
//                     is when games safely update VRAM.
//   Scanline  261     Pre-render. Like a visible line (it does all the same
//                     memory fetches), but outputs no pixels. Flags are
//                     cleared at dot 1.
//
// This emulator is *dot-stepped*: the PPU's internal pipeline runs one dot
// at a time (_tick(), or _renderSpan() for runs of visible pixels), doing
// the same memory fetches and register updates the real chip does on each
// dot. The CPU owes the PPU 3 dots per CPU cycle and the PPU is kept exactly
// in step with it (see catchUp()), so mid-frame register writes take effect
// on exactly the right pixel.
//
// Background rendering (per visible/pre-render scanline):
//   Every 8 dots, the PPU fetches one tile: nametable byte (which tile),
//   attribute byte (which palette), and the two "bit planes" of the tile's
//   pattern. These are loaded into shift registers that shift once per dot;
//   each dot's background pixel comes from the top bits of the shifters.
//   The "v" register is the current VRAM address and doubles as the scroll
//   position: it's incremented horizontally after each tile and vertically
//   at the end of each line.
//
// Sprite rendering:
//   During dots 1-256 of each visible line, the PPU scans OAM (sprite
//   memory) to find up to 8 sprites on the *next* line, copying them into a
//   32-byte "secondary OAM". During dots 257-320 it fetches the pattern data
//   for those 8 sprites into 8 sets of sprite shift registers, which output
//   their pixels on the next line once their X counter reaches zero.
//
// Lots of games and test ROMs rely on quirks of this pipeline (mid-frame
// scroll changes, sprite 0 hit timing, sprite overflow bugs, etc.), which
// all fall out of emulating it faithfully.
//
// Key references:
//   https://www.nesdev.org/wiki/PPU_rendering
//   https://www.nesdev.org/wiki/PPU_scrolling
//   https://www.nesdev.org/wiki/PPU_sprite_evaluation
//   https://www.nesdev.org/wiki/PPU_frame_timing

// Dots between a $2001 write and the rendering pipeline seeing the new
// "rendering enabled" state. On real hardware the delay is a few dots and
// depends on the CPU/PPU clock alignment.
const MASK_DELAY = 2;

class PPU {
  // Status flags (bit numbers in $2002):
  STATUS_VRAMWRITE = 4;
  STATUS_SLSPRITECOUNT = 5;
  STATUS_SPRITE0HIT = 6;
  STATUS_VBLANK = 7;

  constructor(nes) {
    this.nes = nes;

    // Rendering options:
    this.clipToTvSize = true;

    let i;

    // --- Memory ---
    // PPU address space, $0000-$3FFF (plus space above for mirroring
    // tables). Pattern tables ($0000-$1FFF) are copied in by the mapper when
    // it switches CHR banks; nametables ($2000-$2FFF) and palette RAM
    // ($3F00-$3F1F) live here too. vramMirrorTable maps every address to the
    // physical location that backs it.
    this.vramMem = new Uint8Array(0x8000);
    // OAM ("Object Attribute Memory"): 64 sprites x 4 bytes (Y, tile,
    // attributes, X).
    this.spriteMem = new Uint8Array(0x100);
    // Secondary OAM: the up-to-8 sprites found for the next scanline.
    this.secondaryOAM = new Uint8Array(32).fill(0xff);

    this.vramMirrorTable = new Uint16Array(0x8000);
    for (i = 0; i < 0x8000; i++) {
      this.vramMirrorTable[i] = i;
    }
    this.currentMirroring = -1;
    // Which of the (up to) 4 physical nametables each logical nametable
    // uses. Kept for mappers that manage mirroring themselves.
    this.ntable1 = [0, 1, 2, 3];
    this.nameTable = new Array(4);
    for (i = 0; i < 4; i++) {
      this.nameTable[i] = new NameTable(32, 32, `Nt${i}`);
    }

    // Pre-decoded pattern tiles. The renderer reads pattern bytes straight
    // from vramMem, but mappers still maintain this cache (and MMC5's
    // extended attribute mode returns tiles from it), so keep it up to date.
    this.ptTile = new Array(512);
    for (i = 0; i < 512; i++) {
      this.ptTile[i] = new Tile();
    }

    // --- Registers ---
    // "Loopy" registers (named after the person who documented them):
    //   v: current VRAM address (15 bits). During rendering, its bits are
    //      yyy NN YYYYY XXXXX = fine Y, nametable, coarse Y, coarse X.
    //   t: temporary VRAM address; the "scroll position" written by
    //      $2000/$2005/$2006, copied into v at certain times.
    //   x: fine X scroll (3 bits).
    //   w: first/second write toggle shared by $2005 and $2006.
    // See https://www.nesdev.org/wiki/PPU_scrolling
    this.vramAddress = 0; // v
    this.vramTmpAddress = 0; // t
    this.fineX = 0; // x
    this.firstWrite = true; // !w
    this.vramBufferedReadValue = 0; // $2007 read buffer
    this.sramAddress = 0; // OAMADDR ($2003)

    // PPU has its own internal I/O bus. All PPU register writes update this
    // latch. Reading write-only registers ($2000,$2001,$2003,$2005,$2006)
    // returns this value. $2002 uses bits 4-0 from this latch.
    // On real hardware the latch decays to 0 after ~600ms.
    this.openBusLatch = 0;
    this.openBusDecayFrames = 0;

    // $2000 (PPUCTRL)
    this.f_nmiOnVblank = 0; // NMI on VBlank. 0=disable, 1=enable
    this.f_spriteSize = 0; // Sprite size. 0=8x8, 1=8x16
    this.f_bgPatternTable = 0; // Background pattern table. 0=$0000, 1=$1000
    this.f_spPatternTable = 0; // Sprite pattern table (8x8). 0=$0000, 1=$1000
    this.f_addrInc = 0; // $2007 address increment. 0=1, 1=32
    this.f_nTblAddress = 0; // Base nametable (also stored in t)

    // $2001 (PPUMASK)
    this.f_color = 0; // Color emphasis bits
    this.f_spVisibility = 0; // Show sprites
    this.f_bgVisibility = 0; // Show background
    this.f_spClipping = 0; // Show sprites in leftmost 8 pixels
    this.f_bgClipping = 0; // Show background in leftmost 8 pixels
    this.f_dispType = 0; // Greyscale

    // $2002 (PPUSTATUS) flags
    this.vblankFlag = 0;
    this.sprite0HitFlag = 0;
    this.spriteOverflowFlag = 0;

    // NMI output line (vblankFlag AND f_nmiOnVblank). The CPU samples it.
    this.nmiOutput = false;
    // nmiOutput at the point in the current CPU cycle where the CPU samples
    // it (see runCycleExact()).
    this.nmiAtPoll = false;

    // Catch-up state (see catchUp()): dots the CPU has asked for, dots
    // actually run, and the dot of the next event the CPU could notice.
    this.dotTarget = 0;
    this.dotsRun = 0;
    this.nextEventDot = 0;
    // Set when $2002 is read on the dot just before VBlank would be set,
    // which prevents the flag being set (and the NMI) for that frame.
    this.nmiSuppressed = false;
    // Set when VBlank starts; tells the frame loop the frame is complete.
    this.frameEnded = false;

    // --- Timing ---
    // Current position: line 0-261 and dot 0-340 (the dot that the next
    // tick will process). We start in VBlank, just after it began.
    this.line = 241;
    this.dot = 2;
    // Old-style scanline number (0 = first VBlank line, 20 = pre-render,
    // 21-260 = visible lines 0-239, 261 = post-render), which mappers use.
    this.scanline = 0;
    this.oddFrame = false;

    // Whether the rendering pipeline is running (background or sprites
    // enabled), as seen by the pipeline after the $2001 write delay.
    this.renderingOn = false;
    this.maskDelay = 0;

    // --- Background pipeline ---
    this.bgShiftLo = 0; // 16-bit pattern shift registers
    this.bgShiftHi = 0;
    this.attrShiftLo = 0; // 8-bit attribute (palette) shift registers
    this.attrShiftHi = 0;
    this.attrLatchLo = 0; // Serial inputs for the attribute shifters
    this.attrLatchHi = 0;
    this.ntByte = 0; // Latches for the tile being fetched
    this.atBits = 0;
    this.ptLo = 0;
    this.ptHi = 0;

    // --- Sprite evaluation ---
    this.secIdx = 0; // Secondary OAM address (0-31)
    this.secFull = false;
    this.oamLatch = 0; // Byte read from OAM on the previous (odd) dot
    this.evalDone = false; // All of OAM has been scanned
    this.evalOvfStep = 0; // Progress through a sprite in overflow mode
    this.sprite0Next = false; // Sprite 0 found for the next line
    this.sprite0Line = false; // Sprite 0 is in slot 0 on this line
    // OAM corruption: see _renderingDisabled().
    this.oamCorruptPending = false;
    this.oamCorruptRow = 0;

    // --- Sprite output units (8 slots) ---
    this.sprCount = 0; // Slots (from 0) that may output pixels this line
    this.sprLo = new Uint8Array(8); // Pattern shift registers
    this.sprHi = new Uint8Array(8);
    this.sprAttr = new Uint8Array(8);
    this.sprX = new Uint8Array(8); // X down-counters
    this.sprLatchX = new Uint8Array(8); // X positions read during fetch
    this.sprFetchCount = 0; // Slots fetched for the next line
    // Odd-frame quirk, see the end of _tick().
    this.spriteSkipGlitch = false;
    // Precomputed sprite pixels for one line; see _buildSpriteLine().
    this.sprLine = new Uint16Array(256);
    this.sprLineValid = false;
    this.sprLineFor = -1;

    // --- Output ---
    this.buffer = new Uint32Array(256 * 240);
    // RGB color for each of the 32 palette RAM entries.
    this.palColors = new Uint32Array(32);

    this.palTable = new PaletteTable();
    this.palTable.loadNTSCPalette();

    this.updateControlReg1(0);
    this.updateControlReg2(0);
  }

  // ==========================================================================
  // Memory mapping
  // ==========================================================================

  // Sets nametable mirroring.
  setMirroring(mirroring) {
    if (mirroring === this.currentMirroring) {
      return;
    }

    this.currentMirroring = mirroring;

    // Remove mirroring:
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
      this.ntable1[0] = 0;
      this.ntable1[1] = 0;
      this.ntable1[2] = 1;
      this.ntable1[3] = 1;
      this.defineMirrorRegion(0x2400, 0x2000, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2800, 0x400);
    } else if (mirroring === this.nes.rom.VERTICAL_MIRRORING) {
      this.ntable1[0] = 0;
      this.ntable1[1] = 1;
      this.ntable1[2] = 0;
      this.ntable1[3] = 1;
      this.defineMirrorRegion(0x2800, 0x2000, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2400, 0x400);
    } else if (mirroring === this.nes.rom.SINGLESCREEN_MIRRORING) {
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
      this.defineMirrorRegion(0x2000, 0x2400, 0x400);
      this.defineMirrorRegion(0x2800, 0x2400, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2400, 0x400);
    } else {
      // Four-screen mirroring.
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

  // Reads from PPU memory, taking mirroring into account.
  mirroredLoad(address) {
    return this.vramMem[this.vramMirrorTable[address]];
  }

  // Writes to PPU memory, taking mirroring into account.
  mirroredWrite(address, value) {
    if (address >= 0x3f00 && address < 0x3f20) {
      // Palette RAM. The backdrop entries of the sprite palettes
      // ($3F10/$3F14/$3F18/$3F1C) are mirrors of the background ones.
      if ((address & 0x03) === 0) {
        this.writeMem(address & 0x3f0f, value);
        this.writeMem((address & 0x3f0f) | 0x10, value);
      } else {
        this.writeMem(address, value);
      }
    } else {
      this.writeMem(this.vramMirrorTable[address], value);
    }
  }

  // Writes a byte at a physical PPU memory address.
  writeMem(address, value) {
    this.vramMem[address] = value;
    if (address < 0x2000) {
      this.patternWrite(address, value);
    } else if (address >= 0x3f00 && address < 0x3f20) {
      this._updatePaletteColor(address & 0x1f);
    }
  }

  // Keeps the pre-decoded tile cache in sync with CHR RAM writes.
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

  // The old renderer drew lazily and needed to be told before anything
  // that affects rendering changed. This one renders as it goes, so there's
  // nothing to do; kept because mappers call it.
  triggerRendering() {}

  // ==========================================================================
  // Palette
  // ==========================================================================

  _updatePaletteColor(index) {
    let value = this.vramMem[0x3f00 + index] & 0x3f;
    if (this.f_dispType !== 0) {
      // Greyscale: only keep the brightness bits.
      value &= 0x30;
    }
    this.palColors[index] = this.palTable.getEntry(value);
  }

  updatePalettes() {
    for (let i = 0; i < 32; i++) {
      this._updatePaletteColor(i);
    }
  }

  // ==========================================================================
  // CPU-facing registers ($2000-$2007)
  // ==========================================================================

  // $2000 (PPUCTRL) write.
  updateControlReg1(value) {
    this.f_nmiOnVblank = (value >> 7) & 1;
    this.f_spriteSize = (value >> 5) & 1;
    this.f_bgPatternTable = (value >> 4) & 1;
    this.f_spPatternTable = (value >> 3) & 1;
    this.f_addrInc = (value >> 2) & 1;
    this.f_nTblAddress = value & 3;
    // The nametable select bits go into t.
    this.vramTmpAddress = (this.vramTmpAddress & 0x73ff) | ((value & 3) << 10);
    // Enabling NMI while the VBlank flag is set causes an NMI.
    this._updateNmiOutput();
  }

  // $2001 (PPUMASK) write.
  updateControlReg2(value) {
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

    // The rendering pipeline notices the change a couple of dots later.
    if (MASK_DELAY === 0) {
      this._applyRenderingEnable();
    } else {
      this.maskDelay = MASK_DELAY;
    }
  }

  // Update the pipeline's "rendering enabled" state from PPUMASK.
  _applyRenderingEnable() {
    const on = this.f_bgVisibility === 1 || this.f_spVisibility === 1;
    if (this.renderingOn && !on) {
      this._materializeSprites();
      this._renderingDisabled();
    }
    this.renderingOn = on;
  }

  // NMI output = VBlank flag AND NMI enable. The CPU samples this line every
  // cycle and fires an NMI on its rising edge. See https://www.nesdev.org/wiki/NMI
  _updateNmiOutput() {
    this.nmiOutput = this.f_nmiOnVblank !== 0 && this.vblankFlag !== 0;
  }

  // Sets one of the $2002 status flags (kept for compatibility).
  setStatusFlag(flag, value) {
    const v = value ? 1 : 0;
    if (flag === this.STATUS_VBLANK) {
      this.vblankFlag = v;
      this._updateNmiOutput();
    } else if (flag === this.STATUS_SPRITE0HIT) {
      this.sprite0HitFlag = v;
    } else if (flag === this.STATUS_SLSPRITECOUNT) {
      this.spriteOverflowFlag = v;
    }
  }

  // $2002 (PPUSTATUS) read.
  readStatusRegister() {
    // Reading $2002 on the dot just before VBlank would be set returns the
    // flag clear and prevents it from being set this frame (so no NMI).
    // See https://www.nesdev.org/wiki/PPU_frame_timing#VBL_Flag_Timing
    if (this.line === 241 && this.dot === 1) {
      this.nmiSuppressed = true;
    }

    // Bits 7-5 are the status flags; bits 4-0 are PPU open bus.
    let value =
      (this.vblankFlag << 7) |
      (this.sprite0HitFlag << 6) |
      (this.spriteOverflowFlag << 5) |
      (this.openBusLatch & 0x1f);

    // Reading clears the VBlank flag and the $2005/$2006 write toggle.
    this.vblankFlag = 0;
    this._updateNmiOutput();
    this.firstWrite = true;

    this.openBusLatch = value;
    this.openBusDecayFrames = 36; // ~600ms at 60fps
    return value;
  }

  // $2003 (OAMADDR) write.
  writeSRAMAddress(address) {
    this.sramAddress = address;
  }

  // True on the lines where the rendering pipeline is active (the visible
  // lines and the pre-render line) and rendering is enabled.
  _isRenderingLine() {
    return this.renderingOn && (this.line < 240 || this.line === 261);
  }

  // $2004 (OAMDATA) read.
  // While rendering, $2004 returns whatever the sprite logic currently has on
  // its internal OAM data bus, rather than OAM[OAMADDR]:
  //   dots 1-64: secondary OAM is being cleared, so $FF
  //   dots 65-256: the OAM byte at the evaluation's current address
  //   dots 257-320: the secondary OAM byte being fetched for sprites
  // See https://www.nesdev.org/wiki/PPU_registers#OAMDATA
  sramLoad() {
    if (this._isRenderingLine()) {
      const dot = this.dot;
      if (dot >= 1 && dot <= 64) {
        return 0xff;
      } else if (dot >= 257 && dot <= 320) {
        return this.secondaryOAM[this.secIdx & 0x1f];
      } else if (dot === 0 || dot > 320) {
        return this.secondaryOAM[0];
      }
    }
    return this.spriteMem[this.sramAddress];
  }

  // $2004 (OAMDATA) write.
  sramWrite(value) {
    if (this._isRenderingLine()) {
      // During rendering, writes don't go to OAM; instead they bump the OAM
      // address the way sprite evaluation would (+4, aligned).
      this.sramAddress = (this.sramAddress + 4) & 0xfc;
      return;
    }
    // Bits 2-4 of each sprite's attribute byte don't exist in OAM; they
    // always read back as 0.
    if ((this.sramAddress & 3) === 2) {
      value &= 0xe3;
    }
    this.spriteMem[this.sramAddress] = value;
    this.sramAddress = (this.sramAddress + 1) & 0xff;
  }

  // $2005 (PPUSCROLL) write.
  scrollWrite(value) {
    if (this.firstWrite) {
      // X scroll: coarse X into t, fine X into x.
      this.vramTmpAddress = (this.vramTmpAddress & 0x7fe0) | (value >> 3);
      this.fineX = value & 7;
    } else {
      // Y scroll: coarse Y and fine Y into t.
      this.vramTmpAddress =
        (this.vramTmpAddress & 0x0c1f) |
        ((value & 0xf8) << 2) |
        ((value & 7) << 12);
    }
    this.firstWrite = !this.firstWrite;
  }

  // $2006 (PPUADDR) write.
  writeVRAMAddress(value) {
    if (this.firstWrite) {
      // High 6 bits of the address. Bit 14 of t is cleared.
      this.vramTmpAddress =
        (this.vramTmpAddress & 0x00ff) | ((value & 0x3f) << 8);
    } else {
      this.vramTmpAddress = (this.vramTmpAddress & 0x7f00) | value;
      this.vramAddress = this.vramTmpAddress;
      if (this.vramAddress < 0x2000) {
        this.nes.mmap.latchAccess(this.vramAddress);
      }
    }
    this.firstWrite = !this.firstWrite;
  }

  // $2007 (PPUDATA) read.
  vramLoad() {
    const address = this.vramAddress & 0x3fff;
    let value;
    if (address <= 0x3eff) {
      // Reads are delayed by one: return the buffer, then refill it.
      value = this.vramBufferedReadValue;
      if (address < 0x2000) {
        this.vramBufferedReadValue = this.vramMem[address];
        this.nes.mmap.latchAccess(address);
      } else {
        this.vramBufferedReadValue = this.mirroredLoad(address);
      }
    } else {
      // Palette RAM is returned directly (6 bits, the top 2 bits are PPU
      // open bus), but the buffer is filled with the nametable byte
      // "underneath" the palette.
      let palIdx = address & 0x1f;
      if ((palIdx & 0x13) === 0x10) {
        palIdx &= 0x0f; // sprite backdrop entries mirror the BG ones
      }
      value =
        (this.vramMem[0x3f00 + palIdx] & 0x3f) | (this.openBusLatch & 0xc0);
      this.vramBufferedReadValue = this.mirroredLoad(address & 0x2fff);
    }
    this._incrementVramAddress();
    return value;
  }

  // $2007 (PPUDATA) write.
  vramWrite(value) {
    const address = this.vramAddress & 0x3fff;
    if (address >= 0x2000) {
      this.mirroredWrite(address, value);
    } else {
      // Pattern table: writable only if the cartridge has CHR RAM here.
      if (this.nes.mmap.canWriteChr(address)) {
        this.writeMem(address, value);
      }
      this.nes.mmap.latchAccess(address);
    }
    this._incrementVramAddress();
  }

  // Advance v after a $2007 access. Outside rendering, by 1 or 32. During
  // rendering, v is being used as the scroll position, and the access
  // triggers both a coarse X and a Y increment instead.
  // See https://www.nesdev.org/wiki/PPU_scrolling#$2007_reads_and_writes
  _incrementVramAddress() {
    if (this._isRenderingLine()) {
      this._incCoarseX();
      this._incY();
    } else {
      this.vramAddress =
        (this.vramAddress + (this.f_addrInc === 1 ? 32 : 1)) & 0x7fff;
    }
  }

  // ==========================================================================
  // Scrolling helpers (operate on v)
  // ==========================================================================

  _incCoarseX() {
    let v = this.vramAddress;
    if ((v & 0x001f) === 31) {
      v = (v & ~0x001f) ^ 0x0400; // wrap and switch horizontal nametable
    } else {
      v++;
    }
    this.vramAddress = v;
  }

  _incY() {
    let v = this.vramAddress;
    if ((v & 0x7000) !== 0x7000) {
      v += 0x1000; // fine Y
    } else {
      v &= ~0x7000;
      let y = (v & 0x03e0) >> 5;
      if (y === 29) {
        y = 0;
        v ^= 0x0800; // switch vertical nametable
      } else if (y === 31) {
        y = 0; // coarse Y 30/31 are the attribute table; wrap without switching
      } else {
        y++;
      }
      v = (v & ~0x03e0) | (y << 5);
    }
    this.vramAddress = v;
  }

  // ==========================================================================
  // The dot clock
  // ==========================================================================

  // --- Catch-up ---
  //
  // The CPU owes the PPU 3 dots per CPU cycle (dotTarget counts them), but
  // the PPU doesn't run them straight away. Running the PPU in batches is
  // much faster than interleaving it with the CPU one cycle at a time, and
  // gives the same result as long as the batches are run before anything
  // looks at or changes the PPU's state. So:
  //   - Before the CPU accesses a PPU register or the cartridge, it calls
  //     catchUp() to run all the dots owed so far.
  //   - The PPU works out when its next "event" is: something the CPU
  //     would notice without accessing a register (the NMI line changing
  //     at the start/end of VBlank, the mapper's scanline counter being
  //     clocked, the end of the frame). On the CPU cycle containing that
  //     dot, runCycleExact() runs the PPU in step with the CPU.
  // See https://www.nesdev.org/wiki/Catch-up

  // Run all the dots owed by the CPU.
  catchUp() {
    const target = this.dotTarget;
    while (this.dotsRun < target) {
      const dot = this.dot;
      if (
        this.line < 240 &&
        dot >= 1 &&
        dot <= 256 &&
        this.renderingOn &&
        this.maskDelay === 0 &&
        !this.oamCorruptPending
      ) {
        // Fast path: a run of pixels on a visible line.
        let end = dot + (target - this.dotsRun);
        if (end > 257) end = 257;
        this._renderSpan(this.line, dot, end);
        this.dotsRun += end - dot;
        this.dot = end;
      } else {
        this._tick();
        this.dotsRun++;
      }
    }
  }

  // Run the current CPU cycle's 3 dots exactly in step with the CPU, then
  // work out when the next event is. nmiAtPoll records the NMI output after
  // the first dot of the cycle, which is when the CPU samples it.
  runCycleExact() {
    const target = this.dotTarget;
    this.dotTarget = target - 2;
    this.catchUp();
    this.nmiAtPoll = this.nmiOutput;
    this.dotTarget = target;
    this.catchUp();
    this._scheduleNextEvent();
  }

  // Number of dots from the current position until the PPU reaches
  // (line, dot) for the next time.
  _dotsUntil(line, dot) {
    let d = (line - this.line) * 341 + (dot - this.dot);
    if (d < 0) d += 262 * 341;
    return d;
  }

  // Work out the dot (in dotsRun units) of the next event the CPU might
  // notice. See catchUp().
  _scheduleNextEvent() {
    // VBlank start and end, and the odd-frame dot skip (which changes the
    // length of the frame, so we sync there to keep this arithmetic simple).
    let d = this._dotsUntil(241, 1);
    let e = this._dotsUntil(261, 1);
    if (e < d) d = e;
    e = this._dotsUntil(261, 339);
    if (e < d) d = e;
    if (this.renderingOn) {
      // The mapper's scanline counter is clocked once per rendered line.
      const irqDot = this.nes.mmap ? this.nes.mmap.irqClockDot : 260;
      const line = this.line;
      let next;
      if (line < 240) {
        next = this.dot <= irqDot ? line : line + 1;
        if (next === 240) next = 261;
      } else if (line === 261 && this.dot > irqDot) {
        next = 0;
      } else {
        next = 261;
      }
      e = this._dotsUntil(next, irqDot);
      if (e < d) d = e;
    }
    if (this.maskDelay !== 0 && this.maskDelay - 1 < d) {
      // A $2001 write is about to take effect.
      d = this.maskDelay - 1;
    }
    this.nextEventDot = this.dotsRun + d;
  }

  // Process one dot.
  _tick() {
    const line = this.line;
    const dot = this.dot;

    if (line < 240) {
      if (this.renderingOn) {
        this._renderingDot(line, dot, false);
      } else {
        if (dot >= 1 && dot <= 256) {
          this._blankPixel(line, dot - 1);
          // The sprite X counters keep counting down while rendering is
          // off (only the sprite shift registers stop), so a sprite still
          // appears at its normal X position if rendering is re-enabled
          // before it. (AccuracyCoin "BG Serial In")
          for (let i = 0; i < this.sprCount; i++) {
            if (this.sprX[i] !== 0) this.sprX[i]--;
          }
        } else if (dot === 340) {
          this._spriteCountersWithRenderingOff();
        }
      }
    } else if (line === 261) {
      if (dot === 1) {
        // Clear the status flags at the start of the pre-render line.
        this.vblankFlag = 0;
        this.sprite0HitFlag = 0;
        this.spriteOverflowFlag = 0;
        this._updateNmiOutput();
      }
      if (this.renderingOn) {
        this._renderingDot(line, dot, true);
      } else if (dot === 340) {
        this._spriteCountersWithRenderingOff();
      }
    } else if (line === 241 && dot === 1) {
      this._startVBlank();
    }

    // $2001 writes reach the rendering pipeline after a short delay.
    if (this.maskDelay !== 0 && --this.maskDelay === 0) {
      this._applyRenderingEnable();
    }

    // Advance to the next dot.
    if (dot < 340) {
      // Odd frames are one dot shorter when rendering: the last dot of the
      // pre-render line is skipped.
      if (dot === 339 && line === 261 && this.oddFrame && this.renderingOn) {
        this._nextLine();
        // Quirk: skipping dot 340 skips loading the sprite X counters, so
        // the first pixel of every sprite comes out at X=0 and the rest of
        // it one pixel to the left. (AccuracyCoin "Sprites On Scanline 0")
        this.spriteSkipGlitch = true;
        this.sprCount = this.sprFetchCount;
        this.sprLineValid = false;
        return;
      }
      this.dot = dot + 1;
    } else {
      this._nextLine();
    }
  }

  _nextLine() {
    this.dot = 0;
    let line = this.line + 1;
    if (line === 262) {
      line = 0;
      this.oddFrame = !this.oddFrame;
    }
    this.line = line;
    this.scanline = line >= 241 ? line - 241 : line + 21;
  }

  _startVBlank() {
    if (!this.nmiSuppressed) {
      this.vblankFlag = 1;
      this._updateNmiOutput();
    }
    this.nmiSuppressed = false;

    // PPU open bus latch decay: on real hardware each bit decays to 0
    // after ~600ms (~36 frames). We use a simple per-latch frame counter.
    if (this.openBusDecayFrames > 0) {
      this.openBusDecayFrames--;
      if (this.openBusDecayFrames === 0) {
        this.openBusLatch = 0;
      }
    }

    this.endFrame();
    this.frameEnded = true;
  }

  // Output a pixel while rendering is disabled: the backdrop color, or if
  // v points into palette RAM, that palette entry (the "background palette
  // hack"). See https://www.nesdev.org/wiki/PPU_palettes
  _blankPixel(line, x) {
    const v = this.vramAddress & 0x3fff;
    const color = v >= 0x3f00 ? this.palColors[v & 0x1f] : this.palColors[0];
    this.buffer[(line << 8) | x] = color;
  }

  // One dot of a visible or pre-render line, with rendering enabled.
  _renderingDot(line, dot, isPreRender) {
    if (this.oamCorruptPending) {
      this._performOamCorruption();
    }
    if (dot === 0) return; // idle dot

    if (dot > 256 && dot === this.nes.mmap.irqClockDot) {
      // Clock the mapper's scanline counter once per rendered line (MMC3
      // and friends count PPU A12 rising edges during the sprite fetches,
      // around dot 260; see Mapper0.irqClockDot).
      this.nes.mmap.clockIrqCounter();
    }

    if (dot <= 256) {
      if (!isPreRender) {
        this._renderSpan(line, dot, dot + 1);
      } else {
        // The pre-render line does the background fetches, but outputs no
        // pixels and doesn't evaluate sprites.
        this._shiftBg();
        this._bgFetch(dot);
        if (dot === 256) this._incY();
      }
    } else if (dot <= 320) {
      if (dot === 257) {
        // Copy the horizontal scroll bits from t to v.
        this.vramAddress =
          (this.vramAddress & 0x7be0) | (this.vramTmpAddress & 0x041f);
        this.secIdx = 0;
        this.sprFetchCount = 0;
        this.sprite0Line = this.sprite0Next;
        this.nes.mmap.onSpriteRender();
      }
      // OAMADDR is reset to 0 throughout the sprite fetch period.
      this.sramAddress = 0;
      // Sprite pattern fetches: 8 dots per sprite.
      const phase = (dot - 257) & 7;
      if (phase === 7) {
        this._fetchSprite((dot - 257) >> 3, isPreRender ? 261 & 0xff : line);
      }
      // The secondary OAM address moves on dots 0, 1, 2 and 7 of each
      // 8-dot group (it's used as the OAM corruption "seed").
      if (phase <= 2 || phase === 7) {
        this.secIdx = (this.secIdx + 1) & 0x1f;
      }
      if (isPreRender && dot >= 280 && dot <= 304) {
        // Copy the vertical scroll bits from t to v.
        this.vramAddress =
          (this.vramAddress & 0x041f) | (this.vramTmpAddress & 0x7be0);
      }
    } else if (dot <= 336) {
      // Prefetch the first two tiles of the next line.
      if (dot === 321) this.nes.mmap.onBgRender();
      this._shiftBg();
      this._bgFetch(dot);
    } else if (dot === 337) {
      // Unused nametable fetch.
      this.ntByte = this.mirroredLoad(0x2000 | (this.vramAddress & 0x0fff));
    } else if (dot === 339) {
      // Unused nametable fetch.
      this.ntByte = this.mirroredLoad(0x2000 | (this.vramAddress & 0x0fff));
    } else if (dot === 340) {
      // Load the sprite X counters for the next line.
      for (let i = 0; i < 8; i++) {
        this.sprX[i] = this.sprLatchX[i];
      }
      this.sprCount = this.sprFetchCount;
      this._buildSpriteLine(line === 261 ? 0 : line + 1);
    }
  }

  // --- Sprite line buffer ---
  //
  // Running the 8 sprite output units on every pixel is slow, and as long
  // as rendering stays enabled for the whole line their output is fully
  // determined when the X counters are loaded at dot 340. So we precompute
  // the line's sprite pixels into sprLine[x]:
  //   bits 0-4: palette index (0x10-0x1F), or 0 for no sprite pixel
  //   bit 8:    sprite is behind the background
  //   bit 9:    the pixel comes from sprite 0 (for sprite 0 hit)
  // If rendering is turned off partway through the line, the sprite units
  // stop advancing, which the buffer can't represent. In that case
  // _materializeSprites() works out the state the counters and shift
  // registers would have reached, and the per-dot path (_spritePixel())
  // takes over.
  _buildSpriteLine(forLine) {
    const sprLine = this.sprLine;
    sprLine.fill(0);
    this.sprLineFor = forLine;
    this.sprLineValid = true;
    // Lower slots have priority, so draw from the highest slot down.
    for (let i = this.sprCount - 1; i >= 0; i--) {
      let lo = this.sprLo[i];
      let hi = this.sprHi[i];
      if ((lo | hi) === 0) continue;
      const attr = this.sprAttr[i];
      const flags =
        0x10 |
        ((attr & 3) << 2) |
        ((attr & 0x20) << 3) |
        (i === 0 && this.sprite0Line ? 0x200 : 0);
      const x0 = this.sprX[i];
      for (let b = 0; b < 8 && x0 + b < 256; b++) {
        const p = ((lo >> 7) & 1) | ((hi >> 6) & 2);
        lo = (lo << 1) & 0xff;
        hi = (hi << 1) & 0xff;
        if (p !== 0) {
          sprLine[x0 + b] = flags | p;
        }
      }
    }
  }

  // Convert the sprite line buffer back into the state of the sprite
  // output units (X counters and shift registers) at the current dot, and
  // stop using the buffer. See _buildSpriteLine().
  _materializeSprites() {
    if (!this.sprLineValid) return;
    this.sprLineValid = false;
    if (this.line !== this.sprLineFor || this.dot > 256) {
      // Either the line hasn't started (nothing has been output yet), or
      // its pixels are finished and the next line's sprites are already
      // being fetched into the units: nothing to rewind.
      return;
    }
    const done = this.dot > 0 ? this.dot - 1 : 0; // pixels already output
    for (let i = 0; i < this.sprCount; i++) {
      const x0 = this.sprX[i];
      if (done <= x0) {
        this.sprX[i] = x0 - done;
      } else {
        const shift = Math.min(done - x0, 8);
        this.sprX[i] = 0;
        this.sprLo[i] = (this.sprLo[i] << shift) & 0xff;
        this.sprHi[i] = (this.sprHi[i] << shift) & 0xff;
      }
    }
  }

  // If rendering is disabled when the sprite X counters would be loaded,
  // they're left at 0: once rendering is re-enabled, the sprites are drawn
  // straight away regardless of their X position.
  // (AccuracyCoin "Stale BG Shift Registers" test 4)
  _spriteCountersWithRenderingOff() {
    this.sprLineValid = false;
    this.sprX.fill(0);
    this.sprCount = this.sprFetchCount;
  }

  // Background fetches for dots 1-256 and 321-336. Each 8-dot group fetches
  // one tile: nametable byte (dots 1-2), attribute byte (3-4), pattern low
  // (5-6) and high (7-8) bit planes. At the end of the group the tile is
  // loaded into the shift registers and coarse X is incremented.
  //
  // The shift registers shift on every one of these dots, and each visible
  // pixel is taken from them just before the shift. So a tile loaded at the
  // end of dot 8 has moved into the high (output) half 8 dots later. If
  // rendering is off at the moment of a load, the load is skipped and the
  // "serial in" bits shifted in show up instead (AccuracyCoin "BG Serial In").
  _bgFetch(dot) {
    switch (dot & 7) {
      case 1: {
        this.ntByte = this.mirroredLoad(0x2000 | (this.vramAddress & 0x0fff));
        break;
      }
      case 3: {
        const v = this.vramAddress;
        const at = this.mirroredLoad(
          0x23c0 | (v & 0x0c00) | ((v >> 4) & 0x38) | ((v >> 2) & 0x07),
        );
        // Each attribute byte covers 4x4 tiles; pick the 2x2 quadrant.
        this.atBits = (at >> (((v >> 4) & 4) | (v & 2))) & 3;
        break;
      }
      case 5: {
        const addr =
          (this.f_bgPatternTable << 12) |
          (this.ntByte << 4) |
          (this.vramAddress >> 12);
        this.ptLo = this.vramMem[addr];
        break;
      }
      case 7: {
        const addr =
          ((this.f_bgPatternTable << 12) |
            (this.ntByte << 4) |
            (this.vramAddress >> 12)) +
          8;
        this.ptHi = this.vramMem[addr];
        const mmap = this.nes.mmap;
        mmap.latchAccess(addr);
        if (mmap.bgTileOverride) {
          this._mapperBgOverride();
        }
        break;
      }
      case 0: {
        // End of the tile: load it into the shift registers and move on.
        this._reloadBg();
        this._incCoarseX();
        break;
      }
    }
  }

  // MMC5 extended attribute mode supplies the tile pattern and palette for
  // each background tile itself.
  _mapperBgOverride() {
    const v = this.vramAddress;
    const data = this.nes.mmap.getBgTileData(
      this.f_bgPatternTable ? 256 : 0,
      this.ntByte,
      v & 0x1f,
      (v >> 5) & 0x1f,
    );
    if (!data) return;
    const fineY = v >> 12;
    const pix = data.tile.pix;
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < 8; i++) {
      const p = pix[(fineY << 3) + i];
      lo = (lo << 1) | (p & 1);
      hi = (hi << 1) | (p >> 1);
    }
    this.ptLo = lo;
    this.ptHi = hi;
    this.atBits = (data.attrib >> 2) & 3;
  }

  // Shift the background registers by one pixel. The pattern shifters shift
  // in a 0 (low plane) and a 1 (high plane), which shows up if the PPU is
  // made to skip a reload. The attribute shifters shift in their latch.
  _shiftBg() {
    this.bgShiftLo = (this.bgShiftLo << 1) & 0xffff;
    this.bgShiftHi = ((this.bgShiftHi << 1) | 1) & 0xffff;
    this.attrShiftLo = ((this.attrShiftLo << 1) | this.attrLatchLo) & 0xff;
    this.attrShiftHi = ((this.attrShiftHi << 1) | this.attrLatchHi) & 0xff;
  }

  // Load the fetched tile into the low half of the shift registers.
  _reloadBg() {
    this.bgShiftLo = (this.bgShiftLo & 0xff00) | this.ptLo;
    this.bgShiftHi = (this.bgShiftHi & 0xff00) | this.ptHi;
    this.attrLatchLo = this.atBits & 1;
    this.attrLatchHi = this.atBits >> 1;
  }

  // Process dots [from, to) of a visible line (1 <= from < to <= 257) with
  // rendering enabled: for each dot, output a pixel, shift the background
  // registers, do that dot's background fetch, and do that dot's step of
  // sprite evaluation. This is the hot loop of the whole emulator, so the
  // background shift registers are kept in local variables.
  _renderSpan(line, from, to) {
    let bgLo = this.bgShiftLo;
    let bgHi = this.bgShiftHi;
    let atLo = this.attrShiftLo;
    let atHi = this.attrShiftHi;
    const fineX = this.fineX;
    const bit = 15 - fineX;
    const abit = 7 - fineX;
    const showBg = this.f_bgVisibility === 1;
    const bgLeft = this.f_bgClipping === 1;
    const palColors = this.palColors;
    const buffer = this.buffer;
    const sprLine = this.sprLine;
    const showSprites = this.f_spVisibility === 1;
    const spLeft = this.f_spClipping === 1;
    const rowBase = line << 8;

    for (let dot = from; dot < to; dot++) {
      // --- Output the pixel for x = dot - 1 ---
      const x = dot - 1;
      let bgPixel = 0;
      if (showBg && (x >= 8 || bgLeft)) {
        const p = ((bgLo >> bit) & 1) | (((bgHi >> bit) & 1) << 1);
        if (p !== 0) {
          bgPixel =
            p | (((atLo >> abit) & 1) << 2) | (((atHi >> abit) & 1) << 3);
        }
      }
      let colorIndex = bgPixel;
      if (this.sprLineValid) {
        const spr = sprLine[x];
        if (spr !== 0 && showSprites && (x >= 8 || spLeft)) {
          if (spr & 0x200 && bgPixel !== 0 && x !== 255) {
            this.sprite0HitFlag = 1;
          }
          // Sprites are drawn in front of the background unless their
          // priority bit says otherwise (and the background is opaque).
          if (bgPixel === 0 || (spr & 0x100) === 0) {
            colorIndex = spr & 0x1f;
          }
        }
      } else if (this.sprCount !== 0 || this.spriteSkipGlitch) {
        const spr = this._spritePixel(x, bgPixel);
        // Sprites are drawn in front of the background unless their
        // priority bit says otherwise (and the background is opaque).
        if (spr !== 0 && (bgPixel === 0 || (spr & 0x100) === 0)) {
          colorIndex = spr & 0x1f;
        }
      }
      buffer[rowBase | x] = palColors[colorIndex];

      // --- Shift the background registers ---
      // The pattern shifters shift in a 0 (low plane) and a 1 (high
      // plane), which shows up if the PPU is made to skip a reload. The
      // attribute shifters shift in their latch.
      bgLo = (bgLo << 1) & 0xffff;
      bgHi = ((bgHi << 1) | 1) & 0xffff;
      atLo = ((atLo << 1) | this.attrLatchLo) & 0xff;
      atHi = ((atHi << 1) | this.attrLatchHi) & 0xff;

      // --- Background fetch for this dot ---
      if ((dot & 7) === 0) {
        // End of a tile: load it into the shift registers.
        bgLo = (bgLo & 0xff00) | this.ptLo;
        bgHi = (bgHi & 0xff00) | this.ptHi;
        this.attrLatchLo = this.atBits & 1;
        this.attrLatchHi = this.atBits >> 1;
        this._incCoarseX();
        if (dot === 256) this._incY();
      } else if ((dot & 1) === 1) {
        this._bgFetch(dot);
      }

      // --- Sprite evaluation for the next line ---
      if (dot <= 64) {
        // Clear secondary OAM, one byte every 2 dots.
        if ((dot & 1) === 0) {
          this.secondaryOAM[(dot >> 1) - 1] = 0xff;
          this.secIdx = (dot >> 1) & 0x1f;
          if (dot === 64) {
            this._startEvaluation();
          }
        }
      } else if ((dot & 1) === 1) {
        // Odd dots: read OAM.
        this.oamLatch = this.spriteMem[this.sramAddress];
      } else {
        // Even dots: process the byte read.
        this._evaluateSprites(line, dot);
      }
    }

    this.bgShiftLo = bgLo;
    this.bgShiftHi = bgHi;
    this.attrShiftLo = atLo;
    this.attrShiftHi = atHi;
  }

  // Sprite pixel at x (0-255). Returns 0 if no sprite pixel; otherwise the
  // palette index (0x10-0x1F) plus 0x100 if the sprite is behind the
  // background. Also detects sprite 0 hits against bgPixel.
  //
  // Each slot's X counter counts down to 0, then the slot shifts out its 8
  // pixels. The lowest-numbered opaque slot wins.
  _spritePixel(x, bgPixel) {
    let result = 0;
    const count = this.sprCount;
    const glitch = this.spriteSkipGlitch;
    this.spriteSkipGlitch = false;
    const showSprites =
      this.f_spVisibility === 1 && (x >= 8 || this.f_spClipping === 1);
    const sprX = this.sprX;
    const sprLo = this.sprLo;
    const sprHi = this.sprHi;
    for (let i = 0; i < count; i++) {
      if (sprX[i] !== 0 && !glitch) {
        sprX[i]--;
        continue;
      }
      const p = ((sprLo[i] >> 7) & 1) | ((sprHi[i] >> 6) & 2);
      sprLo[i] = sprLo[i] << 1;
      sprHi[i] = sprHi[i] << 1;
      if (glitch && this.sprLatchX[i] !== 0) {
        sprX[i] = this.sprLatchX[i] - 1;
      }
      if (p === 0 || !showSprites) continue;
      if (i === 0 && this.sprite0Line && bgPixel !== 0 && x !== 255) {
        this.sprite0HitFlag = 1;
      }
      if (result === 0) {
        const attr = this.sprAttr[i];
        result = 0x10 | p | ((attr & 3) << 2) | ((attr & 0x20) << 3);
      }
    }
    return result;
  }

  // ==========================================================================
  // Sprite evaluation
  // ==========================================================================
  //
  // From dot 65 to 256 of each visible line, the PPU scans OAM for sprites
  // that will be on the next line. On odd dots it reads a byte from
  // OAM[OAMADDR]; on even dots it processes that byte. This emulates the
  // byte-level state machine, including what happens when OAMADDR isn't a
  // multiple of 4 ("misaligned OAM") and the famous sprite overflow bug.
  // See https://www.nesdev.org/wiki/PPU_sprite_evaluation and the
  // AccuracyCoin "Misaligned OAM Behavior" test for the details.

  _startEvaluation() {
    this.secIdx = 0;
    this.secFull = false;
    this.evalDone = false;
    this.evalOvfStep = 0;
    this.sprite0Next = false;
  }

  // Is the byte `y` (read as a Y coordinate) in range for the next line?
  _inRange(line, y) {
    const row = line - y;
    return row >= 0 && row < (this.f_spriteSize ? 16 : 8);
  }

  // Process the OAM byte read on the previous (odd) dot. Called on the even
  // dots 66-256.
  _evaluateSprites(line, dot) {
    const s = this.oamLatch;
    let addr = this.sramAddress;

    if (this.evalDone) {
      // All sprites checked: the PPU keeps stepping through OAM, failing to
      // copy into secondary OAM.
      addr += 4;
    } else if (!this.secFull) {
      // Copy mode: there's still room in secondary OAM.
      const step = this.secIdx & 3;
      this.secondaryOAM[this.secIdx] = s;
      if (step === 0) {
        // Y coordinate.
        if (this._inRange(line, s)) {
          if (dot === 66) this.sprite0Next = true;
          this.secIdx++;
          addr++;
        } else {
          // Skip to the next sprite (and realign OAMADDR).
          addr = (addr + 4) & ~3;
        }
      } else if (step < 3) {
        // Tile and attributes.
        this.secIdx++;
        addr++;
      } else {
        // X coordinate. The hardware applies the same "in range" check to
        // it; if that fails, OAMADDR is realigned.
        this.secIdx++;
        addr = this._inRange(line, s) ? addr + 1 : (addr + 1) & ~3;
      }
      if (this.secIdx === 32) {
        this.secFull = true;
        this.secIdx = 0;
      }
    } else {
      // Secondary OAM is full: look for a 9th sprite to set the overflow
      // flag. Writes to secondary OAM become reads.
      if (this.evalOvfStep === 0) {
        if (this._inRange(line, s)) {
          this.spriteOverflowFlag = 1;
          this.evalOvfStep = 1;
          addr++;
        } else {
          // Hardware bug: both the sprite index and the byte index are
          // incremented, so the next "Y" read is really some other byte.
          addr += 5;
        }
      } else if (this.evalOvfStep < 3) {
        this.evalOvfStep++;
        addr++;
      } else {
        this.evalOvfStep = 0;
        addr = this._inRange(line, s) ? addr + 1 : addr + 5;
      }
    }

    if (addr > 0xff) {
      // Wrapped around the end of OAM.
      this.evalDone = true;
      addr &= 0xff;
    }
    this.sramAddress = addr;
  }

  // Fetch sprite slot `slot` (0-7) from secondary OAM into the sprite output
  // unit. `line` is the line used for the in-range check; on the pre-render
  // line that's 261 & 255 = 5, which is how stale secondary OAM data can
  // produce sprites on line 0.
  _fetchSprite(slot, line) {
    const base = slot << 2;
    const y = this.secondaryOAM[base];
    const tile = this.secondaryOAM[base + 1];
    const attr = this.secondaryOAM[base + 2];
    const x = this.secondaryOAM[base + 3];
    const height = this.f_spriteSize ? 16 : 8;
    let row = line - y;
    const inRange = row >= 0 && row < height;
    if (attr & 0x80) {
      row = height - 1 - row; // vertical flip
    }
    row &= height - 1;

    let addr;
    if (height === 8) {
      addr = (this.f_spPatternTable << 12) | (tile << 4) | row;
    } else {
      // 8x16: bit 0 of the tile number selects the pattern table.
      addr =
        ((tile & 1) << 12) |
        ((tile & 0xfe) << 4) |
        ((row & 8) << 1) |
        (row & 7);
    }
    let lo = this.vramMem[addr];
    let hi = this.vramMem[addr + 8];
    this.nes.mmap.latchAccess(addr + 8);

    if (!inRange) {
      lo = 0;
      hi = 0;
    } else if (attr & 0x40) {
      lo = REVERSE_BITS[lo];
      hi = REVERSE_BITS[hi];
    }
    this.sprLo[slot] = lo;
    this.sprHi[slot] = hi;
    this.sprAttr[slot] = attr;
    this.sprLatchX[slot] = x;
    // Only slots up to the last one with pixels need processing.
    if ((lo | hi) !== 0) {
      this.sprFetchCount = slot + 1;
    }
  }

  // ==========================================================================
  // OAM corruption
  // ==========================================================================
  //
  // If rendering is turned off in the middle of a visible (or pre-render)
  // line, the sprite logic is interrupted in a state that corrupts OAM once
  // rendering is turned back on: OAM "row" N (8 bytes) is overwritten with
  // row 0, where N is the secondary OAM address at the moment rendering was
  // disabled. See https://www.nesdev.org/wiki/PPU_OAM#Sprite_corruption and
  // the AccuracyCoin "OAM Corruption" test.

  _renderingDisabled() {
    const line = this.line;
    if (!(line < 240 || line === 261)) return;
    const dot = this.dot;
    let row = this.secIdx;
    if (dot >= 65 && dot <= 256) {
      // During evaluation the address is effectively rounded up to a
      // multiple of 4.
      row = (row + 3) & 0x1c;
    }
    this.oamCorruptPending = true;
    this.oamCorruptRow = row & 0x1f;
  }

  _performOamCorruption() {
    this.oamCorruptPending = false;
    const base = this.oamCorruptRow << 3;
    for (let i = 0; i < 8; i++) {
      this.spriteMem[base + i] = this.spriteMem[i];
    }
    this.secondaryOAM[this.oamCorruptRow] = this.secondaryOAM[0];
  }

  // ==========================================================================
  // Frame output
  // ==========================================================================

  // Kept for API compatibility; the frame is drawn as the PPU runs.
  startFrame() {}

  endFrame() {
    let y;
    let buffer = this.buffer;

    if (this.clipToTvSize) {
      // Most TVs don't show the outer 8 pixels on each side. Clip them.
      for (y = 0; y < 240; y++) {
        buffer.fill(0, y << 8, (y << 8) + 8);
        buffer.fill(0, (y << 8) + 248, (y << 8) + 256);
      }
      buffer.fill(0, 0, 8 << 8);
      buffer.fill(0, 232 << 8, 240 << 8);
    } else if (this.f_bgClipping === 0 || this.f_spClipping === 0) {
      for (y = 0; y < 240; y++) {
        buffer.fill(0, y << 8, (y << 8) + 8);
      }
    }

    this.nes.ui.writeFrame(buffer);
  }

  // Used by the Zapper: is the pixel at (x, y) bright white?
  isPixelWhite(x, y) {
    this.catchUp();
    return this.buffer[(y << 8) + x] === 0xffffff;
  }

  // ==========================================================================
  // Save states
  // ==========================================================================

  static JSON_PROPERTIES = [
    "vramMem",
    "spriteMem",
    "secondaryOAM",
    "vramAddress",
    "vramTmpAddress",
    "fineX",
    "firstWrite",
    "vramBufferedReadValue",
    "sramAddress",
    "openBusLatch",
    "openBusDecayFrames",
    "currentMirroring",
    "ntable1",
    "vblankFlag",
    "sprite0HitFlag",
    "spriteOverflowFlag",
    "nmiOutput",
    "nmiAtPoll",
    "nmiSuppressed",
    "line",
    "dot",
    "scanline",
    "oddFrame",
    "renderingOn",
    "maskDelay",
    "bgShiftLo",
    "bgShiftHi",
    "attrShiftLo",
    "attrShiftHi",
    "attrLatchLo",
    "attrLatchHi",
    "ntByte",
    "atBits",
    "ptLo",
    "ptHi",
    "secIdx",
    "secFull",
    "oamLatch",
    "evalDone",
    "evalOvfStep",
    "sprite0Next",
    "sprite0Line",
    "oamCorruptPending",
    "oamCorruptRow",
    "sprCount",
    "sprLo",
    "sprHi",
    "sprAttr",
    "sprX",
    "sprLatchX",
    "sprFetchCount",
    "spriteSkipGlitch",
    // Control/mask register fields
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
  ];

  toJSON() {
    this.catchUp();
    this._materializeSprites();
    let state = toJSON(this);
    state.vramMirrorTable = this.vramMirrorTable;
    return state;
  }

  fromJSON(state) {
    fromJSON(this, state);
    if (state.vramMirrorTable) {
      this.vramMirrorTable.set(state.vramMirrorTable);
    }
    this.dotTarget = 0;
    this.dotsRun = 0;
    this.nextEventDot = 0;
    // Rebuild derived state.
    for (let i = 0; i < 0x2000; i++) {
      this.patternWrite(i, this.vramMem[i]);
    }
    if (this.f_dispType === 0) {
      this.palTable.setEmphasis(this.f_color);
    }
    this.updatePalettes();
  }
}

// Bit-reversed bytes, for horizontally flipped sprites.
const REVERSE_BITS = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let r = 0;
  for (let b = 0; b < 8; b++) {
    if (i & (1 << b)) r |= 0x80 >> b;
  }
  REVERSE_BITS[i] = r;
}

export default PPU;

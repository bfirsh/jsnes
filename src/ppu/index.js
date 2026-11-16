import Mapper0 from "../mappers/mapper0.js";
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
    // Which sprites are on each line (see _oamLineCache()).
    this.oamLineList = new Uint8Array(240 * 8);
    this.oamLineCount = new Uint8Array(240);
    this.oamDirty = true;
    this.oamCacheHeight = 0;
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
    // Status flag prediction (see predictStatus()).
    this.statusPredValid = false;
    this.statusPredLine = 0;
    this.statusPredLimit = 0;
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
    // Evaluation on this line started with OAMADDR = 0 and it hasn't been
    // written since (see _noOverflowPossible()).
    this.evalAligned = false;
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
    this.sprTileMask = 0;
    // The palette indexes of the background pixels of each tile of the
    // current line (see _renderTiles()).
    this.tileIdx = new Int32Array(32);

    // --- Output ---
    this.buffer = new Uint32Array(256 * 240);
    // RGB color for each of the 32 palette RAM entries.
    this.palColors = new Uint32Array(32);
    // The same, except that entries 0, 4, 8, ... 28 (the "transparent"
    // index of each palette) all hold the backdrop color, palColors[0].
    // The renderer looks up pixel colors here so that it doesn't have to
    // check for transparent pixels.
    this.pixColors = new Uint32Array(32);

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
    const color = this.palTable.getEntry(value);
    this.palColors[index] = color;
    if (index === 0) {
      for (let i = 0; i < 32; i += 4) this.pixColors[i] = color;
    } else if ((index & 3) !== 0) {
      this.pixColors[index] = color;
    }
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
    this.evalAligned = false; // (see _noOverflowPossible())
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
    this.evalAligned = false; // (see _noOverflowPossible())
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
    this.oamDirty = true;
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
      } else if (
        dot >= 257 &&
        dot <= 320 &&
        (this.line < 240 || this.line === 261) &&
        this.renderingOn &&
        this.maskDelay === 0 &&
        !this.oamCorruptPending
      ) {
        // Fast path: sprite fetches during horizontal blanking.
        let end = dot + (target - this.dotsRun);
        if (end > 321) end = 321;
        this._spriteFetchSpan(this.line, dot, end, this.line === 261);
        this.dotsRun += end - dot;
        this.dot = end;
      } else if (
        dot >= 321 &&
        (this.line < 240 || (this.line === 261 && dot < 339)) &&
        this.renderingOn &&
        this.maskDelay === 0 &&
        !this.oamCorruptPending
      ) {
        // Fast path: the end of a visible or pre-render line (the first
        // two tiles of the next line are fetched). The odd-frame skip at
        // the end of the pre-render line is left to _tick().
        let end = dot + (target - this.dotsRun);
        const limit = this.line === 261 ? 339 : 341;
        if (end > limit) end = limit;
        this._prefetchSpan(this.line, dot, end);
        this.dotsRun += end - dot;
        if (end === 341) {
          this._nextLine();
        } else {
          this.dot = end;
        }
      } else if (
        dot === 0 &&
        (this.line < 240 || this.line === 261) &&
        this.renderingOn &&
        this.maskDelay === 0 &&
        !this.oamCorruptPending
      ) {
        // Dot 0 of a rendered line is idle.
        this.dotsRun++;
        this.dot = 1;
      } else if (
        this.line >= 240 &&
        this.line <= 260 &&
        (this.line !== 241 || dot >= 2) &&
        this.maskDelay === 0
      ) {
        // Fast path: nothing happens on the post-render and VBlank lines
        // (apart from VBlank starting at line 241, dot 1), so skip ahead.
        const left = 341 - dot;
        const owed = target - this.dotsRun;
        if (owed >= left) {
          this.dotsRun += left;
          this._nextLine();
        } else {
          this.dotsRun += owed;
          this.dot = dot + owed;
        }
      } else {
        this._tick();
        this.dotsRun++;
      }
    }
  }

  // --- $2002 polling ---
  //
  // Games often wait for the sprite 0 hit flag by reading $2002 in a tight
  // loop during rendering. Catching up to every read would split each line
  // into lots of tiny spans. But during the visible lines, the only status
  // flags that can change are sprite 0 hit and sprite overflow, and only at
  // predictable dots: so when the CPU reads $2002, we work out the first
  // dot of the current line on which either could next be set (the
  // "limit"). Reads that happen before the PPU reaches the limit can then
  // be answered without catching up, as the flags will still be as they
  // are now. (Reading $2002 also clears the VBlank flag, which is already
  // clear on these lines, and the write toggle, which rendering doesn't
  // use.)
  //
  // The prediction assumes nothing changes the rendering in the meantime,
  // so the CPU throws it away (statusPredValid = false) on any other PPU
  // register or cartridge access.

  // Can a $2002 read be answered without catching up? `target` is the
  // dotTarget the read would catch up to.
  statusPredicted(target) {
    return (
      this.statusPredValid &&
      this.line === this.statusPredLine &&
      this.dot + (target - this.dotsRun) <= this.statusPredLimit
    );
  }

  // Work out the limit (see above) from the current, caught-up, state.
  predictStatus() {
    this.statusPredValid = false;
    const line = this.line;
    const dot = this.dot;
    if (
      line >= 240 ||
      !this.renderingOn ||
      this.maskDelay !== 0 ||
      this.oamCorruptPending
    ) {
      return;
    }
    const mmap = this.nes.mmap;
    if (
      mmap.bgTileOverride ||
      mmap.latchAccess !== Mapper0.prototype.latchAccess
    ) {
      // The mapper changes the tiles during rendering (MMC2/MMC4/MMC5),
      // which _bgOpaqueAt() doesn't know about.
      return;
    }
    // After dot 256 nothing changes the flags until the next line.
    let limit = 341;
    if (dot <= 256) {
      if (this.spriteOverflowFlag === 0 && !this._noOverflowPossible()) {
        // The overflow flag can't be set before dot 66.
        if (dot >= 66) return;
        limit = 66;
      }
      if (this.sprite0HitFlag === 0) {
        if (!this.sprLineValid) {
          // Unless there are no sprites at all, the sprite output units
          // are being run dot by dot: don't try.
          if (this.sprCount !== 0 || this.spriteSkipGlitch) return;
        } else if (
          this.f_spVisibility === 1 &&
          this.f_bgVisibility === 1 &&
          this.sprite0Line
        ) {
          // The first pixel of sprite 0 (see _buildSpriteLine()) that's
          // still to be drawn and is over an opaque background pixel.
          const cur = dot === 0 ? 1 : dot; // dot 0 is idle
          let x = this.sprX[0];
          if (x < cur - 1) x = cur - 1;
          let end = this.sprX[0] + 8;
          if (end > 255) end = 255; // no hit at x = 255
          for (; x < end; x++) {
            if (
              (this.sprLine[x] & 0x200) !== 0 &&
              (x >= 8 ||
                (this.f_spClipping === 1 && this.f_bgClipping === 1)) &&
              this._bgOpaqueAt(x, cur)
            ) {
              // The hit flag is set when dot x + 1 is processed.
              if (x + 1 < limit) limit = x + 1;
              break;
            }
          }
        }
      }
    }
    this.statusPredValid = true;
    this.statusPredLine = line;
    this.statusPredLimit = limit;
  }

  // True if the sprite overflow flag can't be set on the current line
  // (when dot <= 256). The flag is only set after secondary OAM is full,
  // and when evaluation starts with OAMADDR = 0 it simply checks each
  // sprite's Y coordinate in turn, so it can only fill up if at least 8
  // sprites are on the next line.
  _noOverflowPossible() {
    if (this.dot > 64) {
      if (!this.evalAligned) return false;
      if (this.evalDone) return true;
      if (this.secFull) return false;
    } else if (this.sramAddress !== 0) {
      return false;
    }
    const oam = this.spriteMem;
    const height = this.f_spriteSize ? 16 : 8;
    const line = this.line;
    let n = 0;
    for (let i = 0; i < 256; i += 4) {
      const row = line - oam[i];
      if (row >= 0 && row < height && ++n === 8) return false;
    }
    return true;
  }

  // Will the background pixel at x (on the current line, x >= cur - 1) be
  // opaque? `cur` (1-256) is the next dot to be run. Works out which tile
  // the pixel comes from and looks at the pattern: that's either already in
  // the shift registers or still to be fetched (from where v will be).
  //
  // Tiles are numbered in the order they're fetched: tiles 0 and 1 are
  // fetched at the end of the previous line, and tile t + 2 during the
  // t-th 8-dot group of this line. At the start of group g the shift
  // registers hold tile g (high byte) and g + 1 (low byte), and pixel x
  // comes from column (x + fineX) & 7 of tile (x + fineX) >> 3.
  _bgOpaqueAt(x, cur) {
    if (x < 8 && this.f_bgClipping !== 1) return false;
    const g = (cur - 1) >> 3; // current group
    const shifted = (cur - 1) & 7; // shifts done so far in this group
    const t = (x + this.fineX) >> 3;
    const c = (x + this.fineX) & 7;
    if (t <= g + 1) {
      const b = 15 - ((t - g) << 3) - c + shifted;
      return (((this.bgShiftLo | this.bgShiftHi) >> b) & 1) !== 0;
    }
    // v points at tile g + 2 until the end of the group.
    let v = this.vramAddress;
    for (let i = g + 2; i < t; i++) {
      v = (v & 0x001f) === 31 ? (v & ~0x001f) ^ 0x0400 : v + 1;
    }
    const nt = this.vramMem[this.vramMirrorTable[0x2000 | (v & 0x0fff)]];
    const addr = (this.f_bgPatternTable << 12) | (nt << 4) | (v >> 12);
    return (
      (((this.vramMem[addr] | this.vramMem[addr + 8]) >> (7 - c)) & 1) !== 0
    );
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
    const mmap = this.nes.mmap;
    if (
      this.renderingOn &&
      mmap &&
      mmap.clockIrqCounter !== Mapper0.prototype.clockIrqCounter
    ) {
      // The mapper's scanline counter is clocked once per rendered line.
      // (Most mappers don't have one, and then there's nothing to see.)
      const irqDot = mmap.irqClockDot;
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

    if (dot > 320 && dot === this.nes.mmap.irqClockDot) {
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
      this._spriteFetchSpan(line, dot, dot + 1, isPreRender);
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

  // Dots [from, to) of 321-340 of a visible or pre-render line, with
  // rendering enabled: the same work as _renderingDot() does for them, but
  // with whole tiles fetched at once.
  _prefetchSpan(line, from, to) {
    const mmap = this.nes.mmap;
    const irqDot = mmap.irqClockDot;
    let dot = from;
    while (dot < to) {
      if (dot === irqDot) {
        // See _renderingDot().
        mmap.clockIrqCounter();
      }
      if (dot <= 336) {
        if (dot === 321) mmap.onBgRender();
        if (
          (dot & 7) === 1 &&
          dot + 8 <= to &&
          (irqDot <= dot || irqDot >= dot + 8)
        ) {
          // A whole tile: 8 shifts, the 4 fetches, then the reload.
          this._fetchTile();
          this.bgShiftLo = ((this.bgShiftLo << 8) & 0xff00) | this.ptLo;
          this.bgShiftHi = ((this.bgShiftHi << 8) & 0xff00) | this.ptHi;
          this.attrShiftLo = this.attrLatchLo ? 0xff : 0;
          this.attrShiftHi = this.attrLatchHi ? 0xff : 0;
          this.attrLatchLo = this.atBits & 1;
          this.attrLatchHi = this.atBits >> 1;
          this._incCoarseX();
          dot += 8;
          continue;
        }
        this._shiftBg();
        this._bgFetch(dot);
      } else if (dot === 337 || dot === 339) {
        // Unused nametable fetches.
        this.ntByte = this.mirroredLoad(0x2000 | (this.vramAddress & 0x0fff));
      } else if (dot === 340) {
        // Load the sprite X counters for the next line.
        for (let i = 0; i < 8; i++) {
          this.sprX[i] = this.sprLatchX[i];
        }
        this.sprCount = this.sprFetchCount;
        this._buildSpriteLine(line === 261 ? 0 : line + 1);
      }
      dot++;
    }
  }

  // The four fetches of a background tile (what _bgFetch() does on dots 1,
  // 3, 5 and 7 of a tile), all at once. They only fill latches.
  _fetchTile() {
    const v = this.vramAddress;
    const vram = this.vramMem;
    const mirror = this.vramMirrorTable;
    const ntByte = vram[mirror[0x2000 | (v & 0x0fff)]];
    const at =
      vram[
        mirror[0x23c0 | (v & 0x0c00) | ((v >> 4) & 0x38) | ((v >> 2) & 0x07)]
      ];
    this.ntByte = ntByte;
    this.atBits = (at >> (((v >> 4) & 4) | (v & 2))) & 3;
    const addr = (this.f_bgPatternTable << 12) | (ntByte << 4) | (v >> 12);
    this.ptLo = vram[addr];
    this.ptHi = vram[addr + 8];
    const mmap = this.nes.mmap;
    mmap.latchAccess(addr + 8);
    if (mmap.bgTileOverride) {
      this._mapperBgOverride();
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
    // Bit k of sprTileMask is set if any sprite pixel falls in x = 8k to
    // 8k + 7, so the renderer can skip the sprite checks for the others.
    let mask = 0;
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
          mask |= 1 << ((x0 + b) >> 3);
        }
      }
    }
    this.sprTileMask = mask;
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

  // Dots [from, to) of the sprite fetch period (257-320) of a visible or
  // pre-render line, with rendering enabled. Each of the 8 sprites found
  // by evaluation gets 8 dots, in which its secondary OAM bytes are read
  // and its pattern is fetched.
  _spriteFetchSpan(line, from, to, isPreRender) {
    if (from === 257) {
      // Copy the horizontal scroll bits from t to v.
      this.vramAddress =
        (this.vramAddress & 0x7be0) | (this.vramTmpAddress & 0x041f);
      this.secIdx = 0;
      this.sprFetchCount = 0;
      this.sprite0Line = this.sprite0Next;
      this.nes.mmap.onSpriteRender();
    }
    // Each sprite's pattern is fetched by the last dot of its 8-dot group.
    const evalLine = isPreRender ? 261 & 0xff : line;
    for (let slot = (from - 257) >> 3; slot < 8; slot++) {
      const fetchDot = 264 + (slot << 3);
      if (fetchDot >= to) break;
      if (fetchDot >= from) this._fetchSprite(slot, evalLine);
    }
    // The secondary OAM address moves on dots 0, 1, 2 and 7 of each 8-dot
    // group (it's used as the OAM corruption "seed"), i.e. 4 times per
    // group.
    this.secIdx =
      (this.secIdx + SEC_IDX_STEPS[to - 257] - SEC_IDX_STEPS[from - 257]) &
      0x1f;
    if (isPreRender && from <= 304 && to > 280) {
      // Copy the vertical scroll bits from t to v (dots 280-304).
      this.vramAddress =
        (this.vramAddress & 0x041f) | (this.vramTmpAddress & 0x7be0);
    }
    const irqDot = this.nes.mmap.irqClockDot;
    if (irqDot >= from && irqDot < to) {
      // Clock the mapper's scanline counter (see Mapper0.irqClockDot).
      this.nes.mmap.clockIrqCounter();
    }
    // OAMADDR is reset to 0 throughout the sprite fetch period.
    this.sramAddress = 0;
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
  // rendering enabled: output pixels, run the background pipeline and do
  // the sprite evaluation steps for those dots. This is the hot loop of the
  // whole emulator.
  //
  // Within a span nothing outside the PPU can look at its state (see
  // catchUp()), and the background pipeline and sprite evaluation don't
  // depend on each other (one reads VRAM, the other OAM), so they're run
  // as two separate loops.
  _renderSpan(line, from, to) {
    this._renderBackgroundSpan(line, from, to);
    this._evaluateSpan(line, from, to);
  }

  // Output the pixels for dots [from, to) and run the background pipeline
  // (shift registers and tile fetches). The shift registers are kept in
  // local variables.
  _renderBackgroundSpan(line, from, to) {
    if (!this.sprLineValid && (this.sprCount !== 0 || this.spriteSkipGlitch)) {
      // The sprite output units have to be run dot by dot.
      this._renderBackgroundDots(line, from, to);
      return;
    }
    let dot = from;
    while (dot < to) {
      if ((dot & 7) === 1 && dot + 8 <= to) {
        // A run of whole tiles.
        const n = (to - dot) >> 3;
        this._renderTiles(line, dot, n);
        dot += n << 3;
      } else {
        // Part of a tile.
        let end = ((dot - 1) | 7) + 2; // just after the tile's last dot
        if (end > to) end = to;
        this._renderPartialTile(line, dot, end);
        dot = end;
      }
    }
  }

  // Dots [from, to) of one tile (8-dot group), when the sprites can be
  // drawn from the sprite line buffer (or there are none). Like
  // _renderTiles(), but the shift registers may already have been shifted
  // for the dots of the tile before `from`.
  _renderPartialTile(line, from, to) {
    const n = to - from;
    const x0 = from - 1;
    const sh = 8 - this.fineX;
    let bgLo = this.bgShiftLo;
    let bgHi = this.bgShiftHi;
    let atLo = this.attrShiftLo;
    let atHi = this.attrShiftHi;
    const latLo = this.attrLatchLo;
    const latHi = this.attrLatchHi;
    // See _renderTiles(). (All the pixels are in the same 8-pixel column.)
    let idx =
      (SPREAD[(((atLo << 8) | (latLo ? 0xff : 0)) >> sh) & 0xff] << 2) |
      (SPREAD[(((atHi << 8) | (latHi ? 0xff : 0)) >> sh) & 0xff] << 3);
    if (this.f_bgVisibility === 1 && (x0 >= 8 || this.f_bgClipping === 1)) {
      idx |= SPREAD[(bgLo >> sh) & 0xff] | (SPREAD[(bgHi >> sh) & 0xff] << 1);
    }
    const buffer = this.buffer;
    const pixColors = this.pixColors;
    const out = (line << 8) | x0;
    if (
      !this.sprLineValid ||
      this.f_spVisibility !== 1 ||
      (this.sprTileMask & (1 << (x0 >> 3))) === 0
    ) {
      for (let k = 0; k < n; k++) {
        buffer[out + k] = pixColors[(idx >>> (28 - 4 * k)) & 15];
      }
    } else {
      const sprLine = this.sprLine;
      const spLeft = this.f_spClipping === 1;
      for (let k = 0; k < n; k++) {
        const x = x0 + k;
        let colorIndex = (idx >>> (28 - 4 * k)) & 15;
        const spr = sprLine[x];
        if (spr !== 0 && (x >= 8 || spLeft)) {
          const opaque = (colorIndex & 3) !== 0;
          if (spr & 0x200 && opaque && x !== 255) {
            this.sprite0HitFlag = 1;
          }
          if (!opaque || (spr & 0x100) === 0) {
            colorIndex = spr & 0x1f;
          }
        }
        buffer[out + k] = pixColors[colorIndex];
      }
    }

    // Shift the registers n times (see _shiftBg()).
    const ones = (1 << n) - 1;
    bgLo = (bgLo << n) & 0xffff;
    bgHi = ((bgHi << n) | ones) & 0xffff;
    atLo = ((atLo << n) | (latLo ? ones : 0)) & 0xff;
    atHi = ((atHi << n) | (latHi ? ones : 0)) & 0xff;

    // The fetches on the odd dots, and at the end of the tile, the reload.
    for (let dot = from | 1; dot < to; dot += 2) {
      this._bgFetch(dot);
    }
    if ((to & 7) === 1) {
      bgLo = (bgLo & 0xff00) | this.ptLo;
      bgHi = (bgHi & 0xff00) | this.ptHi;
      this.attrLatchLo = this.atBits & 1;
      this.attrLatchHi = this.atBits >> 1;
      this._incCoarseX();
      if (to === 257) this._incY();
    }
    this.bgShiftLo = bgLo;
    this.bgShiftHi = bgHi;
    this.attrShiftLo = atLo;
    this.attrShiftHi = atHi;
  }

  // _renderBackgroundSpan(), one dot at a time, with the sprite output
  // units run on every dot (see _spritePixel()).
  _renderBackgroundDots(line, from, to) {
    let bgLo = this.bgShiftLo;
    let bgHi = this.bgShiftHi;
    let atLo = this.attrShiftLo;
    let atHi = this.attrShiftHi;
    let latLo = this.attrLatchLo;
    let latHi = this.attrLatchHi;
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

    let dot = from;
    while (dot < to) {
      // Output the pixel for x = dot - 1.
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
        if (spr !== 0 && (bgPixel === 0 || (spr & 0x100) === 0)) {
          colorIndex = spr & 0x1f;
        }
      }
      buffer[rowBase | x] = palColors[colorIndex];

      // Shift the background registers. The pattern shifters shift in a 0
      // (low plane) and a 1 (high plane), which shows up if the PPU is made
      // to skip a reload. The attribute shifters shift in their latch.
      bgLo = (bgLo << 1) & 0xffff;
      bgHi = ((bgHi << 1) | 1) & 0xffff;
      atLo = ((atLo << 1) | latLo) & 0xff;
      atHi = ((atHi << 1) | latHi) & 0xff;

      // Background fetch for this dot.
      if ((dot & 7) === 0) {
        // End of a tile: load it into the shift registers.
        bgLo = (bgLo & 0xff00) | this.ptLo;
        bgHi = (bgHi & 0xff00) | this.ptHi;
        latLo = this.atBits & 1;
        latHi = this.atBits >> 1;
        this._incCoarseX();
        if (dot === 256) this._incY();
      } else if ((dot & 1) === 1) {
        this._bgFetch(dot);
      }
      dot++;
    }

    this.bgShiftLo = bgLo;
    this.bgShiftHi = bgHi;
    this.attrShiftLo = atLo;
    this.attrShiftHi = atHi;
    this.attrLatchLo = latLo;
    this.attrLatchHi = latHi;
  }

  // Render n whole tiles (8 dots each) starting at dot (dot & 7 === 1) of a
  // visible line: the same as running the per-dot background pipeline in
  // _renderBackgroundSpan() for 8n dots, with the state in locals. Only
  // used when the sprites can be drawn from the sprite line buffer (or
  // there are none).
  //
  // Within a tile, the four fetches (nametable, attribute, pattern low and
  // high on dots 1, 3, 5 and 7) only fill latches that the tile's own
  // pixels don't use, so they're done first. Pixel k of the tile is the
  // bit that would be at the top of the shift registers after k shifts.
  _renderTiles(line, dot, n) {
    const vram = this.vramMem;
    const mirror = this.vramMirrorTable;
    const buffer = this.buffer;
    const pixColors = this.pixColors;
    const mmap = this.nes.mmap;
    const override = mmap.bgTileOverride;
    const ptBase = this.f_bgPatternTable << 12;
    // Bit (7 - k) of the 8-bit windows (x >> sh) & 0xff of the shift
    // registers is what pixel k of the tile uses. The attribute windows
    // continue into the latch bits once the shifter's own bits run out.
    const sh = 8 - this.fineX;
    const showBg = this.f_bgVisibility === 1;
    const bgLeft = this.f_bgClipping === 1;
    const tileIdx = this.tileIdx;
    const rowBase = line << 8;
    let v = this.vramAddress;
    let bgLo = this.bgShiftLo;
    let bgHi = this.bgShiftHi;
    let atLo = this.attrShiftLo;
    let atHi = this.attrShiftHi;
    let latLo = this.attrLatchLo;
    let latHi = this.attrLatchHi;
    let ntByte = this.ntByte;
    let atBits = this.atBits;
    let ptLo = this.ptLo;
    let ptHi = this.ptHi;

    // Where the current nametable is in vramMem (nametables are mirrored
    // in 1KB blocks, see setMirroring()).
    let ntBase = mirror[0x2000 | (v & 0x0c00)];
    for (let t = 0; t < n; t++, dot += 8) {
      // The fetches.
      ntByte = vram[ntBase | (v & 0x03ff)];
      if ((v & 1) === 0 || t === 0 || override) {
        // Each attribute byte covers 4x4 tiles; pick the 2x2 quadrant.
        // (Pairs of tiles, from an even coarse X, use the same one.)
        const at = vram[ntBase | 0x3c0 | ((v >> 4) & 0x38) | ((v >> 2) & 0x07)];
        atBits = (at >> (((v >> 4) & 4) | (v & 2))) & 3;
      }
      const addr = ptBase | (ntByte << 4) | (v >> 12);
      ptLo = vram[addr];
      ptHi = vram[addr + 8];
      mmap.latchAccess(addr + 8);
      if (override) {
        this.vramAddress = v;
        this.ntByte = ntByte;
        this.ptLo = ptLo;
        this.ptHi = ptHi;
        this.atBits = atBits;
        this._mapperBgOverride();
        ptLo = this.ptLo;
        ptHi = this.ptHi;
        atBits = this.atBits;
      }

      // The pixels. Each pixel's 4-bit palette index (2 bits from the
      // pattern, 2 from the attribute) is put together in a nibble of a
      // 32-bit word, pixel k in bits 28-4k to 31-4k (see SPREAD), and
      // pixColors turns it into a color (index 0, 4, 8 or 12 means a
      // transparent pixel, i.e. the backdrop color).
      const x0 = dot - 1;
      let idx =
        (SPREAD[(((atLo << 8) | (latLo ? 0xff : 0)) >> sh) & 0xff] << 2) |
        (SPREAD[(((atHi << 8) | (latHi ? 0xff : 0)) >> sh) & 0xff] << 3);
      if (showBg && (x0 >= 8 || bgLeft)) {
        idx |= SPREAD[(bgLo >> sh) & 0xff] | (SPREAD[(bgHi >> sh) & 0xff] << 1);
      }
      const out = rowBase | x0;
      buffer[out] = pixColors[idx >>> 28];
      buffer[out + 1] = pixColors[(idx >>> 24) & 15];
      buffer[out + 2] = pixColors[(idx >>> 20) & 15];
      buffer[out + 3] = pixColors[(idx >>> 16) & 15];
      buffer[out + 4] = pixColors[(idx >>> 12) & 15];
      buffer[out + 5] = pixColors[(idx >>> 8) & 15];
      buffer[out + 6] = pixColors[(idx >>> 4) & 15];
      buffer[out + 7] = pixColors[idx & 15];
      // Sprites are drawn over the tile afterwards (see below).
      tileIdx[x0 >> 3] = idx;

      // After 8 shifts the old tile is gone, the next tile is in the high
      // half, and the attribute shifters are full of their latch bits.
      // Then the tile just fetched is loaded.
      bgLo = ((bgLo << 8) & 0xff00) | ptLo;
      bgHi = ((bgHi << 8) & 0xff00) | ptHi;
      atLo = latLo ? 0xff : 0;
      atHi = latHi ? 0xff : 0;
      latLo = atBits & 1;
      latHi = atBits >> 1;
      // Increment coarse X (see _incCoarseX()), and at the end of the
      // line, Y (_incY()).
      if ((v & 0x001f) === 31) {
        v = (v & ~0x001f) ^ 0x0400;
        ntBase = mirror[0x2000 | (v & 0x0c00)];
      } else {
        v++;
      }
      if (dot === 249) {
        this.vramAddress = v;
        this._incY();
        v = this.vramAddress;
      }
    }

    this.vramAddress = v;
    this.bgShiftLo = bgLo;
    this.bgShiftHi = bgHi;
    this.attrShiftLo = atLo;
    this.attrShiftHi = atHi;
    this.attrLatchLo = latLo;
    this.attrLatchHi = latHi;
    this.ntByte = ntByte;
    this.atBits = atBits;
    this.ptLo = ptLo;
    this.ptHi = ptHi;

    // Draw the sprite pixels in these tiles over the background.
    if (this.sprLineValid && this.f_spVisibility === 1) {
      // (dot is now just past the last tile; note 1 << 32 is 1 in JS.)
      const start = ((dot - 1) >> 3) - n;
      const run = n >= 32 ? -1 : ((1 << n) - 1) << start;
      const mask = this.sprTileMask & run;
      if (mask !== 0) this._drawSpriteTiles(line, mask);
    }
  }

  // Draw the sprite pixels (from the sprite line buffer) in the tiles in
  // `mask` (bit k = x from 8k to 8k + 7), over the background pixels
  // _renderTiles() has just drawn there, whose palette indexes are in
  // tileIdx. Also detects sprite 0 hits.
  _drawSpriteTiles(line, mask) {
    const buffer = this.buffer;
    const pixColors = this.pixColors;
    const sprLine = this.sprLine;
    const tileIdx = this.tileIdx;
    const spLeft = this.f_spClipping === 1;
    const rowBase = line << 8;
    for (let tile = 0; tile < 32; tile++) {
      if ((mask & (1 << tile)) === 0) continue;
      const idx = tileIdx[tile];
      const x0 = tile << 3;
      for (let k = 0; k < 8; k++) {
        const x = x0 + k;
        const spr = sprLine[x];
        if (spr !== 0 && (x >= 8 || spLeft)) {
          const colorIndex = (idx >>> (28 - 4 * k)) & 15;
          const opaque = (colorIndex & 3) !== 0;
          if (spr & 0x200 && opaque && x !== 255) {
            this.sprite0HitFlag = 1;
          }
          // Sprites are drawn in front of the background unless their
          // priority bit says otherwise (and the background is opaque).
          if (!opaque || (spr & 0x100) === 0) {
            buffer[rowBase | x] = pixColors[spr & 0x1f];
          }
        }
      }
    }
  }

  // Sprite evaluation (for the next line) for dots [from, to).
  _evaluateSpan(line, from, to) {
    if (from === 1 && to === 257) {
      // The span covers the whole line: clear secondary OAM in one go (the
      // same as the per-dot loop below does for dots 1-64), then evaluate.
      this.secondaryOAM.fill(0xff);
      this._startEvaluation();
      this._evaluateWindow(line);
      return;
    }
    let dot = from;
    for (; dot < to && dot <= 64; dot++) {
      // Clear secondary OAM, one byte every 2 dots.
      if ((dot & 1) === 0) {
        this.secondaryOAM[(dot >> 1) - 1] = 0xff;
        this.secIdx = (dot >> 1) & 0x1f;
        if (dot === 64) {
          this._startEvaluation();
        }
      }
    }
    if (dot >= to) return;
    if (dot === 65 && to === 257) {
      // The span covers the whole evaluation: use the faster loop.
      this._evaluateWindow(line);
    } else {
      this._evaluateRange(line, dot, to);
    }
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
    this.evalAligned = this.sramAddress === 0;
    this.secIdx = 0;
    this.secFull = false;
    this.evalDone = false;
    this.evalOvfStep = 0;
    this.sprite0Next = false;
  }

  // The whole of sprite evaluation (dots 65-256) in one go: the same state
  // machine as _evaluateRange(), with shortcuts.
  _evaluateWindow(line) {
    const oam = this.spriteMem;
    const sec = this.secondaryOAM;
    const height = this.f_spriteSize ? 16 : 8;
    let addr = this.sramAddress;
    let secIdx = this.secIdx;
    let secFull = this.secFull;
    let done = this.evalDone;
    let ovfStep = this.evalOvfStep;
    let latch = this.oamLatch;
    let dot = 66;
    if (addr === 0) {
      // Fast path for the usual case of OAMADDR starting at 0: the state
      // machine below then simply visits the 64 sprites in order, taking
      // one step (2 dots) for a sprite that isn't on the line and four
      // (copying its 4 bytes) for one that is. That holds until secondary
      // OAM is full, at which point the overflow logic (with its
      // misaligned reads) takes over in the loop below. Even with 8
      // sprites found that's at most 64 + 3 * 8 = 88 of the 96 steps.
      //
      // _oamLineCache() lists the sprites on each line, so we only need to
      // look at those. (The Y coordinates of the sprites that aren't on the
      // line also get written to secondary OAM, each overwriting the last,
      // until the next sprite that is gets copied there.)
      if (this.oamDirty || this.oamCacheHeight !== height) {
        this._oamLineCache(height);
      }
      const list = this.oamLineList;
      const base = line << 3;
      const n = this.oamLineCount[line]; // sprites found (up to 8)
      for (let k = 0; k < n; k++) {
        const a = list[base + k] << 2;
        const b = k << 2;
        sec[b] = oam[a];
        sec[b + 1] = oam[a + 1];
        sec[b + 2] = oam[a + 2];
        sec[b + 3] = oam[a + 3];
      }
      if (n !== 0 && list[base] === 0) this.sprite0Next = true;
      let i; // sprites visited
      let steps;
      if (n === 8) {
        i = list[base + 7] + 1;
        steps = i + 3 * 8;
      } else {
        i = 64;
        steps = 64 + 3 * n;
        if (n === 0 || list[base + n - 1] !== 63) sec[n << 2] = oam[252];
      }
      addr = i << 2;
      dot = 66 + 2 * steps;
      secIdx = (n << 2) & 0x1f;
      if (n === 8) secFull = true;
      if (addr > 0xff) {
        done = true;
        addr &= 0xff;
      }
    }
    for (; dot <= 256; dot += 2) {
      if (done) {
        // All sprites checked: OAMADDR just steps by 4 per 2 dots.
        const steps = ((256 - dot) >> 1) + 1;
        latch = oam[(addr + 4 * (steps - 1)) & 0xff];
        addr = (addr + 4 * steps) & 0xff;
        break;
      }
      // Odd dot: read OAM. Even dot: process the byte.
      const s = (latch = oam[addr]);
      const row = line - s;
      const inRange = row >= 0 && row < height;
      if (!secFull) {
        const step = secIdx & 3;
        sec[secIdx] = s;
        if (step === 0) {
          if (inRange) {
            if (dot === 66) this.sprite0Next = true;
            secIdx++;
            addr++;
          } else {
            addr = (addr + 4) & ~3;
          }
        } else if (step < 3) {
          secIdx++;
          addr++;
        } else {
          secIdx++;
          addr = inRange ? addr + 1 : (addr + 1) & ~3;
        }
        if (secIdx === 32) {
          secFull = true;
          secIdx = 0;
        }
      } else if (ovfStep === 0) {
        if (inRange) {
          this.spriteOverflowFlag = 1;
          ovfStep = 1;
          addr++;
        } else {
          addr += 5;
        }
      } else if (ovfStep < 3) {
        ovfStep++;
        addr++;
      } else {
        ovfStep = 0;
        addr = inRange ? addr + 1 : addr + 5;
      }
      if (addr > 0xff) {
        done = true;
        addr &= 0xff;
      }
    }
    this.sramAddress = addr;
    this.secIdx = secIdx;
    this.secFull = secFull;
    this.evalDone = done;
    this.evalOvfStep = ovfStep;
    this.oamLatch = latch;
  }

  // Sprite evaluation for dots [from, to) (65 <= from < to <= 257). On odd
  // dots the PPU reads OAM[OAMADDR] into a latch; on even dots it
  // processes the byte read.
  _evaluateRange(line, from, to) {
    const oam = this.spriteMem;
    const sec = this.secondaryOAM;
    const height = this.f_spriteSize ? 16 : 8;
    let addr = this.sramAddress;
    let secIdx = this.secIdx;
    let secFull = this.secFull;
    let done = this.evalDone;
    let ovfStep = this.evalOvfStep;
    let latch = this.oamLatch;
    for (let dot = from; dot < to; dot++) {
      if ((dot & 1) === 1) {
        latch = oam[addr];
        continue;
      }
      const s = latch;
      // Is s, read as a Y coordinate, in range for the next line?
      const row = line - s;
      const inRange = row >= 0 && row < height;
      if (done) {
        // All sprites checked: the PPU keeps stepping through OAM, failing
        // to copy into secondary OAM.
        addr += 4;
      } else if (!secFull) {
        // Copy mode: there's still room in secondary OAM.
        const step = secIdx & 3;
        sec[secIdx] = s;
        if (step === 0) {
          // Y coordinate.
          if (inRange) {
            if (dot === 66) this.sprite0Next = true;
            secIdx++;
            addr++;
          } else {
            // Skip to the next sprite (and realign OAMADDR).
            addr = (addr + 4) & ~3;
          }
        } else if (step < 3) {
          // Tile and attributes.
          secIdx++;
          addr++;
        } else {
          // X coordinate. The hardware applies the same "in range" check
          // to it; if that fails, OAMADDR is realigned.
          secIdx++;
          addr = inRange ? addr + 1 : (addr + 1) & ~3;
        }
        if (secIdx === 32) {
          secFull = true;
          secIdx = 0;
        }
      } else if (ovfStep === 0) {
        // Secondary OAM is full: look for a 9th sprite to set the overflow
        // flag. Writes to secondary OAM become reads.
        if (inRange) {
          this.spriteOverflowFlag = 1;
          ovfStep = 1;
          addr++;
        } else {
          // Hardware bug: both the sprite index and the byte index are
          // incremented, so the next "Y" read is really some other byte.
          addr += 5;
        }
      } else if (ovfStep < 3) {
        ovfStep++;
        addr++;
      } else {
        ovfStep = 0;
        addr = inRange ? addr + 1 : addr + 5;
      }
      if (addr > 0xff) {
        // Wrapped around the end of OAM.
        done = true;
        addr &= 0xff;
      }
    }
    this.sramAddress = addr;
    this.secIdx = secIdx;
    this.secFull = secFull;
    this.evalDone = done;
    this.evalOvfStep = ovfStep;
    this.oamLatch = latch;
  }

  // For each visible line, list (in oamLineList[line * 8 + k]) the first 8
  // sprites whose Y coordinate puts them on the line, and count them (up
  // to 8) in oamLineCount. Only redone when OAM changes (oamDirty) or the
  // sprite height does.
  _oamLineCache(height) {
    this.oamDirty = false;
    this.oamCacheHeight = height;
    const count = this.oamLineCount;
    const list = this.oamLineList;
    const oam = this.spriteMem;
    count.fill(0);
    for (let i = 0; i < 64; i++) {
      const y = oam[i << 2];
      let end = y + height;
      if (end > 240) end = 240;
      for (let l = y; l < end; l++) {
        const c = count[l];
        if (c < 8) {
          list[(l << 3) + c] = i;
          count[l] = c + 1;
        }
      }
    }
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
    this.oamDirty = true;
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
      // (Plain loops: fill() has a high fixed cost for 8 pixels.)
      for (y = 8; y < 232; y++) {
        const row = y << 8;
        for (let x = 0; x < 8; x++) {
          buffer[row + x] = 0;
          buffer[row + 248 + x] = 0;
        }
      }
      buffer.fill(0, 0, 8 << 8);
      buffer.fill(0, 232 << 8, 240 << 8);
    } else if (this.f_bgClipping === 0 || this.f_spClipping === 0) {
      for (y = 0; y < 240; y++) {
        const row = y << 8;
        for (let x = 0; x < 8; x++) buffer[row + x] = 0;
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
    this.nes.cpu.flushPpuCycles();
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
    this.oamDirty = true;
    const cpu = this.nes.cpu;
    cpu.ppuCycles = cpu.cycles;
    cpu.nextEvent = 0;
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

// SEC_IDX_STEPS[n] is how many times the secondary OAM address has been
// incremented after the first n dots of the sprite fetch period (dots
// 257-320): on the 1st, 2nd, 3rd and 8th dot of each 8-dot group.
const SEC_IDX_STEPS = new Uint8Array(65);
for (let n = 1; n <= 64; n++) {
  const phase = (n - 1) & 7;
  SEC_IDX_STEPS[n] = SEC_IDX_STEPS[n - 1] + (phase <= 2 || phase === 7 ? 1 : 0);
}

// SPREAD[b] spreads the 8 bits of a byte out to one bit per nibble of a
// 32-bit word: bit 7 - k of b goes to bit 28 - 4k. Used to put together 8
// pixels' palette indexes at once from the bit planes of a tile row.
const SPREAD = new Int32Array(256);
for (let b = 0; b < 256; b++) {
  let spread = 0;
  for (let k = 0; k < 8; k++) {
    if (b & (0x80 >> k)) spread |= 1 << (28 - 4 * k);
  }
  SPREAD[b] = spread;
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

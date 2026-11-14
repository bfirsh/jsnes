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

// MMC3-style mappers only count a rising edge of PPU address line A12 if
// A12 has been low for long enough (they filter it using the CPU clock, M2).
// In PPU dots, the gaps between pattern fetches during rendering are 4 or 8
// dots (filtered out) or at least 12 (counted). See _a12Fetch().
const A12_FILTER_DOTS = 10;

// Pattern fetch pairs start every 8 dots (dots 5, 13, ..., 333). We clock the
// mapper's counter A12_PHASE dots into each 8-dot group that fetches from
// $1000 (dots 7, 15, ..., 335; e.g. dot 263 for sprite slot 0, dot 327 for
// the first background tile of the next line). That is a little after the
// address actually changes, which accounts for the delay before the MMC3
// asserts its IRQ; the value is calibrated against blargg's
// mmc3_test/4-scanline_timing, which checks the IRQ timing to the PPU dot.
const A12_PHASE = 7;

// Palette RAM contents at power-on (see the constructor).
const POWER_UP_PALETTE = [
  0x09, 0x01, 0x00, 0x01, 0x00, 0x02, 0x02, 0x0d, 0x08, 0x10, 0x08, 0x24, 0x00,
  0x00, 0x04, 0x2c, 0x09, 0x01, 0x34, 0x03, 0x00, 0x04, 0x00, 0x14, 0x08, 0x3a,
  0x00, 0x02, 0x00, 0x20, 0x2c, 0x08,
];

// Frames before an un-refreshed PPU open bus bit decays to 0 (~600ms).
const OPEN_BUS_DECAY_FRAMES = 36;

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
    this.lastVramReadCycle = -10; // CPU cycle of the last $2007 read
    this.sramAddress = 0; // OAMADDR ($2003)

    // PPU has its own internal I/O bus, whose capacitance holds the last
    // value driven onto it (the "decay register"). All PPU register writes
    // set all 8 bits. Reads refresh only the bits the PPU actually drives:
    // $2002 drives bits 7-5, $2004 and non-palette $2007 drive all 8,
    // palette $2007 reads drive bits 5-0. Reading a write-only register
    // ($2000,$2001,$2003,$2005,$2006) returns the latch without refreshing
    // it. Each bit that isn't refreshed decays to 0 after ~600ms, so we keep
    // a countdown (in frames) per bit. See ppu_open_bus in
    // https://github.com/christopherpow/nes-test-roms and
    // https://www.nesdev.org/wiki/Open_bus_behavior#PPU_open_bus
    this.openBusLatch = 0;
    this.openBusDecay = new Uint8Array(8);

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

    // --- PPU A12 (for MMC3-style scanline counters) ---
    //
    // MMC3 counts rising edges of PPU address line 12, i.e. the PPU moving
    // from reading the pattern table at $0000 to the one at $1000. During
    // rendering this happens at specific pattern fetches (see _a12Fetch());
    // otherwise the address bus holds v, so writes to $2006 and $2007
    // accesses can clock the counter too. Only tracked when the mapper sets
    // a12Watch. See https://www.nesdev.org/wiki/MMC3#IRQ_Specifics
    //
    // True while A12 is held high by v (rendering not using the bus).
    this.a12High = false;
    // dotsRun value at which A12 last went low.
    this.a12LowSince = -1000;
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

    // Palette RAM isn't cleared at power-on. Its contents are effectively
    // random, but tend to be similar on a given console; use the values
    // blargg recorded from his NES (checked by power_up_palette in his 2005
    // PPU tests), as other emulators do.
    this.vramMem.set(POWER_UP_PALETTE, 0x3f00);

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

  // The reset button. The PPU's reset line clears PPUCTRL, PPUMASK, the
  // $2005/$2006 write toggle and the read buffer; VRAM, OAM, palette and
  // the scroll position are unaffected.
  // (Real PPUs also ignore writes to several registers until the end of the
  // first VBlank after reset; that isn't emulated.)
  // See https://www.nesdev.org/wiki/PPU_power_up_state
  softReset() {
    this.catchUp();
    this.updateControlReg1(0);
    this.updateControlReg2(0);
    this.firstWrite = true;
    this.vramBufferedReadValue = 0;
    // Our upcoming events (NMI, rendering-dependent ones) may have changed.
    this.nextEventDot = 0;
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
    const wasOn = this.renderingOn;
    this.renderingOn = on;
    if (wasOn !== on) {
      // Rendering takes over the address bus from v, or gives it back.
      this._a12FromV();
    }
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

    // Only the 3 status bits are driven onto the PPU bus.
    this.refreshOpenBus(0xe0, value);
    return value;
  }

  // Set the bits of the PPU open bus latch selected by `mask` to `value`,
  // restarting their decay timers.
  refreshOpenBus(mask, value) {
    this.openBusLatch = (this.openBusLatch & ~mask) | (value & mask);
    for (let i = 0; i < 8; i++) {
      if (mask & (1 << i)) {
        this.openBusDecay[i] = OPEN_BUS_DECAY_FRAMES;
      }
    }
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
    const value = this._oamDataValue();
    // $2004 drives all 8 bits onto the PPU bus.
    this.refreshOpenBus(0xff, value);
    return value;
  }

  _oamDataValue() {
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
      this._a12FromV();
    }
    this.firstWrite = !this.firstWrite;
  }

  // $2007 (PPUDATA) read.
  vramLoad() {
    // A $2007 read starts a VRAM fetch into the read buffer which takes a
    // few PPU dots to complete. If a second read arrives on the very next
    // CPU cycle (e.g. the dummy read + real read of LDA $20F7,X with a page
    // crossing), it is effectively ignored: it doesn't touch the buffer or
    // the address and the CPU just sees the PPU bus latch. The exact result
    // depends on the CPU/PPU clock alignment; this matches one of the
    // alignments real hardware shows (tested by double_2007_read in
    // blargg's dmc_dma_during_read4).
    const cycle = this.nes.cpu.cycles;
    if (cycle - this.lastVramReadCycle === 1) {
      return this.openBusLatch;
    }
    this.lastVramReadCycle = cycle;

    const address = this.vramAddress & 0x3fff;
    let value;
    if (address <= 0x3eff) {
      // Reads are delayed by one: return the buffer, then refill it.
      value = this.vramBufferedReadValue;
      if (address < 0x2000) {
        this.vramBufferedReadValue = this.vramMem[address];
        this.nes.mmap.latchAccess(address);
      } else {
        // $3000-$3EFF mirrors the nametables at $2000-$2EFF.
        this.vramBufferedReadValue = this.mirroredLoad(address & 0x2fff);
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
    // VRAM reads drive all 8 bits onto the PPU bus; palette reads only the
    // low 6 (the top 2 came from the latch above).
    this.refreshOpenBus(address <= 0x3eff ? 0xff : 0x3f, value);
    return value;
  }

  // $2007 (PPUDATA) write.
  vramWrite(value) {
    const address = this.vramAddress & 0x3fff;
    if (address >= 0x3f00) {
      // Palette RAM ($3F00-$3F1F, mirrored up to $3FFF).
      this.mirroredWrite(0x3f00 | (address & 0x1f), value);
    } else if (address >= 0x2000) {
      // Nametables; $3000-$3EFF mirrors $2000-$2EFF.
      this.mirroredWrite(address & 0x2fff, value);
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
      this._a12FromV();
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
        if (this.f_bgPatternTable === 1 && this.nes.mmap.a12Watch) {
          this._a12BgSpan(dot, end);
        }
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
    if (this.renderingOn && this.nes.mmap && this.nes.mmap.a12Watch) {
      e = this._dotsUntilA12Clock();
      if (e < d) d = e;
    } else if (this.renderingOn) {
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

  // --- PPU A12 tracking (see the constructor) ---
  //
  // During rendering every pattern fetch pair is followed by a nametable
  // fetch (A12 low), so A12 is only ever high for the 4 dots of a pattern
  // fetch pair. There's one pair every 8 dots, 42 per line: 32 background
  // tiles, then the 8 sprite slots (dots 261-320), then the first 2
  // background tiles of the next line. We evaluate each at
  // dot 8*j + A12_PHASE (j = 0..41). So with the background at $0000 and
  // sprites at $1000 the counter is clocked once per line, by sprite slot
  // 0; with the background at $1000 and sprites at $0000, once per line by
  // the first background prefetch (the gaps between background tiles are
  // too short to get through the A12 filter); with both at the same table,
  // not at all. 8x16 sprites can clock it several times per line.

  // A12 level of the pattern fetch evaluated at `dot`.
  _a12Level(dot) {
    const j = (dot - A12_PHASE) >> 3;
    if (j < 32 || j >= 40) return this.f_bgPatternTable;
    if (!this.f_spriteSize) return this.f_spPatternTable;
    // 8x16 sprites: bit 0 of the tile number picks the pattern table.
    // Unused slots fetch tile $FF (secondary OAM is cleared to $FF).
    return this.secondaryOAM[((j - 32) << 2) + 1] & 1;
  }

  // A pattern fetch on a rendering line, at dot `dot`, which is dot number
  // `at` in dotsRun terms.
  _a12Fetch(dot, at) {
    if (this._a12Level(dot) === 0) return;
    this._a12Rise(at);
    // The nametable fetch 4 dots later brings A12 low again.
    this.a12LowSince = at + 4;
  }

  // Background pattern fetches with the background at $1000, for the fast
  // path in catchUp(): dots [dot, end) of a visible line.
  _a12BgSpan(dot, end) {
    // First and last fetch evaluation dots in [dot, end).
    const firstDot = dot + ((A12_PHASE - dot) & 7);
    if (firstDot >= end) return;
    this._a12Rise(this.dotsRun + (firstDot - dot));
    const lastDot = end - 1 - ((end - 1 - A12_PHASE) & 7);
    this.a12LowSince = this.dotsRun + (lastDot - dot) + 4;
  }

  _a12Rise(at) {
    if (!this.a12High && at - this.a12LowSince > A12_FILTER_DOTS) {
      this.nes.mmap.clockIrqCounter();
    }
  }

  // Outside rendering, the PPU address bus holds v.
  _a12FromV() {
    if (this._isRenderingLine() || !this.nes.mmap || !this.nes.mmap.a12Watch) {
      if (this.a12High) {
        // Rendering's first fetch (a nametable) brings A12 low.
        this.a12High = false;
        this.a12LowSince = this.dotsRun;
      }
      return;
    }
    const high = (this.vramAddress & 0x1000) !== 0;
    if (high && !this.a12High) {
      this._a12Rise(this.dotsRun);
    } else if (!high && this.a12High) {
      this.a12LowSince = this.dotsRun;
    }
    this.a12High = high;
  }

  // Dots until rendering next clocks the mapper's A12 counter, by
  // simulating the fetches on the current and next rendering lines with
  // the current PPU settings. If 8x16 sprites are in use and secondary OAM
  // isn't final yet (before dot 257 of the current line, or any later
  // line), any sprite slot might be at $1000, so it's treated as a
  // possible clock; the schedule is recomputed after each event anyway.
  _dotsUntilA12Clock() {
    if (
      this.f_bgPatternTable === 0 &&
      this.f_spriteSize === 0 &&
      this.f_spPatternTable === 0
    ) {
      // Rendering never reads from $1000.
      return Infinity;
    }
    let high = this.a12High;
    let lowSince = this.a12LowSince - this.dotsRun; // relative to now
    let line = this.line;
    let dot = this.dot;
    // Dots from now until dot 0 of `line` (negative for the current line).
    let rel = -dot;
    for (let n = 0; n < 3; n++) {
      if (line < 240 || line === 261) {
        if (high) {
          high = false;
          lowSince = rel + 1;
        }
        const sprKnown = n === 0 && this.dot >= 257;
        let p = n === 0 ? dot + ((A12_PHASE - dot) & 7) : A12_PHASE;
        for (; p <= 328 + A12_PHASE; p += 8) {
          let level;
          const pj = (p - A12_PHASE) >> 3;
          if (pj < 32 || pj >= 40 || !this.f_spriteSize || sprKnown) {
            level = this._a12Level(p);
          } else {
            level = 1; // unknown: assume it could be at $1000
          }
          if (level === 0) {
            // Skip the rest of a run of fetches from $0000.
            if (pj < 32) {
              p = 31 * 8 + A12_PHASE;
            } else if (pj < 40 && !this.f_spriteSize) {
              p = 39 * 8 + A12_PHASE;
            }
            continue;
          }
          const t = rel + p;
          if (t - lowSince > A12_FILTER_DOTS) {
            return t;
          }
          // The rest of a run of fetches from the same table can't clock
          // the counter either (the gaps between them are too short), so
          // skip to the end of the run.
          if (pj < 32) {
            p = 31 * 8 + A12_PHASE;
          } else if (pj < 40 && !this.f_spriteSize) {
            p = 39 * 8 + A12_PHASE;
          }
          lowSince = rel + p + 4;
        }
      }
      // On to the next line.
      rel += 341;
      line++;
      if (line === 240) {
        // Vblank: the bus holds v (which only the CPU can change, and
        // that triggers a reschedule).
        if ((this.vramAddress & 0x1000) !== 0) {
          high = true;
        }
        rel += 21 * 341;
        line = 261;
      } else if (line === 262) {
        line = 0;
      }
      dot = 0;
    }
    return Infinity;
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
    if (line === 240) {
      // Rendering has finished with the address bus; it holds v again.
      this._a12FromV();
    }
  }

  _startVBlank() {
    if (!this.nmiSuppressed) {
      this.vblankFlag = 1;
      this._updateNmiOutput();
    }
    this.nmiSuppressed = false;

    // PPU open bus latch decay: each bit that hasn't been refreshed for
    // ~600ms decays to 0.
    for (let i = 0; i < 8; i++) {
      if (this.openBusDecay[i] > 0 && --this.openBusDecay[i] === 0) {
        this.openBusLatch &= ~(1 << i);
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

    const mmap = this.nes.mmap;
    if (mmap.a12Watch) {
      // (Dots 257-320 are handled by _spriteFetchSpan().)
      if (
        ((dot - A12_PHASE) & 7) === 0 &&
        dot <= 328 + A12_PHASE &&
        (dot < 257 || dot > 320)
      ) {
        this._a12Fetch(dot, this.dotsRun);
      }
    } else if (dot > 320 && dot === mmap.irqClockDot) {
      // Clock the mapper's scanline counter once per rendered line (see
      // Mapper0.irqClockDot). Dots 257-320 are handled by
      // _spriteFetchSpan().
      mmap.clockIrqCounter();
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
    const mmap = this.nes.mmap;
    if (mmap.a12Watch) {
      // Sprite pattern fetches can clock an MMC3-style counter (see
      // _a12Fetch()).
      for (let p = from + ((A12_PHASE - from) & 7); p < to; p += 8) {
        this._a12Fetch(p, this.dotsRun + (p - from));
      }
    } else {
      const irqDot = mmap.irqClockDot;
      if (irqDot >= from && irqDot < to) {
        // Clock the mapper's scanline counter (see Mapper0.irqClockDot).
        mmap.clockIrqCounter();
      }
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
    const vram = this.vramMem;
    const mirror = this.vramMirrorTable;

    let dot = from;
    while (dot < to) {
      const spritesSimple =
        this.sprLineValid || (this.sprCount === 0 && !this.spriteSkipGlitch);

      if ((dot & 7) === 1 && dot + 8 <= to && spritesSimple) {
        // --- Fast path: one whole tile (8 dots) at once ---
        // The four fetches (the same as _bgFetch() does on dots 1, 3, 5 and
        // 7 of the group) only fill latches, which the pixels of this group
        // don't use, so do them first.
        {
          const v = this.vramAddress;
          const ntByte = vram[mirror[0x2000 | (v & 0x0fff)]];
          const at =
            vram[
              mirror[
                0x23c0 | (v & 0x0c00) | ((v >> 4) & 0x38) | ((v >> 2) & 0x07)
              ]
            ];
          this.ntByte = ntByte;
          this.atBits = (at >> (((v >> 4) & 4) | (v & 2))) & 3;
          const addr =
            (this.f_bgPatternTable << 12) | (ntByte << 4) | (v >> 12);
          this.ptLo = vram[addr];
          this.ptHi = vram[addr + 8];
          const mmap = this.nes.mmap;
          mmap.latchAccess(addr + 8);
          if (mmap.bgTileOverride) {
            this._mapperBgOverride();
          }
        }

        // Pixel k of the group is the bit that would be at the top of the
        // shift registers after k shifts, i.e. bit (15 - fineX - k) of
        // their current value (attribute: bit 7 - fineX - k, or the latch
        // once that has been shifted in).
        const x0 = dot - 1;
        // Bit (7 - k) of these 8-bit windows of the shift registers is the
        // value at the top of the register after k shifts, i.e. what pixel
        // k of this group uses. The attribute windows continue into the
        // latch bits once the shifter's own bits have been used up.
        const sh = 8 - fineX;
        let pix = 0;
        if (showBg && (x0 >= 8 || bgLeft)) {
          pix =
            DECODE_PLANES[(((bgHi >> sh) & 0xff) << 8) | ((bgLo >> sh) & 0xff)];
        }
        const pal =
          DECODE_PLANES[
            (((((atHi << 8) | (latHi ? 0xff : 0)) >> sh) & 0xff) << 8) |
              ((((atLo << 8) | (latLo ? 0xff : 0)) >> sh) & 0xff)
          ];
        if (!this.sprLineValid) {
          for (let k = 0; k < 8; k++) {
            const s2 = 14 - 2 * k;
            const p = (pix >> s2) & 3;
            buffer[rowBase | (x0 + k)] =
              palColors[p === 0 ? 0 : p | (((pal >> s2) & 3) << 2)];
          }
        } else {
          for (let k = 0; k < 8; k++) {
            const x = x0 + k;
            const s2 = 14 - 2 * k;
            const p = (pix >> s2) & 3;
            const bgPixel = p === 0 ? 0 : p | (((pal >> s2) & 3) << 2);
            let colorIndex = bgPixel;
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
            buffer[rowBase | x] = palColors[colorIndex];
          }
        }

        // After 8 shifts the old tile is gone, the next tile is in the high
        // half, and the attribute shifters are full of their latch bits.
        // Then the tile just fetched is loaded.
        bgLo = ((bgLo << 8) & 0xff00) | this.ptLo;
        bgHi = ((bgHi << 8) & 0xff00) | this.ptHi;
        atLo = latLo ? 0xff : 0;
        atHi = latHi ? 0xff : 0;
        latLo = this.atBits & 1;
        latHi = this.atBits >> 1;
        this._incCoarseX();
        if (dot === 249) this._incY();
        dot += 8;
        continue;
      }

      // --- One dot at a time ---
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

  // Sprite evaluation (for the next line) for dots [from, to).
  _evaluateSpan(line, from, to) {
    for (let dot = from; dot < to; dot++) {
      if (dot === 65 && to === 257) {
        // The span covers the whole evaluation: use the faster loop.
        this._evaluateWindow(line);
        return;
      }
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

  // The whole of sprite evaluation (dots 65-256) in one go: the same state
  // machine as _evaluateSprites(), with the state in local variables.
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
    for (let dot = 66; dot <= 256; dot += 2) {
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
          // The overflow bug: see _evaluateSprites().
          addr = ((addr + 4) & 0x1fc) | ((addr + 1) & 3);
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
          // Hardware bug: both the sprite index (n, OAMADDR bits 2-7) and
          // the byte index (m, bits 0-1) are incremented, without a carry
          // from m into n, so the next "Y" read is really some other byte
          // (the 2nd byte of the next sprite, then the 3rd of the one
          // after, ...). (blargg's sprite_overflow_tests 4.Obscure)
          addr = ((addr + 4) & 0x1fc) | ((addr + 1) & 3);
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
    "lastVramReadCycle",
    "sramAddress",
    "openBusLatch",
    "a12High",
    "openBusDecay",
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
    this.a12LowSince = -1000;
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

// DECODE_PLANES[(hi << 8) | lo] packs the 8 two-bit pixels of a pair of
// bit planes, leftmost pixel in bits 14-15: pixel k is
// (DECODE_PLANES[...] >> (14 - 2 * k)) & 3.
const DECODE_PLANES = new Uint16Array(65536);
for (let v = 0; v < 65536; v++) {
  const lo = v & 0xff;
  const hi = v >> 8;
  let packed = 0;
  for (let k = 0; k < 8; k++) {
    const p = ((lo >> (7 - k)) & 1) | (((hi >> (7 - k)) & 1) << 1);
    packed |= p << (14 - 2 * k);
  }
  DECODE_PLANES[v] = packed;
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

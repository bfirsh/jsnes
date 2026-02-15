import Mapper4 from "./mapper4.js";

// TxSROM - MMC3 variant with CHR-controlled nametable mirroring
// Used by games like Armadillo, Pro Sport Hockey, Goal! Two.
// Identical to standard MMC3 except: the $A000 mirroring register is bypassed,
// and bit 7 of CHR bank register values controls CIRAM A10 (nametable page select)
// instead of being used for CHR addressing. This enables single-screen and
// diagonal mirroring modes that standard MMC3 cannot produce.
// See https://www.nesdev.org/wiki/INES_Mapper_118
class Mapper118 extends Mapper4 {
  static mapperName = "TxSROM";

  constructor(nes) {
    super(nes);
    // Raw CHR register values (R0-R5) — bit 7 is used for nametable control
    this.chrRegs = [0, 0, 0, 0, 0, 0];
  }

  write(address, value) {
    if (address === 0xa000) {
      // The standard MMC3 mirroring register is bypassed on TxSROM.
      // Nametable mirroring is instead controlled by bit 7 of CHR bank values.
      return;
    }
    super.write(address, value);
    if (address === 0x8000) {
      // chrAddressSelect may have changed, which affects which CHR registers
      // control which nametables
      this.updateNametableMirroring();
    }
  }

  executeCommand(cmd, arg) {
    if (cmd <= 5) {
      // CHR bank command: store the raw value, then mask bit 7 before passing
      // to the parent for CHR banking (bit 7 goes to CIRAM A10, not CHR A17)
      this.chrRegs[cmd] = arg;
      super.executeCommand(cmd, arg & 0x7f);
      this.updateNametableMirroring();
    } else {
      // PRG bank commands pass through unchanged
      super.executeCommand(cmd, arg);
    }
  }

  // Update nametable mirroring based on bit 7 of CHR register values.
  // The MMC3's CHR banking ignores A13, so pattern table addresses ($0xxx)
  // and nametable addresses ($2xxx) use the same bank selection. CHR A17
  // (bit 7) is wired to CIRAM A10 on TxSROM boards.
  //
  // When chrAddressSelect=0: R0/R1 (2KB banks) are at $0000-$0FFF, so they
  //   control nametables: R0 bit 7 → NT0+NT1, R1 bit 7 → NT2+NT3
  // When chrAddressSelect=1: R2-R5 (1KB banks) are at $0000-$0FFF, so they
  //   control individual nametables: R2→NT0, R3→NT1, R4→NT2, R5→NT3
  updateNametableMirroring() {
    let ppu = this.nes.ppu;

    if (this.chrAddressSelect === 0) {
      let nt01 = (this.chrRegs[0] >> 7) & 1;
      let nt23 = (this.chrRegs[1] >> 7) & 1;
      ppu.ntable1[0] = nt01;
      ppu.ntable1[1] = nt01;
      ppu.ntable1[2] = nt23;
      ppu.ntable1[3] = nt23;
    } else {
      ppu.ntable1[0] = (this.chrRegs[2] >> 7) & 1;
      ppu.ntable1[1] = (this.chrRegs[3] >> 7) & 1;
      ppu.ntable1[2] = (this.chrRegs[4] >> 7) & 1;
      ppu.ntable1[3] = (this.chrRegs[5] >> 7) & 1;
    }

    // Update VRAM mirror table to match ntable1 settings
    for (let i = 0; i < 4; i++) {
      let source = 0x2000 + i * 0x400;
      let target = 0x2000 + ppu.ntable1[i] * 0x400;
      ppu.defineMirrorRegion(source, target, 0x400);
    }

    // Invalidate the PPU's mirroring cache so setMirroring() won't skip
    // updates if called later
    ppu.currentMirroring = -1;
  }

  loadROM() {
    super.loadROM();
    this.updateNametableMirroring();
  }

  toJSON() {
    let s = super.toJSON();
    s.chrRegs = this.chrRegs.slice();
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.chrRegs = s.chrRegs;
    this.updateNametableMirroring();
  }
}

export default Mapper118;

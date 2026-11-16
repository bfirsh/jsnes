import { fromJSON, toJSON } from "./utils.js";

// ============================================================================
// 6502 opcode table
// ============================================================================
//
// The NES's CPU is a MOS 6502 variant (the Ricoh 2A03 on NTSC consoles,
// 2A07 on PAL). Like any CPU, it runs machine code by repeatedly fetching
// a byte from memory, decoding what that byte means, and executing the
// corresponding operation — the classic fetch-decode-execute loop.
//
// On the 6502, every (operation, addressing mode) pair is assigned its own
// unique 1-byte opcode. For example, "LDA" (Load Accumulator) has eight
// different opcode bytes because it supports eight addressing modes — one
// for "load from a fixed 2-byte address", one for "load from a zero-page
// address + X", and so on. That gives a total of 256 possible opcode bytes,
// of which the official 6502 defines 151; another ~80 are "unofficial"
// opcodes (see below); the rest are unused and would hang a real CPU.
//
// This file's emulate() method implements the fetch-decode-execute loop for
// a single CPU instruction. OPCODE_TABLE is the *decode* step: given the
// opcode byte we just fetched, it tells emulate() everything it needs to
// know before running the instruction:
//
//   ins    - which instruction to execute (INS_*). Used as the switch key
//            in the execute phase of emulate().
//   mode   - which addressing mode to use to find the operand (ADDR_*).
//   size   - how many bytes the instruction occupies in memory (1-3).
//   cycles - base cycle count, for reference. The emulator doesn't use
//            this: it performs every bus cycle the real CPU performs, so
//            cycle counts (including page-crossing penalties) come out
//            naturally.
//
// OPCODE_TABLE is defined as a plain object literal below, keyed by the
// raw opcode byte (0-255). Unassigned bytes (KIL/JAM opcodes, which hang a
// real 6502) are simply absent. At load time the table is flattened into
// typed arrays (OP_INS etc.) for speed; absent opcodes throw when executed.
//
// The INS_* and ADDR_* numeric values here must match the `case N:` labels
// in the execute switch in emulate(). If you ever renumber these, update
// the switch in lockstep.

// ----------------------------------------------------------------------------
// Addressing modes
// ----------------------------------------------------------------------------
//
// The 6502 has 13 addressing modes — different ways of specifying where an
// instruction's operand lives. Some modes take a literal value, some read
// from a fixed memory address, some compute an address from a base plus an
// index register (X or Y), and some dereference a pointer stored in memory.
//
// The numeric values here are used as `case` labels in the addressing-mode
// switch at the top of emulate(), which computes the final effective
// address (or loads the literal value) for each instruction before the
// instruction itself runs. The code in that switch is the authoritative
// source for what each mode actually does on the bus, including the
// sometimes-tricky "dummy reads" the real 6502 performs on indexed modes.
//
// Notation below: $XX means a 1-byte value (0-$FF), $XXXX means a 2-byte
// value (0-$FFFF). "Zero page" is the first 256 bytes of memory ($0000-
// $00FF), which the 6502 can address with a single byte — giving faster
// and smaller code than full 16-bit addresses.
//
// See https://www.nesdev.org/wiki/CPU_addressing_modes

const ADDR_ZP = 0; //          Zero page         — operand at $00XX
const ADDR_REL = 1; //         Relative          — PC + signed 8-bit offset (branches)
const ADDR_IMP = 2; //         Implied           — no operand (e.g. CLC, RTS, TAX)
const ADDR_ABS = 3; //         Absolute          — operand at $XXXX (any address)
const ADDR_ACC = 4; //         Accumulator       — operand is the A register itself
const ADDR_IMM = 5; //         Immediate         — operand is a literal byte (LDA #$42)
const ADDR_ZPX = 6; //         Zero page,X       — operand at ($XX + X) & $FF
const ADDR_ZPY = 7; //         Zero page,Y       — operand at ($XX + Y) & $FF
const ADDR_ABSX = 8; //        Absolute,X        — operand at $XXXX + X
const ADDR_ABSY = 9; //        Absolute,Y        — operand at $XXXX + Y
const ADDR_PREIDXIND = 10; //  (Indirect,X)      — pointer at ($XX + X) in zero page
const ADDR_POSTIDXIND = 11; // (Indirect),Y      — pointer at $XX in zero page, then + Y
const ADDR_INDABS = 12; //     Indirect absolute — pointer at $XXXX (JMP indirect only)

// ----------------------------------------------------------------------------
// Instructions
// ----------------------------------------------------------------------------
//
// The 6502 has 56 official instructions, each conventionally referred to
// by a 3-letter mnemonic (LDA, STA, JMP, etc.). Most instructions support
// several addressing modes, so one mnemonic usually maps to several opcode
// bytes — which is why OPCODE_TABLE below has multiple entries per
// mnemonic (e.g. LDA has eight, one for each addressing mode it supports).
//
// Each INS_* here is an internal identifier used as the `case` label in
// the execute switch in emulate(). The ordering and numeric values are
// arbitrary but must stay in sync with that switch.
//
// NOTE: the NES's 2A03/2A07 CPU omits the 6502's BCD (binary-coded decimal)
// mode. The CLD / SED instructions still exist and toggle the D flag, but
// the D flag has no effect on ADC/SBC. That's why the CLD/SED handlers in
// emulate() look like no-ops aside from flipping the flag.
//
// See https://www.nesdev.org/wiki/CPU for a per-instruction reference.

// Arithmetic & logic
const INS_ADC = 0; //  ADC — Add memory to accumulator with carry
const INS_AND = 1; //  AND — Bitwise AND memory with accumulator
const INS_ASL = 2; //  ASL — Arithmetic shift left (top bit → carry)
// Branches — each tests one status flag and jumps relative to PC if it matches
const INS_BCC = 3; //  BCC — Branch if carry clear
const INS_BCS = 4; //  BCS — Branch if carry set
const INS_BEQ = 5; //  BEQ — Branch if equal (zero flag set)
const INS_BIT = 6; //  BIT — Bit test: N ← M.7, V ← M.6, Z ← (A & M) == 0
const INS_BMI = 7; //  BMI — Branch if minus (negative flag set)
const INS_BNE = 8; //  BNE — Branch if not equal (zero flag clear)
const INS_BPL = 9; //  BPL — Branch if plus (negative flag clear)
const INS_BRK = 10; // BRK — Software interrupt (pushes PC+2 and status, jumps via $FFFE)
const INS_BVC = 11; // BVC — Branch if overflow clear
const INS_BVS = 12; // BVS — Branch if overflow set
// Flag clears
const INS_CLC = 13; // CLC — Clear carry flag
const INS_CLD = 14; // CLD — Clear decimal flag (no effect on NES, see note above)
const INS_CLI = 15; // CLI — Clear interrupt disable flag
const INS_CLV = 16; // CLV — Clear overflow flag
// Compares — like subtract, but only set flags (don't modify the register)
const INS_CMP = 17; // CMP — Compare memory with accumulator
const INS_CPX = 18; // CPX — Compare memory with X
const INS_CPY = 19; // CPY — Compare memory with Y
// Decrements
const INS_DEC = 20; // DEC — Decrement memory by one
const INS_DEX = 21; // DEX — Decrement X by one
const INS_DEY = 22; // DEY — Decrement Y by one
// XOR
const INS_EOR = 23; // EOR — Bitwise exclusive-OR memory with accumulator
// Increments
const INS_INC = 24; // INC — Increment memory by one
const INS_INX = 25; // INX — Increment X by one
const INS_INY = 26; // INY — Increment Y by one
// Jumps
const INS_JMP = 27; // JMP — Unconditional jump
const INS_JSR = 28; // JSR — Jump to subroutine (pushes return address first)
// Loads
const INS_LDA = 29; // LDA — Load accumulator from memory
const INS_LDX = 30; // LDX — Load X from memory
const INS_LDY = 31; // LDY — Load Y from memory
// Shift
const INS_LSR = 32; // LSR — Logical shift right (bottom bit → carry)
// No-op
const INS_NOP = 33; // NOP — No operation
// OR
const INS_ORA = 34; // ORA — Bitwise OR memory with accumulator
// Stack pushes/pulls ("pull" is the 6502 term for "pop")
const INS_PHA = 35; // PHA — Push accumulator onto stack
const INS_PHP = 36; // PHP — Push processor status onto stack
const INS_PLA = 37; // PLA — Pull accumulator from stack
const INS_PLP = 38; // PLP — Pull processor status from stack
// Rotates (through carry)
const INS_ROL = 39; // ROL — Rotate left through carry (C → bit 0, bit 7 → C)
const INS_ROR = 40; // ROR — Rotate right through carry (C → bit 7, bit 0 → C)
// Returns
const INS_RTI = 41; // RTI — Return from interrupt (pulls status and PC)
const INS_RTS = 42; // RTS — Return from subroutine (pulls PC)
// Subtract
const INS_SBC = 43; // SBC — Subtract memory from accumulator with borrow
// Flag sets
const INS_SEC = 44; // SEC — Set carry flag
const INS_SED = 45; // SED — Set decimal flag (no effect on NES, see note above)
const INS_SEI = 46; // SEI — Set interrupt disable flag
// Stores
const INS_STA = 47; // STA — Store accumulator to memory
const INS_STX = 48; // STX — Store X to memory
const INS_STY = 49; // STY — Store Y to memory
// Register transfers
const INS_TAX = 50; // TAX — Transfer accumulator to X
const INS_TAY = 51; // TAY — Transfer accumulator to Y
const INS_TSX = 52; // TSX — Transfer stack pointer to X
const INS_TXA = 53; // TXA — Transfer X to accumulator
const INS_TXS = 54; // TXS — Transfer X to stack pointer
const INS_TYA = 55; // TYA — Transfer Y to accumulator

// ----------------------------------------------------------------------------
// Unofficial opcodes
// ----------------------------------------------------------------------------
//
// The 6502's instruction decoder is a combinational circuit rather than a
// lookup table, and about 80 of the 256 possible opcode bytes decode to
// instructions that weren't part of the official instruction set but still
// do *something* — usually a combination of two official instructions that
// happen to share hardware (e.g. SLO = "ASL then ORA"). Some shipped NES
// games, and most CPU test ROMs (including nestest and AccuracyCoin), use
// them deliberately, so a correct NES emulator has to implement them.
//
// See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes

// Combined arithmetic/logic on the accumulator (immediate operand only)
const INS_ALR = 56; // ALR (ASR) — AND then LSR:  A = (A & #imm) >> 1
const INS_ANC = 57; // ANC        — AND, but also copy result's bit 7 into carry
const INS_ARR = 58; // ARR        — AND then ROR, with peculiar N/V/C side effects
const INS_AXS = 59; // AXS (SBX)  — X = (A & X) - #imm (like CMP, but stores result)
// Combined load/store
const INS_LAX = 60; // LAX — Load A and X from memory simultaneously
const INS_SAX = 61; // SAX — Store (A & X) to memory
// Read-modify-write combos: each does an RMW on memory then an A-side op
const INS_DCP = 62; // DCP — DEC memory then CMP with A
const INS_ISC = 63; // ISC (ISB) — INC memory then SBC from A
const INS_RLA = 64; // RLA — ROL memory then AND with A
const INS_RRA = 65; // RRA — ROR memory then ADC with A
const INS_SLO = 66; // SLO — ASL memory then ORA with A
const INS_SRE = 67; // SRE — LSR memory then EOR with A
// Multi-byte NOPs. These consume extra bytes and (for IGN) still perform a
// dummy memory read, but don't otherwise affect state. Games occasionally
// use them for precise cycle-count padding.
const INS_SKB = 68; // SKB — 2-byte NOP (skips an immediate byte)
const INS_IGN = 69; // IGN — 3-byte NOP that still reads from memory

// "Unstable" opcodes whose output depends on the internal bus arbitration
// between CPU cycles. Most store (register & (high byte of target + 1)).
// The DMC audio channel's DMA transfer can hijack the bus mid-instruction
// and change the stored value — the emulator handles this interaction in
// the execute switch. Essentially no shipped games use these, but the
// AccuracyCoin test ROM does.
const INS_SHA = 71; // SHA (AHX) — Store A & X & (H+1)
const INS_SHS = 72; // SHS (TAS) — SP = A & X, then store SP & (H+1)
const INS_SHY = 73; // SHY (SYA) — Store Y & (H+1)
const INS_SHX = 74; // SHX (SXA) — Store X & (H+1)
const INS_LAE = 75; // LAE (LAS) — A = X = SP = (memory & SP)

// Opcodes whose behavior depends on a "magic" constant that varies between
// CPU manufacturing runs (and even across die temperature). Tests only
// exercise these with inputs (A = $FF, or immediate = $00) where the magic
// value cancels out of the result, so we can pick any reasonable magic.
const INS_ANE = 76; // ANE (XAA) — A = (A | magic) & X & #imm
const INS_LXA = 77; // LXA (ATX) — A = X = (A | magic) & #imm

// ----------------------------------------------------------------------------
// The opcode table
// ----------------------------------------------------------------------------
//
// OPCODE_TABLE is a plain object keyed by opcode byte. Every valid 6502
// opcode has an entry here; unassigned bytes (including the KIL/STP/JAM
// family that would hang a real CPU) are simply absent from the table.
//
// Size and cycle counts come from the official 6502 datasheet and match
// the nesdev wiki's tables at https://www.nesdev.org/wiki/CPU.
//
// The whole OPCODE_TABLE literal is marked `// prettier-ignore` so that
// prettier doesn't collapse the manual column alignment below — being
// able to scan straight down the "mode" column makes the table much
// more readable than the default formatting would allow.

// prettier-ignore
const OPCODE_TABLE = {
  // ADC — Add with carry
  0x69: { ins: INS_ADC, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x65: { ins: INS_ADC, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x75: { ins: INS_ADC, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x6d: { ins: INS_ADC, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x7d: { ins: INS_ADC, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x79: { ins: INS_ADC, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0x61: { ins: INS_ADC, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x71: { ins: INS_ADC, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // AND — Bitwise AND with accumulator
  0x29: { ins: INS_AND, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x25: { ins: INS_AND, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x35: { ins: INS_AND, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x2d: { ins: INS_AND, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x3d: { ins: INS_AND, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x39: { ins: INS_AND, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0x21: { ins: INS_AND, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x31: { ins: INS_AND, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // ASL — Arithmetic shift left
  0x0a: { ins: INS_ASL, mode: ADDR_ACC,        size: 1, cycles: 2 },
  0x06: { ins: INS_ASL, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x16: { ins: INS_ASL, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x0e: { ins: INS_ASL, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x1e: { ins: INS_ASL, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // Branches — each tests a status flag and jumps relative to PC if it matches
  0x90: { ins: INS_BCC, mode: ADDR_REL,        size: 2, cycles: 2 },
  0xb0: { ins: INS_BCS, mode: ADDR_REL,        size: 2, cycles: 2 },
  0xf0: { ins: INS_BEQ, mode: ADDR_REL,        size: 2, cycles: 2 },
  0x30: { ins: INS_BMI, mode: ADDR_REL,        size: 2, cycles: 2 },
  0xd0: { ins: INS_BNE, mode: ADDR_REL,        size: 2, cycles: 2 },
  0x10: { ins: INS_BPL, mode: ADDR_REL,        size: 2, cycles: 2 },
  0x50: { ins: INS_BVC, mode: ADDR_REL,        size: 2, cycles: 2 },
  0x70: { ins: INS_BVS, mode: ADDR_REL,        size: 2, cycles: 2 },

  // BIT — Test bits in memory against accumulator
  0x24: { ins: INS_BIT, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x2c: { ins: INS_BIT, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // BRK — Software interrupt
  0x00: { ins: INS_BRK, mode: ADDR_IMP,        size: 1, cycles: 7 },

  // Flag clears
  0x18: { ins: INS_CLC, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xd8: { ins: INS_CLD, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x58: { ins: INS_CLI, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xb8: { ins: INS_CLV, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // CMP — Compare memory with accumulator (sets flags only)
  0xc9: { ins: INS_CMP, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xc5: { ins: INS_CMP, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xd5: { ins: INS_CMP, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xcd: { ins: INS_CMP, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xdd: { ins: INS_CMP, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xd9: { ins: INS_CMP, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0xc1: { ins: INS_CMP, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0xd1: { ins: INS_CMP, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // CPX — Compare memory with X
  0xe0: { ins: INS_CPX, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xe4: { ins: INS_CPX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xec: { ins: INS_CPX, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // CPY — Compare memory with Y
  0xc0: { ins: INS_CPY, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xc4: { ins: INS_CPY, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xcc: { ins: INS_CPY, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // DEC — Decrement memory by one
  0xc6: { ins: INS_DEC, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0xd6: { ins: INS_DEC, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0xce: { ins: INS_DEC, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0xde: { ins: INS_DEC, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // DEX / DEY — Decrement X / Y by one
  0xca: { ins: INS_DEX, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x88: { ins: INS_DEY, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // EOR — Bitwise exclusive-OR with accumulator
  0x49: { ins: INS_EOR, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x45: { ins: INS_EOR, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x55: { ins: INS_EOR, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x4d: { ins: INS_EOR, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x5d: { ins: INS_EOR, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x59: { ins: INS_EOR, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0x41: { ins: INS_EOR, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x51: { ins: INS_EOR, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // INC — Increment memory by one
  0xe6: { ins: INS_INC, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0xf6: { ins: INS_INC, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0xee: { ins: INS_INC, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0xfe: { ins: INS_INC, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // INX / INY — Increment X / Y by one
  0xe8: { ins: INS_INX, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xc8: { ins: INS_INY, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // JMP — Unconditional jump (absolute or via indirect pointer)
  0x4c: { ins: INS_JMP, mode: ADDR_ABS,        size: 3, cycles: 3 },
  0x6c: { ins: INS_JMP, mode: ADDR_INDABS,     size: 3, cycles: 5 },

  // JSR — Jump to subroutine (pushes return address first)
  0x20: { ins: INS_JSR, mode: ADDR_ABS,        size: 3, cycles: 6 },

  // LDA — Load accumulator from memory
  0xa9: { ins: INS_LDA, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xa5: { ins: INS_LDA, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xb5: { ins: INS_LDA, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xad: { ins: INS_LDA, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xbd: { ins: INS_LDA, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xb9: { ins: INS_LDA, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0xa1: { ins: INS_LDA, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0xb1: { ins: INS_LDA, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // LDX — Load X from memory
  0xa2: { ins: INS_LDX, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xa6: { ins: INS_LDX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xb6: { ins: INS_LDX, mode: ADDR_ZPY,        size: 2, cycles: 4 },
  0xae: { ins: INS_LDX, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xbe: { ins: INS_LDX, mode: ADDR_ABSY,       size: 3, cycles: 4 },

  // LDY — Load Y from memory
  0xa0: { ins: INS_LDY, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xa4: { ins: INS_LDY, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xb4: { ins: INS_LDY, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xac: { ins: INS_LDY, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xbc: { ins: INS_LDY, mode: ADDR_ABSX,       size: 3, cycles: 4 },

  // LSR — Logical shift right
  0x4a: { ins: INS_LSR, mode: ADDR_ACC,        size: 1, cycles: 2 },
  0x46: { ins: INS_LSR, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x56: { ins: INS_LSR, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x4e: { ins: INS_LSR, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x5e: { ins: INS_LSR, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // NOP — No operation. $EA is the official NOP; the other six bytes are
  // unofficial single-byte NOPs that the 6502's decoder happens to treat
  // identically, and we handle them the same way.
  0x1a: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x3a: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x5a: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x7a: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xda: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xea: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xfa: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // ORA — Bitwise OR with accumulator
  0x09: { ins: INS_ORA, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x05: { ins: INS_ORA, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x15: { ins: INS_ORA, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x0d: { ins: INS_ORA, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x1d: { ins: INS_ORA, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x19: { ins: INS_ORA, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0x01: { ins: INS_ORA, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x11: { ins: INS_ORA, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // Stack pushes/pulls — PHA/PLA move the accumulator, PHP/PLP the status
  // register. The 6502 stack lives in page 1 ($0100-$01FF), with SP as an
  // offset into that page.
  0x48: { ins: INS_PHA, mode: ADDR_IMP,        size: 1, cycles: 3 },
  0x08: { ins: INS_PHP, mode: ADDR_IMP,        size: 1, cycles: 3 },
  0x68: { ins: INS_PLA, mode: ADDR_IMP,        size: 1, cycles: 4 },
  0x28: { ins: INS_PLP, mode: ADDR_IMP,        size: 1, cycles: 4 },

  // ROL — Rotate left through carry
  0x2a: { ins: INS_ROL, mode: ADDR_ACC,        size: 1, cycles: 2 },
  0x26: { ins: INS_ROL, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x36: { ins: INS_ROL, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x2e: { ins: INS_ROL, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x3e: { ins: INS_ROL, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // ROR — Rotate right through carry
  0x6a: { ins: INS_ROR, mode: ADDR_ACC,        size: 1, cycles: 2 },
  0x66: { ins: INS_ROR, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x76: { ins: INS_ROR, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x6e: { ins: INS_ROR, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x7e: { ins: INS_ROR, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // RTI / RTS — Return from interrupt handler / subroutine
  0x40: { ins: INS_RTI, mode: ADDR_IMP,        size: 1, cycles: 6 },
  0x60: { ins: INS_RTS, mode: ADDR_IMP,        size: 1, cycles: 6 },

  // SBC — Subtract memory from accumulator with borrow.
  // $EB is an unofficial alternate opcode that the 6502's decoder treats
  // identically to the official $E9 (immediate SBC).
  0xe9: { ins: INS_SBC, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xeb: { ins: INS_SBC, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xe5: { ins: INS_SBC, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xf5: { ins: INS_SBC, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xed: { ins: INS_SBC, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xfd: { ins: INS_SBC, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xf9: { ins: INS_SBC, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0xe1: { ins: INS_SBC, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0xf1: { ins: INS_SBC, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // Flag sets
  0x38: { ins: INS_SEC, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xf8: { ins: INS_SED, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x78: { ins: INS_SEI, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // STA — Store accumulator to memory
  0x85: { ins: INS_STA, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x95: { ins: INS_STA, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x8d: { ins: INS_STA, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x9d: { ins: INS_STA, mode: ADDR_ABSX,       size: 3, cycles: 5 },
  0x99: { ins: INS_STA, mode: ADDR_ABSY,       size: 3, cycles: 5 },
  0x81: { ins: INS_STA, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x91: { ins: INS_STA, mode: ADDR_POSTIDXIND, size: 2, cycles: 6 },

  // STX — Store X to memory
  0x86: { ins: INS_STX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x96: { ins: INS_STX, mode: ADDR_ZPY,        size: 2, cycles: 4 },
  0x8e: { ins: INS_STX, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // STY — Store Y to memory
  0x84: { ins: INS_STY, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x94: { ins: INS_STY, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x8c: { ins: INS_STY, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // Register transfers — copy one register to another in a single cycle
  0xaa: { ins: INS_TAX, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xa8: { ins: INS_TAY, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xba: { ins: INS_TSX, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x8a: { ins: INS_TXA, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x9a: { ins: INS_TXS, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x98: { ins: INS_TYA, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // --- Unofficial opcodes ---
  //
  // These aren't part of the official 6502 spec but fall out of the chip's
  // decoder logic. Nestest and AccuracyCoin exercise them, and a handful
  // of shipped NES games rely on them. See the INS_* comments above for
  // what each one actually computes.

  // ALR (ASR) — AND then LSR
  0x4b: { ins: INS_ALR, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // ANC — AND, with carry also set to bit 7 of the result
  0x0b: { ins: INS_ANC, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x2b: { ins: INS_ANC, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // ARR — AND then ROR (with quirky N/V/C flag behavior)
  0x6b: { ins: INS_ARR, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // AXS (SBX) — X = (A & X) - immediate
  0xcb: { ins: INS_AXS, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // LAX — Load A and X simultaneously from memory
  0xa3: { ins: INS_LAX, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0xa7: { ins: INS_LAX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xaf: { ins: INS_LAX, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xb3: { ins: INS_LAX, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },
  0xb7: { ins: INS_LAX, mode: ADDR_ZPY,        size: 2, cycles: 4 },
  0xbf: { ins: INS_LAX, mode: ADDR_ABSY,       size: 3, cycles: 4 },

  // SAX — Store (A & X) to memory
  0x83: { ins: INS_SAX, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x87: { ins: INS_SAX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x8f: { ins: INS_SAX, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x97: { ins: INS_SAX, mode: ADDR_ZPY,        size: 2, cycles: 4 },

  // DCP — DEC memory then CMP with A
  0xc3: { ins: INS_DCP, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0xc7: { ins: INS_DCP, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0xcf: { ins: INS_DCP, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0xd3: { ins: INS_DCP, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0xd7: { ins: INS_DCP, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0xdb: { ins: INS_DCP, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0xdf: { ins: INS_DCP, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // ISC (ISB) — INC memory then SBC from A
  0xe3: { ins: INS_ISC, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0xe7: { ins: INS_ISC, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0xef: { ins: INS_ISC, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0xf3: { ins: INS_ISC, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0xf7: { ins: INS_ISC, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0xfb: { ins: INS_ISC, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0xff: { ins: INS_ISC, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // RLA — ROL memory then AND with A
  0x23: { ins: INS_RLA, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0x27: { ins: INS_RLA, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x2f: { ins: INS_RLA, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x33: { ins: INS_RLA, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0x37: { ins: INS_RLA, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x3b: { ins: INS_RLA, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0x3f: { ins: INS_RLA, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // RRA — ROR memory then ADC with A
  0x63: { ins: INS_RRA, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0x67: { ins: INS_RRA, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x6f: { ins: INS_RRA, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x73: { ins: INS_RRA, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0x77: { ins: INS_RRA, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x7b: { ins: INS_RRA, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0x7f: { ins: INS_RRA, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // SLO — ASL memory then ORA with A
  0x03: { ins: INS_SLO, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0x07: { ins: INS_SLO, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x0f: { ins: INS_SLO, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x13: { ins: INS_SLO, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0x17: { ins: INS_SLO, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x1b: { ins: INS_SLO, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0x1f: { ins: INS_SLO, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // SRE — LSR memory then EOR with A
  0x43: { ins: INS_SRE, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0x47: { ins: INS_SRE, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x4f: { ins: INS_SRE, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x53: { ins: INS_SRE, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0x57: { ins: INS_SRE, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x5b: { ins: INS_SRE, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0x5f: { ins: INS_SRE, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // SKB — 2-byte NOP that skips an immediate byte
  0x80: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x82: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x89: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xc2: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xe2: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // IGN — 3-byte NOP that still performs a memory read
  0x0c: { ins: INS_IGN, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x1c: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x3c: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x5c: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x7c: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xdc: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xfc: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x04: { ins: INS_IGN, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x44: { ins: INS_IGN, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x64: { ins: INS_IGN, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x14: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x34: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x54: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x74: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xd4: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xf4: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },

  // SHA (AHX) — Store A & X & (H+1)
  0x93: { ins: INS_SHA, mode: ADDR_POSTIDXIND, size: 2, cycles: 6 },
  0x9f: { ins: INS_SHA, mode: ADDR_ABSY,       size: 3, cycles: 5 },

  // SHS (TAS) — SP = A & X, then store SP & (H+1)
  0x9b: { ins: INS_SHS, mode: ADDR_ABSY,       size: 3, cycles: 5 },

  // SHY (SYA) — Store Y & (H+1)
  0x9c: { ins: INS_SHY, mode: ADDR_ABSX,       size: 3, cycles: 5 },

  // SHX (SXA) — Store X & (H+1)
  0x9e: { ins: INS_SHX, mode: ADDR_ABSY,       size: 3, cycles: 5 },

  // LAE (LAS) — A = X = SP = memory & SP
  0xbb: { ins: INS_LAE, mode: ADDR_ABSY,       size: 3, cycles: 4 },

  // ANE (XAA) — A = (A | magic) & X & immediate
  0x8b: { ins: INS_ANE, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // LXA — A = X = (A | magic) & immediate
  0xab: { ins: INS_LXA, mode: ADDR_IMM,        size: 2, cycles: 2 },
};

// ----------------------------------------------------------------------------
// Flattened decode tables
// ----------------------------------------------------------------------------
//
// OPCODE_TABLE above is the human-readable source of truth. At load time we
// flatten it into typed arrays indexed by opcode byte, which are much faster
// to look up on the hottest path in the emulator.
//
// OP_INS[op]  - the INS_* instruction (255 = invalid / KIL opcode)
// OP_MODE[op] - the ADDR_* addressing mode
// OP_KIND[op] - how the generic addressing step treats the operand:
//   KIND_READ    - the instruction reads its operand. Indexed modes only do
//                  the extra "fix-up" dummy read when a page is crossed.
//   KIND_WRITE   - stores and read-modify-write instructions. Indexed modes
//                  ALWAYS perform the fix-up dummy read, because the CPU
//                  can't know in advance whether the first (possibly wrong)
//                  address is correct, and writing to the wrong address
//                  would be destructive.
//   KIND_SPECIAL - the instruction does its own bus cycles (jumps, branches,
//                  stack operations, implied/accumulator instructions).
const KIND_READ = 0;
const KIND_WRITE = 1;
const KIND_SPECIAL = 2;

const OP_INS = new Uint8Array(256).fill(255);
const OP_MODE = new Uint8Array(256);
const OP_KIND = new Uint8Array(256);

for (const key of Object.keys(OPCODE_TABLE)) {
  const op = Number(key);
  const info = OPCODE_TABLE[op];
  OP_INS[op] = info.ins;
  OP_MODE[op] = info.mode;
  let kind = KIND_READ;
  switch (info.ins) {
    case INS_STA:
    case INS_STX:
    case INS_STY:
    case INS_SAX:
    case INS_SHA:
    case INS_SHS:
    case INS_SHX:
    case INS_SHY:
    case INS_ASL:
    case INS_LSR:
    case INS_ROL:
    case INS_ROR:
    case INS_INC:
    case INS_DEC:
    case INS_SLO:
    case INS_SRE:
    case INS_RLA:
    case INS_RRA:
    case INS_DCP:
    case INS_ISC:
      kind = KIND_WRITE;
      break;
    case INS_JSR:
    case INS_BRK:
    case INS_RTI:
    case INS_RTS:
    case INS_PHA:
    case INS_PHP:
    case INS_PLA:
    case INS_PLP:
      kind = KIND_SPECIAL;
      break;
  }
  // Modes that the generic addressing step never handles: relative
  // (branches), implied/accumulator (no memory operand) and JMP indirect.
  if (
    info.mode === ADDR_REL ||
    info.mode === ADDR_IMP ||
    info.mode === ADDR_ACC ||
    info.mode === ADDR_INDABS
  ) {
    kind = KIND_SPECIAL;
  }
  OP_KIND[op] = kind;
}

// Interrupt vectors (addresses of the 16-bit handler pointers).
const VECTOR_NMI = 0xfffa;
const VECTOR_RESET = 0xfffc;
const VECTOR_IRQ = 0xfffe;

// Bits in cpu.irqFlags. The 6502's /IRQ input is a single wire shared by
// every device that can interrupt (wired-OR). We track each source in its own
// bit so that each device can assert and release its line independently.
export const IRQ_SOURCE_MAPPER = 1; // Cartridge (e.g. MMC3 scanline counter)
export const IRQ_SOURCE_FRAME = 2; // APU frame counter
export const IRQ_SOURCE_DMC = 4; // APU DMC channel

// The PPU runs at exactly 3x the CPU clock, so 3 PPU "dots" elapse during
// every CPU cycle. The CPU performs its bus access first, then the PPU is
// advanced (see _endCycle()). The CPU's NMI input is sampled partway through
// the cycle (during the second half of the cycle, called φ2, on real
// hardware): after the first of the cycle's 3 dots. This determines e.g.
// whether a VBlank flag that becomes set near the end of an instruction
// triggers an NMI immediately after that instruction or one instruction
// later. It is tuned against the AccuracyCoin "NMI Timing" tests.

// ============================================================================
// The CPU
// ============================================================================
//
// This is a *cycle-stepped* 6502: every single bus access (read or write)
// that the real chip performs is modelled as one call to read() or write(),
// and each such call represents exactly one CPU clock cycle. During that
// cycle, the rest of the console is advanced in lockstep:
//
//   - The APU is clocked once (it runs on the CPU clock).
//   - The PPU is advanced by 3 dots.
//   - The interrupt lines (NMI and IRQ) are sampled.
//   - Pending DMA transfers may "halt" the CPU before a read.
//
// The 6502 performs a bus access on *every* cycle, even when it has nothing
// useful to read (e.g. while it is adding an index to an address). These
// are called "dummy reads" and "dummy writes". They matter because reading
// some I/O registers has side effects (reading $2007 advances the PPU's
// address, reading $2002 clears the VBlank flag, etc.), and test ROMs check
// them. So instructions here are written out cycle by cycle, matching the
// tables in https://www.nesdev.org/6502_cpu.txt.
//
// Interrupt timing falls out of the same model: the 6502 decides whether to
// service an interrupt based on the state of its interrupt lines at the end
// of an instruction's *second-to-last* cycle. See _endCycle().
//
// See https://www.nesdev.org/wiki/CPU and
// https://www.nesdev.org/wiki/CPU_interrupts
class CPU {
  // IRQ Types (arguments to requestIrq)
  IRQ_NORMAL = 0;
  IRQ_NMI = 1;
  IRQ_RESET = 2;

  constructor(nes) {
    this.nes = nes;

    // Main memory. Only $0000-$07FF (internal RAM) and $6000-$FFFF
    // (cartridge RAM/ROM, filled in by the mapper) are really stored here;
    // other regions are I/O and routed through the mapper.
    this.mem = new Uint8Array(0x10000);

    // Power-on RAM contents are not well defined on real hardware. JSNES has
    // historically used $FF with a few specific bytes, which some games
    // (accidentally) depend on.
    this.mem.fill(0xff, 0, 0x2000);
    for (let p = 0; p < 4; p++) {
      let j = p * 0x800;
      this.mem[j + 0x008] = 0xf7;
      this.mem[j + 0x009] = 0xef;
      this.mem[j + 0x00a] = 0xdf;
      this.mem[j + 0x00f] = 0xbf;
    }

    // Registers.
    this.REG_ACC = 0;
    this.REG_X = 0;
    this.REG_Y = 0;
    // 8-bit; the stack lives at $0100 | SP. Starts at 0 at power on; the
    // reset sequence then decrements it by 3, giving the familiar $FD.
    this.REG_SP = 0;
    this.REG_PC = 0x8000; // The real program counter (16-bit)

    // Status flags, stored unpacked for speed. Each is 0 or 1, except:
    // F_ZERO stores the last result byte rather than a boolean. The Z flag
    // is considered SET when F_ZERO === 0. This saves a comparison on every
    // instruction that updates Z.
    this.F_CARRY = 0;
    this.F_ZERO = 1;
    this.F_INTERRUPT = 1;
    this.F_DECIMAL = 0;
    this.F_OVERFLOW = 0;
    this.F_SIGN = 0;
    // Bits 4 (B) and 5 of the status register don't physically exist in
    // the 6502; they only appear in the copy pushed to the stack. We keep
    // these for getStatus()/setStatus() compatibility.
    this.F_BRK = 1;
    this.F_NOTUSED = 1;

    // Total number of CPU cycles executed since power on. Used to determine
    // the "parity" of the current cycle, which matters because the APU (and
    // the DMA unit inside the same chip) runs at half the CPU clock: every
    // CPU cycle is either a "get" cycle or a "put" cycle.
    // See https://www.nesdev.org/wiki/DMA
    this.cycles = 0;
    // The cycles whose PPU dots have been added to ppu.dotTarget, and the
    // first cycle that needs the full per-cycle processing. See "Fast and
    // slow cycles" below.
    this.ppuCycles = 0;
    this.nextEvent = 0;

    // Tracks the last value on the CPU data bus. When reading from unmapped
    // addresses ("open bus"), the NES returns this value. Updated on every
    // read and write (except reads of $4015, which is internal to the CPU
    // chip and doesn't drive the external bus).
    // See https://www.nesdev.org/wiki/Open_bus_behavior
    this.dataBus = 0;

    // --- Interrupts ---
    //
    // IRQ is level-triggered: cpu.irqFlags holds one bit per device that is
    // currently asserting the IRQ line (IRQ_SOURCE_*). NMI is edge-triggered:
    // the CPU watches the PPU's NMI output and latches a request when it goes
    // from inactive to active.
    this.irqFlags = 0;
    this.resetPending = false;
    // Last sampled level of the NMI line, for edge detection.
    this.nmiLine = false;
    // NMI edge detected and not yet serviced.
    this.needNmi = false;
    // needNmi as it was one sample earlier (at the end of the previous
    // cycle). The CPU uses the *second-to-last* cycle's state to decide
    // whether to service an interrupt after an instruction.
    this.prevNeedNmi = false;
    // Whether an IRQ should be serviced (IRQ line active and I flag clear),
    // as of the most recent sample and the one before it.
    this.runIrq = false;
    this.prevRunIrq = false;
    // Test hook: an NMI requested with requestIrq(IRQ_NMI).
    this.forcedNmi = false;

    // --- DMA ---
    //
    // The 2A03 contains two DMA units which take over the bus by halting
    // the CPU: OAM DMA (sprite data copy, triggered by writing $4014) and
    // DMC DMA (audio sample fetches for the APU's DMC channel). The CPU can
    // only be halted on a read cycle. See _runDma().
    this.dmaNeedHalt = false; // A DMA wants to halt the CPU on the next read
    this.dmcDmaRunning = false; // A DMC sample fetch is in progress/pending
    this.dmcNeedDummy = false; // DMC DMA still needs its "dummy" cycle
    this.dmcDmaAbort = false; // DMC DMA was cancelled after it halted the CPU
    this.oamDmaRunning = false; // An OAM DMA is in progress/pending
    this.oamDmaPage = 0; // High byte of the OAM DMA source address
    // The cycle number at which the most recent DMA finished. Used by the
    // SHx unofficial opcodes, whose stored value depends on whether the CPU
    // was halted right before the write.
    this.lastDmaEndCycle = -1;
    // Cycle on which a 1-cycle aborted DMC DMA would halt the CPU.
    this.abortedDmaCycle = -1;

    // Game Genie is applied on reads from cartridge space.
    this._gameGenieActive = false;
    // True when PRG ROM reads ($8000-$FFFF) can come straight from cpu.mem
    // instead of going through the mapper. See _updatePrgReadPath().
    this.directPrgReads = false;

    // Shortcuts to the PPU and APU, which are advanced on every cycle.
    // (The NES sets these again once it has created all its components.)
    this.ppu = nes.ppu;
    this.papu = nes.papu;
  }

  // ==========================================================================
  // Bus cycles
  // ==========================================================================

  // --- Fast and slow cycles ---
  //
  // Most cycles are reads of RAM or PRG ROM, or writes to RAM, in which
  // nothing but the CPU is involved: no DMA is waiting, the APU has nothing
  // to do but count, the PPU has no event the CPU could notice, and the
  // interrupt lines are quiet. For those, all the per-cycle bookkeeping in
  // _endCycle() would leave everything as it is (apart from the PPU's dot
  // count, which is caught up later), so read() and write() skip it.
  //
  // nextEvent is the first cycle that can't be done this way. It's worked
  // out at the end of every slow cycle (_updateNextEvent()), and anything
  // that changes the state it depends on outside of a slow cycle sets it
  // to 0, so that the next cycle is a slow one and it gets worked out
  // again. Setting it to 0 is always safe.

  // One CPU read cycle.
  read(addr) {
    const c = this.cycles + 1;
    if (c < this.nextEvent) {
      if (addr < 0x2000) {
        // Internal RAM, mirrored every 2KB.
        this.cycles = c;
        return (this.dataBus = this.mem[addr & 0x7ff]);
      }
      if (addr >= 0x8000 && this.directPrgReads) {
        // PRG ROM (see _readSlow()).
        this.cycles = c;
        return (this.dataBus = this.mem[addr]);
      }
    }
    return this._readSlow(addr);
  }

  // A read cycle, with everything else that happens in the cycle.
  _readSlow(addr) {
    if (this.dmaNeedHalt) {
      this._runDma(addr);
    }
    this.cycles++;
    if (this.cycles >= this.papu.nextEventCycle) {
      this.papu.catchUp(this.cycles);
    }
    let value;
    if (addr < 0x2000) {
      // Internal RAM, mirrored every 2KB.
      value = this.dataBus = this.mem[addr & 0x7ff];
    } else if (addr >= 0x8000 && this.directPrgReads) {
      // PRG ROM. Almost every mapper copies the selected PRG banks into
      // cpu.mem, so skip the mapper call (this is the most common read).
      value = this.dataBus = this.mem[addr];
    } else if (addr === 0x4015) {
      // The APU status register is inside the CPU chip; reading it doesn't
      // update the external data bus. See https://www.nesdev.org/wiki/Open_bus_behavior
      value = this.nes.mmap.load(addr);
    } else {
      if (
        addr < 0x8000 &&
        (addr < 0x4000 || addr >= 0x4020 || addr === 0x4017)
      ) {
        // The PPU (or a mapper that watches it) may be involved: bring the
        // PPU up to date first. See PPU.catchUp().
        this._syncPpu(addr);
      }
      value = this.nes.mmap.load(addr);
      if (this._gameGenieActive && addr >= 0x8000) {
        value = this.nes.gameGenie.applyCodes(addr, value);
      }
      this.dataBus = value;
    }
    this._endCycle();
    return value;
  }

  // Bring the PPU up to the current cycle before an access that could
  // observe or change its state: PPU registers ($2000-$3FFF), cartridge
  // registers (mappers switch CHR banks or count scanlines) and $4017
  // (the Zapper looks at the screen).
  _syncPpu(addr) {
    const ppu = this.ppu;
    // The dots of all the cycles before this one are owed.
    const done = this.cycles - 1;
    ppu.dotTarget += 3 * (done - this.ppuCycles);
    this.ppuCycles = done;
    ppu.catchUp();
    if (addr < 0x4000) {
      // A PPU register access can change the PPU's upcoming events (e.g.
      // enabling NMI or rendering), so re-check them this cycle.
      ppu.nextEventDot = 0;
    }
  }

  // One CPU write cycle. Writes are never interrupted by DMA: if a DMA
  // becomes pending during a write, it waits for the next read cycle.
  write(addr, value) {
    const c = this.cycles + 1;
    if (c < this.nextEvent && addr < 0x2000) {
      // Internal RAM (see "Fast and slow cycles" above).
      this.cycles = c;
      this.dataBus = value;
      this.mem[addr & 0x7ff] = value;
      return;
    }
    this._writeSlow(addr, value);
  }

  _writeSlow(addr, value) {
    if (this.abortedDmaCycle === this.cycles + 1 && this.dmcDmaAbort) {
      // A pending 1-cycle aborted DMC DMA lands on a write: it vanishes.
      this.dmcDmaRunning = false;
      this.dmcDmaAbort = false;
      this.dmaNeedHalt = this.oamDmaRunning;
    }
    this.cycles++;
    if (this.cycles >= this.papu.nextEventCycle) {
      this.papu.catchUp(this.cycles);
    }
    this.dataBus = value;
    if (addr < 0x2000) {
      this.mem[addr & 0x7ff] = value;
    } else {
      if (addr < 0x4000 || addr >= 0x4020) {
        this._syncPpu(addr);
      }
      this.nes.mmap.write(addr, value);
    }
    this._endCycle();
  }

  // Second half of every cycle: advance the PPU 3 dots and sample the
  // interrupt lines at the right moment within the cycle.
  //
  // For speed, the PPU is normally run lazily ("catch-up"): we just add this
  // cycle's 3 dots to its to-do count, and it runs them in a batch the next
  // time anything needs to look at it. If the PPU has an event coming up
  // that the CPU would notice (like VBlank starting), it runs exactly in
  // step for that cycle instead. See PPU.catchUp().
  _endCycle() {
    const ppu = this.ppu;
    // This cycle's 3 dots, and those of any fast cycles before it.
    ppu.dotTarget += 3 * (this.cycles - this.ppuCycles);
    this.ppuCycles = this.cycles;
    let nmi;
    if (ppu.dotTarget > ppu.nextEventDot) {
      // Runs the dots and records the NMI output at the poll point.
      ppu.runCycleExact();
      nmi = ppu.nmiAtPoll;
    } else {
      // No PPU event this cycle, so the NMI output can't change.
      nmi = ppu.nmiOutput;
    }

    // Sample the interrupt lines. Happens once per cycle.
    //
    // The 6502 checks for interrupts at the end of each instruction, but what
    // it actually looks at is the state of its internal "interrupt pending"
    // signals as they were at the end of the instruction's second-to-last
    // cycle. So we keep two generations of each signal: the current sample
    // and the previous one. When an instruction finishes, emulate() looks at
    // prevNeedNmi/prevRunIrq.
    //
    // This naturally produces lots of documented quirks, e.g. CLI followed by
    // an instruction lets that one instruction run before the IRQ (the I flag
    // only changes after CLI's last cycle has sampled the lines).
    // See https://www.nesdev.org/wiki/CPU_interrupts
    this.prevNeedNmi = this.needNmi;
    if (nmi && !this.nmiLine) {
      this.needNmi = true;
    }
    this.nmiLine = nmi;
    this.prevRunIrq = this.runIrq;
    this.runIrq = this.irqFlags !== 0 && this.F_INTERRUPT === 0;

    this._updateNextEvent();
  }

  // Work out the next cycle that has to be a slow one (see "Fast and slow
  // cycles" above).
  _updateNextEvent() {
    const ppu = this.ppu;
    if (
      this.dmaNeedHalt ||
      this.dmcDmaAbort ||
      this.needNmi ||
      this.prevNeedNmi ||
      this.runIrq ||
      this.prevRunIrq ||
      (this.irqFlags !== 0 && this.F_INTERRUPT === 0) ||
      ppu.nmiOutput !== this.nmiLine
    ) {
      // A DMA is waiting, or the interrupt lines need sampling every cycle.
      this.nextEvent = 0;
      return;
    }
    // The APU's next event.
    let next = this.papu.nextEventCycle;
    // The PPU's: the first cycle c at the end of which the PPU is owed
    // more dots than nextEventDot, i.e. dotTarget + 3 * (c - ppuCycles) >
    // nextEventDot. See _endCycle().
    const p =
      this.ppuCycles + Math.floor((ppu.nextEventDot - ppu.dotTarget) / 3) + 1;
    if (p < next) next = p;
    this.nextEvent = next;
  }

  // Give the PPU the dots of the fast cycles since the last slow one, so
  // that it can be caught up from outside the CPU (e.g. for a save state).
  flushPpuCycles() {
    this.ppu.dotTarget += 3 * (this.cycles - this.ppuCycles);
    this.ppuCycles = this.cycles;
  }

  // Read the byte at PC and advance PC.
  _fetch() {
    const v = this.read(this.REG_PC);
    this.REG_PC = (this.REG_PC + 1) & 0xffff;
    return v;
  }

  push(value) {
    this.write(0x100 | this.REG_SP, value);
    this.REG_SP = (this.REG_SP - 1) & 0xff;
  }

  pull() {
    this.REG_SP = (this.REG_SP + 1) & 0xff;
    return this.read(0x100 | this.REG_SP);
  }

  // Compatibility alias used by tests and older code.
  load(addr) {
    return this.read(addr);
  }

  // ==========================================================================
  // Interrupt requests from other components
  // ==========================================================================

  // Request an interrupt. IRQ_NORMAL asserts the cartridge IRQ line (it is
  // released automatically when the IRQ is serviced, which matches how the
  // mappers in this codebase use it); IRQ_RESET resets the CPU before the
  // next instruction; IRQ_NMI forces an NMI (used by tests).
  requestIrq(type) {
    this.nextEvent = 0;
    if (type === this.IRQ_NORMAL) {
      this.irqFlags |= IRQ_SOURCE_MAPPER;
    } else if (type === this.IRQ_NMI) {
      this.forcedNmi = true;
      this.needNmi = true;
      this.prevNeedNmi = true;
    } else if (type === this.IRQ_RESET) {
      this.resetPending = true;
    }
  }

  // Release the cartridge IRQ line (mappers call this when the game
  // acknowledges the interrupt).
  clearIrq() {
    this.nextEvent = 0;
    this.irqFlags &= ~IRQ_SOURCE_MAPPER;
  }

  // Assert or release one of the APU's IRQ lines.
  setIrqSource(source, active) {
    this.nextEvent = 0;
    if (active) {
      this.irqFlags |= source;
    } else {
      this.irqFlags &= ~source;
    }
  }

  // True if any interrupt request is outstanding (used by tests).
  get irqRequested() {
    return this.irqFlags !== 0 || this.resetPending || this.forcedNmi;
  }

  set irqRequested(value) {
    this.nextEvent = 0;
    if (!value) {
      this.irqFlags = 0;
      this.resetPending = false;
      this.forcedNmi = false;
    }
  }

  // ==========================================================================
  // DMA
  // ==========================================================================
  //
  // Both DMA units in the 2A03 work by pulling the CPU's RDY line low, which
  // makes the CPU stop on its next *read* cycle (the 6502 ignores RDY during
  // writes). While halted, the CPU keeps repeating that read on the bus, so
  // the address it was about to read gets read several times. Reading some
  // registers twice has visible side effects (e.g. $2007 advances twice),
  // which is exactly what the AccuracyCoin "DMA + $2007 Read" etc. tests
  // check.
  //
  // The DMA unit can only read on "get" cycles and only write on "put"
  // cycles (the APU clock is CPU clock / 2, and each APU cycle has a get
  // half and a put half). So DMAs sometimes need an extra "alignment" cycle.
  //
  // DMC DMA (one byte): halt cycle, dummy cycle, optional alignment cycle,
  //   then the read on a get cycle. 3 or 4 cycles total.
  // OAM DMA (256 bytes): halt cycle, optional alignment cycle, then 256
  //   alternating read (get) / write to $2004 (put) pairs. 513 or 514 cycles.
  // When both are active, the DMC read steals a get cycle from the OAM DMA.
  //
  // See https://www.nesdev.org/wiki/DMA

  // Called by the APU when the DMC needs its next sample byte.
  startDmcDma() {
    this.nextEvent = 0;
    this.dmcDmaRunning = true;
    this.dmcNeedDummy = true;
    this.dmaNeedHalt = true;
  }

  // Called by the APU when the DMC is disabled (via $4015) while a DMA is
  // pending. If the DMA hasn't halted the CPU yet it's cancelled entirely;
  // if it has just halted the CPU it gets aborted (the CPU still loses the
  // halt cycle). See https://www.nesdev.org/wiki/DMA#DMC_DMA_abort
  stopDmcDma() {
    this.nextEvent = 0;
    if (!this.dmcDmaRunning) return;
    if (this.dmaNeedHalt && !this.oamDmaRunning) {
      this.dmcDmaRunning = false;
      this.dmcNeedDummy = false;
      this.dmaNeedHalt = false;
    } else {
      this.dmcDmaAbort = true;
    }
  }

  // A DMC DMA that halts the CPU for one cycle and is then aborted (see
  // ChannelDM._requestDma). Unlike a normal DMA, it isn't delayed by write
  // cycles: if the next cycle is a write, it simply doesn't happen.
  startAbortedDmcDma() {
    this.nextEvent = 0;
    if (this.dmcDmaRunning) return;
    this.dmcDmaRunning = true;
    this.dmcDmaAbort = true;
    this.dmaNeedHalt = true;
    this.abortedDmaCycle = this.cycles + 1;
  }

  // Called when the game writes to $4014.
  startOamDma(page) {
    this.nextEvent = 0;
    this.oamDmaRunning = true;
    this.oamDmaPage = page;
    this.dmaNeedHalt = true;
  }

  // A cycle in which the halted CPU repeats its pending read. Most of the
  // time this is harmless, but for I/O registers it has side effects.
  _haltedRead(addr, skipRead) {
    this.cycles++;
    if (this.cycles >= this.papu.nextEventCycle) {
      this.papu.catchUp(this.cycles);
    }
    if (!skipRead) {
      this._dmaBusRead(addr);
    }
    this._endCycle();
  }

  // Perform a read on the bus during DMA (updates the data bus like a
  // normal read, except for the internal $4015 register).
  _dmaBusRead(addr) {
    let value;
    if (addr < 0x2000) {
      value = this.mem[addr & 0x7ff];
    } else {
      if (
        addr < 0x8000 &&
        (addr < 0x4000 || addr >= 0x4020 || addr === 0x4017)
      ) {
        this._syncPpu(addr);
      }
      value = this.nes.mmap.load(addr);
      if (addr === 0x4015) return value;
    }
    this.dataBus = value;
    return value;
  }

  // Read performed by a DMA unit for its own purposes (fetching a DMC
  // sample byte or an OAM byte). Returns the value the DMA unit receives.
  //
  // Hardware quirk: inside the 2A03, the readable registers ($4015-$4017)
  // are enabled whenever the *CPU's* address bus is in $4000-$401F, and
  // they only decode the low 5 bits of the address. Normally the DMA units
  // can't see them, but if the CPU was halted while reading from that range
  // (e.g. LDA $4016), then a DMA read from any address whose low 5 bits are
  // $15-$17 also reads the register, colliding with whatever the external
  // memory returns:
  //   - $4015 (APU status): the read clears the frame IRQ flag; the DMA
  //     receives the status (bit 5 is open bus, so it comes from the
  //     external value), but as usual the status doesn't drive the external
  //     data bus, which keeps the external value.
  //   - $4016/$4017 (controllers): the controller drives bits 0-4, the
  //     external value supplies bits 5-7 (normally "open bus").
  // See https://www.nesdev.org/wiki/DMA#Register_conflicts and the
  // AccuracyCoin "APU Register Activation" / "DMC DMA Bus Conflicts" tests.
  _dmaFetch(addr, haltedAddr) {
    this.cycles++;
    if (this.cycles >= this.papu.nextEventCycle) {
      this.papu.catchUp(this.cycles);
    }
    let value;
    if ((haltedAddr & 0xffe0) !== 0x4000) {
      if (addr >= 0x4000 && addr <= 0x401f) {
        // With the registers disabled, nothing drives the bus here.
        value = this.dataBus;
      } else {
        value = this._dmaBusRead(addr);
      }
      this._lastDmaReadAddr = addr;
    } else {
      const internal = 0x4000 | (addr & 0x1f);
      if (internal === 0x4015) {
        const status = this.nes.mmap.load(0x4015);
        const external =
          addr === internal ? this.dataBus : this._dmaBusRead(addr);
        value = (status & 0xdf) | (external & 0x20);
      } else if (internal === 0x4016 || internal === 0x4017) {
        let port;
        if (this._lastDmaReadAddr === internal) {
          // The controller port's /OE line stays active across back-to-back
          // reads, so the controller only sees one read (no extra clock).
          port = this.dataBus;
        } else {
          port = this.nes.mmap.load(internal);
        }
        const external =
          addr === internal ? this.dataBus : this._dmaBusRead(addr);
        value = this.dataBus = (external & 0xe0) | (port & 0x1f);
      } else {
        value = this._dmaBusRead(addr);
      }
      this._lastDmaReadAddr = internal;
    }
    this._endCycle();
    return value;
  }

  _dmaWrite(addr, value) {
    this.cycles++;
    if (this.cycles >= this.papu.nextEventCycle) {
      this.papu.catchUp(this.cycles);
    }
    this.dataBus = value;
    this._syncPpu(addr);
    this.nes.mmap.write(addr, value);
    this._endCycle();
  }

  // Run any pending DMA. Called at the start of a CPU read cycle when a DMA
  // has requested a halt. `addr` is the address the CPU was about to read;
  // the halted CPU keeps putting it on the bus during idle DMA cycles.
  _runDma(addr) {
    this._runDmaCycles(addr);
    this.lastDmaEndCycle = this.cycles;
  }

  _runDmaCycles(addr) {
    this.dmaNeedHalt = false;
    this._lastDmaReadAddr = addr;

    const isController = addr === 0x4016 || addr === 0x4017;
    // On an NES (as opposed to an original Famicom), the controller only
    // gets clocked by the first of several back-to-back reads of $4016/7,
    // because the /OE line it uses as a clock stays low throughout.
    const skipRepeatReads = isController;

    // If a DMC DMA is about to read the same 2A03 register (low 5 bits) as
    // the CPU, the CPU's halted read and the DMA read merge into one.
    let skipFirstRead = false;
    if (this.dmcDmaRunning && isController) {
      const dmcAddr = this.nes.papu.dmc.currentAddress;
      if ((dmcAddr & 0x1f) === (addr & 0x1f)) {
        skipFirstRead = true;
      }
    }

    // Halt cycle: the CPU's pending read happens, but its result is
    // discarded (the CPU will repeat it after the DMA).
    this._haltedRead(addr, skipFirstRead || (this.dmcDmaAbort && isController));

    if (this.dmcDmaAbort) {
      // The DMC DMA was aborted during its halt cycle.
      this.dmcDmaRunning = false;
      this.dmcDmaAbort = false;
      this.dmcNeedDummy = false;
      if (!this.oamDmaRunning) return;
    }

    let oamCount = 0; // number of OAM bus cycles performed (read+write)
    let oamAddr = 0; // low byte of the OAM DMA source address
    let oamValue = 0;

    while (this.dmcDmaRunning || this.oamDmaRunning) {
      // The upcoming cycle number is this.cycles + 1. "Get" cycles are the
      // even-numbered ones.
      const getCycle = ((this.cycles + 1) & 1) === 0;
      // Every DMA cycle also counts towards the DMC DMA's halt/dummy
      // requirements (a DMC DMA that starts during OAM DMA can use OAM
      // cycles as its halt and dummy cycles).
      let dmcReady =
        this.dmcDmaRunning && !this.dmaNeedHalt && !this.dmcNeedDummy;
      if (this.dmcDmaAbort) {
        this.dmcDmaRunning = false;
        this.dmcDmaAbort = false;
        this.dmcNeedDummy = false;
        this.dmaNeedHalt = false;
        dmcReady = false;
      } else if (this.dmaNeedHalt) {
        this.dmaNeedHalt = false;
      } else if (this.dmcNeedDummy) {
        this.dmcNeedDummy = false;
      }

      if (getCycle) {
        if (dmcReady) {
          const dmc = this.nes.papu.dmc;
          const value = this._dmaFetch(dmc.currentAddress, addr);
          this.dmcDmaRunning = false;
          this.dmcDmaAbort = false;
          dmc.dmaComplete(value);
        } else if (this.oamDmaRunning && (oamCount & 1) === 0) {
          oamValue = this._dmaFetch((this.oamDmaPage << 8) | oamAddr, addr);
          oamAddr = (oamAddr + 1) & 0xff;
          oamCount++;
        } else {
          // DMC DMA waiting for its halt/dummy cycle, no OAM work to do.
          this._haltedRead(addr, skipRepeatReads);
        }
      } else {
        if (this.oamDmaRunning && (oamCount & 1) === 1) {
          this._dmaWrite(0x2004, oamValue);
          oamCount++;
          if (oamCount === 512) {
            this.oamDmaRunning = false;
          }
        } else {
          // Alignment cycle.
          this._haltedRead(addr, skipRepeatReads);
        }
      }
    }
  }

  // ==========================================================================
  // Instruction execution
  // ==========================================================================

  // Executes one instruction (plus any interrupt that follows it, and any
  // DMA that interrupts it). Returns the number of CPU cycles that elapsed.
  emulate() {
    const startCycles = this.cycles;

    if (this.resetPending) {
      this.resetPending = false;
      this._interruptSequence(VECTOR_RESET);
      return this.cycles - startCycles;
    }

    const opcode = this._fetch();
    const ins = OP_INS[opcode];
    const mode = OP_MODE[opcode];

    // ------------------------------------------------------------------
    // Addressing: compute the effective address for memory operands,
    // performing the bus cycles that the real CPU performs to do so.
    // ------------------------------------------------------------------
    let addr = 0;
    // High byte of the base address before indexing, needed by the SHx
    // unofficial instructions.
    let baseHigh = 0;
    // Whether indexing crossed a page boundary.
    let crossed = false;

    if (OP_KIND[opcode] !== KIND_SPECIAL) {
      const write = OP_KIND[opcode] === KIND_WRITE;
      switch (mode) {
        case 5: {
          // Immediate: the operand is the byte after the opcode.
          addr = this.REG_PC;
          this.REG_PC = (this.REG_PC + 1) & 0xffff;
          break;
        }
        case 0: {
          // Zero page.
          addr = this._fetch();
          break;
        }
        case 6:
        case 7: {
          // Zero page,X / Zero page,Y. The CPU reads from the unindexed
          // address while it adds the index (dummy read), and the result
          // wraps within the zero page.
          const base = this._fetch();
          this.read(base);
          addr = (base + (mode === 6 ? this.REG_X : this.REG_Y)) & 0xff;
          break;
        }
        case 3: {
          // Absolute.
          const lo = this._fetch();
          addr = (this._fetch() << 8) | lo;
          break;
        }
        case 8:
        case 9: {
          // Absolute,X / Absolute,Y. The CPU first adds the index to the low
          // byte only and reads from that address. If no carry into the high
          // byte was needed, that read was correct (for read instructions);
          // otherwise it was a dummy read and the CPU reads again from the
          // fixed-up address.
          const lo = this._fetch();
          baseHigh = this._fetch();
          const base = (baseHigh << 8) | lo;
          addr = (base + (mode === 8 ? this.REG_X : this.REG_Y)) & 0xffff;
          crossed = (addr & 0xff00) !== (base & 0xff00);
          if (crossed || write) {
            this.read((base & 0xff00) | (addr & 0xff));
          }
          break;
        }
        case 10: {
          // (Indirect,X): pointer in zero page at (operand + X).
          let ptr = this._fetch();
          this.read(ptr); // dummy read while adding X
          ptr = (ptr + this.REG_X) & 0xff;
          const lo = this.read(ptr);
          addr = (this.read((ptr + 1) & 0xff) << 8) | lo;
          break;
        }
        case 11: {
          // (Indirect),Y: pointer in zero page, then add Y (with the same
          // page-crossing dummy read as Absolute,Y).
          const ptr = this._fetch();
          const lo = this.read(ptr);
          baseHigh = this.read((ptr + 1) & 0xff);
          const base = (baseHigh << 8) | lo;
          addr = (base + this.REG_Y) & 0xffff;
          crossed = (addr & 0xff00) !== (base & 0xff00);
          if (crossed || write) {
            this.read((base & 0xff00) | (addr & 0xff));
          }
          break;
        }
      }
    }

    // ------------------------------------------------------------------
    // Execute. The case labels are raw integers (matching the INS_*
    // constants) so V8 compiles the switch to a jump table.
    // ------------------------------------------------------------------
    let temp;
    let value;
    switch (ins) {
      case 0: {
        // ADC
        this._adc(this.read(addr));
        break;
      }
      case 1: {
        // AND
        this.REG_ACC &= this.read(addr);
        this.F_SIGN = this.REG_ACC >> 7;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 2: {
        // ASL
        if (mode === ADDR_ACC) {
          this.read(this.REG_PC);
          this.REG_ACC = this._asl(this.REG_ACC);
        } else {
          value = this.read(addr);
          this.write(addr, value); // dummy write of the original value
          this.write(addr, this._asl(value));
        }
        break;
      }
      case 3: {
        // BCC
        this._branch(this.F_CARRY === 0);
        break;
      }
      case 4: {
        // BCS
        this._branch(this.F_CARRY !== 0);
        break;
      }
      case 5: {
        // BEQ
        this._branch(this.F_ZERO === 0);
        break;
      }
      case 6: {
        // BIT
        value = this.read(addr);
        this.F_SIGN = (value >> 7) & 1;
        this.F_OVERFLOW = (value >> 6) & 1;
        this.F_ZERO = value & this.REG_ACC;
        break;
      }
      case 7: {
        // BMI
        this._branch(this.F_SIGN !== 0);
        break;
      }
      case 8: {
        // BNE
        this._branch(this.F_ZERO !== 0);
        break;
      }
      case 9: {
        // BPL
        this._branch(this.F_SIGN === 0);
        break;
      }
      case 10: {
        // BRK: a software interrupt. The byte after the opcode is read and
        // skipped ("padding byte"), then it behaves like an IRQ except that
        // the pushed status has the B flag set.
        this._fetch();
        this._interruptSequence(VECTOR_IRQ, true);
        break;
      }
      case 11: {
        // BVC
        this._branch(this.F_OVERFLOW === 0);
        break;
      }
      case 12: {
        // BVS
        this._branch(this.F_OVERFLOW !== 0);
        break;
      }
      case 13: {
        // CLC
        this.read(this.REG_PC);
        this.F_CARRY = 0;
        break;
      }
      case 14: {
        // CLD
        this.read(this.REG_PC);
        this.F_DECIMAL = 0;
        break;
      }
      case 15: {
        // CLI. The flag changes after this instruction's interrupt polling,
        // so a pending IRQ is serviced only after the *next* instruction.
        this.read(this.REG_PC);
        this.F_INTERRUPT = 0;
        this.nextEvent = 0; // the IRQ line may need sampling now
        break;
      }
      case 16: {
        // CLV
        this.read(this.REG_PC);
        this.F_OVERFLOW = 0;
        break;
      }
      case 17: {
        // CMP
        this._compare(this.REG_ACC, this.read(addr));
        break;
      }
      case 18: {
        // CPX
        this._compare(this.REG_X, this.read(addr));
        break;
      }
      case 19: {
        // CPY
        this._compare(this.REG_Y, this.read(addr));
        break;
      }
      case 20: {
        // DEC
        value = this.read(addr);
        this.write(addr, value);
        value = (value - 1) & 0xff;
        this.F_SIGN = value >> 7;
        this.F_ZERO = value;
        this.write(addr, value);
        break;
      }
      case 21: {
        // DEX
        this.read(this.REG_PC);
        this.REG_X = (this.REG_X - 1) & 0xff;
        this.F_SIGN = this.REG_X >> 7;
        this.F_ZERO = this.REG_X;
        break;
      }
      case 22: {
        // DEY
        this.read(this.REG_PC);
        this.REG_Y = (this.REG_Y - 1) & 0xff;
        this.F_SIGN = this.REG_Y >> 7;
        this.F_ZERO = this.REG_Y;
        break;
      }
      case 23: {
        // EOR
        this.REG_ACC ^= this.read(addr);
        this.F_SIGN = this.REG_ACC >> 7;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 24: {
        // INC
        value = this.read(addr);
        this.write(addr, value);
        value = (value + 1) & 0xff;
        this.F_SIGN = value >> 7;
        this.F_ZERO = value;
        this.write(addr, value);
        break;
      }
      case 25: {
        // INX
        this.read(this.REG_PC);
        this.REG_X = (this.REG_X + 1) & 0xff;
        this.F_SIGN = this.REG_X >> 7;
        this.F_ZERO = this.REG_X;
        break;
      }
      case 26: {
        // INY
        this.read(this.REG_PC);
        this.REG_Y = (this.REG_Y + 1) & 0xff;
        this.F_SIGN = this.REG_Y >> 7;
        this.F_ZERO = this.REG_Y;
        break;
      }
      case 27: {
        // JMP
        if (mode === ADDR_INDABS) {
          // JMP (indirect). The famous 6502 bug: the pointer's high byte is
          // read from the same page as its low byte, so JMP ($10FF) reads
          // $10FF and $1000.
          const lo = this._fetch();
          const hi = this._fetch();
          const ptr = (hi << 8) | lo;
          const pcl = this.read(ptr);
          const pch = this.read((ptr & 0xff00) | ((ptr + 1) & 0xff));
          this.REG_PC = (pch << 8) | pcl;
        } else {
          this.REG_PC = addr;
        }
        break;
      }
      case 28: {
        // JSR. Cycle order: fetch low byte of target, dummy read of the
        // stack, push return address (high, low), then fetch the high byte
        // of the target. The high byte fetch is the last bus operation, so
        // it's what's left on the data bus when the subroutine starts.
        const lo = this._fetch();
        this.read(0x100 | this.REG_SP);
        this.push(this.REG_PC >> 8);
        this.push(this.REG_PC & 0xff);
        const hi = this.read(this.REG_PC);
        this.REG_PC = (hi << 8) | lo;
        break;
      }
      case 29: {
        // LDA
        this.REG_ACC = this.F_ZERO = this.read(addr);
        this.F_SIGN = this.REG_ACC >> 7;
        break;
      }
      case 30: {
        // LDX
        this.REG_X = this.F_ZERO = this.read(addr);
        this.F_SIGN = this.REG_X >> 7;
        break;
      }
      case 31: {
        // LDY
        this.REG_Y = this.F_ZERO = this.read(addr);
        this.F_SIGN = this.REG_Y >> 7;
        break;
      }
      case 32: {
        // LSR
        if (mode === ADDR_ACC) {
          this.read(this.REG_PC);
          this.REG_ACC = this._lsr(this.REG_ACC);
        } else {
          value = this.read(addr);
          this.write(addr, value);
          this.write(addr, this._lsr(value));
        }
        break;
      }
      case 33: {
        // NOP (implied)
        this.read(this.REG_PC);
        break;
      }
      case 34: {
        // ORA
        this.REG_ACC |= this.read(addr);
        this.F_SIGN = this.REG_ACC >> 7;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 35: {
        // PHA
        this.read(this.REG_PC);
        this.push(this.REG_ACC);
        break;
      }
      case 36: {
        // PHP. The pushed copy always has bits 4 (B) and 5 set.
        this.read(this.REG_PC);
        this.push(this.getStatus() | 0x30);
        break;
      }
      case 37: {
        // PLA
        this.read(this.REG_PC);
        this.read(0x100 | this.REG_SP); // dummy read while incrementing SP
        this.REG_ACC = this.F_ZERO = this.pull();
        this.F_SIGN = this.REG_ACC >> 7;
        break;
      }
      case 38: {
        // PLP. Like CLI/SEI, the new I flag only takes effect for interrupt
        // polling after this instruction.
        this.read(this.REG_PC);
        this.read(0x100 | this.REG_SP);
        this.setStatusFromStack(this.pull());
        break;
      }
      case 39: {
        // ROL
        if (mode === ADDR_ACC) {
          this.read(this.REG_PC);
          this.REG_ACC = this._rol(this.REG_ACC);
        } else {
          value = this.read(addr);
          this.write(addr, value);
          this.write(addr, this._rol(value));
        }
        break;
      }
      case 40: {
        // ROR
        if (mode === ADDR_ACC) {
          this.read(this.REG_PC);
          this.REG_ACC = this._ror(this.REG_ACC);
        } else {
          value = this.read(addr);
          this.write(addr, value);
          this.write(addr, this._ror(value));
        }
        break;
      }
      case 41: {
        // RTI. The status is restored before the last two cycles, so unlike
        // CLI/PLP, a newly cleared I flag takes effect immediately.
        this.read(this.REG_PC);
        this.read(0x100 | this.REG_SP);
        this.setStatusFromStack(this.pull());
        const pcl = this.pull();
        const pch = this.pull();
        this.REG_PC = (pch << 8) | pcl;
        break;
      }
      case 42: {
        // RTS
        this.read(this.REG_PC);
        this.read(0x100 | this.REG_SP);
        const pcl = this.pull();
        const pch = this.pull();
        this.REG_PC = (pch << 8) | pcl;
        this.read(this.REG_PC); // dummy read while incrementing PC
        this.REG_PC = (this.REG_PC + 1) & 0xffff;
        break;
      }
      case 43: {
        // SBC
        this._adc(this.read(addr) ^ 0xff);
        break;
      }
      case 44: {
        // SEC
        this.read(this.REG_PC);
        this.F_CARRY = 1;
        break;
      }
      case 45: {
        // SED
        this.read(this.REG_PC);
        this.F_DECIMAL = 1;
        break;
      }
      case 46: {
        // SEI
        this.read(this.REG_PC);
        this.F_INTERRUPT = 1;
        break;
      }
      case 47: {
        // STA
        this.write(addr, this.REG_ACC);
        break;
      }
      case 48: {
        // STX
        this.write(addr, this.REG_X);
        break;
      }
      case 49: {
        // STY
        this.write(addr, this.REG_Y);
        break;
      }
      case 50: {
        // TAX
        this.read(this.REG_PC);
        this.REG_X = this.F_ZERO = this.REG_ACC;
        this.F_SIGN = this.REG_ACC >> 7;
        break;
      }
      case 51: {
        // TAY
        this.read(this.REG_PC);
        this.REG_Y = this.F_ZERO = this.REG_ACC;
        this.F_SIGN = this.REG_ACC >> 7;
        break;
      }
      case 52: {
        // TSX
        this.read(this.REG_PC);
        this.REG_X = this.F_ZERO = this.REG_SP;
        this.F_SIGN = this.REG_SP >> 7;
        break;
      }
      case 53: {
        // TXA
        this.read(this.REG_PC);
        this.REG_ACC = this.F_ZERO = this.REG_X;
        this.F_SIGN = this.REG_X >> 7;
        break;
      }
      case 54: {
        // TXS (doesn't affect flags)
        this.read(this.REG_PC);
        this.REG_SP = this.REG_X;
        break;
      }
      case 55: {
        // TYA
        this.read(this.REG_PC);
        this.REG_ACC = this.F_ZERO = this.REG_Y;
        this.F_SIGN = this.REG_Y >> 7;
        break;
      }

      // ---------------- Unofficial opcodes ----------------
      case 56: {
        // ALR (ASR): AND immediate, then LSR A.
        this.REG_ACC = this._lsr(this.REG_ACC & this.read(addr));
        break;
      }
      case 57: {
        // ANC: AND immediate, then copy bit 7 of the result into carry.
        this.REG_ACC &= this.read(addr);
        this.F_SIGN = this.F_CARRY = this.REG_ACC >> 7;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 58: {
        // ARR: AND immediate, then ROR A, with C and V set from bits 6 and
        // 5 of the result in a peculiar way (a side effect of the decimal
        // mode adder hardware).
        temp = this.REG_ACC & this.read(addr);
        this.REG_ACC = ((temp >> 1) | (this.F_CARRY << 7)) & 0xff;
        this.F_ZERO = this.REG_ACC;
        this.F_SIGN = this.REG_ACC >> 7;
        this.F_CARRY = (this.REG_ACC >> 6) & 1;
        this.F_OVERFLOW = ((this.REG_ACC >> 6) ^ (this.REG_ACC >> 5)) & 1;
        break;
      }
      case 59: {
        // AXS (SBX): X = (A & X) - immediate, setting flags like CMP.
        temp = (this.REG_ACC & this.REG_X) - this.read(addr);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.REG_X = this.F_ZERO = temp & 0xff;
        this.F_SIGN = this.REG_X >> 7;
        break;
      }
      case 60: {
        // LAX: load A and X.
        this.REG_ACC = this.REG_X = this.F_ZERO = this.read(addr);
        this.F_SIGN = this.REG_ACC >> 7;
        break;
      }
      case 61: {
        // SAX: store A & X.
        this.write(addr, this.REG_ACC & this.REG_X);
        break;
      }
      case 62: {
        // DCP: DEC memory, then CMP with A.
        value = this.read(addr);
        this.write(addr, value);
        value = (value - 1) & 0xff;
        this.write(addr, value);
        this._compare(this.REG_ACC, value);
        break;
      }
      case 63: {
        // ISC: INC memory, then SBC.
        value = this.read(addr);
        this.write(addr, value);
        value = (value + 1) & 0xff;
        this.write(addr, value);
        this._adc(value ^ 0xff);
        break;
      }
      case 64: {
        // RLA: ROL memory, then AND with A.
        value = this.read(addr);
        this.write(addr, value);
        value = this._rol(value);
        this.write(addr, value);
        this.REG_ACC &= value;
        this.F_SIGN = this.REG_ACC >> 7;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 65: {
        // RRA: ROR memory, then ADC.
        value = this.read(addr);
        this.write(addr, value);
        value = this._ror(value);
        this.write(addr, value);
        this._adc(value);
        break;
      }
      case 66: {
        // SLO: ASL memory, then ORA with A.
        value = this.read(addr);
        this.write(addr, value);
        value = this._asl(value);
        this.write(addr, value);
        this.REG_ACC |= value;
        this.F_SIGN = this.REG_ACC >> 7;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 67: {
        // SRE: LSR memory, then EOR with A.
        value = this.read(addr);
        this.write(addr, value);
        value = this._lsr(value);
        this.write(addr, value);
        this.REG_ACC ^= value;
        this.F_SIGN = this.REG_ACC >> 7;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 68: {
        // SKB: 2-byte NOP that reads its immediate operand.
        this.read(addr);
        break;
      }
      case 69: {
        // IGN: NOP that reads from memory using its addressing mode.
        this.read(addr);
        break;
      }
      case 71: {
        // SHA (AHX): store A & X & (H+1).
        this._shx(addr, this.REG_ACC & this.REG_X, baseHigh, crossed);
        break;
      }
      case 72: {
        // SHS (TAS): SP = A & X, then store SP & (H+1).
        this.REG_SP = this.REG_ACC & this.REG_X;
        this._shx(addr, this.REG_SP, baseHigh, crossed);
        break;
      }
      case 73: {
        // SHY: store Y & (H+1).
        this._shx(addr, this.REG_Y, baseHigh, crossed);
        break;
      }
      case 74: {
        // SHX: store X & (H+1).
        this._shx(addr, this.REG_X, baseHigh, crossed);
        break;
      }
      case 75: {
        // LAE (LAS): A = X = SP = memory & SP.
        temp = this.read(addr) & this.REG_SP;
        this.REG_ACC = this.REG_X = this.REG_SP = this.F_ZERO = temp;
        this.F_SIGN = temp >> 7;
        break;
      }
      case 76: {
        // ANE (XAA): A = (A | magic) & X & immediate. The "magic" constant
        // varies between chips; $FF is the most common value.
        this.REG_ACC = this.F_ZERO =
          (this.REG_ACC | 0xff) & this.REG_X & this.read(addr);
        this.F_SIGN = this.REG_ACC >> 7;
        break;
      }
      case 77: {
        // LXA: A = X = (A | magic) & immediate.
        this.REG_ACC =
          this.REG_X =
          this.F_ZERO =
            (this.REG_ACC | 0xff) & this.read(addr);
        this.F_SIGN = this.REG_ACC >> 7;
        break;
      }
      default: {
        // KIL/JAM opcodes lock up a real 6502.
        throw new Error(
          `Game crashed, invalid opcode at address $${((this.REG_PC - 1) & 0xffff).toString(16)}`,
        );
      }
    }

    // Service an interrupt if one was pending as of the second-to-last
    // cycle of the instruction.
    if (this.prevNeedNmi || this.prevRunIrq) {
      this._interruptSequence(VECTOR_IRQ, false);
    }

    return this.cycles - startCycles;
  }

  // The 7-cycle sequence shared by BRK, IRQ, NMI and reset.
  //
  // For hardware interrupts (IRQ/NMI) the CPU first performs two dummy
  // reads of the next opcode (it fetches it, then throws it away). BRK has
  // already done its two reads (opcode and padding byte).
  //
  // "Interrupt hijacking": the vector address is only chosen after the
  // return address has been pushed. If an NMI is detected by then, the
  // CPU jumps to the NMI handler even if this sequence started as a BRK
  // or IRQ (for BRK, the pushed status still has the B flag set, so the
  // handler can tell). See https://www.nesdev.org/wiki/CPU_interrupts
  _interruptSequence(vector, isBrk) {
    const isReset = vector === VECTOR_RESET;
    if (!isBrk) {
      this.read(this.REG_PC);
      this.read(this.REG_PC);
    }
    if (isReset) {
      // Reset performs the pushes as reads (the R/W line is held high), so
      // the stack pointer moves but nothing is written.
      this.read(0x100 | this.REG_SP);
      this.REG_SP = (this.REG_SP - 1) & 0xff;
      this.read(0x100 | this.REG_SP);
      this.REG_SP = (this.REG_SP - 1) & 0xff;
      this.read(0x100 | this.REG_SP);
      this.REG_SP = (this.REG_SP - 1) & 0xff;
    } else {
      this.push(this.REG_PC >> 8);
      this.push(this.REG_PC & 0xff);
      if (this.needNmi) {
        this.needNmi = false;
        this.forcedNmi = false;
        vector = VECTOR_NMI;
      } else if (!isBrk) {
        // An IRQ releases the (one-shot) cartridge IRQ request.
        this.irqFlags &= ~IRQ_SOURCE_MAPPER;
      }
      this.push((this.getStatus() & 0xcf) | (isBrk ? 0x30 : 0x20));
    }
    this.F_INTERRUPT = 1;
    const lo = this.read(vector);
    const hi = this.read(vector + 1);
    this.REG_PC = (hi << 8) | lo;
    // The first instruction of the handler always runs before another
    // interrupt can be taken.
    this.prevNeedNmi = false;
    this.prevRunIrq = false;
  }

  // Relative branch. Taken branches take an extra cycle (dummy read of the
  // next opcode), and another if the target is on a different page (dummy
  // read from the address with the un-fixed-up high byte).
  _branch(condition) {
    const offset = this._fetch();
    if (!condition) return;
    // Quirk: a taken branch that doesn't cross a page doesn't poll for
    // interrupts on its last cycle, so an IRQ that arrives during the
    // branch is delayed by one instruction.
    // See https://www.nesdev.org/wiki/CPU_interrupts#Branch_instructions_and_interrupts
    if (this.runIrq && !this.prevRunIrq) {
      this.runIrq = false;
    }
    this.read(this.REG_PC);
    const target =
      (this.REG_PC + (offset < 0x80 ? offset : offset - 256)) & 0xffff;
    if ((target & 0xff00) !== (this.REG_PC & 0xff00)) {
      this.read((this.REG_PC & 0xff00) | (target & 0xff));
    }
    this.REG_PC = target;
  }

  // SHA/SHX/SHY/SHS: store `value & (H+1)` where H is the high byte of the
  // base address. These are "unstable" opcodes: the H+1 term comes from
  // the address bus being driven during the previous cycle. If indexing
  // crossed a page, the high byte of the write address is also replaced by
  // the stored value. And if a DMA halted the CPU just before the write,
  // the H+1 term is lost and the plain register value is stored.
  // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
  _shx(addr, reg, baseHigh, crossed) {
    let value;
    if (this.lastDmaEndCycle === this.cycles - 1) {
      value = reg;
    } else {
      value = reg & ((baseHigh + 1) & 0xff);
    }
    if (crossed) {
      addr = (value << 8) | (addr & 0xff);
    }
    this.write(addr, value);
  }

  // ---------------- ALU helpers ----------------

  _adc(value) {
    // The NES's 2A03 has no decimal mode, so ADC/SBC are always binary.
    const result = this.REG_ACC + value + this.F_CARRY;
    this.F_OVERFLOW =
      ((this.REG_ACC ^ result) & (value ^ result) & 0x80) !== 0 ? 1 : 0;
    this.F_CARRY = result > 0xff ? 1 : 0;
    this.REG_ACC = this.F_ZERO = result & 0xff;
    this.F_SIGN = this.REG_ACC >> 7;
  }

  _compare(reg, value) {
    const result = reg - value;
    this.F_CARRY = result >= 0 ? 1 : 0;
    this.F_ZERO = result & 0xff;
    this.F_SIGN = (result >> 7) & 1;
  }

  _asl(value) {
    this.F_CARRY = value >> 7;
    value = (value << 1) & 0xff;
    this.F_SIGN = value >> 7;
    this.F_ZERO = value;
    return value;
  }

  _lsr(value) {
    this.F_CARRY = value & 1;
    value >>= 1;
    this.F_SIGN = 0;
    this.F_ZERO = value;
    return value;
  }

  _rol(value) {
    const result = ((value << 1) | this.F_CARRY) & 0xff;
    this.F_CARRY = value >> 7;
    this.F_SIGN = result >> 7;
    this.F_ZERO = result;
    return result;
  }

  _ror(value) {
    const result = (value >> 1) | (this.F_CARRY << 7);
    this.F_CARRY = value & 1;
    this.F_SIGN = result >> 7;
    this.F_ZERO = result;
    return result;
  }

  // ---------------- Status register ----------------

  getStatus() {
    return (
      this.F_CARRY |
      ((this.F_ZERO === 0 ? 1 : 0) << 1) |
      (this.F_INTERRUPT << 2) |
      (this.F_DECIMAL << 3) |
      (this.F_BRK << 4) |
      (this.F_NOTUSED << 5) |
      (this.F_OVERFLOW << 6) |
      (this.F_SIGN << 7)
    );
  }

  setStatus(st) {
    this.nextEvent = 0; // the I flag may have changed
    this.F_CARRY = st & 1;
    this.F_ZERO = ((st >> 1) & 1) === 1 ? 0 : 1;
    this.F_INTERRUPT = (st >> 2) & 1;
    this.F_DECIMAL = (st >> 3) & 1;
    this.F_BRK = (st >> 4) & 1;
    this.F_NOTUSED = (st >> 5) & 1;
    this.F_OVERFLOW = (st >> 6) & 1;
    this.F_SIGN = (st >> 7) & 1;
  }

  // Set status flags from a value pulled off the stack (PLP, RTI).
  // Bits 4 (B) and 5 (unused) don't exist as physical flags in the
  // 6502 and are ignored when pulling status from the stack.
  // See https://www.nesdev.org/wiki/Status_flags#The_B_flag
  setStatusFromStack(st) {
    this.nextEvent = 0; // the I flag may have changed
    this.F_CARRY = st & 1;
    this.F_ZERO = ((st >> 1) & 1) === 1 ? 0 : 1;
    this.F_INTERRUPT = (st >> 2) & 1;
    this.F_DECIMAL = (st >> 3) & 1;
    this.F_OVERFLOW = (st >> 6) & 1;
    this.F_SIGN = (st >> 7) & 1;
  }

  // Swap in Game Genie handling when patches are active. Called by
  // GameGenie when patches or enabled state change.
  _updateCartridgeLoader() {
    this._gameGenieActive =
      this.nes.gameGenie.enabled && this.nes.gameGenie.patches.length > 0;
    this._updatePrgReadPath();
  }

  // Use the fast path for PRG ROM reads unless the mapper handles reads
  // itself or Game Genie codes need to be applied.
  _updatePrgReadPath() {
    const mmap = this.nes.mmap;
    this.directPrgReads =
      !this._gameGenieActive && !!mmap && mmap.readsPrgFromCpuMem();
  }

  static JSON_PROPERTIES = [
    "mem",
    "cycles",
    "dataBus",
    "irqFlags",
    "resetPending",
    "nmiLine",
    "needNmi",
    "prevNeedNmi",
    "runIrq",
    "prevRunIrq",
    "dmaNeedHalt",
    "dmcDmaRunning",
    "dmcNeedDummy",
    "dmcDmaAbort",
    "oamDmaRunning",
    "oamDmaPage",
    "lastDmaEndCycle",
    "abortedDmaCycle",
    "forcedNmi",
    "REG_ACC",
    "REG_X",
    "REG_Y",
    "REG_SP",
    "REG_PC",
    "F_CARRY",
    "F_DECIMAL",
    "F_INTERRUPT",
    "F_OVERFLOW",
    "F_SIGN",
    "F_ZERO",
    "F_NOTUSED",
    "F_BRK",
  ];

  toJSON() {
    return toJSON(this);
  }

  fromJSON(s) {
    fromJSON(this, s);
    this.ppuCycles = this.cycles;
    this.nextEvent = 0;
  }
}

export default CPU;

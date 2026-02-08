var assert = require("chai").assert;
var fs = require("fs");
var NES = require("../src/nes");

// Error code descriptions from nestest.txt, keyed by [byte, code].
// Byte 0x02 errors:
var ERRORS_02 = {
  0x01: "BCS failed to branch",
  0x02: "BCS branched when it shouldn't have",
  0x03: "BCC branched when it shouldn't have",
  0x04: "BCC failed to branch",
  0x05: "BEQ failed to branch",
  0x06: "BEQ branched when it shouldn't have",
  0x07: "BNE failed to branch",
  0x08: "BNE branched when it shouldn't have",
  0x09: "BVS failed to branch",
  0x0a: "BVC branched when it shouldn't have",
  0x0b: "BVC failed to branch",
  0x0c: "BVS branched when it shouldn't have",
  0x0d: "BPL failed to branch",
  0x0e: "BPL branched when it shouldn't have",
  0x0f: "BMI failed to branch",
  0x10: "BMI branched when it shouldn't have",
  0x11: "PHP/flags failure (bits set)",
  0x12: "PHP/flags failure (bits clear)",
  0x13: "PHP/flags failure (misc bit states)",
  0x14: "PLP/flags failure (misc bit states)",
  0x15: "PLP/flags failure (misc bit states)",
  0x16: "PHA/PLA failure (PLA didn't affect Z and N properly)",
  0x17: "PHA/PLA failure (PLA didn't affect Z and N properly)",
  0x18: "ORA # failure",
  0x19: "ORA # failure",
  0x1a: "AND # failure",
  0x1b: "AND # failure",
  0x1c: "EOR # failure",
  0x1d: "EOR # failure",
  0x1e: "ADC # failure (overflow/carry problems)",
  0x1f: "ADC # failure (decimal mode was turned on)",
  0x20: "ADC # failure",
  0x21: "ADC # failure",
  0x22: "ADC # failure",
  0x23: "LDA # failure (didn't set N and Z correctly)",
  0x24: "LDA # failure (didn't set N and Z correctly)",
  0x25: "CMP # failure (messed up flags)",
  0x26: "CMP # failure (messed up flags)",
  0x27: "CMP # failure (messed up flags)",
  0x28: "CMP # failure (messed up flags)",
  0x29: "CMP # failure (messed up flags)",
  0x2a: "CMP # failure (messed up flags)",
  0x2b: "CPY # failure (messed up flags)",
  0x2c: "CPY # failure (messed up flags)",
  0x2d: "CPY # failure (messed up flags)",
  0x2e: "CPY # failure (messed up flags)",
  0x2f: "CPY # failure (messed up flags)",
  0x30: "CPY # failure (messed up flags)",
  0x31: "CPY # failure (messed up flags)",
  0x32: "CPX # failure (messed up flags)",
  0x33: "CPX # failure (messed up flags)",
  0x34: "CPX # failure (messed up flags)",
  0x35: "CPX # failure (messed up flags)",
  0x36: "CPX # failure (messed up flags)",
  0x37: "CPX # failure (messed up flags)",
  0x38: "CPX # failure (messed up flags)",
  0x39: "LDX # failure (didn't set N and Z correctly)",
  0x3a: "LDX # failure (didn't set N and Z correctly)",
  0x3b: "LDY # failure (didn't set N and Z correctly)",
  0x3c: "LDY # failure (didn't set N and Z correctly)",
  0x3d: "compare(s) stored the result in a register",
  0x3e: "INX/DEX/INY/DEY did something bad",
  0x3f: "INY/DEY messed up overflow or carry",
  0x40: "INX/DEX messed up overflow or carry",
  0x41: "TAY did something bad (changed wrong regs, messed up flags)",
  0x42: "TAX did something bad (changed wrong regs, messed up flags)",
  0x43: "TYA did something bad (changed wrong regs, messed up flags)",
  0x44: "TXA did something bad (changed wrong regs, messed up flags)",
  0x45: "TXS didn't set flags right, or TSX touched flags",
  0x46: "wrong data popped, or data not in right location on stack",
  0x47: "JSR didn't work as expected",
  0x48: "RTS/JSR shouldn't have affected flags",
  0x49: "RTI/RTS didn't work right when return addys/data were manually pushed",
  0x4a: "LSR A failed",
  0x4b: "ASL A failed",
  0x4c: "ROR A failed",
  0x4d: "ROL A failed",
  0x4e: "absolute,X NOPs less than 3 bytes long",
  0x4f: "implied NOPs affects regs/flags",
  0x50: "ZP,X NOPs less than 2 bytes long",
  0x51: "absolute NOP less than 3 bytes long",
  0x52: "ZP NOPs less than 2 bytes long",
  0x53: "absolute,X NOPs less than 3 bytes long",
  0x54: "implied NOPs affects regs/flags",
  0x55: "ZP,X NOPs less than 2 bytes long",
  0x56: "absolute NOP less than 3 bytes long",
  0x57: "ZP NOPs less than 2 bytes long",
  0x58: "(indirect,x) LDA didn't load expected data",
  0x59: "(indirect,x) STA didn't store data where it was supposed to",
  0x5a: "(indirect,x) ORA failure",
  0x5b: "(indirect,x) ORA failure",
  0x5c: "(indirect,x) AND failure",
  0x5d: "(indirect,x) AND failure",
  0x5e: "(indirect,x) EOR failure",
  0x5f: "(indirect,x) EOR failure",
  0x60: "(indirect,x) ADC failure",
  0x61: "(indirect,x) ADC failure",
  0x62: "(indirect,x) ADC failure",
  0x63: "(indirect,x) ADC failure",
  0x64: "(indirect,x) ADC failure",
  0x65: "(indirect,x) CMP failure",
  0x66: "(indirect,x) CMP failure",
  0x67: "(indirect,x) CMP failure",
  0x68: "(indirect,x) CMP failure",
  0x69: "(indirect,x) CMP failure",
  0x6a: "(indirect,x) CMP failure",
  0x6b: "(indirect,x) CMP failure",
  0x6c: "(indirect,x) SBC failure",
  0x6d: "(indirect,x) SBC failure",
  0x6e: "(indirect,x) SBC failure",
  0x6f: "(indirect,x) SBC failure",
  0x70: "(indirect,x) SBC failure",
  0x71: "SBC # failure",
  0x72: "SBC # failure",
  0x73: "SBC # failure",
  0x74: "SBC # failure",
  0x75: "SBC # failure",
  0x76: "zeropage LDA didn't set the flags properly",
  0x77: "zeropage STA affected flags it shouldn't",
  0x78: "zeropage LDY didn't set the flags properly",
  0x79: "zeropage STY affected flags it shouldn't",
  0x7a: "zeropage LDX didn't set the flags properly",
  0x7b: "zeropage STX affected flags it shouldn't",
  0x7c: "zeropage BIT failure",
  0x7d: "zeropage BIT failure",
  0x7e: "zeropage ORA failure",
  0x7f: "zeropage ORA failure",
  0x80: "zeropage AND failure",
  0x81: "zeropage AND failure",
  0x82: "zeropage EOR failure",
  0x83: "zeropage EOR failure",
  0x84: "zeropage ADC failure",
  0x85: "zeropage ADC failure",
  0x86: "zeropage ADC failure",
  0x87: "zeropage ADC failure",
  0x88: "zeropage ADC failure",
  0x89: "zeropage CMP failure",
  0x8a: "zeropage CMP failure",
  0x8b: "zeropage CMP failure",
  0x8c: "zeropage CMP failure",
  0x8d: "zeropage CMP failure",
  0x8e: "zeropage CMP failure",
  0x8f: "zeropage CMP failure",
  0x90: "zeropage SBC failure",
  0x91: "zeropage SBC failure",
  0x92: "zeropage SBC failure",
  0x93: "zeropage SBC failure",
  0x94: "zeropage SBC failure",
  0x95: "zeropage CPX failure",
  0x96: "zeropage CPX failure",
  0x97: "zeropage CPX failure",
  0x98: "zeropage CPX failure",
  0x99: "zeropage CPX failure",
  0x9a: "zeropage CPX failure",
  0x9b: "zeropage CPX failure",
  0x9c: "zeropage CPY failure",
  0x9d: "zeropage CPY failure",
  0x9e: "zeropage CPY failure",
  0x9f: "zeropage CPY failure",
  0xa0: "zeropage CPY failure",
  0xa1: "zeropage CPY failure",
  0xa2: "zeropage CPY failure",
  0xa3: "zeropage LSR failure",
  0xa4: "zeropage LSR failure",
  0xa5: "zeropage ASL failure",
  0xa6: "zeropage ASL failure",
  0xa7: "zeropage ROL failure",
  0xa8: "zeropage ROL failure",
  0xa9: "zeropage ROR failure",
  0xaa: "zeropage ROR failure",
  0xab: "zeropage INC failure",
  0xac: "zeropage INC failure",
  0xad: "zeropage DEC failure",
  0xae: "zeropage DEC failure",
  0xaf: "zeropage DEC failure",
  0xb0: "absolute LDA didn't set the flags properly",
  0xb1: "absolute STA affected flags it shouldn't",
  0xb2: "absolute LDY didn't set the flags properly",
  0xb3: "absolute STY affected flags it shouldn't",
  0xb4: "absolute LDX didn't set the flags properly",
  0xb5: "absolute STX affected flags it shouldn't",
  0xb6: "absolute BIT failure",
  0xb7: "absolute BIT failure",
  0xb8: "absolute ORA failure",
  0xb9: "absolute ORA failure",
  0xba: "absolute AND failure",
  0xbb: "absolute AND failure",
  0xbc: "absolute EOR failure",
  0xbd: "absolute EOR failure",
  0xbe: "absolute ADC failure",
  0xbf: "absolute ADC failure",
  0xc0: "absolute ADC failure",
  0xc1: "absolute ADC failure",
  0xc2: "absolute ADC failure",
  0xc3: "absolute CMP failure",
  0xc4: "absolute CMP failure",
  0xc5: "absolute CMP failure",
  0xc6: "absolute CMP failure",
  0xc7: "absolute CMP failure",
  0xc8: "absolute CMP failure",
  0xc9: "absolute CMP failure",
  0xca: "absolute SBC failure",
  0xcb: "absolute SBC failure",
  0xcc: "absolute SBC failure",
  0xcd: "absolute SBC failure",
  0xce: "absolute SBC failure",
  0xcf: "absolute CPX failure",
  0xd0: "absolute CPX failure",
  0xd1: "absolute CPX failure",
  0xd2: "absolute CPX failure",
  0xd3: "absolute CPX failure",
  0xd4: "absolute CPX failure",
  0xd5: "absolute CPX failure",
  0xd6: "absolute CPY failure",
  0xd7: "absolute CPY failure",
  0xd8: "absolute CPY failure",
  0xd9: "absolute CPY failure",
  0xda: "absolute CPY failure",
  0xdb: "absolute CPY failure",
  0xdc: "absolute CPY failure",
  0xdd: "absolute LSR failure",
  0xde: "absolute LSR failure",
  0xdf: "absolute ASL failure",
  0xe0: "absolute ASL failure",
  0xe1: "absolute ROR failure",
  0xe2: "absolute ROR failure",
  0xe3: "absolute ROL failure",
  0xe4: "absolute ROL failure",
  0xe5: "absolute INC failure",
  0xe6: "absolute INC failure",
  0xe7: "absolute DEC failure",
  0xe8: "absolute DEC failure",
  0xe9: "absolute DEC failure",
  0xea: "(indirect),y LDA didn't load what it was supposed to",
  0xeb: "(indirect),y read location should've wrapped around 0xFFFF to 0x0000",
  0xec: "(indirect),y should've wrapped zeropage address",
  0xed: "(indirect),y ORA failure",
  0xee: "(indirect),y ORA failure",
  0xef: "(indirect),y AND failure",
  0xf0: "(indirect),y AND failure",
  0xf1: "(indirect),y EOR failure",
  0xf2: "(indirect),y EOR failure",
  0xf3: "(indirect),y ADC failure",
  0xf4: "(indirect),y ADC failure",
  0xf5: "(indirect),y ADC failure",
  0xf6: "(indirect),y ADC failure",
  0xf7: "(indirect),y ADC failure",
  0xf8: "(indirect),y CMP failure",
  0xf9: "(indirect),y CMP failure",
  0xfa: "(indirect),y CMP failure",
  0xfb: "(indirect),y CMP failure",
  0xfc: "(indirect),y CMP failure",
  0xfd: "(indirect),y CMP failure",
  0xfe: "(indirect),y CMP failure",
};

// Byte 0x03 errors:
var ERRORS_03 = {
  0x01: "(indirect),y SBC failure",
  0x02: "(indirect),y SBC failure",
  0x03: "(indirect),y SBC failure",
  0x04: "(indirect),y SBC failure",
  0x05: "(indirect),y SBC failure",
  0x06: "(indirect),y STA failure",
  0x07: "JMP () data reading didn't wrap properly (fails on 65C02)",
  0x08: "zeropage,x LDY,X failure",
  0x09: "zeropage,x LDY,X failure",
  0x0a: "zeropage,x STY,X failure",
  0x0b: "zeropage,x ORA failure",
  0x0c: "zeropage,x ORA failure",
  0x0d: "zeropage,x AND failure",
  0x0e: "zeropage,x AND failure",
  0x0f: "zeropage,x EOR failure",
  0x10: "zeropage,x EOR failure",
  0x11: "zeropage,x ADC failure",
  0x12: "zeropage,x ADC failure",
  0x13: "zeropage,x ADC failure",
  0x14: "zeropage,x ADC failure",
  0x15: "zeropage,x ADC failure",
  0x16: "zeropage,x CMP failure",
  0x17: "zeropage,x CMP failure",
  0x18: "zeropage,x CMP failure",
  0x19: "zeropage,x CMP failure",
  0x1a: "zeropage,x CMP failure",
  0x1b: "zeropage,x CMP failure",
  0x1c: "zeropage,x CMP failure",
  0x1d: "zeropage,x SBC failure",
  0x1e: "zeropage,x SBC failure",
  0x1f: "zeropage,x SBC failure",
  0x20: "zeropage,x SBC failure",
  0x21: "zeropage,x SBC failure",
  0x22: "zeropage,x LDA failure",
  0x23: "zeropage,x LDA failure",
  0x24: "zeropage,x STA failure",
  0x25: "zeropage,x LSR failure",
  0x26: "zeropage,x LSR failure",
  0x27: "zeropage,x ASL failure",
  0x28: "zeropage,x ASL failure",
  0x29: "zeropage,x ROR failure",
  0x2a: "zeropage,x ROR failure",
  0x2b: "zeropage,x ROL failure",
  0x2c: "zeropage,x ROL failure",
  0x2d: "zeropage,x INC failure",
  0x2e: "zeropage,x INC failure",
  0x2f: "zeropage,x DEC failure",
  0x30: "zeropage,x DEC failure",
  0x31: "zeropage,x DEC failure",
  0x32: "zeropage,x LDX,Y failure",
  0x33: "zeropage,x LDX,Y failure",
  0x34: "zeropage,x STX,Y failure",
  0x35: "zeropage,x STX,Y failure",
  0x36: "absolute,y LDA failure",
  0x37: "absolute,y LDA failure to wrap properly from 0xFFFF to 0x0000",
  0x38: "absolute,y LDA failure, page cross",
  0x39: "absolute,y ORA failure",
  0x3a: "absolute,y ORA failure",
  0x3b: "absolute,y AND failure",
  0x3c: "absolute,y AND failure",
  0x3d: "absolute,y EOR failure",
  0x3e: "absolute,y EOR failure",
  0x3f: "absolute,y ADC failure",
  0x40: "absolute,y ADC failure",
  0x41: "absolute,y ADC failure",
  0x42: "absolute,y ADC failure",
  0x43: "absolute,y ADC failure",
  0x44: "absolute,y CMP failure",
  0x45: "absolute,y CMP failure",
  0x46: "absolute,y CMP failure",
  0x47: "absolute,y CMP failure",
  0x48: "absolute,y CMP failure",
  0x49: "absolute,y CMP failure",
  0x4a: "absolute,y CMP failure",
  0x4b: "absolute,y SBC failure",
  0x4c: "absolute,y SBC failure",
  0x4d: "absolute,y SBC failure",
  0x4e: "absolute,y SBC failure",
  0x4f: "absolute,y SBC failure",
  0x50: "absolute,y STA failure",
  0x51: "absolute,x LDY,X failure",
  0x52: "absolute,x LDY,X failure (didn't page cross)",
  0x53: "absolute,x ORA failure",
  0x54: "absolute,x ORA failure",
  0x55: "absolute,x AND failure",
  0x56: "absolute,x AND failure",
  0x57: "absolute,x EOR failure",
  0x58: "absolute,x EOR failure",
  0x59: "absolute,x ADC failure",
  0x5a: "absolute,x ADC failure",
  0x5b: "absolute,x ADC failure",
  0x5c: "absolute,x ADC failure",
  0x5d: "absolute,x ADC failure",
  0x5e: "absolute,x CMP failure",
  0x5f: "absolute,x CMP failure",
  0x60: "absolute,x CMP failure",
  0x61: "absolute,x CMP failure",
  0x62: "absolute,x CMP failure",
  0x63: "absolute,x CMP failure",
  0x64: "absolute,x CMP failure",
  0x65: "absolute,x SBC failure",
  0x66: "absolute,x SBC failure",
  0x67: "absolute,x SBC failure",
  0x68: "absolute,x SBC failure",
  0x69: "absolute,x SBC failure",
  0x6a: "absolute,x LDA failure",
  0x6b: "absolute,x LDA failure (didn't page cross)",
  0x6c: "absolute,x STA failure",
  0x6d: "absolute,x LSR failure",
  0x6e: "absolute,x LSR failure",
  0x6f: "absolute,x ASL failure",
  0x70: "absolute,x ASL failure",
  0x71: "absolute,x ROR failure",
  0x72: "absolute,x ROR failure",
  0x73: "absolute,x ROL failure",
  0x74: "absolute,x ROL failure",
  0x75: "absolute,x INC failure",
  0x76: "absolute,x INC failure",
  0x77: "absolute,x DEC failure",
  0x78: "absolute,x DEC failure",
  0x79: "absolute,x DEC failure",
  0x7a: "absolute,x LDX,Y failure",
  0x7b: "absolute,x LDX,Y failure",
  0x7c: "LAX (indr,x) failure",
  0x7d: "LAX (indr,x) failure",
  0x7e: "LAX zeropage failure",
  0x7f: "LAX zeropage failure",
  0x80: "LAX absolute failure",
  0x81: "LAX absolute failure",
  0x82: "LAX (indr),y failure",
  0x83: "LAX (indr),y failure",
  0x84: "LAX zp,y failure",
  0x85: "LAX zp,y failure",
  0x86: "LAX abs,y failure",
  0x87: "LAX abs,y failure",
  0x88: "SAX (indr,x) failure",
  0x89: "SAX (indr,x) failure",
  0x8a: "SAX zeropage failure",
  0x8b: "SAX zeropage failure",
  0x8c: "SAX absolute failure",
  0x8d: "SAX absolute failure",
  0x8e: "SAX zp,y failure",
  0x8f: "SAX zp,y failure",
  0x90: "SBC (unofficial) failure",
  0x91: "SBC (unofficial) failure",
  0x92: "SBC (unofficial) failure",
  0x93: "SBC (unofficial) failure",
  0x94: "SBC (unofficial) failure",
  0x95: "DCP (indr,x) failure",
  0x96: "DCP (indr,x) failure",
  0x97: "DCP (indr,x) failure",
  0x98: "DCP zeropage failure",
  0x99: "DCP zeropage failure",
  0x9a: "DCP zeropage failure",
  0x9b: "DCP absolute failure",
  0x9c: "DCP absolute failure",
  0x9d: "DCP absolute failure",
  0x9e: "DCP (indr),y failure",
  0x9f: "DCP (indr),y failure",
  0xa0: "DCP (indr),y failure",
  0xa1: "DCP zp,x failure",
  0xa2: "DCP zp,x failure",
  0xa3: "DCP zp,x failure",
  0xa4: "DCP abs,y failure",
  0xa5: "DCP abs,y failure",
  0xa6: "DCP abs,y failure",
  0xa7: "DCP abs,x failure",
  0xa8: "DCP abs,x failure",
  0xa9: "DCP abs,x failure",
  0xaa: "ISC (indr,x) failure",
  0xab: "ISC (indr,x) failure",
  0xac: "ISC (indr,x) failure",
  0xad: "ISC zeropage failure",
  0xae: "ISC zeropage failure",
  0xaf: "ISC zeropage failure",
  0xb0: "ISC absolute failure",
  0xb1: "ISC absolute failure",
  0xb2: "ISC absolute failure",
  0xb3: "ISC (indr),y failure",
  0xb4: "ISC (indr),y failure",
  0xb5: "ISC (indr),y failure",
  0xb6: "ISC zp,x failure",
  0xb7: "ISC zp,x failure",
  0xb8: "ISC zp,x failure",
  0xb9: "ISC abs,y failure",
  0xba: "ISC abs,y failure",
  0xbb: "ISC abs,y failure",
  0xbc: "ISC abs,x failure",
  0xbd: "ISC abs,x failure",
  0xbe: "ISC abs,x failure",
  0xbf: "SLO (indr,x) failure",
  0xc0: "SLO (indr,x) failure",
  0xc1: "SLO (indr,x) failure",
  0xc2: "SLO zeropage failure",
  0xc3: "SLO zeropage failure",
  0xc4: "SLO zeropage failure",
  0xc5: "SLO absolute failure",
  0xc6: "SLO absolute failure",
  0xc7: "SLO absolute failure",
  0xc8: "SLO (indr),y failure",
  0xc9: "SLO (indr),y failure",
  0xca: "SLO (indr),y failure",
  0xcb: "SLO zp,x failure",
  0xcc: "SLO zp,x failure",
  0xcd: "SLO zp,x failure",
  0xce: "SLO abs,y failure",
  0xcf: "SLO abs,y failure",
  0xd0: "SLO abs,y failure",
  0xd1: "SLO abs,x failure",
  0xd2: "SLO abs,x failure",
  0xd3: "SLO abs,x failure",
  0xd4: "RLA (indr,x) failure",
  0xd5: "RLA (indr,x) failure",
  0xd6: "RLA (indr,x) failure",
  0xd7: "RLA zeropage failure",
  0xd8: "RLA zeropage failure",
  0xd9: "RLA zeropage failure",
  0xda: "RLA absolute failure",
  0xdb: "RLA absolute failure",
  0xdc: "RLA absolute failure",
  0xdd: "RLA (indr),y failure",
  0xde: "RLA (indr),y failure",
  0xdf: "RLA (indr),y failure",
  0xe0: "RLA zp,x failure",
  0xe1: "RLA zp,x failure",
  0xe2: "RLA zp,x failure",
  0xe3: "RLA abs,y failure",
  0xe4: "RLA abs,y failure",
  0xe5: "RLA abs,y failure",
  0xe6: "RLA abs,x failure",
  0xe7: "RLA abs,x failure",
  0xe8: "RLA abs,x failure",
  0xe9: "SRE (indr,x) failure",
  0xea: "SRE (indr,x) failure",
  0xeb: "SRE (indr,x) failure",
  0xec: "SRE zeropage failure",
  0xed: "SRE zeropage failure",
  0xee: "SRE zeropage failure",
  0xef: "SRE absolute failure",
  0xf0: "SRE absolute failure",
  0xf1: "SRE absolute failure",
  0xf2: "SRE (indr),y failure",
  0xf3: "SRE (indr),y failure",
  0xf4: "SRE (indr),y failure",
  0xf5: "SRE zp,x failure",
  0xf6: "SRE zp,x failure",
  0xf7: "SRE zp,x failure",
  0xf8: "SRE abs,y failure",
  0xf9: "SRE abs,y failure",
  0xfa: "SRE abs,y failure",
  0xfb: "SRE abs,x failure",
  0xfc: "SRE abs,x failure",
  0xfd: "SRE abs,x failure",
};

// Group test ranges for byte 0x02 into named test groups.
// Each group covers a contiguous range of error codes.
var TEST_GROUPS_02 = [
  { name: "Branch tests", from: 0x01, to: 0x10 },
  { name: "Flag tests (PHP/PLP/PHA/PLA)", from: 0x11, to: 0x17 },
  { name: "Immediate instruction tests", from: 0x18, to: 0x3d },
  { name: "Implied instruction tests (INX/DEX/TAX/etc)", from: 0x3e, to: 0x45 },
  { name: "Stack tests", from: 0x46, to: 0x49 },
  { name: "Accumulator shift tests (LSR/ASL/ROR/ROL A)", from: 0x4a, to: 0x4d },
  { name: "Unofficial NOP tests", from: 0x4e, to: 0x57 },
  { name: "(indirect,x) tests", from: 0x58, to: 0x70 },
  { name: "SBC # tests", from: 0x71, to: 0x75 },
  { name: "Zeropage tests", from: 0x76, to: 0xaf },
  { name: "Absolute tests", from: 0xb0, to: 0xe9 },
  { name: "(indirect),y tests", from: 0xea, to: 0xfe },
];

var TEST_GROUPS_03 = [
  { name: "(indirect),y tests (continued)", from: 0x01, to: 0x06 },
  { name: "JMP indirect wrapping test", from: 0x07, to: 0x07 },
  { name: "Zeropage,x tests", from: 0x08, to: 0x31 },
  { name: "Zeropage,x LDX,Y / STX,Y tests", from: 0x32, to: 0x35 },
  { name: "Absolute,y tests", from: 0x36, to: 0x50 },
  { name: "Absolute,x tests", from: 0x51, to: 0x7b },
  { name: "Unofficial LAX tests", from: 0x7c, to: 0x87 },
  { name: "Unofficial SAX tests", from: 0x88, to: 0x8f },
  { name: "Unofficial SBC tests", from: 0x90, to: 0x94 },
  { name: "Unofficial DCP tests", from: 0x95, to: 0xa9 },
  { name: "Unofficial ISC tests", from: 0xaa, to: 0xbe },
  { name: "Unofficial SLO tests", from: 0xbf, to: 0xd3 },
  { name: "Unofficial RLA tests", from: 0xd4, to: 0xe8 },
  { name: "Unofficial SRE tests", from: 0xe9, to: 0xfd },
];

/**
 * Run nestest in automation mode: set PC to 0xC000 and step through
 * CPU instructions until the ROM finishes or hits an invalid opcode.
 *
 * The automation entry point at 0xC000 is a JMP that bypasses the
 * interactive menu and runs all tests sequentially. Results are stored
 * in memory:
 *   mem[0x10] = page 1 result (official opcodes, corresponds to "byte 02h")
 *   mem[0x11] = page 2 result (unofficial opcodes, corresponds to "byte 03h")
 * A value of 0x00 means all tests in that page passed.
 */
function runNestest(romData) {
  var nes = new NES({
    onFrame: function () {},
    onAudioSample: function () {},
    emulateSound: false,
  });

  nes.loadROM(romData);

  // Override PC to 0xC000 for automation mode.
  // The emulator uses REG_PC as (actual_PC - 1).
  nes.cpu.REG_PC = 0xc000 - 1;
  nes.cpu.REG_PC_NEW = 0xc000 - 1;
  // Clear the pending reset IRQ so our PC override isn't overwritten
  nes.cpu.irqRequested = false;

  // Step individual CPU instructions (no PPU needed — the automation
  // path doesn't wait for VBlank). Run until the ROM hits an invalid
  // opcode (crashes) or we reach a safety limit.
  var maxInstructions = 100000;
  var count = 0;

  var crashMessage = null;
  try {
    while (count < maxInstructions) {
      nes.cpu.emulate();
      count++;
    }
  } catch (e) {
    crashMessage = e.message;
  }

  // A crash in the open bus region ($4018-$5FFF) is expected when open bus
  // is properly emulated — the nestest automation mode executes from open
  // bus addresses, and the data bus values lead to a KIL opcode.
  var crashInOpenBus =
    crashMessage !== null &&
    /address \$[45][0-9a-f]{3}$/.test(crashMessage);

  return {
    result02: nes.cpu.mem[0x10],
    result03: nes.cpu.mem[0x11],
    instructions: count,
    crashed: crashMessage !== null && !crashInOpenBus,
    crashMessage: crashMessage,
  };
}

function describeError(byte, code, errorTable) {
  if (code === 0) return null;
  var desc = errorTable[code];
  var hex = "0x" + code.toString(16).toUpperCase().padStart(2, "0");
  if (desc) {
    return "byte " + byte + " error " + hex + ": " + desc;
  }
  return "byte " + byte + " error " + hex + " (unknown error code)";
}

describe("nestest (CPU test ROM)", function () {
  this.timeout(30000);

  var results;

  before(function (done) {
    fs.readFile("roms/nestest/nestest.nes", function (err, data) {
      if (err) return done(err);
      results = runNestest(data.toString("binary"));
      done();
    });
  });

  it("should run without crashing", function () {
    assert.isAbove(
      results.instructions,
      1000,
      "Test ROM didn't run enough instructions",
    );
    assert.isFalse(
      results.crashed,
      "ROM crashed: " + results.crashMessage,
    );
  });

  // Generate individual test cases for each group in byte 0x02
  TEST_GROUPS_02.forEach(function (group) {
    it(group.name, function () {
      var code = results.result02;
      if (code >= group.from && code <= group.to) {
        assert.fail(describeError("0x02", code, ERRORS_02));
      }
    });
  });

  // Generate individual test cases for each group in byte 0x03.
  // This covers official addressing mode tests and unofficial opcode tests.
  // Note: RRA tests (codes 0x01-0x15) overlap with official (indirect),y
  // codes and run last, so a RRA failure would overwrite earlier results.
  TEST_GROUPS_03.forEach(function (group) {
    it(group.name, function () {
      var code = results.result03;
      if (code >= group.from && code <= group.to) {
        assert.fail(describeError("0x03", code, ERRORS_03));
      }
    });
  });

  it("all official opcode tests pass (byte 0x02 = 0x00)", function () {
    var code = results.result02;
    if (code !== 0) {
      assert.fail(
        describeError("0x02", code, ERRORS_02) ||
          "byte 0x02 = 0x" + code.toString(16),
      );
    }
  });

  it("all unofficial opcode tests pass (byte 0x03 = 0x00)", function () {
    var code = results.result03;
    if (code !== 0) {
      assert.fail(
        describeError("0x03", code, ERRORS_03) ||
          "byte 0x03 = 0x" + code.toString(16),
      );
    }
  });

  after(function () {
    // Print summary
    var hex02 =
      "0x" + results.result02.toString(16).toUpperCase().padStart(2, "0");
    var hex03 =
      "0x" + results.result03.toString(16).toUpperCase().padStart(2, "0");
    console.log("");
    console.log(
      "    nestest results: byte 0x02 = " + hex02 + ", byte 0x03 = " + hex03,
    );
    if (results.result02 === 0 && results.result03 === 0) {
      console.log("    All tests passed!");
    } else {
      if (results.result02 !== 0) {
        console.log(
          "    Last failure (page 1): " +
            describeError("0x02", results.result02, ERRORS_02),
        );
      }
      if (results.result02 === 0 && results.result03 !== 0) {
        console.log(
          "    Last failure (page 2): " +
            describeError("0x03", results.result03, ERRORS_03),
        );
      }
    }
  });
});

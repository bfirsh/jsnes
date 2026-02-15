import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import CPU from "../src/cpu.js";

// Based on https://github.com/gutomaia/wedNESday/blob/0.0.x/wednesday/cpu_6502_spec.py
// ... which was based on https://github.com/nwidger/nintengo/blob/master/m65go2/instructions_test.go

const Status = {
  C: 0b00000001, // Carry
  Z: 0b00000010, // Zero
  I: 0b00000100, // Interrupt Disable
  D: 0b00001000, // Decimal
  B: 0b00010000, // B Flag
  U: 0b00100000, // Unused always pushed as 1
  V: 0b01000000, // Overflow
  N: 0b10000000, // Negative
};

const REGISTER_MAP = {
  PC: "REG_PC",
  SP: "REG_SP",
  A: "REG_ACC",
  X: "REG_X",
  Y: "REG_Y",
};

const FLAG_MAP = {
  C: "F_CARRY",
  Z: "F_ZERO",
  I: "F_INTERRUPT",
  D: "F_DECIMAL",
  V: "F_OVERFLOW",
  N: "F_SIGN",
};

const MMAP = function (mem) {
  this.mem = mem;
};

MMAP.prototype.load = function (addr) {
  return this.mem[addr];
};

MMAP.prototype.write = function (addr, val) {
  this.mem[addr] = val;
};

import GameGenie from "../src/gamegenie.js";

const NES = function (mmap) {
  this.mmap = mmap;
  this.gameGenie = new GameGenie();
  // Stub for inline PPU stepping in CPU bus operations
  this.ppu = { step() {} };
  // Stub for APU catch-up during $4015 reads
  this.papu = { advanceFrameCounter() {} };
};

NES.prototype.stop = function () {};

describe("CPU", function () {
  let cpu = null;
  let mmap = null;
  let nes = null;
  let mem = null;
  let perform_check_cycles = true;

  beforeEach(function () {
    mem = Array.apply(null, Array(0x10000)).map(Number.prototype.valueOf, 0);

    mmap = new MMAP(mem);
    nes = new NES(mmap);
    cpu = new CPU(nes);
    cpu.mem = mem;
    perform_check_cycles = true;
    cpu.REG_SP = 0xfd;
  });

  function check_cycles() {
    return perform_check_cycles;
  }

  function skip_cycles() {
    perform_check_cycles = false;
  }

  function cpu_pc(counter) {
    cpu.REG_PC = counter - 1;
    cpu.REG_PC_NEW = counter - 1;
  }

  function memory_set(pos, val) {
    if (pos < 0x2000) {
      mem[pos & 0x7ff] = val;
    } else {
      nes.mmap.write(pos, val);
    }
  }

  function memory_fetch(pos) {
    if (pos < 0x2000) {
      return cpu.mem[pos];
    } else {
      return nes.mmap.read();
    }
  }

  function execute() {
    let cycles = cpu.emulate();
    return cycles;
  }

  function cpu_set_register(register, value) {
    if (register == "P") {
      cpu.setStatus(value);
    } else {
      let reg = REGISTER_MAP[register];
      cpu[reg] = value;
    }
  }

  function cpu_register(register) {
    if (register == "P") {
      // Mask bits 4-5: B and unused don't exist as physical flags
      return cpu.getStatus() & 0xcf;
    }
    const reg = REGISTER_MAP[register];
    const val = cpu[reg];
    if (register == "PC") {
      return val + 1;
    }
    return val;
  }

  function cpu_flag(flag) {
    let fg = FLAG_MAP[flag];
    let val = Boolean(cpu[fg]);
    if (flag == "Z") {
      return !val;
    }
    return val;
  }

  function cpu_set_flag(flag) {
    let fg = FLAG_MAP[flag];
    if (flag == "Z") {
      cpu[fg] = 0;
    } else {
      cpu[fg] = 1;
    }
  }

  function cpu_unset_flag(flag) {
    let fg = FLAG_MAP[flag];
    if (flag == "Z") {
      cpu[fg] = 1;
    } else {
      cpu[fg] = 0;
    }
  }

  function cpu_push_byte(byte) {
    cpu.push(byte);
  }

  function cpu_pull_byte() {
    return cpu.pull();
  }

  function cpu_push_word(word) {
    let hi = (0xff00 & word) >> 8;
    let lo = 0x00ff & word;
    cpu_push_byte(hi);
    cpu_push_byte(lo);
  }

  function cpu_pull_word() {
    let b1 = cpu_pull_byte();
    let b2 = cpu_pull_byte() << 8;
    return b1 + b2;
  }

  function cpu_force_interrupt(type) {
    let typeMap = {
      irq: cpu.IRQ_NORMAL,
      nmi: cpu.IRQ_NMI,
      rst: cpu.IRQ_RESET,
    };
    cpu.requestIrq(typeMap[type]);
  }

  function cpu_get_interrupt(type) {
    return cpu.irqRequested;
  }

  function execute_interrupt() {
    // Replicate interrupt handling from cpu.emulate() without
    // executing the instruction at the target address
    let temp =
      cpu.F_CARRY |
      ((cpu.F_ZERO === 0 ? 1 : 0) << 1) |
      (cpu.F_INTERRUPT << 2) |
      (cpu.F_DECIMAL << 3) |
      (cpu.F_BRK << 4) |
      (cpu.F_NOTUSED << 5) |
      (cpu.F_OVERFLOW << 6) |
      (cpu.F_SIGN << 7);

    cpu.REG_PC_NEW = cpu.REG_PC;
    cpu.F_INTERRUPT_NEW = cpu.F_INTERRUPT;
    switch (cpu.irqType) {
      case 0: {
        if (cpu.F_INTERRUPT !== 0) {
          break;
        }
        cpu.doIrq(temp & 0xef);
        break;
      }
      case 1: {
        cpu.doNonMaskableInterrupt(temp & 0xef);
        break;
      }
      case 2: {
        cpu.doResetInterrupt();
        break;
      }
    }

    cpu.REG_PC = cpu.REG_PC_NEW;
    cpu.F_INTERRUPT = cpu.F_INTERRUPT_NEW;
    cpu.F_BRK = cpu.F_BRK_NEW;
    cpu.irqRequested = false;
  }

  it("lda imediate", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa9);
    memory_set(0x101, 0xff);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("lda zeropage", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa5);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("lda zero page x", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xb5);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0xff);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("lda absolute", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xad);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("lda absolute x", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xbd);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0xff);
    let cycles = execute();
    if (check_cycles()) {
      assert.strictEqual(cycles, 0x4);
    }
    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("lda absolute x 2", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xbd);
    memory_set(0x101, 0xff);
    memory_set(0x102, 0x2);
    memory_set(0x300, 0xff);
    let cycles = execute();
    if (check_cycles()) {
      assert.strictEqual(cycles, 0x5);
    }
  });

  it("lda absolute y", function () {
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xb9);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0xff);
    let cycles = execute();
    if (check_cycles()) {
      assert.strictEqual(cycles, 0x4);
    }
    assert.strictEqual(cpu_register("A"), 0xff);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xb9);
    memory_set(0x101, 0xff);
    memory_set(0x102, 0x2);
    memory_set(0x300, 0xff);
    cycles = execute();
    if (check_cycles()) {
      assert.strictEqual(cycles, 0x5);
    }
  });

  it("lda indirect x", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xa1);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x87);
    memory_set(0x86, 0x0);
    memory_set(0x87, 0xff);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("lda indirect y", function () {
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xb1);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x86);
    memory_set(0x85, 0x0);
    memory_set(0x87, 0xff);
    let cycles = execute();
    if (check_cycles()) {
      assert.strictEqual(cycles, 0x5);
    }
    assert.strictEqual(cpu_register("A"), 0xff);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xb1);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xff);
    memory_set(0x85, 0x2);
    memory_set(0x300, 0xff);
    cycles = execute();
    if (check_cycles()) {
      assert.strictEqual(cycles, 0x6);
    }
  });

  it("lda z flag set", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa9);
    memory_set(0x101, 0x0);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("lda z flag unset", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa9);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("lda n flag set", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa9);
    memory_set(0x101, 0x81);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("lda n flag unset", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa9);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("ldx immediate", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa2);
    memory_set(0x101, 0xff);

    execute();

    assert.strictEqual(cpu_register("X"), 0xff);
  });

  it("ldx zero page", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa6);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_register("X"), 0xff);
  });

  it("ldx zeropage y", function () {
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xb6);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0xff);

    execute();

    assert.strictEqual(cpu_register("X"), 0xff);
  });

  it("ldx absolute", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xae);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_register("X"), 0xff);
  });

  it("ldx absolute y", function () {
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xbe);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0xff);

    execute();

    assert.strictEqual(cpu_register("X"), 0xff);
  });

  it("ldx z flag set", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa2);
    memory_set(0x101, 0x0);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("ldx z flag unset", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa2);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("ldx n flag set", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa2);
    memory_set(0x101, 0x81);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("ldx n flag unset", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa2);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("ldy immediate", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa0);
    memory_set(0x101, 0xff);

    execute();

    assert.strictEqual(cpu_register("Y"), 0xff);
  });

  it("ldy zeropage", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa4);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_register("Y"), 0xff);
  });

  it("ldy zeropage x", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xb4);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0xff);

    execute();

    assert.strictEqual(cpu_register("Y"), 0xff);
  });

  it("ldy absolute", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xac);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_register("Y"), 0xff);
  });

  it("ldy absolute x", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xbc);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0xff);

    execute();

    assert.strictEqual(cpu_register("Y"), 0xff);
  });

  it("ldy z flag set", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa0);
    memory_set(0x101, 0x0);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("ldy z flag unset", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa0);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("ldy n flag set", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa0);
    memory_set(0x101, 0x81);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("ldy n flag unset", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xa0);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("sta zeropage", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x85);
    memory_set(0x101, 0x84);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0xff);
  });

  it("sta zeropage x", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x95);
    memory_set(0x101, 0x84);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0xff);
  });

  it("sta absolute", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x8d);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0xff);
  });

  it("sta absolute x", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x9d);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0xff);
  });

  it("sta absolute y", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x99);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0xff);
  });

  it("sta indirect x", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x81);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x87);
    memory_set(0x86, 0x0);

    execute();

    assert.strictEqual(memory_fetch(0x87), 0xff);
  });

  it("sta indirect y", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x91);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x86);
    memory_set(0x85, 0x0);

    execute();

    assert.strictEqual(memory_fetch(0x87), 0xff);
  });

  it("stx zeropage", function () {
    cpu_set_register("X", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x86);
    memory_set(0x101, 0x84);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0xff);
  });

  it("stx zeropage y", function () {
    cpu_set_register("X", 0xff);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x96);
    memory_set(0x101, 0x84);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0xff);
  });

  it("stx absolute", function () {
    cpu_set_register("X", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x8e);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0xff);
  });

  it("sty zeropage", function () {
    cpu_set_register("Y", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x84);
    memory_set(0x101, 0x84);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0xff);
  });

  it("sty zeropage y", function () {
    cpu_set_register("Y", 0xff);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x94);
    memory_set(0x101, 0x84);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0xff);
  });

  it("sty absolute", function () {
    cpu_set_register("Y", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x8c);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0xff);
  });

  it("tax", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xaa);

    execute();

    assert.strictEqual(cpu_register("X"), 0xff);
  });

  it("tax z flag set", function () {
    cpu_set_register("A", 0x0);
    cpu_pc(0x100);
    memory_set(0x100, 0xaa);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("tax z flag unset", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xaa);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("tax n flag set", function () {
    cpu_set_register("A", 0x81);
    cpu_pc(0x100);
    memory_set(0x100, 0xaa);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("tax n flag unset", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xaa);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("tay", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xa8);

    execute();

    assert.strictEqual(cpu_register("Y"), 0xff);
  });

  it("txa", function () {
    cpu_set_register("X", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x8a);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("tya", function () {
    cpu_set_register("Y", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x98);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("tsx", function () {
    cpu_set_register("SP", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xba);

    execute();

    assert.strictEqual(cpu_register("X"), 0xff);
  });

  it("txs", function () {
    cpu_set_register("X", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x9a);

    execute();

    assert.strictEqual(cpu_register("SP"), 0xff);
  });

  it("pha", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x48);

    execute();

    assert.strictEqual(cpu_pull_byte(), 0xff);
  });

  it("php", function () {
    cpu_set_register("P", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x8);

    execute();

    assert.strictEqual(cpu_pull_byte(), 0xff);
  });

  it("pla", function () {
    cpu_pc(0x100);
    cpu_push_byte(0xff);
    memory_set(0x100, 0x68);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("pla z flag set", function () {
    cpu_push_byte(0x0);
    cpu_pc(0x100);
    memory_set(0x100, 0x68);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("pla z flag unset", function () {
    cpu_push_byte(0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x68);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("pla n flag set", function () {
    cpu_push_byte(0x81);
    cpu_pc(0x100);
    memory_set(0x100, 0x68);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("pla n flag unset", function () {
    cpu_push_byte(0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x68);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("plp", function () {
    cpu_push_byte(0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x28);

    execute();

    assert.strictEqual(cpu_register("P"), 0xcf);
  });

  it("and immediate", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x29);
    memory_set(0x101, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf);
  });

  it("and zeropage", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x25);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf);
  });

  it("and zeropage x", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x35);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf);
  });

  it("and absolute", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x2d);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf);
  });

  it("and absolute x", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x3d);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf);
  });

  it("and absolute y", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x39);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf);
  });

  it("and indirect x", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x21);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x87);
    memory_set(0x86, 0x0);
    memory_set(0x87, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf);
  });

  it("and indirect y", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x31);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x86);
    memory_set(0x85, 0x0);
    memory_set(0x87, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf);
  });

  it("and z flag set", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0x29);
    memory_set(0x101, 0x0);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("and z flag unset", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x29);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("and n flag set", function () {
    cpu_set_register("A", 0x81);
    cpu_pc(0x100);
    memory_set(0x100, 0x29);
    memory_set(0x101, 0x81);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("and n flag unset", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0x29);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("eor immediate", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x49);
    memory_set(0x101, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf0);
  });

  it("eor zeropage", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x45);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf0);
  });

  it("eor zeropage x", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x55);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf0);
  });

  it("eor absolute", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x4d);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf0);
  });

  it("eor absolute x", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x5d);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf0);
  });

  it("eor absolute y", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x59);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf0);
  });

  it("eor indirect x", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x41);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x87);
    memory_set(0x86, 0x0);
    memory_set(0x87, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf0);
  });

  it("eor indirect y", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x51);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x86);
    memory_set(0x85, 0x0);
    memory_set(0x87, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xf0);
  });

  it("eor z flag set", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0x49);
    memory_set(0x101, 0x0);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("eor z flag unset", function () {
    cpu_set_register("A", 0x0);
    cpu_pc(0x100);
    memory_set(0x100, 0x49);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("eor n flag set", function () {
    cpu_set_register("A", 0x0);
    cpu_pc(0x100);
    memory_set(0x100, 0x49);
    memory_set(0x101, 0x81);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("eor n flag unset", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0x49);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("ora immediate", function () {
    cpu_set_register("A", 0xf0);
    cpu_pc(0x100);
    memory_set(0x100, 0x9);
    memory_set(0x101, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("ora zeropage", function () {
    cpu_set_register("A", 0xf0);
    cpu_pc(0x100);
    memory_set(0x100, 0x5);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("ora zeropage x", function () {
    cpu_set_register("A", 0xf0);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x15);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("ora absolute", function () {
    cpu_set_register("A", 0xf0);
    cpu_pc(0x100);
    memory_set(0x100, 0xd);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("ora absolute x", function () {
    cpu_set_register("A", 0xf0);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x1d);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("ora absolute y", function () {
    cpu_set_register("A", 0xf0);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x19);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("ora indirect x", function () {
    cpu_set_register("A", 0xf0);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x1);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x87);
    memory_set(0x86, 0x0);
    memory_set(0x87, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("ora indirect y", function () {
    cpu_set_register("A", 0xf0);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x11);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x86);
    memory_set(0x85, 0x0);
    memory_set(0x87, 0xf);

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("ora z flag set", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0x9);
    memory_set(0x101, 0x0);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("ora z flag unset", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x9);
    memory_set(0x101, 0x0);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("ora n flag set", function () {
    cpu_set_register("A", 0x81);
    cpu_pc(0x100);
    memory_set(0x100, 0x9);
    memory_set(0x101, 0x0);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("ora n flag unset", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0x9);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("bit zeropage", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x24);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x7f);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("bit absolute", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x2c);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0x7f);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("bit n flag set", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x24);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("bit n flag unset", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x24);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x7f);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("bit v flag set", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x24);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_flag("V"), true);
  });

  it("bit v flag unset", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x24);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x3f);

    execute();

    assert.strictEqual(cpu_flag("V"), false);
  });

  it("bit z flag set", function () {
    cpu_set_register("A", 0x0);
    cpu_pc(0x100);
    memory_set(0x100, 0x24);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("bit z flag unset", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x24);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x3f);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("adc immediate", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_register("A"), 0x3);
  });

  it.skip("adc immediate with bcd", function () {
    cpu_set_flag("D");
    cpu_set_register("A", 0x29);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0x11);

    execute();

    assert.strictEqual(cpu_register("A"), 0x40);
    cpu_set_flag("D");
    cpu_set_register("A", 0x29 | Status.N);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0x29);

    execute();

    assert.strictEqual(cpu_register("A"), 0x38);
    cpu_set_flag("D");
    cpu_set_flag("C");
    cpu_set_register("A", 0x58);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0x46);

    execute();

    assert.strictEqual(cpu_register("A"), 0x5);
  });

  it("adc zeropage", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x65);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x2);

    execute();

    assert.strictEqual(cpu_register("A"), 0x3);
  });

  it("adc zeropage x", function () {
    cpu_set_register("A", 0x1);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x75);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x2);

    execute();

    assert.strictEqual(cpu_register("A"), 0x3);
  });

  it("adc absolute", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x6d);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0x2);

    execute();

    assert.strictEqual(cpu_register("A"), 0x3);
  });

  it("adc absolute x", function () {
    cpu_set_register("A", 0x1);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x7d);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0x2);

    execute();

    assert.strictEqual(cpu_register("A"), 0x3);
  });

  it("adc absolute y", function () {
    cpu_set_register("A", 0x1);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x79);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0x2);

    execute();

    assert.strictEqual(cpu_register("A"), 0x3);
  });

  it("adc indirect x", function () {
    cpu_set_register("A", 0x1);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x61);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x87);
    memory_set(0x86, 0x0);
    memory_set(0x87, 0x2);

    execute();

    assert.strictEqual(cpu_register("A"), 0x3);
  });

  it("adc indirect y", function () {
    cpu_set_register("A", 0x1);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x71);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x86);
    memory_set(0x85, 0x0);
    memory_set(0x87, 0x2);

    execute();

    assert.strictEqual(cpu_register("A"), 0x3);
  });

  it("adc c flag set", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("C"), true);
    cpu_set_flag("C");
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0x0);

    execute();

    assert.strictEqual(cpu_flag("C"), true);
  });

  it("adc c flag unset", function () {
    cpu_set_register("A", 0x0);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("C"), false);
    cpu_unset_flag("C");
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0x0);

    execute();

    assert.strictEqual(cpu_flag("C"), false);
  });

  it("adc z flag set", function () {
    cpu_set_register("A", 0x0);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0x0);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
    cpu_set_flag("C");
    cpu_set_register("A", 0xfe);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("adc z flag unset", function () {
    cpu_set_register("A", 0x0);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
    cpu_set_register("A", 0xfe);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("adc v flag set", function () {
    cpu_set_register("A", 0x7f);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("V"), true);
  });

  it("adc v flag unset", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("V"), false);
  });

  it("adc n flag set", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0xfe);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("adc n flag unset", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x69);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("sbc immediate", function () {
    cpu_set_flag("C");
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xe9);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_register("A"), 0x1);
  });

  it("sbc immediate with bcd", function () {
    cpu_set_flag("D");
    cpu_set_register("A", 0x29);
    cpu_pc(0x100);
    memory_set(0x100, 0xe9);
    memory_set(0x101, 0x11);

    execute();
  });

  it("sbc zeroPage", function () {
    cpu_set_flag("C");
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xe5);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x1);

    execute();

    assert.strictEqual(cpu_register("A"), 0x1);
  });

  it("sbc zeropage x", function () {
    cpu_set_flag("C");
    cpu_set_register("A", 0x2);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xf5);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x1);

    execute();

    assert.strictEqual(cpu_register("A"), 0x1);
  });

  it("sbc absolute", function () {
    cpu_set_flag("C");
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xed);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0x1);

    execute();

    assert.strictEqual(cpu_register("A"), 0x1);
  });

  it("sbc absolute x", function () {
    cpu_set_flag("C");
    cpu_set_register("A", 0x2);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xfd);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0x1);

    execute();

    assert.strictEqual(cpu_register("A"), 0x1);
  });

  it("sbc absolute y", function () {
    cpu_set_flag("C");
    cpu_set_register("A", 0x2);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xf9);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0x1);

    execute();

    assert.strictEqual(cpu_register("A"), 0x1);
  });

  it("sbc indirect x", function () {
    cpu_set_flag("C");
    cpu_set_register("A", 0x2);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xe1);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x87);
    memory_set(0x86, 0x0);
    memory_set(0x87, 0x1);

    execute();

    assert.strictEqual(cpu_register("A"), 0x1);
  });

  it("sbc indirect y", function () {
    cpu_set_flag("C");
    cpu_set_register("A", 0x2);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xf1);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x86);
    memory_set(0x85, 0x0);
    memory_set(0x87, 0x1);

    execute();

    assert.strictEqual(cpu_register("A"), 0x1);
  });

  it("sbc c flag set", function () {
    cpu_set_register("A", 0xc4);
    cpu_pc(0x100);
    memory_set(0x100, 0xe9);
    memory_set(0x101, 0x3c);

    execute();

    assert.strictEqual(cpu_flag("C"), true);
  });

  it("sbc c flag unset", function () {
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xe9);
    memory_set(0x101, 0x4);

    execute();

    assert.strictEqual(cpu_flag("C"), false);
  });

  it("sbc z flag set", function () {
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xe9);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("sbc z flag unset", function () {
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xe9);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("sbc v flag set", function () {
    cpu_set_register("A", 0x80);
    cpu_pc(0x100);
    memory_set(0x100, 0xe9);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("V"), true);
  });

  it("sbc v flag unset", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xe9);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("V"), false);
  });

  it("sbc n flag set", function () {
    cpu_set_register("A", 0xfd);
    cpu_pc(0x100);
    memory_set(0x100, 0xe9);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("sbc n flag unset", function () {
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xe9);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("cmp immediate", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xc9);
    memory_set(0x101, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cmp zeropage", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xc5);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cmp zeropage x", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xd5);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cmp absolute", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xcd);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cmp absolute x", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xdd);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cmp absolute y", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xd9);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cmp indirect x", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xc1);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x87);
    memory_set(0x86, 0x0);
    memory_set(0x87, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cmp indirect y", function () {
    cpu_set_register("A", 0xff);
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xd1);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x86);
    memory_set(0x85, 0x0);
    memory_set(0x87, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cmp n flag set", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xc9);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("cmp n flag unset", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xc9);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("cmp z flag set", function () {
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xc9);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
    cpu_set_register("A", 0xfe);
    cpu_pc(0x100);
    memory_set(0x100, 0xc9);
    memory_set(0x101, 0xfe);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cmp z flag unset", function () {
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xc9);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
    cpu_set_register("A", 0xfe);
    cpu_pc(0x100);
    memory_set(0x100, 0xc9);
    memory_set(0x101, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("cmp c flag set", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xc9);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("C"), true);
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xc9);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("C"), true);
    cpu_set_register("A", 0xfe);
    cpu_pc(0x100);
    memory_set(0x100, 0xc9);
    memory_set(0x101, 0xfd);

    execute();

    assert.strictEqual(cpu_flag("C"), true);
  });

  it("cmp c flag unset", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xc9);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_flag("C"), false);
    cpu_set_register("A", 0xfd);
    cpu_pc(0x100);
    memory_set(0x100, 0xc9);
    memory_set(0x101, 0xfe);

    execute();

    assert.strictEqual(cpu_flag("C"), false);
  });

  it("cpx immediate", function () {
    cpu_set_register("X", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xe0);
    memory_set(0x101, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cpx zeropage", function () {
    cpu_set_register("X", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xe4);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cpx absolute", function () {
    cpu_set_register("X", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xec);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cpx n flag set", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xe0);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("cpx n flag unset", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xe0);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("cpx z flag set", function () {
    cpu_set_register("X", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xe0);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cpx z flag unset", function () {
    cpu_set_register("X", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xe0);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("cpx c flag set", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xe0);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("C"), true);
  });

  it("cpx C flag unset", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xe0);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_flag("C"), false);
  });

  it("cpy immediate", function () {
    cpu_set_register("Y", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xc0);
    memory_set(0x101, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cpy zeroPage", function () {
    cpu_set_register("Y", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xc4);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cpy absolute", function () {
    cpu_set_register("Y", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xcc);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cpy n flag set", function () {
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xc0);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("cpy n flag unset", function () {
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xc0);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("cpy z flag set", function () {
    cpu_set_register("Y", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xc0);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("cpy z flag unset", function () {
    cpu_set_register("Y", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xc0);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("cpy c flag set", function () {
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xc0);
    memory_set(0x101, 0x1);

    execute();

    assert.strictEqual(cpu_flag("C"), true);
  });

  it("cpy c flag unset", function () {
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xc0);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_flag("C"), false);
  });

  it("inc zeroPage", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xe6);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xfe);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0xff);
  });

  it("inc zeropage x", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xf6);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0xfe);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0xff);
  });

  it("inc absolute", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xee);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0xfe);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0xff);
  });

  it("inc absolute x", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xfe);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0xfe);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0xff);
  });

  it("inc z flag set", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xe6);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xff);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("inc z flag unset", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xe6);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x0);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("inc n flag set", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xe6);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0xfe);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("inc n flag unset", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xe6);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x0);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("inx", function () {
    cpu_set_register("X", 0xfe);
    cpu_pc(0x100);
    memory_set(0x100, 0xe8);

    execute();

    assert.strictEqual(cpu_register("X"), 0xff);
  });

  it("inx z flag set", function () {
    cpu_set_register("X", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xe8);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("inx z flag unset", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xe8);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("inx n flag set", function () {
    cpu_set_register("X", 0xfe);
    cpu_pc(0x100);
    memory_set(0x100, 0xe8);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("inx n flag unset", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xe8);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("iny", function () {
    cpu_set_register("Y", 0xfe);
    cpu_pc(0x100);
    memory_set(0x100, 0xc8);

    execute();

    assert.strictEqual(cpu_register("Y"), 0xff);
  });

  it("iny z flag set", function () {
    cpu_set_register("Y", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xc8);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("iny z flag unset", function () {
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xc8);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("iny n flag set", function () {
    cpu_set_register("Y", 0xfe);
    cpu_pc(0x100);
    memory_set(0x100, 0xc8);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("iny n flag unset", function () {
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xc8);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("dec zeroPage", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xc6);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0x1);
  });

  it("dec zeropage x", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xd6);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0x1);
  });

  it("dec absolute", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xce);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0x1);
  });

  it("dec absolute x", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xde);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0x1);
  });

  it("dec z flag set", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xc6);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x1);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("dec z flag unset", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xc6);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x2);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("dec n flag set", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xc6);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x0);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("dec n flag unset", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xc6);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x1);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("dex", function () {
    cpu_set_register("X", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xca);

    execute();

    assert.strictEqual(cpu_register("X"), 0x1);
  });

  it("dex z flag set", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xca);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("dex z flag unset", function () {
    cpu_set_register("X", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xca);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("dex n flag set", function () {
    cpu_set_register("X", 0x0);
    cpu_pc(0x100);
    memory_set(0x100, 0xca);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("dex n flag unset", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xca);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("dey", function () {
    cpu_set_register("Y", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0x88);

    execute();

    assert.strictEqual(cpu_register("Y"), 0x1);
  });

  it("dey z flag set", function () {
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x88);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("dey z flag unset", function () {
    cpu_set_register("Y", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0x88);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("dey n flag set", function () {
    cpu_set_register("Y", 0x0);
    cpu_pc(0x100);
    memory_set(0x100, 0x88);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("dey n flag unset", function () {
    cpu_set_register("Y", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x88);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("asl accumulator", function () {
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xa);

    execute();

    assert.strictEqual(cpu_register("A"), 0x4);
  });

  it("asl zeroPage", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0x6);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0x4);
  });

  it("asl zeropage x", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x16);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0x4);
  });

  it("asl absolute", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0xe);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0x4);
  });

  it("asl absoluteX", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x1e);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0x4);
  });

  it("asl c flag set", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0xa);

    execute();

    assert.strictEqual(cpu_flag("C"), true);
  });

  it("asl c flag unset", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xa);

    execute();

    assert.strictEqual(cpu_flag("C"), false);
  });

  it("asl z flag set", function () {
    cpu_set_register("A", 0x0);
    cpu_pc(0x100);
    memory_set(0x100, 0xa);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("asl z flag unset", function () {
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0xa);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("asl n flag set", function () {
    cpu_set_register("A", 0xfe);
    cpu_pc(0x100);
    memory_set(0x100, 0xa);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("asl n flag unset", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0xa);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("lsr accumulator", function () {
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0x4a);

    execute();

    assert.strictEqual(cpu_register("A"), 0x1);
  });

  it("lsr zeroPage", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0x46);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0x1);
  });

  it("lsr zeropage x", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x56);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0x1);
  });

  it("lsr absolute", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0x4e);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0x1);
  });

  it("lsr absolute x", function () {
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x5e);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0x1);
  });

  it("lsr c flag set", function () {
    cpu_set_register("A", 0xff);
    cpu_pc(0x100);
    memory_set(0x100, 0x4a);

    execute();

    assert.strictEqual(cpu_flag("C"), true);
  });

  it("lsr c flag unset", function () {
    cpu_set_register("A", 0x10);
    cpu_pc(0x100);
    memory_set(0x100, 0x4a);

    execute();

    assert.strictEqual(cpu_flag("C"), false);
  });

  it("lsr z flag set", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x4a);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("lsr z flag unset", function () {
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0x4a);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("lsr n flag unset", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x4a);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("rol accumulator", function () {
    cpu_set_flag("C");
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0x2a);

    execute();

    assert.strictEqual(cpu_register("A"), 0x5);
  });

  it("rol zeropage", function () {
    cpu_set_flag("C");
    cpu_pc(0x100);
    memory_set(0x100, 0x26);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0x5);
  });

  it("rol zeropage x", function () {
    cpu_set_flag("C");
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x36);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0x5);
  });

  it("rol absolute", function () {
    cpu_set_flag("C");
    cpu_pc(0x100);
    memory_set(0x100, 0x2e);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0x5);
  });

  it("rol absolute x", function () {
    cpu_set_flag("C");
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x3e);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0x2);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0x5);
  });

  it("rol c flag set", function () {
    cpu_set_register("A", 0x80);
    cpu_pc(0x100);
    memory_set(0x100, 0x2a);

    execute();

    assert.strictEqual(cpu_flag("C"), true);
  });

  it("rol c flag unset", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x2a);

    execute();

    assert.strictEqual(cpu_flag("C"), false);
  });

  it("rol z flag set", function () {
    cpu_set_register("A", 0x0);
    cpu_pc(0x100);
    memory_set(0x100, 0x2a);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("rol z flag unset", function () {
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0x2a);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("rol n flag set", function () {
    cpu_set_register("A", 0xfe);
    cpu_pc(0x100);
    memory_set(0x100, 0x2a);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("rol n flag unset", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x2a);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("ror accumulator", function () {
    cpu_set_flag("C");
    cpu_set_register("A", 0x8);
    cpu_pc(0x100);
    memory_set(0x100, 0x6a);

    execute();

    assert.strictEqual(cpu_register("A"), 0x84);
  });

  it("ror zeropage", function () {
    cpu_set_flag("C");
    cpu_pc(0x100);
    memory_set(0x100, 0x66);
    memory_set(0x101, 0x84);
    memory_set(0x84, 0x8);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0x84);
  });

  it("ror zeropage x", function () {
    cpu_set_flag("C");
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x76);
    memory_set(0x101, 0x84);
    memory_set(0x85, 0x8);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0x84);
  });

  it("ror absolute", function () {
    cpu_set_flag("C");
    cpu_pc(0x100);
    memory_set(0x100, 0x6e);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0x8);

    execute();

    assert.strictEqual(memory_fetch(0x84), 0x84);
  });

  it("ror absolute x", function () {
    cpu_set_flag("C");
    cpu_set_register("X", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x7e);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x85, 0x8);

    execute();

    assert.strictEqual(memory_fetch(0x85), 0x84);
  });

  it("ror c flag set", function () {
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x6a);

    execute();

    assert.strictEqual(cpu_flag("C"), true);
  });

  it("ror c flag unset", function () {
    cpu_set_register("A", 0x10);
    cpu_pc(0x100);
    memory_set(0x100, 0x6a);

    execute();

    assert.strictEqual(cpu_flag("C"), false);
  });

  it("ror z flag set", function () {
    cpu_set_register("A", 0x0);
    cpu_pc(0x100);
    memory_set(0x100, 0x6a);

    execute();

    assert.strictEqual(cpu_flag("Z"), true);
  });

  it("ror z flag unset", function () {
    cpu_set_register("A", 0x2);
    cpu_pc(0x100);
    memory_set(0x100, 0x6a);

    execute();

    assert.strictEqual(cpu_flag("Z"), false);
  });

  it("ror n flag set", function () {
    cpu_set_flag("C");
    cpu_set_register("A", 0xfe);
    cpu_pc(0x100);
    memory_set(0x100, 0x6a);

    execute();

    assert.strictEqual(cpu_flag("N"), true);
  });

  it("ror n flag unset", function () {
    cpu_unset_flag("C");
    cpu_set_register("A", 0x1);
    cpu_pc(0x100);
    memory_set(0x100, 0x6a);

    execute();

    assert.strictEqual(cpu_flag("N"), false);
  });

  it("jmp absolute", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0x4c);
    memory_set(0x101, 0xff);
    memory_set(0x102, 0x1);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x1ff);
  });

  it("jmp indirect", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0x6c);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x1);
    memory_set(0x184, 0xff);
    memory_set(0x185, 0xff);

    execute();

    assert.strictEqual(cpu_register("PC"), 0xffff);
  });

  it("jsr", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0x20);
    memory_set(0x101, 0xff);
    memory_set(0x102, 0x1);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x1ff);
    assert.strictEqual(memory_fetch(0x1fd), 0x1);
    assert.strictEqual(memory_fetch(0x1fc), 0x2);
  });

  it("jsr stack pointer", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0x20);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x84, 0x60);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x84);
    assert.strictEqual(cpu_register("SP"), 0xfb);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x103);
    assert.strictEqual(cpu_register("SP"), 0xfd);
  });

  it.skip("jsr with illegal opcode", function () {
    cpu_pc(0x100);
    memory_set(0x100, 0x20);
    memory_set(0x101, 0x84);
    memory_set(0x102, 0x0);
    memory_set(0x103, 0xa9);
    memory_set(0x104, 0xff);
    memory_set(0x105, 0x2);
    memory_set(0x84, 0x60);

    execute();

    execute();

    execute();

    execute();

    assert.strictEqual(cpu_register("A"), 0xff);
  });

  it("rts", function () {
    cpu_pc(0x100);
    cpu_push_word(0x102);
    memory_set(0x100, 0x60);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x103);
  });

  it("bcc", function () {
    skip_cycles();
    cpu_set_flag("C");
    cpu_pc(0x100);
    memory_set(0x100, 0x90);
    let cycles = execute();
    if (check_cycles()) {
      assert.strictEqual(cycles, 0x2);
    }
    assert.strictEqual(cpu_register("PC"), 0x102);
    cpu_unset_flag("C");
    cpu_pc(0x100);
    memory_set(0x100, 0x90);
    memory_set(0x101, 0x2);
    cycles = execute();
    if (check_cycles()) {
      assert.strictEqual(cycles, 0x3);
    }
    assert.strictEqual(cpu_register("PC"), 0x104);
    cpu_unset_flag("C");
    cpu_pc(0x100);
    memory_set(0x100, 0x90);
    memory_set(0x101, 0xfd);
    cycles = execute();
    if (check_cycles()) {
      assert.strictEqual(cycles, 0x4);
    }
    assert.strictEqual(cpu_register("PC"), 0xff);
  });

  it("bcs", function () {
    cpu_set_flag("C");
    cpu_pc(0x100);
    memory_set(0x100, 0xb0);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x104);
    cpu_set_flag("C");
    cpu_pc(0x100);
    memory_set(0x100, 0xb0);
    memory_set(0x101, 0xfe);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x100);
  });

  it("beq", function () {
    cpu_set_flag("Z");
    cpu_pc(0x100);
    memory_set(0x100, 0xf0);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x104);
    cpu_set_flag("Z");
    cpu_pc(0x100);
    memory_set(0x100, 0xf0);
    memory_set(0x101, 0xfe);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x100);
  });

  it("bmi", function () {
    // Not taken: 2 cycles
    cpu_unset_flag("N");
    cpu_pc(0x150);
    memory_set(0x150, 0x30);
    memory_set(0x151, 0x02);
    let cycles = execute();
    assert.strictEqual(cycles, 2);
    assert.strictEqual(cpu_register("PC"), 0x152);

    // Taken, no page crossing: 3 cycles
    // (use address mid-page so opaddr stays on the same page as target)
    cpu_set_flag("N");
    cpu_pc(0x150);
    memory_set(0x150, 0x30);
    memory_set(0x151, 0x02);
    cycles = execute();
    assert.strictEqual(cycles, 3);
    assert.strictEqual(cpu_register("PC"), 0x154);

    // Taken, page crossing: 4 cycles
    // (branch forward from 0x1F0 across the 0x200 page boundary)
    cpu_set_flag("N");
    cpu_pc(0x1f0);
    memory_set(0x1f0, 0x30);
    memory_set(0x1f1, 0x20);
    cycles = execute();
    assert.strictEqual(cycles, 4);
    assert.strictEqual(cpu_register("PC"), 0x212);
  });

  it("bne", function () {
    cpu_unset_flag("Z");
    cpu_pc(0x100);
    memory_set(0x100, 0xd0);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x104);
    cpu_unset_flag("Z");
    cpu_pc(0x100);
    memory_set(0x100, 0xd0);
    memory_set(0x101, 0xfe);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x100);
  });

  it("bpl", function () {
    cpu_unset_flag("N");
    cpu_pc(0x100);
    memory_set(0x100, 0x10);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x104);
    cpu_unset_flag("N");
    cpu_pc(0x100);
    memory_set(0x100, 0x10);
    memory_set(0x101, 0xfe);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x100);
  });

  it("bvc", function () {
    cpu_unset_flag("V");
    cpu_pc(0x100);
    memory_set(0x100, 0x50);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x104);
    cpu_unset_flag("V");
    cpu_pc(0x100);
    memory_set(0x100, 0x50);
    memory_set(0x101, 0xfe);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x100);
  });

  it("bvs", function () {
    cpu_set_flag("V");
    cpu_pc(0x100);
    memory_set(0x100, 0x70);
    memory_set(0x101, 0x2);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x104);
    cpu_set_flag("V");
    cpu_pc(0x100);
    memory_set(0x100, 0x70);
    memory_set(0x101, 0xfe);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x100);
  });

  it("clc", function () {
    cpu_unset_flag("C");
    cpu_pc(0x100);
    memory_set(0x100, 0x18);

    execute();

    assert.strictEqual(cpu_flag("C"), false);
    cpu_set_flag("C");
    cpu_pc(0x100);
    memory_set(0x100, 0x18);

    execute();

    assert.strictEqual(cpu_flag("C"), false);
  });

  it("cld", function () {
    cpu_unset_flag("D");
    cpu_pc(0x100);
    memory_set(0x100, 0xd8);

    execute();

    assert.strictEqual(cpu_flag("D"), false);
    cpu_set_flag("D");
    cpu_pc(0x100);
    memory_set(0x100, 0xd8);

    execute();

    assert.strictEqual(cpu_flag("D"), false);
  });

  it("cli", function () {
    cpu_unset_flag("I");
    cpu_pc(0x100);
    memory_set(0x100, 0x58);

    execute();

    assert.strictEqual(cpu_flag("I"), false);
    cpu_set_flag("I");
    cpu_pc(0x100);
    memory_set(0x100, 0x58);

    execute();

    assert.strictEqual(cpu_flag("I"), false);
  });

  it("clv", function () {
    cpu_unset_flag("V");
    cpu_pc(0x100);
    memory_set(0x100, 0xb8);

    execute();

    assert.strictEqual(cpu_flag("V"), false);
    cpu_set_flag("V");
    cpu_pc(0x100);
    memory_set(0x100, 0xb8);

    execute();

    assert.strictEqual(cpu_flag("V"), false);
  });

  it("sec", function () {
    cpu_unset_flag("C");
    cpu_pc(0x100);
    memory_set(0x100, 0x38);

    execute();

    assert.strictEqual(cpu_flag("C"), true);
    cpu_set_flag("C");
    cpu_pc(0x100);
    memory_set(0x100, 0x38);

    execute();

    assert.strictEqual(cpu_flag("C"), true);
  });

  it("sed", function () {
    cpu_unset_flag("D");
    cpu_pc(0x100);
    memory_set(0x100, 0xf8);

    execute();

    assert.strictEqual(cpu_flag("D"), true);
    cpu_set_flag("D");
    cpu_pc(0x100);
    memory_set(0x100, 0xf8);

    execute();

    assert.strictEqual(cpu_flag("D"), true);
  });

  it("sei", function () {
    cpu_unset_flag("I");
    cpu_pc(0x100);
    memory_set(0x100, 0x78);

    execute();

    assert.strictEqual(cpu_flag("I"), true);
    cpu_set_flag("I");
    cpu_pc(0x100);
    memory_set(0x100, 0x78);

    execute();

    assert.strictEqual(cpu_flag("I"), true);
  });

  it("brk", function () {
    cpu_set_register("P", 0xff - Status.B);
    cpu_pc(0x100);
    memory_set(0x100, 0x0);
    memory_set(0xfffe, 0xff);
    memory_set(0xffff, 0x1);

    execute();

    assert.strictEqual(cpu_pull_byte(), 0xff);
    assert.strictEqual(cpu_pull_word(), 0x102);
    assert.strictEqual(cpu_register("PC"), 0x1ff);
  });

  it("rti", function () {
    cpu_pc(0x100);
    cpu_push_word(0x102);
    cpu_push_byte(0x3);
    memory_set(0x100, 0x40);

    execute();

    assert.strictEqual(cpu_register("PC"), 0x102);
  });

  it("irq interrupt", function () {
    cpu_set_register("P", 0xfb);
    cpu_pc(0x100);
    cpu_force_interrupt("irq");
    memory_set(0xfffe, 0x40);
    memory_set(0xffff, 0x1);

    execute_interrupt();

    assert.strictEqual(cpu_pull_byte(), 0xeb);
    assert.strictEqual(cpu_pull_word(), 0x100);
    assert.strictEqual(cpu_register("PC"), 0x140);
    assert.strictEqual(cpu_get_interrupt("irq"), false);
  });

  it("nmi interrupt", function () {
    cpu_set_register("P", 0xff);
    cpu_pc(0x100);
    cpu_force_interrupt("nmi");
    memory_set(0xfffa, 0x40);
    memory_set(0xfffb, 0x1);

    execute_interrupt();

    assert.strictEqual(cpu_pull_byte(), 0xef);
    assert.strictEqual(cpu_pull_word(), 0x100);
    assert.strictEqual(cpu_register("PC"), 0x140);
    assert.strictEqual(cpu_get_interrupt("nmi"), false);
  });

  it("rst interrupt", function () {
    cpu_pc(0x100);
    cpu_force_interrupt("rst");
    memory_set(0xfffc, 0x40);
    memory_set(0xfffd, 0x1);

    execute_interrupt();

    assert.strictEqual(cpu_register("PC"), 0x140);
    assert.strictEqual(cpu_get_interrupt("rst"), false);
  });
});

var assert = require("chai").assert;
var CPU = require("../src/cpu");

// Based on https://github.com/gutomaia/wedNESday/blob/0.0.x/wednesday/cpu_6502_spec.py
// ... which was based on https://github.com/nwidger/nintengo/blob/master/m65go2/instructions_test.go

Status = {
    C: 0b00000001, // Carry
    Z: 0b00000010, // Zero
    I: 0b00000100, // Interrupt Disable
    D: 0b00001000, // Decimal
    B: 0b00010000, // B Flag
    U: 0b00100000, // Unused always pushed as 1
    V: 0b01000000, // Overflow
    N: 0b10000000, // Negative
}

REGISTER_MAP = {
    'PC': 'REG_PC',
    'SP': 'REG_SP',
    'A': 'REG_ACC',
    'X': 'REG_X',
    'Y': 'REG_Y',
}

FLAG_MAP = {
    'C': 'F_CARRY',
    'Z': 'F_ZERO',
    'I': 'F_INTERRUPT',
    'D': 'F_DECIMAL',
    'V': 'F_OVERFLOW',
    'N': 'F_SIGN',
}

var MMAP = function (mem) {
    this.mem = mem;
};

MMAP.prototype.load = function (addr) {
    return this.mem[addr];
};

MMAP.prototype.write = function (addr, val) {
    this.mem[addr] = val;
};

var NES = function (mmap) {
    this.mmap = mmap;
};

NES.prototype.stop = function () {
};

describe("CPU", function () {
    var cpu = null;
    var mmap = null;
    var nes = null;
    var mem = null;
    var perform_check_cycles = true;

    beforeEach(function (done) {
        mem = Array.apply(
            null, Array(0x10000)
        ).map(Number.prototype.valueOf, 0);

        mmap = new MMAP(mem);
        nes = new NES(mmap);
        cpu = new CPU(nes);
        cpu.reset();
        cpu.mem = mem;
        perform_check_cycles = true;
        cpu.REG_SP = 0xfd;
        done();
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
    };

    function memory_set(pos, val) {
        if (pos < 0x2000) {
            mem[pos & 0x7ff] = val;
        } else {
            nes.mmap.write(pos, val);
        }
    }

    function memory_fetch(pos) {
        if (pos < 0x2000) {
            return cpu.mem[pos]
        } else {
            return nes.mmap.read();
        }
    }

    function execute() {
        var cycles = cpu.emulate();
        return cycles
    }

    function cpu_set_register(register, value) {
        if (register == 'P') {
            cpu.setStatus(value);
        } else {
            var reg = REGISTER_MAP[register];
            cpu[reg] = value;
        }
    }

    function cpu_register(register) {
        var val = null
        if (register == 'P') {
            // Mask bits 4-5: B and unused don't exist as physical flags
            return cpu.getStatus() & 0xcf;
        }
        var reg = REGISTER_MAP[register];
        var val = cpu[reg];
        if (register == 'PC') {
            return val + 1;
        }
        return val
    }

    function cpu_flag(flag){
        var fg = FLAG_MAP[flag]
        var val = Boolean(cpu[fg])
        if (flag == 'Z') {
            return !val;
        }
        return val
    }

    function cpu_set_flag(flag){
        var fg = FLAG_MAP[flag];
        if (flag == 'Z') {
            cpu[fg] = 0;
        } else {
            cpu[fg] = 1;
        }
    }

    function cpu_unset_flag(flag){
        var fg = FLAG_MAP[flag];
        if (flag == 'Z') {
            cpu[fg] = 1;
        } else {
            cpu[fg] = 0;
        }
    }

    function cpu_push_byte(byte){
        cpu.push(byte);
    }

    function cpu_pull_byte(){
        return cpu.pull();
    }

    function cpu_push_word(word){
        hi = (0xFF00 & word) >> 8;
        lo = 0x00FF & word;
        cpu_push_byte(hi);
        cpu_push_byte(lo);
    }

    function cpu_pull_word() {
        var b1 = cpu_pull_byte();
        var b2 = cpu_pull_byte() << 8;
        return b1 + b2;
    }

    function cpu_force_interrupt(type) {
        var typeMap = {
            'irq': cpu.IRQ_NORMAL,
            'nmi': cpu.IRQ_NMI,
            'rst': cpu.IRQ_RESET,
        };
        cpu.requestIrq(typeMap[type]);
    }

    function cpu_get_interrupt(type) {
        return cpu.irqRequested;
    }

    function execute_interrupt() {
        // Replicate interrupt handling from cpu.emulate() without
        // executing the instruction at the target address
        var temp =
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

    it("lda imediate", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa9);
        memory_set(0x101, 0xff);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("lda zeropage", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa5);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xff);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("lda zero page x", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xb5);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0xff);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("lda absolute", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xad);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0xff);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("lda absolute x", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xbd);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0xff);
        var cycles = execute();
        if (check_cycles()) {
            assert.equal(cycles, 0x4);
        };
        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("lda absolute x 2", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xbd);
        memory_set(0x101, 0xff);
        memory_set(0x102, 0x2);
        memory_set(0x300, 0xff);
        var cycles = execute();
        if (check_cycles()) {
            assert.equal(cycles, 0x5);
        };
        done();
    });
    
    it("lda absolute y", function(done) {
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xb9);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0xff);
        var cycles = execute();
        if (check_cycles()) {
            assert.equal(cycles, 0x4);
        };
        assert.equal(cpu_register("A"), 0xff);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xb9);
        memory_set(0x101, 0xff);
        memory_set(0x102, 0x2);
        memory_set(0x300, 0xff);
        var cycles = execute();
        if (check_cycles()) {
            assert.equal(cycles, 0x5);
        };
        done();
    });
    
    it("lda indirect x", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xa1);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0x87);
        memory_set(0x86, 0x0);
        memory_set(0x87, 0xff);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("lda indirect y", function(done) {
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xb1);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x86);
        memory_set(0x85, 0x0);
        memory_set(0x87, 0xff);
        var cycles = execute();
        if (check_cycles()) {
            assert.equal(cycles, 0x5);
        };
        assert.equal(cpu_register("A"), 0xff);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xb1);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xff);
        memory_set(0x85, 0x2);
        memory_set(0x300, 0xff);
        var cycles = execute();
        if (check_cycles()) {
            assert.equal(cycles, 0x6);
        };
        done();
    });
    
    it("lda z flag set", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa9);
        memory_set(0x101, 0x0);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("lda z flag unset", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa9);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("lda n flag set", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa9);
        memory_set(0x101, 0x81);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("lda n flag unset", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa9);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("ldx immediate", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa2);
        memory_set(0x101, 0xff);

        execute();

        assert.equal(cpu_register("X"), 0xff);
        done();
    });
    
    it("ldx zero page", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa6);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xff);

        execute();

        assert.equal(cpu_register("X"), 0xff);
        done();
    });
    
    it("ldx zeropage y", function(done) {
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xb6);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0xff);

        execute();

        assert.equal(cpu_register("X"), 0xff);
        done();
    });
    
    it("ldx absolute", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xae);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0xff);

        execute();

        assert.equal(cpu_register("X"), 0xff);
        done();
    });
    
    it("ldx absolute y", function(done) {
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xbe);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0xff);

        execute();

        assert.equal(cpu_register("X"), 0xff);
        done();
    });
    
    it("ldx z flag set", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa2);
        memory_set(0x101, 0x0);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("ldx z flag unset", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa2);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("ldx n flag set", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa2);
        memory_set(0x101, 0x81);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("ldx n flag unset", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa2);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("ldy immediate", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa0);
        memory_set(0x101, 0xff);

        execute();

        assert.equal(cpu_register("Y"), 0xff);
        done();
    });
    
    it("ldy zeropage", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa4);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xff);

        execute();

        assert.equal(cpu_register("Y"), 0xff);
        done();
    });
    
    it("ldy zeropage x", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xb4);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0xff);

        execute();

        assert.equal(cpu_register("Y"), 0xff);
        done();
    });
    
    it("ldy absolute", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xac);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0xff);

        execute();

        assert.equal(cpu_register("Y"), 0xff);
        done();
    });
    
    it("ldy absolute x", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xbc);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0xff);

        execute();

        assert.equal(cpu_register("Y"), 0xff);
        done();
    });
    
    it("ldy z flag set", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa0);
        memory_set(0x101, 0x0);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("ldy z flag unset", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa0);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("ldy n flag set", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa0);
        memory_set(0x101, 0x81);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("ldy n flag unset", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xa0);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("sta zeropage", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x85);
        memory_set(0x101, 0x84);

        execute();

        assert.equal(memory_fetch(0x84), 0xff);
        done();
    });
    
    it("sta zeropage x", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x95);
        memory_set(0x101, 0x84);

        execute();

        assert.equal(memory_fetch(0x85), 0xff);
        done();
    });
    
    it("sta absolute", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x8d);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);

        execute();

        assert.equal(memory_fetch(0x84), 0xff);
        done();
    });
    
    it("sta absolute x", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x9d);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);

        execute();

        assert.equal(memory_fetch(0x85), 0xff);
        done();
    });
    
    it("sta absolute y", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x99);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);

        execute();

        assert.equal(memory_fetch(0x85), 0xff);
        done();
    });
    
    it("sta indirect x", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x81);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0x87);
        memory_set(0x86, 0x0);

        execute();

        assert.equal(memory_fetch(0x87), 0xff);
        done();
    });
    
    it("sta indirect y", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x91);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x86);
        memory_set(0x85, 0x0);

        execute();

        assert.equal(memory_fetch(0x87), 0xff);
        done();
    });
    
    it("stx zeropage", function(done) {
        cpu_set_register("X", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x86);
        memory_set(0x101, 0x84);

        execute();

        assert.equal(memory_fetch(0x84), 0xff);
        done();
    });
    
    it("stx zeropage y", function(done) {
        cpu_set_register("X", 0xff);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x96);
        memory_set(0x101, 0x84);

        execute();

        assert.equal(memory_fetch(0x85), 0xff);
        done();
    });
    
    it("stx absolute", function(done) {
        cpu_set_register("X", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x8e);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);

        execute();

        assert.equal(memory_fetch(0x84), 0xff);
        done();
    });
    
    it("sty zeropage", function(done) {
        cpu_set_register("Y", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x84);
        memory_set(0x101, 0x84);

        execute();

        assert.equal(memory_fetch(0x84), 0xff);
        done();
    });
    
    it("sty zeropage y", function(done) {
        cpu_set_register("Y", 0xff);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x94);
        memory_set(0x101, 0x84);

        execute();

        assert.equal(memory_fetch(0x85), 0xff);
        done();
    });
    
    it("sty absolute", function(done) {
        cpu_set_register("Y", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x8c);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);

        execute();

        assert.equal(memory_fetch(0x84), 0xff);
        done();
    });
    
    it("tax", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xaa);

        execute();

        assert.equal(cpu_register("X"), 0xff);
        done();
    });
    
    it("tax z flag set", function(done) {
        cpu_set_register("A", 0x0);
        cpu_pc(0x100);
        memory_set(0x100, 0xaa);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("tax z flag unset", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xaa);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("tax n flag set", function(done) {
        cpu_set_register("A", 0x81);
        cpu_pc(0x100);
        memory_set(0x100, 0xaa);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("tax n flag unset", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xaa);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("tay", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xa8);

        execute();

        assert.equal(cpu_register("Y"), 0xff);
        done();
    });
    
    it("txa", function(done) {
        cpu_set_register("X", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x8a);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("tya", function(done) {
        cpu_set_register("Y", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x98);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("tsx", function(done) {
        cpu_set_register("SP", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xba);

        execute();

        assert.equal(cpu_register("X"), 0xff);
        done();
    });
    
    it("txs", function(done) {
        cpu_set_register("X", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x9a);

        execute();

        assert.equal(cpu_register("SP"), 0xff);
        done();
    });
    
    it("pha", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x48);

        execute();

        assert.equal(cpu_pull_byte(), 0xff);
        done();
    });
    
    it("php", function(done) {
        cpu_set_register("P", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x8);

        execute();

        assert.equal(cpu_pull_byte(), 0xff);
        done();
    });
    
    it("pla", function(done) {
        cpu_pc(0x100);
        cpu_push_byte(0xff);
        memory_set(0x100, 0x68);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("pla z flag set", function(done) {
        cpu_push_byte(0x0);
        cpu_pc(0x100);
        memory_set(0x100, 0x68);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("pla z flag unset", function(done) {
        cpu_push_byte(0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x68);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("pla n flag set", function(done) {
        cpu_push_byte(0x81);
        cpu_pc(0x100);
        memory_set(0x100, 0x68);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("pla n flag unset", function(done) {
        cpu_push_byte(0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x68);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("plp", function(done) {
        cpu_push_byte(0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x28);

        execute();

        assert.equal(cpu_register("P"), 0xcf);
        done();
    });
    
    it("and immediate", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x29);
        memory_set(0x101, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf);
        done();
    });
    
    it("and zeropage", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x25);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf);
        done();
    });
    
    it("and zeropage x", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x35);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf);
        done();
    });
    
    it("and absolute", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x2d);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf);
        done();
    });
    
    it("and absolute x", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x3d);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf);
        done();
    });
    
    it("and absolute y", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x39);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf);
        done();
    });
    
    it("and indirect x", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x21);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0x87);
        memory_set(0x86, 0x0);
        memory_set(0x87, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf);
        done();
    });
    
    it("and indirect y", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x31);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x86);
        memory_set(0x85, 0x0);
        memory_set(0x87, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf);
        done();
    });
    
    it("and z flag set", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0x29);
        memory_set(0x101, 0x0);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("and z flag unset", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x29);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("and n flag set", function(done) {
        cpu_set_register("A", 0x81);
        cpu_pc(0x100);
        memory_set(0x100, 0x29);
        memory_set(0x101, 0x81);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("and n flag unset", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0x29);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("eor immediate", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x49);
        memory_set(0x101, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf0);
        done();
    });
    
    it("eor zeropage", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x45);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf0);
        done();
    });
    
    it("eor zeropage x", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x55);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf0);
        done();
    });
    
    it("eor absolute", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x4d);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf0);
        done();
    });
    
    it("eor absolute x", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x5d);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf0);
        done();
    });
    
    it("eor absolute y", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x59);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf0);
        done();
    });
    
    it("eor indirect x", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x41);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0x87);
        memory_set(0x86, 0x0);
        memory_set(0x87, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf0);
        done();
    });
    
    it("eor indirect y", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x51);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x86);
        memory_set(0x85, 0x0);
        memory_set(0x87, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xf0);
        done();
    });
    
    it("eor z flag set", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0x49);
        memory_set(0x101, 0x0);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("eor z flag unset", function(done) {
        cpu_set_register("A", 0x0);
        cpu_pc(0x100);
        memory_set(0x100, 0x49);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("eor n flag set", function(done) {
        cpu_set_register("A", 0x0);
        cpu_pc(0x100);
        memory_set(0x100, 0x49);
        memory_set(0x101, 0x81);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("eor n flag unset", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0x49);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("ora immediate", function(done) {
        cpu_set_register("A", 0xf0);
        cpu_pc(0x100);
        memory_set(0x100, 0x9);
        memory_set(0x101, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("ora zeropage", function(done) {
        cpu_set_register("A", 0xf0);
        cpu_pc(0x100);
        memory_set(0x100, 0x5);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("ora zeropage x", function(done) {
        cpu_set_register("A", 0xf0);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x15);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("ora absolute", function(done) {
        cpu_set_register("A", 0xf0);
        cpu_pc(0x100);
        memory_set(0x100, 0xd);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("ora absolute x", function(done) {
        cpu_set_register("A", 0xf0);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x1d);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("ora absolute y", function(done) {
        cpu_set_register("A", 0xf0);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x19);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("ora indirect x", function(done) {
        cpu_set_register("A", 0xf0);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x1);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0x87);
        memory_set(0x86, 0x0);
        memory_set(0x87, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("ora indirect y", function(done) {
        cpu_set_register("A", 0xf0);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x11);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x86);
        memory_set(0x85, 0x0);
        memory_set(0x87, 0xf);

        execute();

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("ora z flag set", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0x9);
        memory_set(0x101, 0x0);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("ora z flag unset", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x9);
        memory_set(0x101, 0x0);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("ora n flag set", function(done) {
        cpu_set_register("A", 0x81);
        cpu_pc(0x100);
        memory_set(0x100, 0x9);
        memory_set(0x101, 0x0);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("ora n flag unset", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0x9);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("bit zeropage", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x24);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x7f);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("bit absolute", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x2c);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0x7f);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("bit n flag set", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x24);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xff);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("bit n flag unset", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x24);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x7f);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("bit v flag set", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x24);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xff);

        execute();

        assert.isTrue(cpu_flag("V"));
        done();
    });
    
    it("bit v flag unset", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x24);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x3f);

        execute();

        assert.isFalse(cpu_flag("V"));
        done();
    });
    
    it("bit z flag set", function(done) {
        cpu_set_register("A", 0x0);
        cpu_pc(0x100);
        memory_set(0x100, 0x24);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("bit z flag unset", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x24);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x3f);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("adc immediate", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0x2);

        execute();

        assert.equal(cpu_register("A"), 0x3);
        done();
    });
    
    it("adc immediate with bcd", function(done) {
        this.skip("Not implemented on jsNES");
        cpu_set_flag("D");
        cpu_set_register("A", 0x29);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0x11);

        execute();

        assert.equal(cpu_register("A"), 0x40);
        cpu_set_flag("D");
        cpu_set_register("A", 0x29 | Status.N);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0x29);

        execute();

        assert.equal(cpu_register("A"), 0x38);
        cpu_set_flag("D");
        cpu_set_flag("C");
        cpu_set_register("A", 0x58);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0x46);

        execute();

        assert.equal(cpu_register("A"), 0x5);
        done();
    });
    
    it("adc zeropage", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x65);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x2);

        execute();

        assert.equal(cpu_register("A"), 0x3);
        done();
    });
    
    it("adc zeropage x", function(done) {
        cpu_set_register("A", 0x1);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x75);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0x2);

        execute();

        assert.equal(cpu_register("A"), 0x3);
        done();
    });
    
    it("adc absolute", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x6d);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0x2);

        execute();

        assert.equal(cpu_register("A"), 0x3);
        done();
    });
    
    it("adc absolute x", function(done) {
        cpu_set_register("A", 0x1);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x7d);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0x2);

        execute();

        assert.equal(cpu_register("A"), 0x3);
        done();
    });
    
    it("adc absolute y", function(done) {
        cpu_set_register("A", 0x1);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x79);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0x2);

        execute();

        assert.equal(cpu_register("A"), 0x3);
        done();
    });
    
    it("adc indirect x", function(done) {
        cpu_set_register("A", 0x1);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x61);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0x87);
        memory_set(0x86, 0x0);
        memory_set(0x87, 0x2);

        execute();

        assert.equal(cpu_register("A"), 0x3);
        done();
    });
    
    it("adc indirect y", function(done) {
        cpu_set_register("A", 0x1);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x71);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x86);
        memory_set(0x85, 0x0);
        memory_set(0x87, 0x2);

        execute();

        assert.equal(cpu_register("A"), 0x3);
        done();
    });
    
    it("adc c flag set", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0x1);

        execute();

        assert.isTrue(cpu_flag("C"));
        cpu_set_flag("C");
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0x0);

        execute();

        assert.isTrue(cpu_flag("C"));
        done();
    });
    
    it("adc c flag unset", function(done) {
        cpu_set_register("A", 0x0);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("C"));
        cpu_unset_flag("C");
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0x0);

        execute();

        assert.isFalse(cpu_flag("C"));
        done();
    });
    
    it("adc z flag set", function(done) {
        cpu_set_register("A", 0x0);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0x0);

        execute();

        assert.isTrue(cpu_flag("Z"));
        cpu_set_flag("C");
        cpu_set_register("A", 0xfe);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0x1);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("adc z flag unset", function(done) {
        cpu_set_register("A", 0x0);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0xff);

        execute();

        assert.isFalse(cpu_flag("Z"));
        cpu_set_register("A", 0xfe);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("adc v flag set", function(done) {
        cpu_set_register("A", 0x7f);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0x1);

        execute();

        assert.isTrue(cpu_flag("V"));
        done();
    });
    
    it("adc v flag unset", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("V"));
        done();
    });
    
    it("adc n flag set", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0xfe);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("adc n flag unset", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x69);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("sbc immediate", function(done) {
        cpu_set_flag("C");
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xe9);
        memory_set(0x101, 0x1);

        execute();

        assert.equal(cpu_register("A"), 0x1);
        done();
    });
    
    it("sbc immediate with bcd", function(done) {
        cpu_set_flag("D");
        cpu_set_register("A", 0x29);
        cpu_pc(0x100);
        memory_set(0x100, 0xe9);
        memory_set(0x101, 0x11);

        execute();

        done();
    });
    
    it("sbc zeroPage", function(done) {
        cpu_set_flag("C");
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xe5);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x1);

        execute();

        assert.equal(cpu_register("A"), 0x1);
        done();
    });
    
    it("sbc zeropage x", function(done) {
        cpu_set_flag("C");
        cpu_set_register("A", 0x2);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xf5);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0x1);

        execute();

        assert.equal(cpu_register("A"), 0x1);
        done();
    });
    
    it("sbc absolute", function(done) {
        cpu_set_flag("C");
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xed);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0x1);

        execute();

        assert.equal(cpu_register("A"), 0x1);
        done();
    });
    
    it("sbc absolute x", function(done) {
        cpu_set_flag("C");
        cpu_set_register("A", 0x2);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xfd);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0x1);

        execute();

        assert.equal(cpu_register("A"), 0x1);
        done();
    });
    
    it("sbc absolute y", function(done) {
        cpu_set_flag("C");
        cpu_set_register("A", 0x2);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xf9);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0x1);

        execute();

        assert.equal(cpu_register("A"), 0x1);
        done();
    });
    
    it("sbc indirect x", function(done) {
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

        assert.equal(cpu_register("A"), 0x1);
        done();
    });
    
    it("sbc indirect y", function(done) {
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

        assert.equal(cpu_register("A"), 0x1);
        done();
    });
    
    it("sbc c flag set", function(done) {
        cpu_set_register("A", 0xc4);
        cpu_pc(0x100);
        memory_set(0x100, 0xe9);
        memory_set(0x101, 0x3c);

        execute();

        assert.isTrue(cpu_flag("C"));
        done();
    });
    
    it("sbc c flag unset", function(done) {
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xe9);
        memory_set(0x101, 0x4);

        execute();

        assert.isFalse(cpu_flag("C"));
        done();
    });
    
    it("sbc z flag set", function(done) {
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xe9);
        memory_set(0x101, 0x1);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("sbc z flag unset", function(done) {
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xe9);
        memory_set(0x101, 0x2);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("sbc v flag set", function(done) {
        cpu_set_register("A", 0x80);
        cpu_pc(0x100);
        memory_set(0x100, 0xe9);
        memory_set(0x101, 0x1);

        execute();

        assert.isTrue(cpu_flag("V"));
        done();
    });
    
    it("sbc v flag unset", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xe9);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("V"));
        done();
    });
    
    it("sbc n flag set", function(done) {
        cpu_set_register("A", 0xfd);
        cpu_pc(0x100);
        memory_set(0x100, 0xe9);
        memory_set(0x101, 0x1);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("sbc n flag unset", function(done) {
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xe9);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("cmp immediate", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xc9);
        memory_set(0x101, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cmp zeropage", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xc5);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cmp zeropage x", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xd5);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cmp absolute", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xcd);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cmp absolute x", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xdd);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cmp absolute y", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xd9);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cmp indirect x", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xc1);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0x87);
        memory_set(0x86, 0x0);
        memory_set(0x87, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cmp indirect y", function(done) {
        cpu_set_register("A", 0xff);
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xd1);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x86);
        memory_set(0x85, 0x0);
        memory_set(0x87, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cmp n flag set", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xc9);
        memory_set(0x101, 0x2);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("cmp n flag unset", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xc9);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("cmp z flag set", function(done) {
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xc9);
        memory_set(0x101, 0x2);

        execute();

        assert.isTrue(cpu_flag("Z"));
        cpu_set_register("A", 0xfe);
        cpu_pc(0x100);
        memory_set(0x100, 0xc9);
        memory_set(0x101, 0xfe);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cmp z flag unset", function(done) {
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xc9);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("Z"));
        cpu_set_register("A", 0xfe);
        cpu_pc(0x100);
        memory_set(0x100, 0xc9);
        memory_set(0x101, 0xff);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("cmp c flag set", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xc9);
        memory_set(0x101, 0x1);

        execute();

        assert.isTrue(cpu_flag("C"));
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xc9);
        memory_set(0x101, 0x1);

        execute();

        assert.isTrue(cpu_flag("C"));
        cpu_set_register("A", 0xfe);
        cpu_pc(0x100);
        memory_set(0x100, 0xc9);
        memory_set(0x101, 0xfd);

        execute();

        assert.isTrue(cpu_flag("C"));
        done();
    });
    
    it("cmp c flag unset", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xc9);
        memory_set(0x101, 0x2);

        execute();

        assert.isFalse(cpu_flag("C"));
        cpu_set_register("A", 0xfd);
        cpu_pc(0x100);
        memory_set(0x100, 0xc9);
        memory_set(0x101, 0xfe);

        execute();

        assert.isFalse(cpu_flag("C"));
        done();
    });
    
    it("cpx immediate", function(done) {
        cpu_set_register("X", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xe0);
        memory_set(0x101, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cpx zeropage", function(done) {
        cpu_set_register("X", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xe4);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cpx absolute", function(done) {
        cpu_set_register("X", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xec);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cpx n flag set", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xe0);
        memory_set(0x101, 0x2);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("cpx n flag unset", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xe0);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("cpx z flag set", function(done) {
        cpu_set_register("X", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xe0);
        memory_set(0x101, 0x2);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cpx z flag unset", function(done) {
        cpu_set_register("X", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xe0);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("cpx c flag set", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xe0);
        memory_set(0x101, 0x1);

        execute();

        assert.isTrue(cpu_flag("C"));
        done();
    });
    
    it("cpx C flag unset", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xe0);
        memory_set(0x101, 0x2);

        execute();

        assert.isFalse(cpu_flag("C"));
        done();
    });
    
    it("cpy immediate", function(done) {
        cpu_set_register("Y", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xc0);
        memory_set(0x101, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cpy zeroPage", function(done) {
        cpu_set_register("Y", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xc4);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cpy absolute", function(done) {
        cpu_set_register("Y", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xcc);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cpy n flag set", function(done) {
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xc0);
        memory_set(0x101, 0x2);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("cpy n flag unset", function(done) {
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xc0);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("cpy z flag set", function(done) {
        cpu_set_register("Y", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xc0);
        memory_set(0x101, 0x2);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("cpy z flag unset", function(done) {
        cpu_set_register("Y", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xc0);
        memory_set(0x101, 0x1);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("cpy c flag set", function(done) {
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xc0);
        memory_set(0x101, 0x1);

        execute();

        assert.isTrue(cpu_flag("C"));
        done();
    });
    
    it("cpy c flag unset", function(done) {
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xc0);
        memory_set(0x101, 0x2);

        execute();

        assert.isFalse(cpu_flag("C"));
        done();
    });
    
    it("inc zeroPage", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xe6);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xfe);

        execute();

        assert.equal(memory_fetch(0x84), 0xff);
        done();
    });
    
    it("inc zeropage x", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xf6);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0xfe);

        execute();

        assert.equal(memory_fetch(0x85), 0xff);
        done();
    });
    
    it("inc absolute", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xee);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0xfe);

        execute();

        assert.equal(memory_fetch(0x84), 0xff);
        done();
    });
    
    it("inc absolute x", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xfe);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0xfe);

        execute();

        assert.equal(memory_fetch(0x85), 0xff);
        done();
    });
    
    it("inc z flag set", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xe6);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xff);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("inc z flag unset", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xe6);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x0);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("inc n flag set", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xe6);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0xfe);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("inc n flag unset", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xe6);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x0);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("inx", function(done) {
        cpu_set_register("X", 0xfe);
        cpu_pc(0x100);
        memory_set(0x100, 0xe8);

        execute();

        assert.equal(cpu_register("X"), 0xff);
        done();
    });
    
    it("inx z flag set", function(done) {
        cpu_set_register("X", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xe8);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("inx z flag unset", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xe8);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("inx n flag set", function(done) {
        cpu_set_register("X", 0xfe);
        cpu_pc(0x100);
        memory_set(0x100, 0xe8);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("inx n flag unset", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xe8);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("iny", function(done) {
        cpu_set_register("Y", 0xfe);
        cpu_pc(0x100);
        memory_set(0x100, 0xc8);

        execute();

        assert.equal(cpu_register("Y"), 0xff);
        done();
    });
    
    it("iny z flag set", function(done) {
        cpu_set_register("Y", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xc8);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("iny z flag unset", function(done) {
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xc8);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("iny n flag set", function(done) {
        cpu_set_register("Y", 0xfe);
        cpu_pc(0x100);
        memory_set(0x100, 0xc8);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("iny n flag unset", function(done) {
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xc8);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("dec zeroPage", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xc6);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x2);

        execute();

        assert.equal(memory_fetch(0x84), 0x1);
        done();
    });
    
    it("dec zeropage x", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xd6);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0x2);

        execute();

        assert.equal(memory_fetch(0x85), 0x1);
        done();
    });
    
    it("dec absolute", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xce);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0x2);

        execute();

        assert.equal(memory_fetch(0x84), 0x1);
        done();
    });
    
    it("dec absolute x", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xde);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0x2);

        execute();

        assert.equal(memory_fetch(0x85), 0x1);
        done();
    });
    
    it("dec z flag set", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xc6);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x1);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("dec z flag unset", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xc6);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x2);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("dec n flag set", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xc6);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x0);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("dec n flag unset", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xc6);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x1);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("dex", function(done) {
        cpu_set_register("X", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xca);

        execute();

        assert.equal(cpu_register("X"), 0x1);
        done();
    });
    
    it("dex z flag set", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xca);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("dex z flag unset", function(done) {
        cpu_set_register("X", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xca);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("dex n flag set", function(done) {
        cpu_set_register("X", 0x0);
        cpu_pc(0x100);
        memory_set(0x100, 0xca);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("dex n flag unset", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xca);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("dey", function(done) {
        cpu_set_register("Y", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0x88);

        execute();

        assert.equal(cpu_register("Y"), 0x1);
        done();
    });
    
    it("dey z flag set", function(done) {
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x88);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("dey z flag unset", function(done) {
        cpu_set_register("Y", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0x88);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("dey n flag set", function(done) {
        cpu_set_register("Y", 0x0);
        cpu_pc(0x100);
        memory_set(0x100, 0x88);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("dey n flag unset", function(done) {
        cpu_set_register("Y", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x88);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("asl accumulator", function(done) {
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xa);

        execute();

        assert.equal(cpu_register("A"), 0x4);
        done();
    });
    
    it("asl zeroPage", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0x6);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x2);

        execute();

        assert.equal(memory_fetch(0x84), 0x4);
        done();
    });
    
    it("asl zeropage x", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x16);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0x2);

        execute();

        assert.equal(memory_fetch(0x85), 0x4);
        done();
    });
    
    it("asl absolute", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0xe);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0x2);

        execute();

        assert.equal(memory_fetch(0x84), 0x4);
        done();
    });
    
    it("asl absoluteX", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x1e);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0x2);

        execute();

        assert.equal(memory_fetch(0x85), 0x4);
        done();
    });
    
    it("asl c flag set", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0xa);

        execute();

        assert.isTrue(cpu_flag("C"));
        done();
    });
    
    it("asl c flag unset", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xa);

        execute();

        assert.isFalse(cpu_flag("C"));
        done();
    });
    
    it("asl z flag set", function(done) {
        cpu_set_register("A", 0x0);
        cpu_pc(0x100);
        memory_set(0x100, 0xa);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("asl z flag unset", function(done) {
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0xa);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("asl n flag set", function(done) {
        cpu_set_register("A", 0xfe);
        cpu_pc(0x100);
        memory_set(0x100, 0xa);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("asl n flag unset", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0xa);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("lsr accumulator", function(done) {
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0x4a);

        execute();

        assert.equal(cpu_register("A"), 0x1);
        done();
    });
    
    it("lsr zeroPage", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0x46);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x2);

        execute();

        assert.equal(memory_fetch(0x84), 0x1);
        done();
    });
    
    it("lsr zeropage x", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x56);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0x2);

        execute();

        assert.equal(memory_fetch(0x85), 0x1);
        done();
    });
    
    it("lsr absolute", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0x4e);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0x2);

        execute();

        assert.equal(memory_fetch(0x84), 0x1);
        done();
    });
    
    it("lsr absolute x", function(done) {
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x5e);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0x2);

        execute();

        assert.equal(memory_fetch(0x85), 0x1);
        done();
    });
    
    it("lsr c flag set", function(done) {
        cpu_set_register("A", 0xff);
        cpu_pc(0x100);
        memory_set(0x100, 0x4a);

        execute();

        assert.isTrue(cpu_flag("C"));
        done();
    });
    
    it("lsr c flag unset", function(done) {
        cpu_set_register("A", 0x10);
        cpu_pc(0x100);
        memory_set(0x100, 0x4a);

        execute();

        assert.isFalse(cpu_flag("C"));
        done();
    });
    
    it("lsr z flag set", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x4a);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("lsr z flag unset", function(done) {
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0x4a);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("lsr n flag unset", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x4a);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("rol accumulator", function(done) {
        cpu_set_flag("C");
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0x2a);

        execute();

        assert.equal(cpu_register("A"), 0x5);
        done();
    });
    
    it("rol zeropage", function(done) {
        cpu_set_flag("C");
        cpu_pc(0x100);
        memory_set(0x100, 0x26);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x2);

        execute();

        assert.equal(memory_fetch(0x84), 0x5);
        done();
    });
    
    it("rol zeropage x", function(done) {
        cpu_set_flag("C");
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x36);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0x2);

        execute();

        assert.equal(memory_fetch(0x85), 0x5);
        done();
    });
    
    it("rol absolute", function(done) {
        cpu_set_flag("C");
        cpu_pc(0x100);
        memory_set(0x100, 0x2e);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0x2);

        execute();

        assert.equal(memory_fetch(0x84), 0x5);
        done();
    });
    
    it("rol absolute x", function(done) {
        cpu_set_flag("C");
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x3e);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0x2);

        execute();

        assert.equal(memory_fetch(0x85), 0x5);
        done();
    });
    
    it("rol c flag set", function(done) {
        cpu_set_register("A", 0x80);
        cpu_pc(0x100);
        memory_set(0x100, 0x2a);

        execute();

        assert.isTrue(cpu_flag("C"));
        done();
    });
    
    it("rol c flag unset", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x2a);

        execute();

        assert.isFalse(cpu_flag("C"));
        done();
    });
    
    it("rol z flag set", function(done) {
        cpu_set_register("A", 0x0);
        cpu_pc(0x100);
        memory_set(0x100, 0x2a);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("rol z flag unset", function(done) {
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0x2a);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("rol n flag set", function(done) {
        cpu_set_register("A", 0xfe);
        cpu_pc(0x100);
        memory_set(0x100, 0x2a);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("rol n flag unset", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x2a);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("ror accumulator", function(done) {
        cpu_set_flag("C");
        cpu_set_register("A", 0x8);
        cpu_pc(0x100);
        memory_set(0x100, 0x6a);

        execute();

        assert.equal(cpu_register("A"), 0x84);
        done();
    });
    
    it("ror zeropage", function(done) {
        cpu_set_flag("C");
        cpu_pc(0x100);
        memory_set(0x100, 0x66);
        memory_set(0x101, 0x84);
        memory_set(0x84, 0x8);

        execute();

        assert.equal(memory_fetch(0x84), 0x84);
        done();
    });
    
    it("ror zeropage x", function(done) {
        cpu_set_flag("C");
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x76);
        memory_set(0x101, 0x84);
        memory_set(0x85, 0x8);

        execute();

        assert.equal(memory_fetch(0x85), 0x84);
        done();
    });
    
    it("ror absolute", function(done) {
        cpu_set_flag("C");
        cpu_pc(0x100);
        memory_set(0x100, 0x6e);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0x8);

        execute();

        assert.equal(memory_fetch(0x84), 0x84);
        done();
    });
    
    it("ror absolute x", function(done) {
        cpu_set_flag("C");
        cpu_set_register("X", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x7e);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x85, 0x8);

        execute();

        assert.equal(memory_fetch(0x85), 0x84);
        done();
    });
    
    it("ror c flag set", function(done) {
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x6a);

        execute();

        assert.isTrue(cpu_flag("C"));
        done();
    });
    
    it("ror c flag unset", function(done) {
        cpu_set_register("A", 0x10);
        cpu_pc(0x100);
        memory_set(0x100, 0x6a);

        execute();

        assert.isFalse(cpu_flag("C"));
        done();
    });
    
    it("ror z flag set", function(done) {
        cpu_set_register("A", 0x0);
        cpu_pc(0x100);
        memory_set(0x100, 0x6a);

        execute();

        assert.isTrue(cpu_flag("Z"));
        done();
    });
    
    it("ror z flag unset", function(done) {
        cpu_set_register("A", 0x2);
        cpu_pc(0x100);
        memory_set(0x100, 0x6a);

        execute();

        assert.isFalse(cpu_flag("Z"));
        done();
    });
    
    it("ror n flag set", function(done) {
        cpu_set_flag("C");
        cpu_set_register("A", 0xfe);
        cpu_pc(0x100);
        memory_set(0x100, 0x6a);

        execute();

        assert.isTrue(cpu_flag("N"));
        done();
    });
    
    it("ror n flag unset", function(done) {
        cpu_unset_flag("C");
        cpu_set_register("A", 0x1);
        cpu_pc(0x100);
        memory_set(0x100, 0x6a);

        execute();

        assert.isFalse(cpu_flag("N"));
        done();
    });
    
    it("jmp absolute", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0x4c);
        memory_set(0x101, 0xff);
        memory_set(0x102, 0x1);

        execute();

        assert.equal(cpu_register("PC"), 0x1ff);
        done();
    });
    
    it("jmp indirect", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0x6c);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x1);
        memory_set(0x184, 0xff);
        memory_set(0x185, 0xff);

        execute();

        assert.equal(cpu_register("PC"), 0xffff);
        done();
    });
    
    it("jsr", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0x20);
        memory_set(0x101, 0xff);
        memory_set(0x102, 0x1);

        execute();

        assert.equal(cpu_register("PC"), 0x1ff);
        assert.equal(memory_fetch(0x1fd), 0x1);
        assert.equal(memory_fetch(0x1fc), 0x2);
        done();
    });
    
    it("jsr stack pointer", function(done) {
        cpu_pc(0x100);
        memory_set(0x100, 0x20);
        memory_set(0x101, 0x84);
        memory_set(0x102, 0x0);
        memory_set(0x84, 0x60);

        execute();

        assert.equal(cpu_register("PC"), 0x84);
        assert.equal(cpu_register("SP"), 0xfb);

        execute();

        assert.equal(cpu_register("PC"), 0x103);
        assert.equal(cpu_register("SP"), 0xfd);
        done();
    });
    
    it("jsr with illegal opcode", function(done) {
        this.skip();
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

        assert.equal(cpu_register("A"), 0xff);
        done();
    });
    
    it("rts", function(done) {
        cpu_pc(0x100);
        cpu_push_word(0x102);
        memory_set(0x100, 0x60);

        execute();

        assert.equal(cpu_register("PC"), 0x103);
        done();
    });
    
    it("bcc", function(done) {
        skip_cycles();
        cpu_set_flag("C");
        cpu_pc(0x100);
        memory_set(0x100, 0x90);
        var cycles = execute();
        if (check_cycles()) {
            assert.equal(cycles, 0x2);
        };
        assert.equal(cpu_register("PC"), 0x102);
        cpu_unset_flag("C");
        cpu_pc(0x100);
        memory_set(0x100, 0x90);
        memory_set(0x101, 0x2);
        var cycles = execute();
        if (check_cycles()) {
            assert.equal(cycles, 0x3);
        };
        assert.equal(cpu_register("PC"), 0x104);
        cpu_unset_flag("C");
        cpu_pc(0x100);
        memory_set(0x100, 0x90);
        memory_set(0x101, 0xfd);
        var cycles = execute();
        if (check_cycles()) {
            assert.equal(cycles, 0x4);
        };
        assert.equal(cpu_register("PC"), 0xff);
        done();
    });
    
    it("bcs", function(done) {
        cpu_set_flag("C");
        cpu_pc(0x100);
        memory_set(0x100, 0xb0);
        memory_set(0x101, 0x2);

        execute();

        assert.equal(cpu_register("PC"), 0x104);
        cpu_set_flag("C");
        cpu_pc(0x100);
        memory_set(0x100, 0xb0);
        memory_set(0x101, 0xfe);

        execute();

        assert.equal(cpu_register("PC"), 0x100);
        done();
    });
    
    it("beq", function(done) {
        cpu_set_flag("Z");
        cpu_pc(0x100);
        memory_set(0x100, 0xf0);
        memory_set(0x101, 0x2);

        execute();

        assert.equal(cpu_register("PC"), 0x104);
        cpu_set_flag("Z");
        cpu_pc(0x100);
        memory_set(0x100, 0xf0);
        memory_set(0x101, 0xfe);

        execute();

        assert.equal(cpu_register("PC"), 0x100);
        done();
    });
    
    it("bmi", function(done) {
        cpu_set_flag("N");
        cpu_pc(0x100);
        memory_set(0x100, 0x30);
        memory_set(0x101, 0x2);

        execute();

        assert.equal(cpu_register("PC"), 0x104);
        cpu_set_flag("N");
        cpu_pc(0x100);
        memory_set(0x100, 0x30);
        memory_set(0x101, 0xfe);

        execute();

        assert.equal(cpu_register("PC"), 0x100);
        done();
    });
    
    it("bne", function(done) {
        cpu_unset_flag("Z");
        cpu_pc(0x100);
        memory_set(0x100, 0xd0);
        memory_set(0x101, 0x2);

        execute();

        assert.equal(cpu_register("PC"), 0x104);
        cpu_unset_flag("Z");
        cpu_pc(0x100);
        memory_set(0x100, 0xd0);
        memory_set(0x101, 0xfe);

        execute();

        assert.equal(cpu_register("PC"), 0x100);
        done();
    });
    
    it("bpl", function(done) {
        cpu_unset_flag("N");
        cpu_pc(0x100);
        memory_set(0x100, 0x10);
        memory_set(0x101, 0x2);

        execute();

        assert.equal(cpu_register("PC"), 0x104);
        cpu_unset_flag("N");
        cpu_pc(0x100);
        memory_set(0x100, 0x10);
        memory_set(0x101, 0xfe);

        execute();

        assert.equal(cpu_register("PC"), 0x100);
        done();
    });
    
    it("bvc", function(done) {
        cpu_unset_flag("V");
        cpu_pc(0x100);
        memory_set(0x100, 0x50);
        memory_set(0x101, 0x2);

        execute();

        assert.equal(cpu_register("PC"), 0x104);
        cpu_unset_flag("V");
        cpu_pc(0x100);
        memory_set(0x100, 0x50);
        memory_set(0x101, 0xfe);

        execute();

        assert.equal(cpu_register("PC"), 0x100);
        done();
    });
    
    it("bvs", function(done) {
        cpu_set_flag("V");
        cpu_pc(0x100);
        memory_set(0x100, 0x70);
        memory_set(0x101, 0x2);

        execute();

        assert.equal(cpu_register("PC"), 0x104);
        cpu_set_flag("V");
        cpu_pc(0x100);
        memory_set(0x100, 0x70);
        memory_set(0x101, 0xfe);

        execute();

        assert.equal(cpu_register("PC"), 0x100);
        done();
    });
    
    it("clc", function(done) {
        cpu_unset_flag("C");
        cpu_pc(0x100);
        memory_set(0x100, 0x18);

        execute();

        assert.isFalse(cpu_flag("C"));
        cpu_set_flag("C");
        cpu_pc(0x100);
        memory_set(0x100, 0x18);

        execute();

        assert.isFalse(cpu_flag("C"));
        done();
    });
    
    it("cld", function(done) {
        cpu_unset_flag("D");
        cpu_pc(0x100);
        memory_set(0x100, 0xd8);

        execute();

        assert.isFalse(cpu_flag("D"));
        cpu_set_flag("D");
        cpu_pc(0x100);
        memory_set(0x100, 0xd8);

        execute();

        assert.isFalse(cpu_flag("D"));
        done();
    });
    
    it("cli", function(done) {
        cpu_unset_flag("I");
        cpu_pc(0x100);
        memory_set(0x100, 0x58);

        execute();

        assert.isFalse(cpu_flag("I"));
        cpu_set_flag("I");
        cpu_pc(0x100);
        memory_set(0x100, 0x58);

        execute();

        assert.isFalse(cpu_flag("I"));
        done();
    });
    
    it("clv", function(done) {
        cpu_unset_flag("V");
        cpu_pc(0x100);
        memory_set(0x100, 0xb8);

        execute();

        assert.isFalse(cpu_flag("V"));
        cpu_set_flag("V");
        cpu_pc(0x100);
        memory_set(0x100, 0xb8);

        execute();

        assert.isFalse(cpu_flag("V"));
        done();
    });
    
    it("sec", function(done) {
        cpu_unset_flag("C");
        cpu_pc(0x100);
        memory_set(0x100, 0x38);

        execute();

        assert.isTrue(cpu_flag("C"));
        cpu_set_flag("C");
        cpu_pc(0x100);
        memory_set(0x100, 0x38);

        execute();

        assert.isTrue(cpu_flag("C"));
        done();
    });
    
    it("sed", function(done) {
        cpu_unset_flag("D");
        cpu_pc(0x100);
        memory_set(0x100, 0xf8);

        execute();

        assert.isTrue(cpu_flag("D"));
        cpu_set_flag("D");
        cpu_pc(0x100);
        memory_set(0x100, 0xf8);

        execute();

        assert.isTrue(cpu_flag("D"));
        done();
    });
    
    it("sei", function(done) {
        cpu_unset_flag("I");
        cpu_pc(0x100);
        memory_set(0x100, 0x78);

        execute();

        assert.isTrue(cpu_flag("I"));
        cpu_set_flag("I");
        cpu_pc(0x100);
        memory_set(0x100, 0x78);

        execute();

        assert.isTrue(cpu_flag("I"));
        done();
    });
    
    it("brk", function(done) {
        cpu_set_register("P", 0xff - Status.B);
        cpu_pc(0x100);
        memory_set(0x100, 0x0);
        memory_set(0xfffe, 0xff);
        memory_set(0xffff, 0x1);

        execute();

        assert.equal(cpu_pull_byte(), 0xff);
        assert.equal(cpu_pull_word(), 0x102);
        assert.equal(cpu_register("PC"), 0x1ff);
        done();
    });
    
    it("rti", function(done) {
        cpu_pc(0x100);
        cpu_push_word(0x102);
        cpu_push_byte(0x3);
        memory_set(0x100, 0x40);

        execute();

        assert.equal(cpu_register("PC"), 0x102);
        done();
    });
    
    it("irq interrupt", function(done) {
        cpu_set_register("P", 0xfb);
        cpu_pc(0x100);
        cpu_force_interrupt("irq");
        memory_set(0xfffe, 0x40);
        memory_set(0xffff, 0x1);

        execute_interrupt();

        assert.equal(cpu_pull_byte(), 0xeb);
        assert.equal(cpu_pull_word(), 0x100);
        assert.equal(cpu_register("PC"), 0x140);
        assert.isFalse(cpu_get_interrupt("irq"));
        done();
    });
    
    it("nmi interrupt", function(done) {
        cpu_set_register("P", 0xff);
        cpu_pc(0x100);
        cpu_force_interrupt("nmi");
        memory_set(0xfffa, 0x40);
        memory_set(0xfffb, 0x1);

        execute_interrupt();

        assert.equal(cpu_pull_byte(), 0xef);
        assert.equal(cpu_pull_word(), 0x100);
        assert.equal(cpu_register("PC"), 0x140);
        assert.isFalse(cpu_get_interrupt("nmi"));
        done();
    });
    
    it("rst interrupt", function(done) {
        cpu_pc(0x100);
        cpu_force_interrupt("rst");
        memory_set(0xfffc, 0x40);
        memory_set(0xfffd, 0x1);

        execute_interrupt();

        assert.equal(cpu_register("PC"), 0x140);
        assert.isFalse(cpu_get_interrupt("rst"));
        done();
    });
    
});

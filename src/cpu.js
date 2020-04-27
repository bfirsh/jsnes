var utils = require("./utils");

var CPU = function (nes) {
  this.nes = nes;

  // Keep Chrome happy
  this.mem = null;
  this.REG_ACC = null;
  this.REG_X = null;
  this.REG_Y = null;
  this.REG_SP = null;
  this.REG_PC = null;
  this.REG_PC_NEW = null;
  this.REG_STATUS = null;
  this.F_CARRY = null;
  this.F_DECIMAL = null;
  this.F_INTERRUPT = null;
  this.F_INTERRUPT_NEW = null;
  this.F_OVERFLOW = null;
  this.F_SIGN = null;
  this.F_ZERO = null;
  this.F_NOTUSED = null;
  this.F_NOTUSED_NEW = null;
  this.F_BRK = null;
  this.F_BRK_NEW = null;
  this.opdata = null;
  this.cyclesToHalt = null;
  this.crash = null;
  this.irqRequested = null;
  this.irqType = null;

  this.reset();
};

CPU.prototype = {
  // IRQ Types
  IRQ_NORMAL: 0,
  IRQ_NMI: 1,
  IRQ_RESET: 2,

  reset: function () {
    // Main memory
    this.mem = new Array(0x10000);

    for (var i = 0; i < 0x2000; i++) {
      this.mem[i] = 0xff;
    }
    for (var p = 0; p < 4; p++) {
      var j = p * 0x800;
      this.mem[j + 0x008] = 0xf7;
      this.mem[j + 0x009] = 0xef;
      this.mem[j + 0x00a] = 0xdf;
      this.mem[j + 0x00f] = 0xbf;
    }
    for (var k = 0x2001; k < this.mem.length; k++) {
      this.mem[k] = 0;
    }

    // CPU Registers:
    this.REG_ACC = 0;
    this.REG_X = 0;
    this.REG_Y = 0;
    // Reset Stack pointer:
    this.REG_SP = 0x01ff;
    // Reset Program counter:
    this.REG_PC = 0x8000 - 1;
    this.REG_PC_NEW = 0x8000 - 1;
    // Reset Status register:
    this.REG_STATUS = 0x28;

    this.setStatus(0x28);

    // Set flags:
    this.F_CARRY = 0;
    this.F_DECIMAL = 0;
    this.F_INTERRUPT = 1;
    this.F_INTERRUPT_NEW = 1;
    this.F_OVERFLOW = 0;
    this.F_SIGN = 0;
    this.F_ZERO = 1;

    this.F_NOTUSED = 1;
    this.F_NOTUSED_NEW = 1;
    this.F_BRK = 1;
    this.F_BRK_NEW = 1;

    this.opdata = new OpData().opdata;
    this.cyclesToHalt = 0;

    // Reset crash flag:
    this.crash = false;

    // Interrupt notification:
    this.irqRequested = false;
    this.irqType = null;
  },

  // Emulates a single CPU instruction, returns the number of cycles
  emulate: function () {
    var temp;
    var add;

    // Check interrupts:
    if (this.irqRequested) {
      temp =
        this.F_CARRY |
        ((this.F_ZERO === 0 ? 1 : 0) << 1) |
        (this.F_INTERRUPT << 2) |
        (this.F_DECIMAL << 3) |
        (this.F_BRK << 4) |
        (this.F_NOTUSED << 5) |
        (this.F_OVERFLOW << 6) |
        (this.F_SIGN << 7);

      this.REG_PC_NEW = this.REG_PC;
      this.F_INTERRUPT_NEW = this.F_INTERRUPT;
      switch (this.irqType) {
        case 0: {
          // Normal IRQ:
          if (this.F_INTERRUPT !== 0) {
            // console.log("Interrupt was masked.");
            break;
          }
          this.doIrq(temp);
          // console.log("Did normal IRQ. I="+this.F_INTERRUPT);
          break;
        }
        case 1: {
          // NMI:
          this.doNonMaskableInterrupt(temp);
          break;
        }
        case 2: {
          // Reset:
          this.doResetInterrupt();
          break;
        }
      }

      this.REG_PC = this.REG_PC_NEW;
      this.F_INTERRUPT = this.F_INTERRUPT_NEW;
      this.F_BRK = this.F_BRK_NEW;
      this.irqRequested = false;
    }

    var opinf = this.opdata[this.nes.mmap.load(this.REG_PC + 1)];
    var cycleCount = opinf >> 24;
    var cycleAdd = 0;

    // Find address mode:
    var addrMode = (opinf >> 8) & 0xff;

    // Increment PC by number of op bytes:
    var opaddr = this.REG_PC;
    this.REG_PC += (opinf >> 16) & 0xff;

    var addr = 0;
    switch (addrMode) {
      case 0: {
        // Zero Page mode. Use the address given after the opcode,
        // but without high byte.
        addr = this.load(opaddr + 2);
        break;
      }
      case 1: {
        // Relative mode.
        addr = this.load(opaddr + 2);
        if (addr < 0x80) {
          addr += this.REG_PC;
        } else {
          addr += this.REG_PC - 256;
        }
        break;
      }
      case 2: {
        // Ignore. Address is implied in instruction.
        break;
      }
      case 3: {
        // Absolute mode. Use the two bytes following the opcode as
        // an address.
        addr = this.load16bit(opaddr + 2);
        break;
      }
      case 4: {
        // Accumulator mode. The address is in the accumulator
        // register.
        addr = this.REG_ACC;
        break;
      }
      case 5: {
        // Immediate mode. The value is given after the opcode.
        addr = this.REG_PC;
        break;
      }
      case 6: {
        // Zero Page Indexed mode, X as index. Use the address given
        // after the opcode, then add the
        // X register to it to get the final address.
        addr = (this.load(opaddr + 2) + this.REG_X) & 0xff;
        break;
      }
      case 7: {
        // Zero Page Indexed mode, Y as index. Use the address given
        // after the opcode, then add the
        // Y register to it to get the final address.
        addr = (this.load(opaddr + 2) + this.REG_Y) & 0xff;
        break;
      }
      case 8: {
        // Absolute Indexed Mode, X as index. Same as zero page
        // indexed, but with the high byte.
        addr = this.load16bit(opaddr + 2);
        if ((addr & 0xff00) !== ((addr + this.REG_X) & 0xff00)) {
          cycleAdd = 1;
        }
        addr += this.REG_X;
        break;
      }
      case 9: {
        // Absolute Indexed Mode, Y as index. Same as zero page
        // indexed, but with the high byte.
        addr = this.load16bit(opaddr + 2);
        if ((addr & 0xff00) !== ((addr + this.REG_Y) & 0xff00)) {
          cycleAdd = 1;
        }
        addr += this.REG_Y;
        break;
      }
      case 10: {
        // Pre-indexed Indirect mode. Find the 16-bit address
        // starting at the given location plus
        // the current X register. The value is the contents of that
        // address.
        addr = this.load(opaddr + 2);
        if ((addr & 0xff00) !== ((addr + this.REG_X) & 0xff00)) {
          cycleAdd = 1;
        }
        addr += this.REG_X;
        addr &= 0xff;
        addr = this.load16bit(addr);
        break;
      }
      case 11: {
        // Post-indexed Indirect mode. Find the 16-bit address
        // contained in the given location
        // (and the one following). Add to that address the contents
        // of the Y register. Fetch the value
        // stored at that adress.
        addr = this.load16bit(this.load(opaddr + 2));
        if ((addr & 0xff00) !== ((addr + this.REG_Y) & 0xff00)) {
          cycleAdd = 1;
        }
        addr += this.REG_Y;
        break;
      }
      case 12: {
        // Indirect Absolute mode. Find the 16-bit address contained
        // at the given location.
        addr = this.load16bit(opaddr + 2); // Find op
        if (addr < 0x1fff) {
          addr =
            this.mem[addr] +
            (this.mem[(addr & 0xff00) | (((addr & 0xff) + 1) & 0xff)] << 8); // Read from address given in op
        } else {
          addr =
            this.nes.mmap.load(addr) +
            (this.nes.mmap.load(
              (addr & 0xff00) | (((addr & 0xff) + 1) & 0xff)
            ) <<
              8);
        }
        break;
      }
    }
    // Wrap around for addresses above 0xFFFF:
    addr &= 0xffff;

    // ----------------------------------------------------------------------------------------------------
    // Decode & execute instruction:
    // ----------------------------------------------------------------------------------------------------

    // This should be compiled to a jump table.
    switch (opinf & 0xff) {
      case 0: {
        // *******
        // * ADC *
        // *******

        // Add with carry.
        temp = this.REG_ACC + this.load(addr) + this.F_CARRY;

        if (
          ((this.REG_ACC ^ this.load(addr)) & 0x80) === 0 &&
          ((this.REG_ACC ^ temp) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp > 255 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        this.REG_ACC = temp & 255;
        cycleCount += cycleAdd;
        break;
      }
      case 1: {
        // *******
        // * AND *
        // *******

        // AND memory with accumulator.
        this.REG_ACC = this.REG_ACC & this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        if (addrMode !== 11) cycleCount += cycleAdd; // PostIdxInd = 11
        break;
      }
      case 2: {
        // *******
        // * ASL *
        // *******

        // Shift left one bit
        if (addrMode === 4) {
          // ADDR_ACC = 4

          this.F_CARRY = (this.REG_ACC >> 7) & 1;
          this.REG_ACC = (this.REG_ACC << 1) & 255;
          this.F_SIGN = (this.REG_ACC >> 7) & 1;
          this.F_ZERO = this.REG_ACC;
        } else {
          temp = this.load(addr);
          this.F_CARRY = (temp >> 7) & 1;
          temp = (temp << 1) & 255;
          this.F_SIGN = (temp >> 7) & 1;
          this.F_ZERO = temp;
          this.write(addr, temp);
        }
        break;
      }
      case 3: {
        // *******
        // * BCC *
        // *******

        // Branch on carry clear
        if (this.F_CARRY === 0) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
        }
        break;
      }
      case 4: {
        // *******
        // * BCS *
        // *******

        // Branch on carry set
        if (this.F_CARRY === 1) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
        }
        break;
      }
      case 5: {
        // *******
        // * BEQ *
        // *******

        // Branch on zero
        if (this.F_ZERO === 0) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
        }
        break;
      }
      case 6: {
        // *******
        // * BIT *
        // *******

        temp = this.load(addr);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_OVERFLOW = (temp >> 6) & 1;
        temp &= this.REG_ACC;
        this.F_ZERO = temp;
        break;
      }
      case 7: {
        // *******
        // * BMI *
        // *******

        // Branch on negative result
        if (this.F_SIGN === 1) {
          cycleCount++;
          this.REG_PC = addr;
        }
        break;
      }
      case 8: {
        // *******
        // * BNE *
        // *******

        // Branch on not zero
        if (this.F_ZERO !== 0) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
        }
        break;
      }
      case 9: {
        // *******
        // * BPL *
        // *******

        // Branch on positive result
        if (this.F_SIGN === 0) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
        }
        break;
      }
      case 10: {
        // *******
        // * BRK *
        // *******

        this.REG_PC += 2;
        this.push((this.REG_PC >> 8) & 255);
        this.push(this.REG_PC & 255);
        this.F_BRK = 1;

        this.push(
          this.F_CARRY |
            ((this.F_ZERO === 0 ? 1 : 0) << 1) |
            (this.F_INTERRUPT << 2) |
            (this.F_DECIMAL << 3) |
            (this.F_BRK << 4) |
            (this.F_NOTUSED << 5) |
            (this.F_OVERFLOW << 6) |
            (this.F_SIGN << 7)
        );

        this.F_INTERRUPT = 1;
        //this.REG_PC = load(0xFFFE) | (load(0xFFFF) << 8);
        this.REG_PC = this.load16bit(0xfffe);
        this.REG_PC--;
        break;
      }
      case 11: {
        // *******
        // * BVC *
        // *******

        // Branch on overflow clear
        if (this.F_OVERFLOW === 0) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
        }
        break;
      }
      case 12: {
        // *******
        // * BVS *
        // *******

        // Branch on overflow set
        if (this.F_OVERFLOW === 1) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
        }
        break;
      }
      case 13: {
        // *******
        // * CLC *
        // *******

        // Clear carry flag
        this.F_CARRY = 0;
        break;
      }
      case 14: {
        // *******
        // * CLD *
        // *******

        // Clear decimal flag
        this.F_DECIMAL = 0;
        break;
      }
      case 15: {
        // *******
        // * CLI *
        // *******

        // Clear interrupt flag
        this.F_INTERRUPT = 0;
        break;
      }
      case 16: {
        // *******
        // * CLV *
        // *******

        // Clear overflow flag
        this.F_OVERFLOW = 0;
        break;
      }
      case 17: {
        // *******
        // * CMP *
        // *******

        // Compare memory and accumulator:
        temp = this.REG_ACC - this.load(addr);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        cycleCount += cycleAdd;
        break;
      }
      case 18: {
        // *******
        // * CPX *
        // *******

        // Compare memory and index X:
        temp = this.REG_X - this.load(addr);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        break;
      }
      case 19: {
        // *******
        // * CPY *
        // *******

        // Compare memory and index Y:
        temp = this.REG_Y - this.load(addr);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        break;
      }
      case 20: {
        // *******
        // * DEC *
        // *******

        // Decrement memory by one:
        temp = (this.load(addr) - 1) & 0xff;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        this.write(addr, temp);
        break;
      }
      case 21: {
        // *******
        // * DEX *
        // *******

        // Decrement index X by one:
        this.REG_X = (this.REG_X - 1) & 0xff;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      }
      case 22: {
        // *******
        // * DEY *
        // *******

        // Decrement index Y by one:
        this.REG_Y = (this.REG_Y - 1) & 0xff;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        break;
      }
      case 23: {
        // *******
        // * EOR *
        // *******

        // XOR Memory with accumulator, store in accumulator:
        this.REG_ACC = (this.load(addr) ^ this.REG_ACC) & 0xff;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        cycleCount += cycleAdd;
        break;
      }
      case 24: {
        // *******
        // * INC *
        // *******

        // Increment memory by one:
        temp = (this.load(addr) + 1) & 0xff;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        this.write(addr, temp & 0xff);
        break;
      }
      case 25: {
        // *******
        // * INX *
        // *******

        // Increment index X by one:
        this.REG_X = (this.REG_X + 1) & 0xff;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      }
      case 26: {
        // *******
        // * INY *
        // *******

        // Increment index Y by one:
        this.REG_Y++;
        this.REG_Y &= 0xff;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        break;
      }
      case 27: {
        // *******
        // * JMP *
        // *******

        // Jump to new location:
        this.REG_PC = addr - 1;
        break;
      }
      case 28: {
        // *******
        // * JSR *
        // *******

        // Jump to new location, saving return address.
        // Push return address on stack:
        this.push((this.REG_PC >> 8) & 255);
        this.push(this.REG_PC & 255);
        this.REG_PC = addr - 1;
        break;
      }
      case 29: {
        // *******
        // * LDA *
        // *******

        // Load accumulator with memory:
        this.REG_ACC = this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        cycleCount += cycleAdd;
        break;
      }
      case 30: {
        // *******
        // * LDX *
        // *******

        // Load index X with memory:
        this.REG_X = this.load(addr);
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        cycleCount += cycleAdd;
        break;
      }
      case 31: {
        // *******
        // * LDY *
        // *******

        // Load index Y with memory:
        this.REG_Y = this.load(addr);
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        cycleCount += cycleAdd;
        break;
      }
      case 32: {
        // *******
        // * LSR *
        // *******

        // Shift right one bit:
        if (addrMode === 4) {
          // ADDR_ACC

          temp = this.REG_ACC & 0xff;
          this.F_CARRY = temp & 1;
          temp >>= 1;
          this.REG_ACC = temp;
        } else {
          temp = this.load(addr) & 0xff;
          this.F_CARRY = temp & 1;
          temp >>= 1;
          this.write(addr, temp);
        }
        this.F_SIGN = 0;
        this.F_ZERO = temp;
        break;
      }
      case 33: {
        // *******
        // * NOP *
        // *******

        // No OPeration.
        // Ignore.
        break;
      }
      case 34: {
        // *******
        // * ORA *
        // *******

        // OR memory with accumulator, store in accumulator.
        temp = (this.load(addr) | this.REG_ACC) & 255;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        this.REG_ACC = temp;
        if (addrMode !== 11) cycleCount += cycleAdd; // PostIdxInd = 11
        break;
      }
      case 35: {
        // *******
        // * PHA *
        // *******

        // Push accumulator on stack
        this.push(this.REG_ACC);
        break;
      }
      case 36: {
        // *******
        // * PHP *
        // *******

        // Push processor status on stack
        this.F_BRK = 1;
        this.push(
          this.F_CARRY |
            ((this.F_ZERO === 0 ? 1 : 0) << 1) |
            (this.F_INTERRUPT << 2) |
            (this.F_DECIMAL << 3) |
            (this.F_BRK << 4) |
            (this.F_NOTUSED << 5) |
            (this.F_OVERFLOW << 6) |
            (this.F_SIGN << 7)
        );
        break;
      }
      case 37: {
        // *******
        // * PLA *
        // *******

        // Pull accumulator from stack
        this.REG_ACC = this.pull();
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 38: {
        // *******
        // * PLP *
        // *******

        // Pull processor status from stack
        temp = this.pull();
        this.F_CARRY = temp & 1;
        this.F_ZERO = ((temp >> 1) & 1) === 1 ? 0 : 1;
        this.F_INTERRUPT = (temp >> 2) & 1;
        this.F_DECIMAL = (temp >> 3) & 1;
        this.F_BRK = (temp >> 4) & 1;
        this.F_NOTUSED = (temp >> 5) & 1;
        this.F_OVERFLOW = (temp >> 6) & 1;
        this.F_SIGN = (temp >> 7) & 1;

        this.F_NOTUSED = 1;
        break;
      }
      case 39: {
        // *******
        // * ROL *
        // *******

        // Rotate one bit left
        if (addrMode === 4) {
          // ADDR_ACC = 4

          temp = this.REG_ACC;
          add = this.F_CARRY;
          this.F_CARRY = (temp >> 7) & 1;
          temp = ((temp << 1) & 0xff) + add;
          this.REG_ACC = temp;
        } else {
          temp = this.load(addr);
          add = this.F_CARRY;
          this.F_CARRY = (temp >> 7) & 1;
          temp = ((temp << 1) & 0xff) + add;
          this.write(addr, temp);
        }
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        break;
      }
      case 40: {
        // *******
        // * ROR *
        // *******

        // Rotate one bit right
        if (addrMode === 4) {
          // ADDR_ACC = 4

          add = this.F_CARRY << 7;
          this.F_CARRY = this.REG_ACC & 1;
          temp = (this.REG_ACC >> 1) + add;
          this.REG_ACC = temp;
        } else {
          temp = this.load(addr);
          add = this.F_CARRY << 7;
          this.F_CARRY = temp & 1;
          temp = (temp >> 1) + add;
          this.write(addr, temp);
        }
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        break;
      }
      case 41: {
        // *******
        // * RTI *
        // *******

        // Return from interrupt. Pull status and PC from stack.

        temp = this.pull();
        this.F_CARRY = temp & 1;
        this.F_ZERO = ((temp >> 1) & 1) === 0 ? 1 : 0;
        this.F_INTERRUPT = (temp >> 2) & 1;
        this.F_DECIMAL = (temp >> 3) & 1;
        this.F_BRK = (temp >> 4) & 1;
        this.F_NOTUSED = (temp >> 5) & 1;
        this.F_OVERFLOW = (temp >> 6) & 1;
        this.F_SIGN = (temp >> 7) & 1;

        this.REG_PC = this.pull();
        this.REG_PC += this.pull() << 8;
        if (this.REG_PC === 0xffff) {
          return;
        }
        this.REG_PC--;
        this.F_NOTUSED = 1;
        break;
      }
      case 42: {
        // *******
        // * RTS *
        // *******

        // Return from subroutine. Pull PC from stack.

        this.REG_PC = this.pull();
        this.REG_PC += this.pull() << 8;

        if (this.REG_PC === 0xffff) {
          return; // return from NSF play routine:
        }
        break;
      }
      case 43: {
        // *******
        // * SBC *
        // *******

        temp = this.REG_ACC - this.load(addr) - (1 - this.F_CARRY);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        if (
          ((this.REG_ACC ^ temp) & 0x80) !== 0 &&
          ((this.REG_ACC ^ this.load(addr)) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp < 0 ? 0 : 1;
        this.REG_ACC = temp & 0xff;
        if (addrMode !== 11) cycleCount += cycleAdd; // PostIdxInd = 11
        break;
      }
      case 44: {
        // *******
        // * SEC *
        // *******

        // Set carry flag
        this.F_CARRY = 1;
        break;
      }
      case 45: {
        // *******
        // * SED *
        // *******

        // Set decimal mode
        this.F_DECIMAL = 1;
        break;
      }
      case 46: {
        // *******
        // * SEI *
        // *******

        // Set interrupt disable status
        this.F_INTERRUPT = 1;
        break;
      }
      case 47: {
        // *******
        // * STA *
        // *******

        // Store accumulator in memory
        this.write(addr, this.REG_ACC);
        break;
      }
      case 48: {
        // *******
        // * STX *
        // *******

        // Store index X in memory
        this.write(addr, this.REG_X);
        break;
      }
      case 49: {
        // *******
        // * STY *
        // *******

        // Store index Y in memory:
        this.write(addr, this.REG_Y);
        break;
      }
      case 50: {
        // *******
        // * TAX *
        // *******

        // Transfer accumulator to index X:
        this.REG_X = this.REG_ACC;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 51: {
        // *******
        // * TAY *
        // *******

        // Transfer accumulator to index Y:
        this.REG_Y = this.REG_ACC;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 52: {
        // *******
        // * TSX *
        // *******

        // Transfer stack pointer to index X:
        this.REG_X = this.REG_SP - 0x0100;
        this.F_SIGN = (this.REG_SP >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      }
      case 53: {
        // *******
        // * TXA *
        // *******

        // Transfer index X to accumulator:
        this.REG_ACC = this.REG_X;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      }
      case 54: {
        // *******
        // * TXS *
        // *******

        // Transfer index X to stack pointer:
        this.REG_SP = this.REG_X + 0x0100;
        this.stackWrap();
        break;
      }
      case 55: {
        // *******
        // * TYA *
        // *******

        // Transfer index Y to accumulator:
        this.REG_ACC = this.REG_Y;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        break;
      }
      case 56: {
        // *******
        // * ALR *
        // *******

        // Shift right one bit after ANDing:
        temp = this.REG_ACC & this.load(addr);
        this.F_CARRY = temp & 1;
        this.REG_ACC = this.F_ZERO = temp >> 1;
        this.F_SIGN = 0;
        break;
      }
      case 57: {
        // *******
        // * ANC *
        // *******

        // AND accumulator, setting carry to bit 7 result.
        this.REG_ACC = this.F_ZERO = this.REG_ACC & this.load(addr);
        this.F_CARRY = this.F_SIGN = (this.REG_ACC >> 7) & 1;
        break;
      }
      case 58: {
        // *******
        // * ARR *
        // *******

        // Rotate right one bit after ANDing:
        temp = this.REG_ACC & this.load(addr);
        this.REG_ACC = this.F_ZERO = (temp >> 1) + (this.F_CARRY << 7);
        this.F_SIGN = this.F_CARRY;
        this.F_CARRY = (temp >> 7) & 1;
        this.F_OVERFLOW = ((temp >> 7) ^ (temp >> 6)) & 1;
        break;
      }
      case 59: {
        // *******
        // * AXS *
        // *******

        // Set X to (X AND A) - value.
        temp = (this.REG_X & this.REG_ACC) - this.load(addr);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        if (
          ((this.REG_X ^ temp) & 0x80) !== 0 &&
          ((this.REG_X ^ this.load(addr)) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp < 0 ? 0 : 1;
        this.REG_X = temp & 0xff;
        break;
      }
      case 60: {
        // *******
        // * LAX *
        // *******

        // Load A and X with memory:
        this.REG_ACC = this.REG_X = this.F_ZERO = this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        cycleCount += cycleAdd;
        break;
      }
      case 61: {
        // *******
        // * SAX *
        // *******

        // Store A AND X in memory:
        this.write(addr, this.REG_ACC & this.REG_X);
        break;
      }
      case 62: {
        // *******
        // * DCP *
        // *******

        // Decrement memory by one:
        temp = (this.load(addr) - 1) & 0xff;
        this.write(addr, temp);

        // Then compare with the accumulator:
        temp = this.REG_ACC - temp;
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        if (addrMode !== 11) cycleCount += cycleAdd; // PostIdxInd = 11
        break;
      }
      case 63: {
        // *******
        // * ISC *
        // *******

        // Increment memory by one:
        temp = (this.load(addr) + 1) & 0xff;
        this.write(addr, temp);

        // Then subtract from the accumulator:
        temp = this.REG_ACC - temp - (1 - this.F_CARRY);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        if (
          ((this.REG_ACC ^ temp) & 0x80) !== 0 &&
          ((this.REG_ACC ^ this.load(addr)) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp < 0 ? 0 : 1;
        this.REG_ACC = temp & 0xff;
        if (addrMode !== 11) cycleCount += cycleAdd; // PostIdxInd = 11
        break;
      }
      case 64: {
        // *******
        // * RLA *
        // *******

        // Rotate one bit left
        temp = this.load(addr);
        add = this.F_CARRY;
        this.F_CARRY = (temp >> 7) & 1;
        temp = ((temp << 1) & 0xff) + add;
        this.write(addr, temp);

        // Then AND with the accumulator.
        this.REG_ACC = this.REG_ACC & temp;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        if (addrMode !== 11) cycleCount += cycleAdd; // PostIdxInd = 11
        break;
      }
      case 65: {
        // *******
        // * RRA *
        // *******

        // Rotate one bit right
        temp = this.load(addr);
        add = this.F_CARRY << 7;
        this.F_CARRY = temp & 1;
        temp = (temp >> 1) + add;
        this.write(addr, temp);

        // Then add to the accumulator
        temp = this.REG_ACC + this.load(addr) + this.F_CARRY;

        if (
          ((this.REG_ACC ^ this.load(addr)) & 0x80) === 0 &&
          ((this.REG_ACC ^ temp) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp > 255 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        this.REG_ACC = temp & 255;
        if (addrMode !== 11) cycleCount += cycleAdd; // PostIdxInd = 11
        break;
      }
      case 66: {
        // *******
        // * SLO *
        // *******

        // Shift one bit left
        temp = this.load(addr);
        this.F_CARRY = (temp >> 7) & 1;
        temp = (temp << 1) & 255;
        this.write(addr, temp);

        // Then OR with the accumulator.
        this.REG_ACC = this.REG_ACC | temp;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        if (addrMode !== 11) cycleCount += cycleAdd; // PostIdxInd = 11
        break;
      }
      case 67: {
        // *******
        // * SRE *
        // *******

        // Shift one bit right
        temp = this.load(addr) & 0xff;
        this.F_CARRY = temp & 1;
        temp >>= 1;
        this.write(addr, temp);

        // Then XOR with the accumulator.
        this.REG_ACC = this.REG_ACC ^ temp;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        if (addrMode !== 11) cycleCount += cycleAdd; // PostIdxInd = 11
        break;
      }
      case 68: {
        // *******
        // * SKB *
        // *******

        // Do nothing
        break;
      }
      case 69: {
        // *******
        // * IGN *
        // *******

        // Do nothing but load.
        // TODO: Properly implement the double-reads.
        this.load(addr);
        if (addrMode !== 11) cycleCount += cycleAdd; // PostIdxInd = 11
        break;
      }

      default: {
        // *******
        // * ??? *
        // *******

        this.nes.stop();
        this.nes.crashMessage =
          "Game crashed, invalid opcode at address $" + opaddr.toString(16);
        break;
      }
    } // end of switch

    return cycleCount;
  },

  load: function (addr) {
    if (addr < 0x2000) {
      return this.mem[addr & 0x7ff];
    } else {
      return this.nes.mmap.load(addr);
    }
  },

  load16bit: function (addr) {
    if (addr < 0x1fff) {
      return this.mem[addr & 0x7ff] | (this.mem[(addr + 1) & 0x7ff] << 8);
    } else {
      return this.nes.mmap.load(addr) | (this.nes.mmap.load(addr + 1) << 8);
    }
  },

  write: function (addr, val) {
    if (addr < 0x2000) {
      this.mem[addr & 0x7ff] = val;
    } else {
      this.nes.mmap.write(addr, val);
    }
  },

  requestIrq: function (type) {
    if (this.irqRequested) {
      if (type === this.IRQ_NORMAL) {
        return;
      }
      // console.log("too fast irqs. type="+type);
    }
    this.irqRequested = true;
    this.irqType = type;
  },

  push: function (value) {
    this.nes.mmap.write(this.REG_SP, value);
    this.REG_SP--;
    this.REG_SP = 0x0100 | (this.REG_SP & 0xff);
  },

  stackWrap: function () {
    this.REG_SP = 0x0100 | (this.REG_SP & 0xff);
  },

  pull: function () {
    this.REG_SP++;
    this.REG_SP = 0x0100 | (this.REG_SP & 0xff);
    return this.nes.mmap.load(this.REG_SP);
  },

  pageCrossed: function (addr1, addr2) {
    return (addr1 & 0xff00) !== (addr2 & 0xff00);
  },

  haltCycles: function (cycles) {
    this.cyclesToHalt += cycles;
  },

  doNonMaskableInterrupt: function (status) {
    if ((this.nes.mmap.load(0x2000) & 128) !== 0) {
      // Check whether VBlank Interrupts are enabled

      this.REG_PC_NEW++;
      this.push((this.REG_PC_NEW >> 8) & 0xff);
      this.push(this.REG_PC_NEW & 0xff);
      //this.F_INTERRUPT_NEW = 1;
      this.push(status);

      this.REG_PC_NEW =
        this.nes.mmap.load(0xfffa) | (this.nes.mmap.load(0xfffb) << 8);
      this.REG_PC_NEW--;
    }
  },

  doResetInterrupt: function () {
    this.REG_PC_NEW =
      this.nes.mmap.load(0xfffc) | (this.nes.mmap.load(0xfffd) << 8);
    this.REG_PC_NEW--;
  },

  doIrq: function (status) {
    this.REG_PC_NEW++;
    this.push((this.REG_PC_NEW >> 8) & 0xff);
    this.push(this.REG_PC_NEW & 0xff);
    this.push(status);
    this.F_INTERRUPT_NEW = 1;
    this.F_BRK_NEW = 0;

    this.REG_PC_NEW =
      this.nes.mmap.load(0xfffe) | (this.nes.mmap.load(0xffff) << 8);
    this.REG_PC_NEW--;
  },

  getStatus: function () {
    return (
      this.F_CARRY |
      (this.F_ZERO << 1) |
      (this.F_INTERRUPT << 2) |
      (this.F_DECIMAL << 3) |
      (this.F_BRK << 4) |
      (this.F_NOTUSED << 5) |
      (this.F_OVERFLOW << 6) |
      (this.F_SIGN << 7)
    );
  },

  setStatus: function (st) {
    this.F_CARRY = st & 1;
    this.F_ZERO = (st >> 1) & 1;
    this.F_INTERRUPT = (st >> 2) & 1;
    this.F_DECIMAL = (st >> 3) & 1;
    this.F_BRK = (st >> 4) & 1;
    this.F_NOTUSED = (st >> 5) & 1;
    this.F_OVERFLOW = (st >> 6) & 1;
    this.F_SIGN = (st >> 7) & 1;
  },

  JSON_PROPERTIES: [
    "mem",
    "cyclesToHalt",
    "irqRequested",
    "irqType",
    // Registers
    "REG_ACC",
    "REG_X",
    "REG_Y",
    "REG_SP",
    "REG_PC",
    "REG_PC_NEW",
    "REG_STATUS",
    // Status
    "F_CARRY",
    "F_DECIMAL",
    "F_INTERRUPT",
    "F_INTERRUPT_NEW",
    "F_OVERFLOW",
    "F_SIGN",
    "F_ZERO",
    "F_NOTUSED",
    "F_NOTUSED_NEW",
    "F_BRK",
    "F_BRK_NEW",
  ],

  toJSON: function () {
    return utils.toJSON(this);
  },

  fromJSON: function (s) {
    utils.fromJSON(this, s);
  },
};

// Generates and provides an array of details about instructions
var OpData = function () {
  this.opdata = new Array(256);

  // Set all to invalid instruction (to detect crashes):
  for (var i = 0; i < 256; i++) this.opdata[i] = 0xff;

  // Now fill in all valid opcodes:

  // ADC:
  this.setOp(this.INS_ADC, 0x69, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_ADC, 0x65, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_ADC, 0x75, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_ADC, 0x6d, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_ADC, 0x7d, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_ADC, 0x79, this.ADDR_ABSY, 3, 4);
  this.setOp(this.INS_ADC, 0x61, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_ADC, 0x71, this.ADDR_POSTIDXIND, 2, 5);

  // AND:
  this.setOp(this.INS_AND, 0x29, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_AND, 0x25, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_AND, 0x35, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_AND, 0x2d, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_AND, 0x3d, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_AND, 0x39, this.ADDR_ABSY, 3, 4);
  this.setOp(this.INS_AND, 0x21, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_AND, 0x31, this.ADDR_POSTIDXIND, 2, 5);

  // ASL:
  this.setOp(this.INS_ASL, 0x0a, this.ADDR_ACC, 1, 2);
  this.setOp(this.INS_ASL, 0x06, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_ASL, 0x16, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_ASL, 0x0e, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_ASL, 0x1e, this.ADDR_ABSX, 3, 7);

  // BCC:
  this.setOp(this.INS_BCC, 0x90, this.ADDR_REL, 2, 2);

  // BCS:
  this.setOp(this.INS_BCS, 0xb0, this.ADDR_REL, 2, 2);

  // BEQ:
  this.setOp(this.INS_BEQ, 0xf0, this.ADDR_REL, 2, 2);

  // BIT:
  this.setOp(this.INS_BIT, 0x24, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_BIT, 0x2c, this.ADDR_ABS, 3, 4);

  // BMI:
  this.setOp(this.INS_BMI, 0x30, this.ADDR_REL, 2, 2);

  // BNE:
  this.setOp(this.INS_BNE, 0xd0, this.ADDR_REL, 2, 2);

  // BPL:
  this.setOp(this.INS_BPL, 0x10, this.ADDR_REL, 2, 2);

  // BRK:
  this.setOp(this.INS_BRK, 0x00, this.ADDR_IMP, 1, 7);

  // BVC:
  this.setOp(this.INS_BVC, 0x50, this.ADDR_REL, 2, 2);

  // BVS:
  this.setOp(this.INS_BVS, 0x70, this.ADDR_REL, 2, 2);

  // CLC:
  this.setOp(this.INS_CLC, 0x18, this.ADDR_IMP, 1, 2);

  // CLD:
  this.setOp(this.INS_CLD, 0xd8, this.ADDR_IMP, 1, 2);

  // CLI:
  this.setOp(this.INS_CLI, 0x58, this.ADDR_IMP, 1, 2);

  // CLV:
  this.setOp(this.INS_CLV, 0xb8, this.ADDR_IMP, 1, 2);

  // CMP:
  this.setOp(this.INS_CMP, 0xc9, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_CMP, 0xc5, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_CMP, 0xd5, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_CMP, 0xcd, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_CMP, 0xdd, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_CMP, 0xd9, this.ADDR_ABSY, 3, 4);
  this.setOp(this.INS_CMP, 0xc1, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_CMP, 0xd1, this.ADDR_POSTIDXIND, 2, 5);

  // CPX:
  this.setOp(this.INS_CPX, 0xe0, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_CPX, 0xe4, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_CPX, 0xec, this.ADDR_ABS, 3, 4);

  // CPY:
  this.setOp(this.INS_CPY, 0xc0, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_CPY, 0xc4, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_CPY, 0xcc, this.ADDR_ABS, 3, 4);

  // DEC:
  this.setOp(this.INS_DEC, 0xc6, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_DEC, 0xd6, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_DEC, 0xce, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_DEC, 0xde, this.ADDR_ABSX, 3, 7);

  // DEX:
  this.setOp(this.INS_DEX, 0xca, this.ADDR_IMP, 1, 2);

  // DEY:
  this.setOp(this.INS_DEY, 0x88, this.ADDR_IMP, 1, 2);

  // EOR:
  this.setOp(this.INS_EOR, 0x49, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_EOR, 0x45, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_EOR, 0x55, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_EOR, 0x4d, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_EOR, 0x5d, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_EOR, 0x59, this.ADDR_ABSY, 3, 4);
  this.setOp(this.INS_EOR, 0x41, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_EOR, 0x51, this.ADDR_POSTIDXIND, 2, 5);

  // INC:
  this.setOp(this.INS_INC, 0xe6, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_INC, 0xf6, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_INC, 0xee, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_INC, 0xfe, this.ADDR_ABSX, 3, 7);

  // INX:
  this.setOp(this.INS_INX, 0xe8, this.ADDR_IMP, 1, 2);

  // INY:
  this.setOp(this.INS_INY, 0xc8, this.ADDR_IMP, 1, 2);

  // JMP:
  this.setOp(this.INS_JMP, 0x4c, this.ADDR_ABS, 3, 3);
  this.setOp(this.INS_JMP, 0x6c, this.ADDR_INDABS, 3, 5);

  // JSR:
  this.setOp(this.INS_JSR, 0x20, this.ADDR_ABS, 3, 6);

  // LDA:
  this.setOp(this.INS_LDA, 0xa9, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_LDA, 0xa5, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_LDA, 0xb5, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_LDA, 0xad, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_LDA, 0xbd, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_LDA, 0xb9, this.ADDR_ABSY, 3, 4);
  this.setOp(this.INS_LDA, 0xa1, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_LDA, 0xb1, this.ADDR_POSTIDXIND, 2, 5);

  // LDX:
  this.setOp(this.INS_LDX, 0xa2, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_LDX, 0xa6, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_LDX, 0xb6, this.ADDR_ZPY, 2, 4);
  this.setOp(this.INS_LDX, 0xae, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_LDX, 0xbe, this.ADDR_ABSY, 3, 4);

  // LDY:
  this.setOp(this.INS_LDY, 0xa0, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_LDY, 0xa4, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_LDY, 0xb4, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_LDY, 0xac, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_LDY, 0xbc, this.ADDR_ABSX, 3, 4);

  // LSR:
  this.setOp(this.INS_LSR, 0x4a, this.ADDR_ACC, 1, 2);
  this.setOp(this.INS_LSR, 0x46, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_LSR, 0x56, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_LSR, 0x4e, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_LSR, 0x5e, this.ADDR_ABSX, 3, 7);

  // NOP:
  this.setOp(this.INS_NOP, 0x1a, this.ADDR_IMP, 1, 2);
  this.setOp(this.INS_NOP, 0x3a, this.ADDR_IMP, 1, 2);
  this.setOp(this.INS_NOP, 0x5a, this.ADDR_IMP, 1, 2);
  this.setOp(this.INS_NOP, 0x7a, this.ADDR_IMP, 1, 2);
  this.setOp(this.INS_NOP, 0xda, this.ADDR_IMP, 1, 2);
  this.setOp(this.INS_NOP, 0xea, this.ADDR_IMP, 1, 2);
  this.setOp(this.INS_NOP, 0xfa, this.ADDR_IMP, 1, 2);

  // ORA:
  this.setOp(this.INS_ORA, 0x09, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_ORA, 0x05, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_ORA, 0x15, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_ORA, 0x0d, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_ORA, 0x1d, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_ORA, 0x19, this.ADDR_ABSY, 3, 4);
  this.setOp(this.INS_ORA, 0x01, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_ORA, 0x11, this.ADDR_POSTIDXIND, 2, 5);

  // PHA:
  this.setOp(this.INS_PHA, 0x48, this.ADDR_IMP, 1, 3);

  // PHP:
  this.setOp(this.INS_PHP, 0x08, this.ADDR_IMP, 1, 3);

  // PLA:
  this.setOp(this.INS_PLA, 0x68, this.ADDR_IMP, 1, 4);

  // PLP:
  this.setOp(this.INS_PLP, 0x28, this.ADDR_IMP, 1, 4);

  // ROL:
  this.setOp(this.INS_ROL, 0x2a, this.ADDR_ACC, 1, 2);
  this.setOp(this.INS_ROL, 0x26, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_ROL, 0x36, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_ROL, 0x2e, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_ROL, 0x3e, this.ADDR_ABSX, 3, 7);

  // ROR:
  this.setOp(this.INS_ROR, 0x6a, this.ADDR_ACC, 1, 2);
  this.setOp(this.INS_ROR, 0x66, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_ROR, 0x76, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_ROR, 0x6e, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_ROR, 0x7e, this.ADDR_ABSX, 3, 7);

  // RTI:
  this.setOp(this.INS_RTI, 0x40, this.ADDR_IMP, 1, 6);

  // RTS:
  this.setOp(this.INS_RTS, 0x60, this.ADDR_IMP, 1, 6);

  // SBC:
  this.setOp(this.INS_SBC, 0xe9, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_SBC, 0xe5, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_SBC, 0xf5, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_SBC, 0xed, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_SBC, 0xfd, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_SBC, 0xf9, this.ADDR_ABSY, 3, 4);
  this.setOp(this.INS_SBC, 0xe1, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_SBC, 0xf1, this.ADDR_POSTIDXIND, 2, 5);

  // SEC:
  this.setOp(this.INS_SEC, 0x38, this.ADDR_IMP, 1, 2);

  // SED:
  this.setOp(this.INS_SED, 0xf8, this.ADDR_IMP, 1, 2);

  // SEI:
  this.setOp(this.INS_SEI, 0x78, this.ADDR_IMP, 1, 2);

  // STA:
  this.setOp(this.INS_STA, 0x85, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_STA, 0x95, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_STA, 0x8d, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_STA, 0x9d, this.ADDR_ABSX, 3, 5);
  this.setOp(this.INS_STA, 0x99, this.ADDR_ABSY, 3, 5);
  this.setOp(this.INS_STA, 0x81, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_STA, 0x91, this.ADDR_POSTIDXIND, 2, 6);

  // STX:
  this.setOp(this.INS_STX, 0x86, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_STX, 0x96, this.ADDR_ZPY, 2, 4);
  this.setOp(this.INS_STX, 0x8e, this.ADDR_ABS, 3, 4);

  // STY:
  this.setOp(this.INS_STY, 0x84, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_STY, 0x94, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_STY, 0x8c, this.ADDR_ABS, 3, 4);

  // TAX:
  this.setOp(this.INS_TAX, 0xaa, this.ADDR_IMP, 1, 2);

  // TAY:
  this.setOp(this.INS_TAY, 0xa8, this.ADDR_IMP, 1, 2);

  // TSX:
  this.setOp(this.INS_TSX, 0xba, this.ADDR_IMP, 1, 2);

  // TXA:
  this.setOp(this.INS_TXA, 0x8a, this.ADDR_IMP, 1, 2);

  // TXS:
  this.setOp(this.INS_TXS, 0x9a, this.ADDR_IMP, 1, 2);

  // TYA:
  this.setOp(this.INS_TYA, 0x98, this.ADDR_IMP, 1, 2);

  // ALR:
  this.setOp(this.INS_ALR, 0x4b, this.ADDR_IMM, 2, 2);

  // ANC:
  this.setOp(this.INS_ANC, 0x0b, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_ANC, 0x2b, this.ADDR_IMM, 2, 2);

  // ARR:
  this.setOp(this.INS_ARR, 0x6b, this.ADDR_IMM, 2, 2);

  // AXS:
  this.setOp(this.INS_AXS, 0xcb, this.ADDR_IMM, 2, 2);

  // LAX:
  this.setOp(this.INS_LAX, 0xa3, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_LAX, 0xa7, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_LAX, 0xaf, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_LAX, 0xb3, this.ADDR_POSTIDXIND, 2, 5);
  this.setOp(this.INS_LAX, 0xb7, this.ADDR_ZPY, 2, 4);
  this.setOp(this.INS_LAX, 0xbf, this.ADDR_ABSY, 3, 4);

  // SAX:
  this.setOp(this.INS_SAX, 0x83, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_SAX, 0x87, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_SAX, 0x8f, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_SAX, 0x97, this.ADDR_ZPY, 2, 4);

  // DCP:
  this.setOp(this.INS_DCP, 0xc3, this.ADDR_PREIDXIND, 2, 8);
  this.setOp(this.INS_DCP, 0xc7, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_DCP, 0xcf, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_DCP, 0xd3, this.ADDR_POSTIDXIND, 2, 8);
  this.setOp(this.INS_DCP, 0xd7, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_DCP, 0xdb, this.ADDR_ABSY, 3, 7);
  this.setOp(this.INS_DCP, 0xdf, this.ADDR_ABSX, 3, 7);

  // ISC:
  this.setOp(this.INS_ISC, 0xe3, this.ADDR_PREIDXIND, 2, 8);
  this.setOp(this.INS_ISC, 0xe7, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_ISC, 0xef, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_ISC, 0xf3, this.ADDR_POSTIDXIND, 2, 8);
  this.setOp(this.INS_ISC, 0xf7, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_ISC, 0xfb, this.ADDR_ABSY, 3, 7);
  this.setOp(this.INS_ISC, 0xff, this.ADDR_ABSX, 3, 7);

  // RLA:
  this.setOp(this.INS_RLA, 0x23, this.ADDR_PREIDXIND, 2, 8);
  this.setOp(this.INS_RLA, 0x27, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_RLA, 0x2f, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_RLA, 0x33, this.ADDR_POSTIDXIND, 2, 8);
  this.setOp(this.INS_RLA, 0x37, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_RLA, 0x3b, this.ADDR_ABSY, 3, 7);
  this.setOp(this.INS_RLA, 0x3f, this.ADDR_ABSX, 3, 7);

  // RRA:
  this.setOp(this.INS_RRA, 0x63, this.ADDR_PREIDXIND, 2, 8);
  this.setOp(this.INS_RRA, 0x67, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_RRA, 0x6f, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_RRA, 0x73, this.ADDR_POSTIDXIND, 2, 8);
  this.setOp(this.INS_RRA, 0x77, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_RRA, 0x7b, this.ADDR_ABSY, 3, 7);
  this.setOp(this.INS_RRA, 0x7f, this.ADDR_ABSX, 3, 7);

  // SLO:
  this.setOp(this.INS_SLO, 0x03, this.ADDR_PREIDXIND, 2, 8);
  this.setOp(this.INS_SLO, 0x07, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_SLO, 0x0f, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_SLO, 0x13, this.ADDR_POSTIDXIND, 2, 8);
  this.setOp(this.INS_SLO, 0x17, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_SLO, 0x1b, this.ADDR_ABSY, 3, 7);
  this.setOp(this.INS_SLO, 0x1f, this.ADDR_ABSX, 3, 7);

  // SRE:
  this.setOp(this.INS_SRE, 0x43, this.ADDR_PREIDXIND, 2, 8);
  this.setOp(this.INS_SRE, 0x47, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_SRE, 0x4f, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_SRE, 0x53, this.ADDR_POSTIDXIND, 2, 8);
  this.setOp(this.INS_SRE, 0x57, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_SRE, 0x5b, this.ADDR_ABSY, 3, 7);
  this.setOp(this.INS_SRE, 0x5f, this.ADDR_ABSX, 3, 7);

  // SKB:
  this.setOp(this.INS_SKB, 0x80, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_SKB, 0x82, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_SKB, 0x89, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_SKB, 0xc2, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_SKB, 0xe2, this.ADDR_IMM, 2, 2);

  // SKB:
  this.setOp(this.INS_IGN, 0x0c, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_IGN, 0x1c, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_IGN, 0x3c, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_IGN, 0x5c, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_IGN, 0x7c, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_IGN, 0xdc, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_IGN, 0xfc, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_IGN, 0x04, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_IGN, 0x44, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_IGN, 0x64, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_IGN, 0x14, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_IGN, 0x34, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_IGN, 0x54, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_IGN, 0x74, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_IGN, 0xd4, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_IGN, 0xf4, this.ADDR_ZPX, 2, 4);

  // prettier-ignore
  this.cycTable = new Array(
    /*0x00*/ 7,6,2,8,3,3,5,5,3,2,2,2,4,4,6,6,
    /*0x10*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    /*0x20*/ 6,6,2,8,3,3,5,5,4,2,2,2,4,4,6,6,
    /*0x30*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    /*0x40*/ 6,6,2,8,3,3,5,5,3,2,2,2,3,4,6,6,
    /*0x50*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    /*0x60*/ 6,6,2,8,3,3,5,5,4,2,2,2,5,4,6,6,
    /*0x70*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    /*0x80*/ 2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,
    /*0x90*/ 2,6,2,6,4,4,4,4,2,5,2,5,5,5,5,5,
    /*0xA0*/ 2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,
    /*0xB0*/ 2,5,2,5,4,4,4,4,2,4,2,4,4,4,4,4,
    /*0xC0*/ 2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6,
    /*0xD0*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    /*0xE0*/ 2,6,3,8,3,3,5,5,2,2,2,2,4,4,6,6,
    /*0xF0*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7
  );

  this.instname = new Array(70);

  // Instruction Names:
  this.instname[0] = "ADC";
  this.instname[1] = "AND";
  this.instname[2] = "ASL";
  this.instname[3] = "BCC";
  this.instname[4] = "BCS";
  this.instname[5] = "BEQ";
  this.instname[6] = "BIT";
  this.instname[7] = "BMI";
  this.instname[8] = "BNE";
  this.instname[9] = "BPL";
  this.instname[10] = "BRK";
  this.instname[11] = "BVC";
  this.instname[12] = "BVS";
  this.instname[13] = "CLC";
  this.instname[14] = "CLD";
  this.instname[15] = "CLI";
  this.instname[16] = "CLV";
  this.instname[17] = "CMP";
  this.instname[18] = "CPX";
  this.instname[19] = "CPY";
  this.instname[20] = "DEC";
  this.instname[21] = "DEX";
  this.instname[22] = "DEY";
  this.instname[23] = "EOR";
  this.instname[24] = "INC";
  this.instname[25] = "INX";
  this.instname[26] = "INY";
  this.instname[27] = "JMP";
  this.instname[28] = "JSR";
  this.instname[29] = "LDA";
  this.instname[30] = "LDX";
  this.instname[31] = "LDY";
  this.instname[32] = "LSR";
  this.instname[33] = "NOP";
  this.instname[34] = "ORA";
  this.instname[35] = "PHA";
  this.instname[36] = "PHP";
  this.instname[37] = "PLA";
  this.instname[38] = "PLP";
  this.instname[39] = "ROL";
  this.instname[40] = "ROR";
  this.instname[41] = "RTI";
  this.instname[42] = "RTS";
  this.instname[43] = "SBC";
  this.instname[44] = "SEC";
  this.instname[45] = "SED";
  this.instname[46] = "SEI";
  this.instname[47] = "STA";
  this.instname[48] = "STX";
  this.instname[49] = "STY";
  this.instname[50] = "TAX";
  this.instname[51] = "TAY";
  this.instname[52] = "TSX";
  this.instname[53] = "TXA";
  this.instname[54] = "TXS";
  this.instname[55] = "TYA";
  this.instname[56] = "ALR";
  this.instname[57] = "ANC";
  this.instname[58] = "ARR";
  this.instname[59] = "AXS";
  this.instname[60] = "LAX";
  this.instname[61] = "SAX";
  this.instname[62] = "DCP";
  this.instname[63] = "ISC";
  this.instname[64] = "RLA";
  this.instname[65] = "RRA";
  this.instname[66] = "SLO";
  this.instname[67] = "SRE";
  this.instname[68] = "SKB";
  this.instname[69] = "IGN";

  this.addrDesc = new Array(
    "Zero Page           ",
    "Relative            ",
    "Implied             ",
    "Absolute            ",
    "Accumulator         ",
    "Immediate           ",
    "Zero Page,X         ",
    "Zero Page,Y         ",
    "Absolute,X          ",
    "Absolute,Y          ",
    "Preindexed Indirect ",
    "Postindexed Indirect",
    "Indirect Absolute   "
  );
};

OpData.prototype = {
  INS_ADC: 0,
  INS_AND: 1,
  INS_ASL: 2,

  INS_BCC: 3,
  INS_BCS: 4,
  INS_BEQ: 5,
  INS_BIT: 6,
  INS_BMI: 7,
  INS_BNE: 8,
  INS_BPL: 9,
  INS_BRK: 10,
  INS_BVC: 11,
  INS_BVS: 12,

  INS_CLC: 13,
  INS_CLD: 14,
  INS_CLI: 15,
  INS_CLV: 16,
  INS_CMP: 17,
  INS_CPX: 18,
  INS_CPY: 19,

  INS_DEC: 20,
  INS_DEX: 21,
  INS_DEY: 22,

  INS_EOR: 23,

  INS_INC: 24,
  INS_INX: 25,
  INS_INY: 26,

  INS_JMP: 27,
  INS_JSR: 28,

  INS_LDA: 29,
  INS_LDX: 30,
  INS_LDY: 31,
  INS_LSR: 32,

  INS_NOP: 33,

  INS_ORA: 34,

  INS_PHA: 35,
  INS_PHP: 36,
  INS_PLA: 37,
  INS_PLP: 38,

  INS_ROL: 39,
  INS_ROR: 40,
  INS_RTI: 41,
  INS_RTS: 42,

  INS_SBC: 43,
  INS_SEC: 44,
  INS_SED: 45,
  INS_SEI: 46,
  INS_STA: 47,
  INS_STX: 48,
  INS_STY: 49,

  INS_TAX: 50,
  INS_TAY: 51,
  INS_TSX: 52,
  INS_TXA: 53,
  INS_TXS: 54,
  INS_TYA: 55,

  INS_ALR: 56,
  INS_ANC: 57,
  INS_ARR: 58,
  INS_AXS: 59,
  INS_LAX: 60,
  INS_SAX: 61,
  INS_DCP: 62,
  INS_ISC: 63,
  INS_RLA: 64,
  INS_RRA: 65,
  INS_SLO: 66,
  INS_SRE: 67,
  INS_SKB: 68,
  INS_IGN: 69,

  INS_DUMMY: 70, // dummy instruction used for 'halting' the processor some cycles

  // -------------------------------- //

  // Addressing modes:
  ADDR_ZP: 0,
  ADDR_REL: 1,
  ADDR_IMP: 2,
  ADDR_ABS: 3,
  ADDR_ACC: 4,
  ADDR_IMM: 5,
  ADDR_ZPX: 6,
  ADDR_ZPY: 7,
  ADDR_ABSX: 8,
  ADDR_ABSY: 9,
  ADDR_PREIDXIND: 10,
  ADDR_POSTIDXIND: 11,
  ADDR_INDABS: 12,

  setOp: function (inst, op, addr, size, cycles) {
    this.opdata[op] =
      (inst & 0xff) |
      ((addr & 0xff) << 8) |
      ((size & 0xff) << 16) |
      ((cycles & 0xff) << 24);
  },
};

module.exports = CPU;

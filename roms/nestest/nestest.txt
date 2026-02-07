                      The ultimate NES CPU test ROM
                      -----------------------------


V1.00 - 09/06/04

By: Kevin Horton


---


What it is:

This here is a pretty much all inclusive test suite for a NES CPU.
It was designed to test almost every combination of flags, instructions,
and registers.  Some of these tests are very difficult, and so far,
Nesten and Nesticle failed it.  Nintendulator passes, as does a real
NES (naturally).  I haven't tested it with any more emualtors yet.

I attempted to check the states of all flags after most instructions. 
For example, CPY and CMP shouldn't affect the overflow flag, while SBC
and ADC should.  Likewise, all forms of wrapping ARE tested for- zeropage
wrapping being the tests most emulators fail.  

i.e.

LDA #001h
LDA 0ffh,X   ;indexed zeropage read

should read the byte from 000h... NOT 0100h.   This is because zeropage
instructions cannot cross a page boundary.

---

How to work it good:

Simply run the .NES ROM on your emulator of choice.  You can select a single
test to run, or you can run ALL tests in sequence by selecting the
appropriate option.

Pressing Select will change pages and allow testing "invalid" opcodes.
Be aware that these will crash alot of emulators <cough>Nesten<cough>.

Once a test completes, the result will be "OK" if the test passes, or a
2 digit hex number which indicates a failure of some kind.  A list is
provided below for the failure and its cause.  For a more detailed reason
for the failure, you should check out the .ASM file included with this
document.

If the entire page of tests succeeds, "OK" will be displayed next to the
first entry on the page.  If one or more tests fails, "Er" will be displayed
instead.

---

NSF player testing:

This ROM is set up to be usable inside an NSF player.  It outputs the 
results of the test audially.  <to be finished>

---

Emulator authors:

This test program, when run on "automation", (i.e. set your program counter
to 0c000h) will perform all tests in sequence and shove the results of
the tests into locations 02h and 03h.  

---

Final notes:

The hex numbers shown on the screen (or stored in the above mentioned
memory locations) are of the LAST test that failed in the group tested. 
This means, there could be multiple failures in one or more groups.  This
wasn't the best solution, but since there are close to 400 tests performed,
any other way wouldn't have had acceptable memory usage.  So long as your
emulator bugs are fixed and the numbers are getting smaller, you're doing
good :-)


----------------------------------------

Test failure codes and what they mean:

(byte 02h only)

000h - tests completed successfully

branch tests
------------
001h - BCS failed to branch
002h - BCS branched when it shouldn't have
003h - BCC branched when it shouldn't have
004h - BCC failed to branch
005h - BEQ failed to branch
006h - BEQ branched when it shouldn't have
007h - BNE failed to branch
008h - BNE branched when it shouldn't have
009h - BVS failed to branch
00Ah - BVC branched when it shouldn't have
00Bh - BVC failed to branch
00Ch - BVS branched when it shouldn't have
00Dh - BPL failed to branch
00Eh - BPL branched when it shouldn't have
00Fh - BMI failed to branch
010h - BMI branched when it shouldn't have

flag tests
----------
011h - PHP/flags failure (bits set) 
012h - PHP/flags failure (bits clear)
013h - PHP/flags failure (misc bit states)
014h - PLP/flags failure (misc bit states)
015h - PLP/flags failure (misc bit states)
016h - PHA/PLA failure (PLA didn't affect Z and N properly)
017h - PHA/PLA failure (PLA didn't affect Z and N properly)

immediate instruction tests
---------------------------
018h - ORA # failure
019h - ORA # failure
01Ah - AND # failure
01Bh - AND # failure
01Ch - EOR # failure
01Dh - EOR # failure
01Eh - ADC # failure (overflow/carry problems)
01Fh - ADC # failure (decimal mode was turned on)
020h - ADC # failure
021h - ADC # failure
022h - ADC # failure
023h - LDA # failure (didn't set N and Z correctly)
024h - LDA # failure (didn't set N and Z correctly)
025h - CMP # failure (messed up flags)
026h - CMP # failure (messed up flags)
027h - CMP # failure (messed up flags)
028h - CMP # failure (messed up flags)
029h - CMP # failure (messed up flags)
02Ah - CMP # failure (messed up flags)
02Bh - CPY # failure (messed up flags)
02Ch - CPY # failure (messed up flags)
02Dh - CPY # failure (messed up flags)
02Eh - CPY # failure (messed up flags)
02Fh - CPY # failure (messed up flags)
030h - CPY # failure (messed up flags)
031h - CPY # failure (messed up flags)
032h - CPX # failure (messed up flags)
033h - CPX # failure (messed up flags)
034h - CPX # failure (messed up flags)
035h - CPX # failure (messed up flags)
036h - CPX # failure (messed up flags)
037h - CPX # failure (messed up flags)
038h - CPX # failure (messed up flags)
039h - LDX # failure (didn't set N and Z correctly)
03Ah - LDX # failure (didn't set N and Z correctly)
03Bh - LDY # failure (didn't set N and Z correctly)
03Ch - LDY # failure (didn't set N and Z correctly)
03Dh - compare(s) stored the result in a register (whoops!)
071h - SBC # failure
072h - SBC # failure
073h - SBC # failure
074h - SBC # failure
075h - SBC # failure


implied instruction tests
-------------------------
03Eh - INX/DEX/INY/DEY did something bad
03Fh - INY/DEY messed up overflow or carry
040h - INX/DEX messed up overflow or carry
041h - TAY did something bad (changed wrong regs, messed up flags)
042h - TAX did something bad (changed wrong regs, messed up flags)
043h - TYA did something bad (changed wrong regs, messed up flags)
044h - TXA did something bad (changed wrong regs, messed up flags)
045h - TXS didn't set flags right, or TSX touched flags and it shouldn't have

stack tests
-----------
046h - wrong data popped, or data not in right location on stack
047h - JSR didn't work as expected
048h - RTS/JSR shouldn't have affected flags
049h - RTI/RTS didn't work right when return addys/data were manually pushed

accumulator tests
-----------------
04Ah - LSR A  failed
04Bh - ASL A  failed
04Ch - ROR A  failed
04Dh - ROL A  failed

(indirect,x) tests
------------------
058h - LDA didn't load the data it expected to load
059h - STA didn't store the data where it was supposed to
05Ah - ORA failure
05Bh - ORA failure
05Ch - AND failure
05Dh - AND failure
05Eh - EOR failure
05Fh - EOR failure
060h - ADC failure
061h - ADC failure
062h - ADC failure
063h - ADC failure
064h - ADC failure
065h - CMP failure
066h - CMP failure
067h - CMP failure
068h - CMP failure
069h - CMP failure
06Ah - CMP failure
06Bh - CMP failure
06Ch - SBC failure
06Dh - SBC failure
06Eh - SBC failure
06Fh - SBC failure
070h - SBC failure

zeropage tests
--------------
076h - LDA didn't set the flags properly
077h - STA affected flags it shouldn't
078h - LDY didn't set the flags properly
079h - STY affected flags it shouldn't
07Ah - LDX didn't set the flags properly
07Bh - STX affected flags it shouldn't
07Ch - BIT failure
07Dh - BIT failure
07Eh - ORA failure
07Fh - ORA failure
080h - AND failure
081h - AND failure
082h - EOR failure
083h - EOR failure
084h - ADC failure
085h - ADC failure
086h - ADC failure
087h - ADC failure
088h - ADC failure
089h - CMP failure
08Ah - CMP failure
08Bh - CMP failure
08Ch - CMP failure
08Dh - CMP failure
08Eh - CMP failure
08Fh - CMP failure
090h - SBC failure
091h - SBC failure
092h - SBC failure
093h - SBC failure
094h - SBC failure
095h - CPX failure
096h - CPX failure
097h - CPX failure
098h - CPX failure
099h - CPX failure
09Ah - CPX failure
09Bh - CPX failure
09Ch - CPY failure
09Dh - CPY failure
09Eh - CPY failure
09Fh - CPY failure
0A0h - CPY failure
0A1h - CPY failure
0A2h - CPY failure
0A3h - LSR failure
0A4h - LSR failure
0A5h - ASL failure
0A6h - ASL failure
0A7h - ROL failure
0A8h - ROL failure
0A9h - ROR failure
0AAh - ROR failure
0ABh - INC failure
0ACh - INC failure
0ADh - DEC failure
0AEh - DEC failure
0AFh - DEC failure

Absolute tests
--------------
0B0h - LDA didn't set the flags properly
0B1h - STA affected flags it shouldn't
0B2h - LDY didn't set the flags properly
0B3h - STY affected flags it shouldn't
0B4h - LDX didn't set the flags properly
0B5h - STX affected flags it shouldn't
0B6h - BIT failure
0B7h - BIT failure
0B8h - ORA failure
0B9h - ORA failure
0BAh - AND failure
0BBh - AND failure
0BCh - EOR failure
0BDh - EOR failure
0BEh - ADC failure
0BFh - ADC failure
0C0h - ADC failure
0C1h - ADC failure
0C2h - ADC failure
0C3h - CMP failure
0C4h - CMP failure
0C5h - CMP failure
0C6h - CMP failure
0C7h - CMP failure
0C8h - CMP failure
0C9h - CMP failure
0CAh - SBC failure
0CBh - SBC failure
0CCh - SBC failure
0CDh - SBC failure
0CEh - SBC failure
0CFh - CPX failure
0D0h - CPX failure
0D1h - CPX failure
0D2h - CPX failure
0D3h - CPX failure
0D4h - CPX failure
0D5h - CPX failure
0D6h - CPY failure
0D7h - CPY failure
0D8h - CPY failure
0D9h - CPY failure
0DAh - CPY failure
0DBh - CPY failure
0DCh - CPY failure
0DDh - LSR failure
0DEh - LSR failure
0DFh - ASL failure
0E0h - ASL failure
0E1h - ROR failure
0E2h - ROR failure
0E3h - ROL failure
0E4h - ROL failure
0E5h - INC failure
0E6h - INC failure
0E7h - DEC failure
0E8h - DEC failure
0E9h - DEC failure

(indirect),y tests
------------------
0EAh - LDA didn't load what it was supposed to
0EBh - read location should've wrapped around ffffh to 0000h
0ECh - should've wrapped zeropage address
0EDh - ORA failure
0EEh - ORA failure
0EFh - AND failure
0F0h - AND failure
0F1h - EOR failure
0F2h - EOR failure
0F3h - ADC failure
0F4h - ADC failure
0F5h - ADC failure
0F6h - ADC failure
0F7h - ADC failure
0F8h - CMP failure
0F9h - CMP failure
0FAh - CMP failure
0FBh - CMP failure
0FCh - CMP failure
0FDh - CMP failure
0FEh - CMP failure

(error byte location 03h starts here)

000h - no error, all tests pass
001h - SBC failure
002h - SBC failure
003h - SBC failure
004h - SBC failure
005h - SBC failure
006h - STA failure
007h - JMP () data reading didn't wrap properly (this fails on a 65C02)

zeropage,x tests
----------------
008h - LDY,X failure
009h - LDY,X failure
00Ah - STY,X failure
00Bh - ORA failure
00Ch - ORA failure
00Dh - AND failure
00Eh - AND failure
00Fh - EOR failure
010h - EOR failure
011h - ADC failure
012h - ADC failure
013h - ADC failure
014h - ADC failure
015h - ADC failure
016h - CMP failure
017h - CMP failure
018h - CMP failure
019h - CMP failure
01Ah - CMP failure
01Bh - CMP failure
01Ch - CMP failure
01Dh - SBC failure
01Eh - SBC failure
01Fh - SBC failure
020h - SBC failure
021h - SBC failure
022h - LDA failure
023h - LDA failure
024h - STA failure
025h - LSR failure
026h - LSR failure
027h - ASL failure
028h - ASL failure
029h - ROR failure
02Ah - ROR failure
02Bh - ROL failure
02Ch - ROL failure
02Dh - INC failure
02Eh - INC failure
02Fh - DEC failure
030h - DEC failure
031h - DEC failure
032h - LDX,Y failure
033h - LDX,Y failure
034h - STX,Y failure
035h - STX,Y failure

absolute,y tests
----------------
036h - LDA failure
037h - LDA failure to wrap properly from ffffh to 0000h
038h - LDA failure, page cross
039h - ORA failure
03Ah - ORA failure
03Bh - AND failure
03Ch - AND failure
03Dh - EOR failure
03Eh - EOR failure
03Fh - ADC failure
040h - ADC failure
041h - ADC failure
042h - ADC failure
043h - ADC failure
044h - CMP failure
045h - CMP failure
046h - CMP failure
047h - CMP failure
048h - CMP failure
049h - CMP failure
04Ah - CMP failure
04Bh - SBC failure
04Ch - SBC failure
04Dh - SBC failure
04Eh - SBC failure
04Fh - SBC failure
050h - STA failure

absolute,x tests
----------------
051h - LDY,X failure
052h - LDY,X failure (didn't page cross)
053h - ORA failure
054h - ORA failure
055h - AND failure
056h - AND failure
057h - EOR failure
058h - EOR failure
059h - ADC failure
05Ah - ADC failure
05Bh - ADC failure
05Ch - ADC failure
05Dh - ADC failure
05Eh - CMP failure
05Fh - CMP failure
060h - CMP failure
061h - CMP failure
062h - CMP failure
063h - CMP failure
064h - CMP failure
065h - SBC failure
066h - SBC failure
067h - SBC failure
068h - SBC failure
069h - SBC failure
06Ah - LDA failure
06Bh - LDA failure (didn't page cross)
06Ch - STA failure
06Dh - LSR failure
06Eh - LSR failure
06Fh - ASL failure
070h - ASL failure
071h - ROR failure
072h - ROR failure
073h - ROL failure
074h - ROL failure
075h - INC failure
076h - INC failure
077h - DEC failure
078h - DEC failure
079h - DEC failure
07Ah - LDX,Y failure
07Bh - LDX,Y failure

------------------------------------

Invalid opcode tests... all errors are reported in byte 03h unless
specified.

NOP - "invalid" opcode tests (error byte 02h)
---------------------------------------------
04Eh - absolute,X NOPs less than 3 bytes long
04Fh - implied NOPs affects regs/flags
050h - ZP,X NOPs less than 2 bytes long
051h - absolute NOP less than 3 bytes long
052h - ZP NOPs less than 2 bytes long
053h - absolute,X NOPs less than 3 bytes long
054h - implied NOPs affects regs/flags
055h - ZP,X NOPs less than 2 bytes long
056h - absolute NOP less than 3 bytes long
057h - ZP NOPs less than 2 bytes long

LAX - "invalid" opcode tests
----------------------------
07Ch - LAX (indr,x) failure
07Dh - LAX (indr,x) failure
07Eh - LAX zeropage failure
07Fh - LAX zeropage failure
080h - LAX absolute failure
081h - LAX absolute failure
082h - LAX (indr),y failure
083h - LAX (indr),y failure
084h - LAX zp,y failure
085h - LAX zp,y failure
086h - LAX abs,y failure
087h - LAX abs,y failure

SAX - "invalid" opcode tests
----------------------------
088h - SAX (indr,x) failure
089h - SAX (indr,x) failure
08Ah - SAX zeropage failure
08Bh - SAX zeropage failure
08Ch - SAX absolute failure
08Dh - SAX absolute failure
08Eh - SAX zp,y failure
08Fh - SAX zp,y failure
 
SBC - "invalid" opcode test
---------------------------
090h - SBC failure
091h - SBC failure
092h - SBC failure
093h - SBC failure
094h - SBC failure

DCP - "invalid" opcode tests
----------------------------
095h - DCP (indr,x) failure
096h - DCP (indr,x) failure
097h - DCP (indr,x) failure
098h - DCP zeropage failure
099h - DCP zeropage failure
09Ah - DCP zeropage failure
09Bh - DCP absolute failure
09Ch - DCP absolute failure
09Dh - DCP absolute failure
09Eh - DCP (indr),y failure
09Fh - DCP (indr),y failure
0A0h - DCP (indr),y failure
0A1h - DCP zp,x failure
0A2h - DCP zp,x failure
0A3h - DCP zp,x failure
0A4h - DCP abs,y failure
0A5h - DCP abs,y failure
0A6h - DCP abs,y failure
0A7h - DCP abs,x failure
0A8h - DCP abs,x failure
0A9h - DCP abs,x failure

ISB - "invalid" opcode tests
----------------------------
0AAh - DCP (indr,x) failure
0ABh - DCP (indr,x) failure
0ACh - DCP (indr,x) failure
0ADh - DCP zeropage failure
0AEh - DCP zeropage failure
0AFh - DCP zeropage failure
0B0h - DCP absolute failure
0B1h - DCP absolute failure
0B2h - DCP absolute failure
0B3h - DCP (indr),y failure
0B4h - DCP (indr),y failure
0B5h - DCP (indr),y failure
0B6h - DCP zp,x failure
0B7h - DCP zp,x failure
0B8h - DCP zp,x failure
0B9h - DCP abs,y failure
0BAh - DCP abs,y failure
0BBh - DCP abs,y failure
0BCh - DCP abs,x failure
0BDh - DCP abs,x failure
0BEh - DCP abs,x failure

SLO - "invalid" opcode tests
----------------------------
0BFh - SLO (indr,x) failure
0C0h - SLO (indr,x) failure
0C1h - SLO (indr,x) failure
0C2h - SLO zeropage failure
0C3h - SLO zeropage failure
0C4h - SLO zeropage failure
0C5h - SLO absolute failure
0C6h - SLO absolute failure
0C7h - SLO absolute failure
0C8h - SLO (indr),y failure
0C9h - SLO (indr),y failure
0CAh - SLO (indr),y failure
0CBh - SLO zp,x failure
0CCh - SLO zp,x failure
0CDh - SLO zp,x failure
0CEh - SLO abs,y failure
0CFh - SLO abs,y failure
0D0h - SLO abs,y failure
0D1h - SLO abs,x failure
0D2h - SLO abs,x failure
0D3h - SLO abs,x failure

RLA - "invalid" opcode tests
----------------------------
0D4h - RLA (indr,x) failure
0D5h - RLA (indr,x) failure
0D6h - RLA (indr,x) failure
0D7h - RLA zeropage failure
0D8h - RLA zeropage failure
0D9h - RLA zeropage failure
0DAh - RLA absolute failure
0DBh - RLA absolute failure
0DCh - RLA absolute failure
0DDh - RLA (indr),y failure
0DEh - RLA (indr),y failure
0DFh - RLA (indr),y failure
0E0h - RLA zp,x failure
0E1h - RLA zp,x failure
0E2h - RLA zp,x failure
0E3h - RLA abs,y failure
0E4h - RLA abs,y failure
0E5h - RLA abs,y failure
0E6h - RLA abs,x failure
0E7h - RLA abs,x failure
0E8h - RLA abs,x failure

SRE - "invalid" opcode tests
----------------------------
0E8h - SRE (indr,x) failure
0EAh - SRE (indr,x) failure
0EBh - SRE (indr,x) failure
0ECh - SRE zeropage failure
0EDh - SRE zeropage failure
0EEh - SRE zeropage failure
0EFh - SRE absolute failure
0F0h - SRE absolute failure
0F1h - SRE absolute failure
0F2h - SRE (indr),y failure
0F3h - SRE (indr),y failure
0F4h - SRE (indr),y failure
0F5h - SRE zp,x failure
0F6h - SRE zp,x failure
0F7h - SRE zp,x failure
0F8h - SRE abs,y failure
0F9h - SRE abs,y failure
0FAh - SRE abs,y failure
0FBh - SRE abs,x failure
0FCh - SRE abs,x failure
0FDh - SRE abs,x failure


RRA - "invalid" opcode tests
----------------------------
001h - RRA (indr,x) failure
002h - RRA (indr,x) failure
003h - RRA (indr,x) failure
004h - RRA zeropage failure
005h - RRA zeropage failure
006h - RRA zeropage failure
007h - RRA absolute failure
008h - RRA absolute failure
009h - RRA absolute failure
00Ah - RRA (indr),y failure
00Bh - RRA (indr),y failure
00Ch - RRA (indr),y failure
00Dh - RRA zp,x failure
00Eh - RRA zp,x failure
00Fh - RRA zp,x failure
010h - RRA abs,y failure
011h - RRA abs,y failure
012h - RRA abs,y failure
013h - RRA abs,x failure
014h - RRA abs,x failure
015h - RRA abs,x failure








001h - 
002h - 
003h - 
004h - 
005h - 
006h - 
007h - 
008h - 
009h - 
00Ah - 
00Bh - 
00Ch - 
00Dh - 
00Eh - 
00Fh - 
010h - 


Todo:  check to see if decimal mode is missing on CPU

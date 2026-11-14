NES Double-Write Behavior Tests
----------------------------------
These tests verify that the CPU is doing double-writes properly.

Double-write is a side effect of the NES CPU when it is executing
a read-modify-write instruction: It first reads the original value,
then writes back the same value, and then writes the modified value.


For example, the cycle by cycle listing of an absolute-addressing
instruction such as INC is as follows
(from 65doc.txt by John West and Marko Mäkelä):

     Read-Modify-Write instructions (ASL, LSR, ROL, ROR, INC, DEC,
                                     SLO, SRE, RLA, RRA, ISB, DCP)

        #  address R/W description
       --- ------- --- ------------------------------------------
        1    PC     R  fetch opcode, increment PC
        2    PC     R  fetch low byte of address, increment PC
        3    PC     R  fetch high byte of address, increment PC
        4  address  R  read from effective address
        5  address  W  write the value back to effective address,
                       and do the operation on it
        6  address  W  write the new value to effective address


Two sets of tests are provided:
One that uses OAM data ($2004) for testing, and one that
uses PPU memory ($2007).

The OAM data testing is only valid on emulators. The actual NES console
fails the test, because the OAM read port is not reliable on the real
console.

The PPUMEM test can be used on emulators and on the real NES.

The PPUMEM test requires that the emulator implements open bus behavior
properly. Without open bus behavior the testing will not work as expected.
Because of that, an extensive set of tests is first performed for
the open bus behavior.

Tests in the OAM version:

	 #2: OAM reading is too unreliable.
	 #3: Writes to OAM should automatically increment SPRADDR
	 #4: Reads from OAM should not automatically increment SPRADDR
	 #5: Some opcodes failed the test.
	 #6: OAM reads are unreliable.
	 #7: ROM should not be writable.

Fail codes #2 and #6 are basically the same thing, except #2 is
given if #5 also fails. If #5 passes, but the OAM read test
failed, #6 is given instead.

Expected output in the OAM version:
	TEST: cpu_dummy_writes_oam
	This program verifies that the
	CPU does 2x writes properly.
	Any read-modify-write opcode
	should first write the origi-
	nal value; then the calculated
	value exactly 1 cycle later.

	Requirement: OAM memory reads
	MUST be reliable. This is
	often the case on emulators,
	but NOT on the real NES.
	Nevertheless, this test can be
	used to see if the CPU in the
	emulator is built properly.

	Testing OAM.  The screen will go blank for a moment now.
	OK; Verifying opcodes...
	0E2E4E6ECEEE 1E3E5E7EDEFE 
	0F2F4F6FCFEF 1F3F5F7FDFFF 
	03234363C3E3 13335373D3F3 
	1B3B5B7BDBFB              

	Passed

Tests in the PPUMEM version:

	#2: Non-palette PPU memory reads should have one-byte buffer
	#3: A single write to $2005 must not change the address used by $2007 when vblank is on.
	#4: Even two writes to $2005 must not change the address used by $2007 when vblank is on.
	#5: A single write to $2006 must not change the address used by $2007 when vblank is on.
	#6: A single write to $2005 must change the address toggle for both $2005 and $2006.
	#7: Sequential PPU memory read does not work
	#8: Sequential PPU memory write does not work
	#9: Some opcodes failed the test.
	#10: Open bus behavior is wrong.
	#11: ROM should not be writable.

Expected output in the PPUMEM version:

	TEST: cpu_dummy_writes_ppumem
	This program verifies that the
	CPU does 2x writes properly.
	Any read-modify-write opcode
	should first write the origi-
	nal value; then the calculated
	value exactly 1 cycle later.

	Verifying open bus behavior.
	      W- W- WR W- W- W- W- WR
	2000+ 0  1  2  3  4  5  6  7 
	  R0: 0- 0- 00 0- 0- 0- 0- 00
	  R1: 0- 0- 00 0- 0- 0- 0- 00
	  R3: 0- 0- 00 0- 0- 0- 0- 00
	  R5: 0- 0- 00 0- 0- 0- 0- 00
	  R6: 0- 0- 00 0- 0- 0- 0- 00
	OK; Verifying opcodes...
	0E2E4E6ECEEE 1E3E5E7EDEFE 
	0F2F4F6FCFEF 1F3F5F7FDFFF 
	03234363C3E3 13335373D3F3 
	1B3B5B7BDBFB              

	Passed


Flashes, clicks, other glitches
-------------------------------
If a test prints "passed", it passed, even if there were some flashes or
odd sounds. Only a test which prints "done" at the end requires that you
watch/listen while it runs in order to determine whether it passed. Such
tests involve things which the CPU cannot directly test.


Alternate output
----------------
Tests generally print information on screen, but also report the final
result audibly, and output text to memory, in case the PPU doesn't work
or there isn't one, as in an NSF or a NES emulator early in development.

After the tests are done, the final result is reported as a series of
beeps (see below). For NSF builds, any important diagnostic bytes are
also reported as beeps, before the final result.


Output at $6000
---------------
All text output is written starting at $6004, with a zero-byte
terminator at the end. As more text is written, the terminator is moved
forward, so an emulator can print the current text at any time.

The text output may include ANSI color codes, which take the form of
an esc character ($1B), an opening bracket ('['), and a sequence of
numbers and semicolon characters, terminated by a non-digit character ('m').

The test status is written to $6000. $80 means the test is running, $81
means the test needs the reset button pressed, but delayed by at least
100 msec from now. $00-$7F means the test has completed and given that
result code.

To allow an emulator to know when one of these tests is running and the
data at $6000+ is valid, as opposed to some other NES program, $DE $B0
$G1 is written to $6001-$6003.


Audible output
--------------
A byte is reported as a series of tones. The code is in binary, with a
low tone for 0 and a high tone for 1, and with leading zeroes skipped.
The first tone is always a zero. A final code of 0 means passed, 1 means
failure, and 2 or higher indicates a specific reason. See the source
code of the test for more information about the meaning of a test code.
They are found after the set_test macro. For example, the cause of test
code 3 would be found in a line containing set_test 3. Examples:

	Tones         Binary  Decimal  Meaning
	- - - - - - - - - - - - - - - - - - - - 
	low              0      0      passed
	low high        01      1      failed
	low high low   010      2      error 2


-- 
Shay Green <gblargg@gmail.com>
Joel Yliluoma <bisqwit@iki.fi>

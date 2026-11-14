NES Memory Execution Tests
----------------------------------
These tests verify that the CPU can execute code from any possible
memory location, even if that is mapped as I/O space.

In addition, two obscure side effects are tested:

1. The PPU open bus. Any write to PPU will update the open bus.
   Reading from 2002 updates the low 5 bits. Reading from 2007
   updates 8 bits. The open bus is shown in any addresss/bit
   that the PPU does not write to. Read from 2000, you get open bus.
   Read from 2006, ditto. Read from 2002, you get that in high 3 bits.
   Additionally, the open bus decays automatically to zero in about one
   second if not refreshed.
   This test requires that a value written to $2003 can be read back
   from $2001 within a time window of one or two frames.

2. One-byte opcodes must issue a dummy read to the byte immediately
   following that opcode. The CPU always does a fetch of the second
   byte, before it has even begun executing the opcode in the first
   place.

Additionally, the following PPU features must be working properly:

1. PPU memory writes and reads through $2006/$2007
2. The address high/low toggle reset at $2002
3. A single write through $2006 must not affect the address used by $2007
4. NMI should fire sometimes to salvage a broken program, if the JSR/JMP
   never reaches its intended destination. (Only required in the
   test IF the CPU and/or open bus are not working properly.)

The test is done FIVE times: Once with JSR $2001, again with JMP $2001,
and then with RTS (with target address of $2001), and then with a JMP
that expects to return with an RTI opcode. Finally, with a regular
JSR, but the return from the code is done through a BRK instruction.

Tests and results:

	 #2: PPU memory access through $2007 does not work properly. (Use other tests to determine the exact problem.)
	 #3: PPU open bus implementation is missing or incomplete: A write to $2003, followed by a read from $2001 should return the same value as was written.
	 #4: The RTS at $2001 was never executed. (If NMI has not been implemented in the emulator, the symptom of this failure is that the program crashes and does not output either "Fail" nor "Passed").
	 #5: An RTS opcode should still do a dummy fetch of the next opcode.  (The same goes for all one-byte opcodes, really.)
	 #6: I have no idea what happened, but the test did not work as supposed to. In any case, the problem is in the PPU.
	 #7: A jump to $2001 should never execute code from $8001 / $9001 / $A001 / $B001 / $C001 / $D001 / $E001.
	 #8: Okay, the test passed when JSR was used, but NOT when the opcode was JMP. I definitely did not think any emulator would trigger this result.
	 #9: Your PPU is broken in mind-defyingly random ways.
	 #10: RTS to $2001 never returned. This message never gets displayed.
	 #11: The test passed when JSR was used, and when JMP was used, but NOT when RTS was used. Caught ya! Paranoia wins.
	 #12: Your PPU gave up reason at the last moment.
	 #13: JMP to $2001 never returned. Again, this message never gets displayed.
	 #14: An RTI opcode should still do a dummy fetch of the next opcode.  (The same goes for all one-byte opcodes, really.)
	 #15: An RTI opcode should not destroy the PPU. Somehow that still appears to be the case here.
	 #16: IRQ occurred uncalled
	 #17: JSR to $2001 never returned. (Never displayed)
	 #18: The BRK instruction should issue an automatic fetch of the byte that follows right after the BRK. (The same goes for all one-byte opcodes, but with BRK it should be a bit more obvious than with others.)
	 #19: A BRK opcode should not destroy the PPU. Somehow that still appears to be the case here.
	 

Expected output:
	TEST:test_cpu_exec_space_ppuio
	This program verifies that the
	CPU can execute code from any
	possible location that it can
	address, including I/O space.

	In addition, it will be tested
	that an RTS instruction does a
	dummy read of the byte that
	immediately follows the
	instructions.

	JSR test OK
	JMP test OK
	RTS test OK
	JMP+RTI test OK
	BRK test OK

	Passed

Expected output in the other test:

	TEST: test_cpu_exec_space_apu
	This program verifies that the
	CPU can execute code from any
	possible location that it can
	address, including I/O space.
	
	In this test, it is also
	verified that not only all
	write-only APU I/O ports
	return the open bus, but
	also the unallocated I/O
	space in $4018..$40FF.
	
	40FF
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

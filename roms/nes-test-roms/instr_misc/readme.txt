NES CPU Instruction Behavior Misc Tests
----------------------------------------
These tests verify miscellaneous instruction behavior.


01-abs_x_wrap
-------------
Verifies that $FFFF wraps around to 0 for STA abs,X and LDA abs,X.


02-branch_wrap
--------------
Verifies that branching past end or before beginning of RAM wraps
around.


03-dummy_reads
--------------
Tests some instructions that do dummy reads before the real read/write.
Doesn't test all instructions.

Tests LDA and STA with modes (ZP,X), (ZP),Y and ABS,X
Dummy reads for the following cases are tested:

LDA ABS,X or (ZP),Y when carry is generated from low byte
STA ABS,X or (ZP),Y
ROL ABS,X always


04-dummy_reads_apu
------------------
Tests dummy reads for (hopefully) ALL instructions which do them,
including unofficial ones. Prints opcode(s) of failed instructions.
Requires that APU implement $4015 IRQ flag reading.


Multi-tests
-----------
The NES/NSF builds in the main directory consist of multiple sub-tests.
When run, they list the subtests as they are run. The final result code
refers to the first sub-test that failed. For more information about any
failed subtests, run them individually from rom_singles/ and
nsf_singles/.


Flashes, clicks, other glitches
-------------------------------
If a test prints "passed", it passed, even if there were some flashes or
odd sounds. Only a test which prints "done" at the end requires that you
watch/listen while it runs in order to determine whether it passed. Such
tests involve things which the CPU cannot directly test.


Text output
-----------
Tests generally print information on screen, but also output information
in other ways, in case the PPU doesn't work or there isn't one, as in an
NSF or a NES emulator early in development.

When building as an NSF, the final result is reported as a series of
beeps (see below). Any important diagnostic bytes are also reported as
beeps, before the final result.

All text output is written starting at $6004, with a zero-byte
terminator at the end. As more text is written, the terminator is moved
forward, so an emulator can print the current text at any time.

The test status is written to $6000. $80 means the test is running, $81
means the test needs the reset button pressed, but delayed by at least
100 msec from now. $00-$7F means the test has completed and given that
result code.

To allow an emulator to know when one of these tests is running and the
data at $6000+ is valid, as opposed to some other NES program, $DE $B0
$G1 is written to $6001-$6003.

See the source code for more information about a particular test and why
it might be failing. Each test has comments anout its operation.


NSF versions
------------
Many NSF-based tests require that the NSF player either not interrupt
the init routine with the play routine, or if it does, not interrupt the
play routine again if it hasn't returned yet. This is because many tests
need to run for a while without returning.

NSF versions also make periodic clicks to prevent the NSF player from
thinking the track is silent and thus ending the track before it's done
testing.

In addition to the other text output methods described above, NSF builds
report essential information bytes audibly, including the final result.
A byte is reported as a series of tones. The code is in binary, with a
low tone for 0 and a high tone for 1, and with leading zeroes skipped.
The first tone is always a zero. A final code of 0 means passed, 1 means
failure, and 2 or higher indicates a specific reason as listed in the
source code by the corresponding set_code line. Examples:

	Tones         Binary  Decimal  Meaning
	- - - - - - - - - - - - - - - - - - - - 
	low              0      0      passed
	low high        01      1      failed
	low high low   010      2      error 2

-- 
Shay Green <gblargg@gmail.com>

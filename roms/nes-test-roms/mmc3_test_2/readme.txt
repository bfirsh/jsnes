NES MMC3 Tests
--------------
These tests verify a small part of MMC3 (and some MMC6) behavior, mostly
related to the scanline counter and IRQ. They should be run in order.

The ROMs mainly test behavior by manually clocking the MMC3's IRQ
counter by writing to $2006 to change the current VRAM address. The last
two ROMs test behavior that differs among MMC3 chips.


MMC3 Operation
--------------
I have fairly thoroughly tested MMC3 IRQ counter operation and found the
following behaviors that differ as described in kevtris's (draft?) MMC3
documentation:

- The counter can be clocked manually via bit 12 of the VRAM address
even when $2000 = $00 (bg and sprites both use tiles from $0xxx).

- The IRQ flag is not set when the counter is cleared by writing to
$C001.

- I uncovered some pathological behavior that isn't covered by the test
ROMs. If $C001 is written, the counter clocked, then $C001 written
again, on the next counter clock the counter will be ORed with $80
(revision B)/frozen (revision A) and neither decremented nor reloaded.
If $C001 is written again at this point, on the next counter clock it
will be reloaded normally. I put a check in my emulator and none of the
several games I tested ever caused this situation to occur, so it's
probably not a good idea to implement this.

The MMC3 in Crystalis (referred to here as revision A) worked as
described in kevtris's document, with the above changes. The MMC3 in
Super Mario Bros. 3 and Mega Man 3 (I think revision B, but I don't have
the special screw driver) further differed when $C000 was written with
0:

- Writing 0 to $C000 works no differently than any other value written;
it will cause the counter to be reloaded every time it is clocked (once
it reaches zero).

- When the counter is clocked, if it's not zero, it is decremented,
otherwise it is reloaded with the last value written to $C000. *After*
decrementing/reloading, if the counter is zero and IRQ is enabled via
$E001, the IRQ flag is set.


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


NSF versions
------------
Many NSF-based tests require that the NSF player either not interrupt
the init routine with the play routine, or if it does, not interrupt the
play routine again if it hasn't returned yet. This is because many tests
need to run for a while without returning.

NSF versions also make periodic clicks to prevent the NSF player from
thinking the track is silent and thus ending the track before it's done
testing.

-- 
Shay Green <gblargg@gmail.com>

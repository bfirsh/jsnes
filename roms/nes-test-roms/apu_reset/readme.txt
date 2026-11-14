NES APU Reset Tests
--------------------
These tests verify initial APU state at power, and the effect of reset.


4015_cleared
------------
At power and reset, $4015 is cleared.

2) At power, $4015 should be cleared
3) At reset, $4015 should be cleared


4017_timing
-----------
At power, it is as if $00 were written to $4017,
then a 9-12 clock delay, then execution from address
in reset vector.

At reset, same as above, except last value written
to $4017 is written again, rather than $00.

The delay from when $00 was written to $4017 is
printed. Delay after NES being powered off for a
minute is usually 9.

2) Frame IRQ flag should be set later after power/reset
3) Frame IRQ flag should be set sooner after power/reset


4017_written
------------
At power, $4017 = $00.
At reset, $4017 mode is unchanged, but IRQ inhibit
flag is sometimes cleared.

2) At power, $4017 should be written with $00
3) At reset, $4017 should should be rewritten with last value written


irq_flag_cleared
----------------
At power and reset, IRQ flag is clear.

2) At power, flag should be clear
3) At reset, flag should be clear


len_ctrs_enabled
----------------
At power and reset, length counters are enabled.

2) At power, length counters should be enabled
3) At reset, length counters should be enabled, triangle unaffected


works_immediately
-----------------
At power and reset, $4017, $4015, and length counters work
immediately.

2) At power, writes should work immediately
3) At reset, writes should work immediately

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

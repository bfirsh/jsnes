NES APU Tests
-------------
These ROMs test many aspects of the APU that are visible to the CPU.
Really obsucre things are not tested here.


1-len_ctr
---------
Tests length counter operation for the four main channels

2) Problem with length counter load or $4015
3) Problem with length table, timing, or $4015
4) Writing $80 to $4017 should clock length immediately
5) Writing 0 to $4017 shouldn't clock length immediately
6) Disabling via $4015 should clear length counter
7) When disabled via $4015, length shouldn't allow reloading
8) Halt bit should suspend length clocking


2-len_table
-----------
Verifies all length table entries


3-irq_flag
----------
Verifies basic operation of frame irq flag

2) Flag shouldn't be set in $4017 mode $40
3) Flag shouldn't be set in $4017 mode $80
4) Flag should be set in $4017 mode $00
5) Reading flag should clear it
6) Writing $00 or $80 to $4017 shouldn't affect flag
7) Writing $40 or $C0 to $4017 should clear flag


4-jitter
--------
Tests for APU clock jitter. Also tests basic timing of frame irq flag
since it's needed to determine jitter.

3) Frame irq is set too late
4) Even jitter not handled properly
5) Odd jitter not handled properly


5-len_timing
------------
Verifies timing of length counter clocks in both modes

2) First length of mode 0 is too soon
3) First length of mode 0 is too late
4) Second length of mode 0 is too soon
5) Second length of mode 0 is too late
6) Third length of mode 0 is too soon
7) Third length of mode 0 is too late
8) First length of mode 1 is too soon
9) First length of mode 1 is too late
10) Second length of mode 1 is too soon
11) Second length of mode 1 is too late
12) Third length of mode 1 is too soon
13) Third length of mode 1 is too late


6-irq_flag_timing
-----------------
Frame interrupt flag is set three times in a row 29831 clocks after
writing $00 to $4017.

3) Flag first set too late
4) Flag last set too soon
5) Flag last set too late 


7-dmc_basics
------------
Verifies basic DMC operation

2) DMC isn't working well enough to test further
3) Starting DMC should reload length from $4013
4) Writing $10 to $4015 should restart DMC if previous sample finished
5) Writing $10 to $4015 should not affect DMC if previous sample is
still playing
6) Writing $00 to $4015 should stop current sample
7) Changing $4013 shouldn't affect current sample length
8) Shouldn't set DMC IRQ flag when flag is disabled
9) Should set IRQ flag when enabled and sample ends
10) Reading IRQ flag shouldn't clear it
11) Writing to $4015 should clear IRQ flag
12) Disabling IRQ flag should clear it
13) Looped sample shouldn't end until $00 is written to $4015
14) Looped sample shouldn't ever set IRQ flag
15) Clearing loop flag and then setting again shouldn't stop loop
16) Clearing loop flag should end sample once it reaches end
17) Looped sample should reload length from $4013 each time it reaches
end
18) $4013=0 should give 1-byte sample
19) There should be a one-byte buffer that's filled immediately if empty


8-dmc_rates
-----------
Verifies the DMC's 16 rates

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

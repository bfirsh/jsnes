NES PPU Tests
-------------
These tests verify the behavior and timing of the NTSC PPU's VBL flag,
NMI enable, and NMI interrupt. Timing is tested to an accuracy of one
PPU clock. Note that often the NES starts up with a different value in
the clock divider, causing PPU timing to be slightly different and fail
some of the tests. These test the timings that have been most fully
documented and emulated.


01-vbl_basics
-------------
Tests basic VBL operation and VBL period.

2) VBL period is way off
3) Reading VBL flag should clear it
4) Writing $2002 shouldn't affect VBL flag
5) $2002 should be mirrored at $200A
6) $2002 should be mirrored every 8 bytes up to $2FFA
7) VBL period is too short with BG off
8) VBL period is too long with BG off


02-vbl_set_time
---------------
Verifies time VBL flag is set.

Reads $2002 twice and prints VBL flags from
them. Test is run one PPU clock later each time,
around the time the flag is set.

00 - V
01 - V
02 - V
03 - V   ; after some resets this is - -
04 - -   ; flag setting is suppressed
05 V -
06 V -
07 V -
08 V -


03-vbl_clear_time
-----------------
Tests time VBL flag is cleared.

Reads $2002 and prints VBL flag.
Test is run one PPU clock later each line,
around the time the flag is cleared.

00 V
01 V
02 V
03 V
04 V
05 V
06 -
07 -
08 -


04-nmi_control
--------------
Tests immediate NMI behavior when enabling while VBL flag is already set

2) Shouldn't occur when disabled
3) Should occur when enabled and VBL begins
4) $2000 should be mirrored every 8 bytes
5) Should occur immediately if enabled while VBL flag is set
6) Shouldn't occur if enabled while VBL flag is clear
7) Shouldn't occur again if writing $80 when already enabled
8) Shouldn't occur again if writing $80 when already enabled 2
9) Should occur again if enabling after disabled
10) Should occur again if enabling after disabled 2
11) Immediate occurence should be after NEXT instruction


05-nmi_timing
-------------
Tests NMI timing.

Prints which instruction NMI occurred
after. Test is run one PPU clock later
each line.

00 4
01 4
02 4
03 3
04 3
05 3
06 3
07 3
08 3
09 2


06-suppression
--------------
Tests behavior when $2002 is read near time
VBL flag is set.

Reads $2002 one PPU clock later each time.
Prints whether VBL flag read back as set, and
whether NMI occurred.

00 - N
01 - N
02 - N
03 - N  ; normal behavior
04 - -  ; flag never set, no NMI
05 V -  ; flag read back as set, but no NMI
06 V -
07 V N  ; normal behavior
08 V N
09 V N


07-nmi_on_timing
----------------
Tests NMI occurrence when enabled near time
VBL flag is cleared.

Enables NMI one PPU clock later on each line.
Prints whether NMI occurred.

00 N
01 N
02 N
03 N
04 N
05 -
06 -
07 -
08 -


08-nmi_off_timing
-----------------
Tests NMI occurrence when disabled near time
VBL flag is set.

Disables NMI one PPU clock later on each line.
Prints whether NMI occurred.

03 -
04 -
05 -
06 -
07 N
08 N
09 N
0A N
0B N
0C N


09-even_odd_frames
------------------
Tests clock skipped on every other PPU frame when BG rendering
is enabled.

Tries pattern of BG enabled/disabled during a sequence of
5 frames, then finds how many clocks were skipped. Prints
number skipped clocks to help find problems.

Correct output: 00 01 01 02


10-even_odd_timing
------------------
Tests timing of skipped clock every other frame
when BG is enabled.

Output: 08 08 09 07 

2) Clock is skipped too soon, relative to enabling BG
3) Clock is skipped too late, relative to enabling BG
4) Clock is skipped too soon, relative to disabling BG
5) Clock is skipped too late, relative to disabling BG

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

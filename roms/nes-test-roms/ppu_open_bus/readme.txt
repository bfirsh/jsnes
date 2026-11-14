NES PPU Open-Bus Test
---------------------
Tests behavior when reading from open-bus PPU bits/registers, those bits
that aren't otherwise defined. Unlike other open-bus addresses, the PPU
ones are separate. Takes about 5 seconds to run.

The PPU effectively has a "decay register", an 8-bit register. Each bit
can be refreshed with a 0 or 1. If a bit isn't refreshed with a 1 for
about 600 milliseconds, it will decay to 0 (some decay sooner, depending
on the NES and temperature).

Writing to any PPU register sets the decay register to the value
written. Reading from a PPU register is more complex. The following
shows the effect of a read from each register:

	Addr    Open-bus bits
			7654 3210
	- - - - - - - - - - - - - - - -
	$2000   DDDD DDDD
	$2001   DDDD DDDD
	$2002   ---D DDDD
	$2003   DDDD DDDD
	$2004   ---- ----
	$2005   DDDD DDDD
	$2006   DDDD DDDD
	$2007   ---- ----   non-palette
			DD-- ----   palette

A D means that this bit reads back as whatever is in the decay register
at that bit, and doesn't refresh the decay register at that bit. A -
means that this bit reads back as defined by the PPU, and refreshes the
decay register at the corresponding bit.


Flashes, clicks, other glitches
-------------------------------
Some tests might need to turn the screen off and on, or cause slight
audio clicks. This does not indicate failure, and should be ignored.
Only the test result reported at the end is important, unless stated
otherwise.


Text output
-----------
Tests generally print information on screen. They also output the same
text as a zero-terminted string beginning at $6004, allowing examination
of output in an NSF player, or a NES emulator without a working PPU. The
tests also work properly if the PPU doesn't set the VBL flag properly or
doesn't implement it at all.

The final result is displayed and also written to $6000. Before the test
starts, $80 is written there so you can tell when it's done. If a test
needs the NES to be reset, it writes $81 there (emulator should wait a
couple of frames after seeing $81). In addition, $DE $B0 $G1 is written
to $6001-$6003 to allow an emulator to detect when a test is being run,
as opposed to some other NES program. In NSF builds, the final result is
also reported via a series of beeps (see below).

See the source code for more information about a particular test and why
it might be failing. Each test has comments and correct output at the
top.


NSF versions
------------
Many NSF-based tests require that the NSF player either not interrupt
the init routine with the play routine, or if it does, not interrupt the
play routine again if it hasn't returned yet. This is because many tests
need to run for a while without returning.

NSF versions also make periodic clicks to avoid the NSF player from
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

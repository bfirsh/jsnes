NTSC NES PPU Sprite Overflow Flag Test ROMs
-------------------------------------------
These ROMs test the sprite overflow flag in bit 5 of $2002. When run on
a NES they all give a passing result. Each ROM runs several tests and
reports the result on screen and by beeping a number of times. See below
for the meaning of failure codes for each test. THE TESTS MUST BE RUN
(*AND* *PASS*) IN ORDER, because some earlier ROMs test things that
later ones assume will work properly.

Source code for each test is included, and most tests are clearly
divided into sections. Support code is also included, but it runs on a
custom devcart and assembler so it will require some effort to assemble.
Contact me if you'd like assistance porting them to your setup.


1.Basics
--------
Tests basic operation of sprite overflow flag.

2) Should be set when 9 sprites are on a scanline
3) Reading $2002 shouldn't clear flag
4) Shouldn't be cleared at the beginning of VBL
5) Should be cleared at the end of VBL
6) Shouldn't be set when all rendering is off
7) Should work normally when $2001 = $08 (bg rendering only)
8) Should work normally when $2001 = $10 (sprite rendering only)


2.Details
---------
Tests more detailed operation.

2) Should be set even when sprites are under left clip (X = 0)
3) Disabling rendering shouldn't clear flag
4) Should be cleared at the end of VBL even when rendering is off
5) Should be set when sprite Y coordinates are 239
6) Shouldn't be set when sprite Y coordinates are 240 (off screen)
7) Shouldn't be set when sprite Y coordinates are 255 (off screen)
8) Should be set regardless of which sprites are involved
9) Shouldn't be set when all scanlines have 7 or fewer sprites
10) Double-height sprites aren't handled properly


3.Timing
--------
Tests timing of sprite overflow flag. The tests fail if timing is off by
more than a CPU clock or two.

2) Cleared too late/3)too early at end of VBL
4) Set too early/5)too late for first scanline
6) Sprite horizontal positions should have no effect on timing
7) Set too early/8)late for last sprites on first scanline
9) Set too early/10)too late for last scanline
11) Set too early/12)too late when 9th sprite # is way after 8th
13) Overflow on second scanline occurs too early/14)too late


4.Obscure
---------
Tests the pathological behavior when 8 sprites are on a scanline and the
one just after the 8th is not on the scanline. In that case, the PPU
interprets different bytes of each following sprite as the Y coordinate.
For the following setup of any consecutive range of sprites (that is,
sprite 1 below could be the PPU's 25th sprite, sprite 2 the 26th, etc.):

	1 2 3 4 5 6 7 8 9 10 11 12 13 14

If 1-8 are on the same scanline but 9 isn't, then the second byte of 10,
the third byte of 11, fourth byte of 12, first byte of 13, second byte
of 14, etc. are treated as those sprites' Y coordinates for the purpose
of determining whether overflow occurs on that scanline. This search
continues until one of the (erroneously interpreted) Y coordinates
places the sprite within the scanline, or all sprites have been scanned.
Refer to the NESdevWiki for further information about this behavior. 

2) Checks that second byte of sprite #10 is treated as its Y 
3) Checks that third byte of sprite #11 is treated as its Y 
4) Checks that fourth byte of sprite #12 is treated as its Y 
5) Checks that first byte of sprite #13 is treated as its Y 
6) Checks that second byte of sprite #14 is treated as its Y 
7) Checks that search stops at the last sprite without overflow
8) Same as test #2 but using a different range of sprites


5.Emulator
----------
Tests things that an emulator with predictive overflow flag handling is
likely to get wrong.

2) Didn't calculate overflow when there was no $2002 read for frame
3) Disabling rendering didn't recalculate flag time
4) Changing sprite RAM didn't recalculate flag time
5) Changing sprite height didn't recalculate time

-- 
Shay Green <gblargg@gmail.com>

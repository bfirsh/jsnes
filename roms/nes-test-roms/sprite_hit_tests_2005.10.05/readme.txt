NTSC NES PPU Sprite 0 Test ROMs
-------------------------------
These ROMs test much of sprite 0 hit behavior on a NTSC NES PPU. They
have been tested on an actual NES and all give a passing result. I wrote
them to verify that my NES emulator's sprite 0 hit emulation was working
properly.

Each test ROM runs several tests and reports the result on screen and by
beeping a number of times. See below for the meaning of failure codes
for each test. It's best to run the tests in order, because some earlier
ROMs test things that later ones assume will work properly.

The main source code for each test is included, and most tests are
clearly divided into sections. All the asm source is included, but it
runs on a custom devcart and assembler so it will require some effort to
assemble. Contact me if you'd assistance porting them to your setup.


01.basics
---------
Tests basic sprite 0 hit behavior (nothing timing related).

2) Sprite hit isn't working at all
3) Should hit even when completely behind background
4) Should miss when background rendering is off
5) Should miss when sprite rendering is off
6) Should miss when all rendering is off
7) All-transparent sprite should miss
8) Only low two palette index bits are relevant
9) Any non-zero palette index should hit with any other
10) Should miss when background is all transparent
11) Should always miss other sprites


02.alignment
------------
Tests alignment of sprite hit with background. Places a solid background
tile in the middle of the screen and places the sprite on all four edges
both overlapping and non-overlapping.

2) Basic sprite-background alignment is way off
3) Sprite should miss left side of bg tile
4) Sprite should hit left side of bg tile
5) Sprite should miss right side of bg tile
6) Sprite should hit right side of bg tile
7) Sprite should miss top of bg tile
8) Sprite should hit top of bg tile
9) Sprite should miss bottom of bg tile
10) Sprite should hit bottom of bg tile


03.corners
----------
Tests sprite 0 hit using a sprite with a single pixel set, for each of
the four corners.

2) Lower-right pixel should hit
3) Lower-left pixel should hit
4) Upper-right pixel should hit
5) Upper-left pixel should hit


04.flip
-------
Tests sprite 0 hit for single pixel sprite and background.

2) Horizontal flipping doesn't work
3) Vertical flipping doesn't work
4) Horizontal + Vertical flipping doesn't work


05.left_clip
------------
Tests sprite 0 hit with regard to clipping of left 8 pixels of screen.

2) Should miss when entirely in left-edge clipping
3) Left-edge clipping occurs when $2001 is not $1e
4) Left-edge clipping is off when $2001 = $1e
5) Left-edge clipping blocks all hits only when X = 0
6) Should miss; sprite pixel covered by left-edge clip
7) Should hit; sprite pixel outside left-edge clip
8) Should hit; sprite pixel outside left-edge clip


06.right_edge
-------------
Tests sprite 0 hit with regard to column 255 (ignored) and off right
edge of screen.

2) Should always miss when X = 255
3) Should hit; sprite has pixels < 255
4) Should miss; sprite pixel is at 255
5) Should hit; sprite pixel is at 254
6) Should also hit; sprite pixel is at 254


07.screen_bottom
----------------
Tests sprite 0 hit with regard to bottom of screen.

2) Should always miss when Y >= 239
3) Can hit when Y < 239
4) Should always miss when Y = 255
5) Should hit; sprite pixel is at 238
6) Should miss; sprite pixel is at 239
7) Should hit; sprite pixel is at 238


08.double_height
----------------
Tests basic sprite 0 hit double-height operation.

2) Lower sprite tile should miss bottom of bg tile
3) Lower sprite tile should hit bottom of bg tile
3) Lower sprite tile should miss top of bg tile
4) Lower sprite tile should hit top of bg tile


09.timing_basics
----------------
Tests sprite 0 hit timing to within 12 or so PPU clocks. Tests flag
timing for upper-left corner, upper-right corner, lower-right corner,
and time flag is cleared (at end of VBL). Depends on proper PPU frame
length (less than 29781 CPU clocks).

2) Upper-left corner too soon
3) Upper-left corner too late
4) Upper-right corner too soon
5) Upper-right corner too late
6) Lower-left corner too soon
7) Lower-left corner too late
8) Cleared at end of VBL too soon
9) Cleared at end of VBL too late


10.timing_order
---------------
Tests sprite 0 hit timing for which pixel it first reports hit on. Each
test hits at the same location on screen, though different relative to
the position of the sprite.

2) Upper-left corner too soon
3) Upper-left corner too late
4) Upper-right corner too soon
5) Upper-right corner too late
6) Lower-left corner too soon
7) Lower-left corner too late
8) Lower-right corner too soon
9) Lower-right corner too late


11.edge_timing
--------------
Tests sprite 0 hit timing for which pixel it first reports hit on when
some pixels are under clip, or at or beyond right edge.

2) Hit time shouldn't be based on pixels under left clip
3) Hit time shouldn't be based on pixels at X=255
4) Hit time shouldn't be based on pixels off right edge

-- 
Shay Green <hotpop.com@blargg> (swap to e-mail)

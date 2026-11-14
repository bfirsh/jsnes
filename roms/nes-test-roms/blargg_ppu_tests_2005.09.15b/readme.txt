NTSC NES PPU Tests
------------------
These ROMs test a few aspects of the NTSC NES PPU operation. They have been
tested on an actual NES and all give a passing result. I wrote them to verify
that my NES emulator's PPU was working properly.

Each ROM runs several tests and reports a result code on screen and by beeping
a number of times. A result code of 1 always indicates that all tests were
passed; see below for the meaning of other codes for each test.

The main source code for each test is included, and most tests are clearly
divided into sections. Some of the common support code is included, but not
all, since it runs on a custom setup. Contact me if you want to assemble the
tests yourself.

Shay Green <hotpop.com@blargg> (swap to e-mail)


palette_ram
-----------
PPU palette RAM read/write and mirroring test

1) Tests passed
2) Palette read shouldn't be buffered like other VRAM
3) Palette write/read doesn't work
4) Palette should be mirrored within $3f00-$3fff
5) Write to $10 should be mirrored at $00
6) Write to $00 should be mirrored at $10


power_up_palette
----------------
Reports whether initial values in palette at power-up match those
that my NES has. These values are probably unique to my NES.

1) Palette matches
2) Palette differs from table


sprite_ram
----------
Tests sprite RAM access via $2003, $2004, and $4014

1) Tests passed
2) Basic read/write doesn't work
3) Address should increment on $2004 write
4) Address should not increment on $2004 read
5) Third sprite bytes should be masked with $e3 on read 
6) $4014 DMA copy doesn't work at all
7) $4014 DMA copy should start at value in $2003 and wrap
8) $4014 DMA copy should leave value in $2003 intact


vbl_clear_time
--------------
The VBL flag ($2002.7) is cleared by the PPU around 2270 CPU clocks
after NMI occurs.

1) Tests passed
2) VBL flag cleared too soon
3) VBL flag cleared too late


vram_access
-----------
Tests PPU VRAM read/write and internal read buffer operation

1) Tests passed
2) VRAM reads should be delayed in a buffer
3) Basic Write/read doesn't work
4) Read buffer shouldn't be affected by VRAM write
5) Read buffer shouldn't be affected by palette write
6) Palette read should also read VRAM into read buffer
7) "Shadow" VRAM read unaffected by palette transparent color mirroring

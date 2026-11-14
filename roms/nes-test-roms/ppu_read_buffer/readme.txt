NES PPU Read Buffer Tests
----------------------------------
This mammoth test pack tests many aspects of the NES system,
mostly centering around the PPU $2007 read buffer.

The test will take about 20 seconds.

The program attempts to do as many tests as possible before
reporting the result. When the screen is blanked for a long
time, audio is used to report progress. A low-pitched fat
tone indicates failure; bright beeps indicate progress.

If a sub-test fails, at a certain point the list of all
failed tests is provided in a numeric form, and a textual
explanation of the first failed test is shown.


Full list of tests performed is below.
Note that the tests are not performed in a numerical order.
For example, test #47 (does palette reading work at all) is
performed before test #7 (does sequential palette reading work).

	Test  2 (TEST_PPUMEMORYIO):

	PPU memory I/O does not work.
	Possible areas of problem:
	- PPU not implemented
	- PPU memory writing ($2007)
	- PPU memory reading ($2007)
	- PPU memory area $2C00-$2FFF

	Test  3 (TEST_ONEBYTEBUFFER):

	Non-palette PPU memory reads
	should have one-byte buffer.

	Test  4 (TEST_CIRAM_READ):

	CIRAM reading
	does not work.

	Test  5 (TEST_CIRAM_SEQ_READ_1):

	Sequential CIRAM reading
	with  1-byte increment
	does not work.

	Test  6 (TEST_CIRAM_SEQ_READ_32):

	Sequential CIRAM reading
	with 32-byte increment
	does not work.

	Test  7 (TEST_PALETTE_RAM_SEQ_READ_1):

	Sequential PALETTE reading
	with  1-byte increment
	does not work.

	Test  8 (TEST_PALETTE_RAM_SEQ_READ_32):

	Sequential PALETTE reading
	with 32-byte increment
	does not work.

	Test  9 (TEST_CHRROM_READ):

	CHR-ROM reading
	does not work.

	Test 10 (TEST_CHRROM_SEQ_READ_1):

	Sequential CHR-ROM reading
	with  1-byte increment
	does not work.

	Test 11 (TEST_CHRROM_SEQ_READ_32):

	Sequential CHR-ROM reading
	with 32-byte increment
	does not work.

	Test 12 (TEST_CIRAM_SEQ_WRITE_1):

	Sequential CIRAM writes
	with  1-byte increment
	does not work.

	Test 13 (TEST_CIRAM_SEQ_WRITE_32):

	Sequential CIRAM writes
	with 32-byte increment
	does not work.

	Test 14 (TEST_NTA_MIRRORING_FAIL_1NTA):

	1-nametable setup seems to
	be active, even though this
	ROM is explicitly configured
	for horizontal mirroring.

	Test 15 (TEST_NTA_MIRRORING_FAIL_4NTA):

	Four-screen setup seems to
	be active, even though this
	ROM is explicitly configured
	for horizontal mirroring.

	Test 16 (TEST_NTA_MIRRORING_FAIL_VERT):

	Vertical mirroring seems to
	be active, even though this
	ROM is explicitly configured
	for horizontal mirroring.

	Test 17 (TEST_PPU_OPEN_BUS):

	Any data that is transferred
	through PPU I/O should linger
	and be readable for a while
	in any PPU register that does
	not have a read function.
	This is called "open bus".
	To minimally pass this test,
	you need to at least provide
	a bridge between $2003(W) and
	$2000(R).

	Test 18 (TEST_PPU_OPEN_BUS_SHORTCUT):

	Reading a write-only PPU
	register should not just give
	the current value of SPRADDR.
	That would be a too lazy
	workaround for a failed test!

	Test 19 (TEST_PPU_OPENBUS_MUST_NOT_COPY_READBUFFER):

	PPU memory read buffer is not
	the open bus. Reading the bus
	should repeat the last value
	that was transferred, not
	disclose the buffered byte.

	Test 20 (TEST_PPU_OPENBUS_FROM_WRITE2000_MUST_NOT_WRITETO_READBUFFER):

	A write to $2000 must not
	overwrite the $2007 read
	buffer.

	Test 21 (TEST_PPU_OPENBUS_FROM_WRITE2001_MUST_NOT_WRITETO_READBUFFER):

	A write to $2001 must not
	overwrite the $2007 read
	buffer.

	Test 22 (TEST_PPU_OPENBUS_FROM_WRITE2002_MUST_NOT_WRITETO_READBUFFER):

	A write to $2002 must not
	overwrite the $2007 read
	buffer.

	Test 23 (TEST_PPU_OPENBUS_FROM_WRITE2003_MUST_NOT_WRITETO_READBUFFER):

	A write to $2003 must not
	overwrite the $2007 read
	buffer.

	Test 24 (TEST_PPU_OPENBUS_FROM_WRITE2004_MUST_NOT_WRITETO_READBUFFER):

	A write to $2004 must not
	overwrite the $2007 read
	buffer.

	Test 25 (TEST_PPU_OPENBUS_FROM_WRITE2005_MUST_NOT_WRITETO_READBUFFER):

	A write to $2005 must not
	overwrite the $2007 read
	buffer.

	Test 26 (TEST_PPU_OPENBUS_FROM_WRITE2006_MUST_NOT_WRITETO_READBUFFER):

	A write to $2006 must not
	overwrite the $2007 read
	buffer.

	Test 27 (TEST_PPU_OPENBUS_FROM_WRITE2007_MUST_NOT_WRITETO_READBUFFER):

	A write to $2007 must not
	overwrite the $2007 read
	buffer.

	Test 28 (TEST_PPU_OPENBUS_FROM_READ2000_MUST_NOT_WRITETO_READBUFFER):

	A read from $2000 must not
	overwrite the $2007 read
	buffer.

	Test 29 (TEST_PPU_OPENBUS_FROM_READ2001_MUST_NOT_WRITETO_READBUFFER):

	A read from $2001 must not
	overwrite the $2007 read
	buffer.

	Test 30 (TEST_PPU_OPENBUS_FROM_READ2002_MUST_NOT_WRITETO_READBUFFER):

	A read from $2002 must not
	overwrite the $2007 read
	buffer.

	Test 31 (TEST_PPU_OPENBUS_FROM_READ2003_MUST_NOT_WRITETO_READBUFFER):

	A read from $2003 must not
	overwrite the $2007 read
	buffer.

	Test 32 (TEST_PPU_OPENBUS_FROM_READ2004_MUST_NOT_WRITETO_READBUFFER):

	A read from $2004 must not
	overwrite the $2007 read
	buffer.

	Test 33 (TEST_PPU_OPENBUS_FROM_READ2005_MUST_NOT_WRITETO_READBUFFER):

	A read from $2005 must not
	overwrite the $2007 read
	buffer.

	Test 34 (TEST_PPU_OPENBUS_FROM_READ2006_MUST_NOT_WRITETO_READBUFFER):

	A read from $2006 must not
	overwrite the $2007 read
	buffer.

	Test 35 (TEST_PPU_OPENBUS_INDEXED):

	STA $2000,Y with Y=7 must
	issue a dummy read to $2007.

	Test 36 (TEST_PPU_OPENBUS_INDEXED2):

	STA $1FF0,Y with Y=$17 mustn't
	issue a dummy read to $2007.

	Test 37 (TEST_PPU_OPENBUS_FROM_READ_MIRROR_MUST_WRITETO_READBUFFER):

	A read from a mirrored copy
	of $2007 must act as if
	$2007 was read, and update
	the same read buffer.

	Test 38 (TEST_PPU_READ_WITH_AND):

	The AND instruction must be
	usable for reading $2007
	or any other I/O port.

	Test 39 (TEST_PPU_READ_WITH_ORA):

	The ORA instruction must be
	usable for reading $2007
	or any other I/O port.

	Test 40 (TEST_PPU_READ_WITH_EOR):

	The EOR instruction must be
	usable for reading $2007
	or any other I/O port.

	Test 41 (TEST_PPU_READ_WITH_CMP):

	The CMP instruction must be
	usable for reading $2007
	or any other I/O port.

	Test 42 (TEST_PPU_READ_WITH_CPX):

	The CPX instruction must be
	usable for reading $2007
	or any other I/O port.

	Test 43 (TEST_PPU_READ_WITH_CPY):

	The CPY instruction must be
	usable for reading $2007
	or any other I/O port.

	Test 44 (TEST_PPU_READ_WITH_ADC):

	The ADC instruction must be
	usable for reading $2007
	or any other I/O port.

	Test 45 (TEST_PPU_READ_WITH_SBC):

	The SBC instruction must be
	usable for reading $2007
	or any other I/O port.

	Test 46 (TEST_ONEBYTEBUFFER_PALETTE):

	Palette reads from PPU should
	not have one-byte buffer.

	Test 47 (TEST_PALETTE_READS):

	Palette reads from PPU do not
	seem to be working at all.

	Test 48 (TEST_PALETTE_READS_UNRELIABLE):

	Palette reads  from PPU seem
	to work randomly.

	Test 49 (TEST_PALETTE_MIRRORS):

	Palette indexes $3F1x should
	be mirrors of $3F0x when
	x is 0, 4, 8, or C.

	Test 50 (TEST_PALETTE_UNIQUE):

	It must be possible to store
	unique data in each of $3F00,
	$3F04, $3F08 and $3F0C.

	Test 51 (TEST_PPU_PALETTE_WRAP):

	PPU addresses 3F00-3F1F
	should be mirrored within
	the whole 3F00-3FFF region,
	for a total of 8 times.

	Test 52 (TEST_PPU_MEMORY_14BIT_A):

	Failed sub-test 1 of:
	The two MSB within the PPU
	memory address should be
	completely ignored in all
	circumstances, effectively
	mirroring the 0000-3FFF
	address range within the
	whole 0000-FFFF region,
	for a total of 4 times.

	Test 53 (TEST_PPU_MEMORY_14BIT_B):

	Failed sub-test 2 of:
	The two MSB within the PPU
	memory address should be
	completely ignored in all
	circumstances, effectively
	mirroring the 0000-3FFF
	address range within the
	whole 0000-FFFF region,
	for a total of 4 times.

	Test 54 (TEST_PPU_MIRROR_3000):

	PPU memory range 3000-3EFE
	should be a mirror of the
	PPU memory range 2000-2EFE.

	Test 55 (TEST_PPU_READ_3EFF):

	Setting PPU address to 3EFF
	and reading $2007 twice
	should give the data at
	$3F00, not the data at $2EFF.

	Test 56 (TEST_PPU_MIRROR_2F):

	Reading PPU memory range 3Fxx
	should put contents of 2Fxx
	into the read buffer.

	Test 57 (TEST_PPU_SEQ_READ_WRAP):

	Setting PPU address to 3FFF
	& reading $2007 thrice should
	give the contents of $0000.

	Test 58 (SEQ_READ_INTERNAL):

	Unexpected: VROM contents at
	$0000 and $1FFF read the same.
	This should never happen in
	this test ROM.

	Test 59 (TEST_VADDR):

	Relationship between $2005
	and $2006 is not implemented
	properly. Here is a guide.
	It explains which registers
	use which parts of the address.
	Note that only the second
	write to $2006 updates the
	address really used by $2007.
	FEDCBA9876543210ZYX: bit pos.
	  ^^^^^^^^^^^^^^------ =$2007
	zz543210-------------- $2006#1
	        76543210------ $2006#2
	           76543210--- $2005#1
	 210--76543----------- $2005#2
	    10---------------- $2000

	Test 60 (TEST_RAM_MIRRORING):

	CPU RAM at 0000-07FF should
	be mirrored 4 times, in the
	following address ranges:
	- 0000-07FF
	- 0800-0FFF
	- 1000-17FF
	- 1800-1FFF

	Test 61 (TEST_PPUIO_MIRRORING):

	PPU I/O memory at 2000-2007
	should be mirrored within the
	whole 2000-3FFF region, for
	a total of 1024 times.

	Test 62 (TEST_SPHIT_AND_VBLANK):

	Sprite 0 hit flag should not
	read as set during vblank.

	Test 63 (TEST_SPHIT_DIRECT):

	Sprite 0 hit test by poking
	data directly into $2003-4
	^ Possible causes for failure:
	- $2003/$2004 not implemented
	- No sprite 0 hit tests
	- Way too long vblank period

	Test 64 (TEST_SPHIT_DIRECT_READBUFFER):

	Sending 5 bytes of data into
	$2003 and $2004 must not
	overwrite the $2007 read
	buffer.

	Test 65 (TEST_SPHIT_DMA_ROM):

	Sprite 0 hit test using DMA
	($4014) using ROM as source
	^ Possible causes for failure:
	- $4014 DMA cannot read from
	  anything other than RAM

	Test 66 (TEST_SPHIT_DMA_READBUFFER):

	Invoking a $4014 DMA with a
	non-$20 value  must not
	overwrite the $2007 read
	buffer.

	Test 67 (TEST_SPHIT_DMA_PPU_BUS):

	Sprite 0 hit test using DMA
	($4014) using PPU I/O bus
	as source
	^ In this test, $4014 <- #$20.
	  Possible causes for failure:
	- DMA does not do proper reads
	- PPU bus does not preserve
	  last transferred values
	- $2002 read returned a value
	  that differs from expected
	- $2004 read modifies the OAM

	Test 68 (TEST_DMA_PPU_SIDEEFFECT):

	Writing $20 into $4014 should
	generate 32 reads into $2007
	as a side-effect, each time
	incrementing the PPU read
	address.

	Test 69 (TEST_SPHIT_DMA_RAM):

	Sprite 0 hit test using DMA.
	All internal RAM pages are
	tested, including mirrored
	addresses. Failing the test
	may imply faulty mirroring.

	Test 70 (TEST_CHRROM_READ_BANKED):

	CHR ROM read through $2007
	does not honor mapper 3
	(CNROM) bank switching

	Test 71 (TEST_CHRROM_READ_BANKED_BUFFER):

	The $2007 read buffer should
	not retroactively react to
	changes in VROM mapping.
	When you read $2007, the
	data is stored in a buffer
	("latch"), and the previous
	content of the buffer is
	returned. It is not a delayed
	read request.

	Test 72 (TEST_CHRROM_WRITE):

	CHR ROM on mapper 3 (CNROM boards)
	must not be writable.

	Test 73 (TEST_BUFFER_DELAY_BLANK_1FRAME):

	The PPU read buffer should
	survive 1 frame of idle
	with rendering disabled.

	Test 74 (TEST_BUFFER_DELAY_BLANK_2SECONDS):

	The PPU read buffer should
	survive 2 seconds of idle
	with rendering disabled.

	Test 75 (TEST_BUFFER_DELAY_INTERNAL):

	Unexpected: VROM contents at
	$1Bxx did not match what was
	hardcoded into the program.

	Test 76 (TEST_BUFFER_DELAY_VISIBLE_1FRAME):

	The PPU read buffer should
	survive 1 frame of idle
	with rendering enabled.

	Test 77 (TEST_BUFFER_DELAY_VISIBLE_1SECOND):

	The PPU read buffer should
	survive 1 second of idle
	with rendering enabled.

	Test 78 (TEST_BUFFER_DELAY_VISIBLE_3SECONDS):

	The PPU read buffer should
	survive 3 seconds of idle
	with rendering enabled.

	Test 79 (TEST_BUFFER_DELAY_VISIBLE_7SECONDS):

	The PPU read buffer should
	survive 7 seconds of idle
	with rendering enabled.



Expected output:

  TEST:test_ppu_read_buffer      :)
  -------------------------------
  Testing basic PPU memory I/O.
  Performing tests that combine
  sprite 0 hit flag, $4014 DMA
  and the RAM mirroring...
  Graphical artifacts during
  this test are OK and expected.
  
                Hit  No-Hit
  Direct poke   OK   OK
  DMA with ROM  OK   OK
  DMA + PPU bus OK   OK
  DMA with RAM  OK   OK
  -------------------------------
   This next test will take a while.
   In order to distract you with
   entertainment, art is provided.
   Contemplate on the art while
   the test is in progress.

   
  Passed
  
The ":)" should be blue/purple; the "OK" should be brownish
orange, and the "Graphical artifacts" paragraph should
also be brownish orange. Everything else should be white.

In the painting by Thomas Kinkade that is shown before
the "Passed" text appears, the ground should be pleasantly
green.


The text outputted to the $6000 console is
slightly different than the reference shown above,
because parts of the text above are placed on the
screen directly, and for other reasons.


Because this ROM contains a large amount of text and
some graphics data, portions of the ROM had to be
compressed to avoid increasing the ROM size too much.
Should one want to rebuild the ROM, a particular set
of tools will be needed; including nasm, gcc, and php.


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


-- 
Joel Yliluoma <bisqwit@iki.fi>
Shay Green <gblargg@gmail.com>

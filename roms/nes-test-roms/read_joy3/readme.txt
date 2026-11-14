NES Tests Source Code
---------------------

Building with ca65
------------------
To assemble a test with ca65, use the following commands:

	ca65 -I common -o rom.o source_filename_here.s
	ld65 -C nes.cfg rom.o -o rom.nes
	your_favorite_nes_emulator rom.nes

Don't bother trying to build a multi-test ROM, since it's not worth the
complexity. Also, tests you build won't print their name if they fail,
since that requires special arrangements.


Framework
---------
Each test is in a single source file, and makes use of several library
source files from common/. This framework provides common services and
reduces code to only that which performs the actual test. Virtually all
tests include "shell.inc" at the beginning, which sets things up and
includes all the appropriate library files.

The reset handler does minimal NES hardware initialization, clears RAM,
sets up the text console, then runs main. Main can exit by returning or
jumping to "exit" with an error code in A. Exit reports the code then
goes into an infinite loop. If the code is 0, it doesn't do anything,
otherwise it reports the code. Code 1 is reported as "Failed", and the
rest as "Error <code>".

Several routines are available to print values and text to the console.
Most update a running CRC-32 checksum which can be checked with
check_crc, allowing ALL the output to be checked very easily. If the
checksum doesn't match, it is printed, so you can run the code on a NES
and paste the correct checksum into your code.

The default is to build an iNES ROM, with other build types that I
haven't documented (devcart, sub-test of a multi-test ROM, NSF music
file). My nes.cfg file puts the code at $E000 since my devcart requires
it, and I don't want the normal ROM to differ in any way from what I've
tested.

Library routines are organized by function into several files, each with
short documentation. Each routine may also optionally list registers
which are preserved, rather than those which are modified (trashed) as
is more commonly done. This is because it's best for the caller to
assume that ALL registers are NOT preserved unless noted.

Some macros are used to make common operations more convenient. The left
is equivalent to the right:

	Macro               Equivalent
	-------------------------------------
	blt                 bcc
	
	bge                 bcs
	
	jne label           beq skip
						jmp label
						skip:
	etc.
	
	zp_byte name        .zeropage
						name: .res 1
						.code
	
	zp_res name,n       .zeropage
						name: .res n
						.code
	
	bss_res name,n      .bss
						name: .res n
						.code
	
	for_loop routine,begin,end,step
						calls a routine with A set to successive values

NES 6502 Timing Test
--------------------
This program tests instruction timing for all official and unofficial
NES 6502 instructions except the 8 branch instructions (Bxx) and the 12
halt instructions (HLT). It tests normal and page crossing cases of all
instructions (including instructions that should not take longer due to
a page crossing). It passes when run on an NTSC NES (it will not work on
a PAL NES due to the differing refresh rate).

The test takes up to 16 seconds to complete. If everything passes, it
prints a message and beeps twice. If it fails, it prints an error
message and beeps once.

The test can be restricted to only official instructions or test some or
all of the unofficial instructions, in case your emulator doesn't
emulate all the unofficial instructions. Select between these by holding
the following buttons on controller #1 when starting the test:

(nothing)   Official instructions only
B           Official + all unofficial instructions
A           Official + $EB (equivalent to $E9) + unofficial NOPs:

1-byte NOPs: $1A $3A $5A $7A $DA $FA
2-byte NOPs: $04 $14 $34 $44 $54 $64 $74 $80 $82 $89 $C2 $D4 $E2 $F4
3-byte NOPs: $0C $1C $3C $5C $7C $DC $FC

The 12 halt instructions are never tested, as they freeze the NES and
require a reset:

HLT: $02 $12 $22 $32 $42 $52 $62 $72 $92 $B2 $D2 $F2

The 8 branch instructions aren't tested since they have more subtle
page-crossing behavior. Use my branch_timing_tests for these.

Source code is included. Support code is also included, but it runs on a
custom devcart and assembler so it will require some effort to assemble.
Contact me if you'd like assistance porting them to your setup. I really
do plan on making my source work with ca65 eventually.


Errors
------
All instructions are first tested without a page crossing, then with a
page crossing, allowing you to more easily debug timing problems.

FAIL OP: The indicated opcode failed. If it was being timed where a page
crossing should occur, that will be noted. The number of clocks will be
shown that the emulator used, and the correct number of clocks it should
have used.

UNKNOWN ERROR: Occurs if the instruction timing fails or NMI
unexpectedly returns. Prints the opcode and a hex value. Post to the
Nesdev forum if you get this error.

BASIC TIMING WRONG: If you get this error, then the loop that tests NMI
and basic instruction timing (below) ran too many/too few times. If this
occurs, verify the timing of the following instructions and your PPU's
NMI interrupt timing.

loop:
	cpx zero-page
	bne stop
	inc zero-page
	bne loop
	inc zero-page
	jmp loop
stop:


How the tests work
------------------
All instructions are tested using a common framework which runs the
instruction in an infinite loop. Once the loop is eventually interrupted
by NMI, the number of times the loop ran is cross-referenced with a
table to determine how many clocks the instruction used. For normal
timing, instructions which use some form of indexed addressing reference
address $0xFD and X and Y are set to 2, which is just shy of a page
cross ($FD+2=$FF). To test page crossing timing, X and Y are set to 3,
causing a page crossing for relevant instructions ($FD+3=$100). Not all
instructions add an extra clock when a page is crossed, so this test
reveals missing and extra page crossing penalties.

Some instructions require special handling. JMP and JSR are tested by
jumping to the next instruction. RTS and RTI are handled by filling the
stack with the value $02 and having the next instruction of the loop be
at address $0202 (for RTI) or $0203 (for RTS, since it adds one to the
return address). BRK is handled by setting the IRQ vector to $0202, the
address of the next instruction in the loop after BRK. The trickiness of
these special cases might reveal non-timing problems in an emulator.


Instruction timing
------------------
The following unofficial instructions have an extra clock added for page
crossing and use the indicated addressing mode:

Absolute, X: $1C $3C $5C $7C $DC $FC
Absolute, Y: $BB $BF
Indirect, Y: $B3

These are the tables the test uses. Since it passes on a NES, the values
are pretty much guaranteed correct.

No page crossing:

	0 1 2 3 4 5 6 7 8 9 A B C D E F
	--------------------------------
	7,6,0,8,3,3,5,5,3,2,2,2,4,4,6,6 | 0
	0,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7 | 1
	6,6,0,8,3,3,5,5,4,2,2,2,4,4,6,6 | 2
	0,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7 | 3
	6,6,0,8,3,3,5,5,3,2,2,2,3,4,6,6 | 4
	0,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7 | 5
	6,6,0,8,3,3,5,5,4,2,2,2,5,4,6,6 | 6
	0,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7 | 7
	2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4 | 8
	0,6,0,6,4,4,4,4,2,5,2,5,5,5,5,5 | 9
	2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4 | A
	0,5,0,5,4,4,4,4,2,4,2,4,4,4,4,4 | B
	2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6 | C
	0,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7 | D
	2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6 | E
	0,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7 | F
	
Page crossing:

	0 1 2 3 4 5 6 7 8 9 A B C D E F
	--------------------------------
	7,6,0,8,3,3,5,5,3,2,2,2,4,4,6,6 | 0
	0,6,0,8,4,4,6,6,2,5,2,7,5,5,7,7 | 1
	6,6,0,8,3,3,5,5,4,2,2,2,4,4,6,6 | 2
	0,6,0,8,4,4,6,6,2,5,2,7,5,5,7,7 | 3
	6,6,0,8,3,3,5,5,3,2,2,2,3,4,6,6 | 4
	0,6,0,8,4,4,6,6,2,5,2,7,5,5,7,7 | 5
	6,6,0,8,3,3,5,5,4,2,2,2,5,4,6,6 | 6
	0,6,0,8,4,4,6,6,2,5,2,7,5,5,7,7 | 7
	2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4 | 8
	0,6,0,6,4,4,4,4,2,5,2,5,5,5,5,5 | 9
	2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4 | A
	0,6,0,6,4,4,4,4,2,5,2,5,5,5,5,5 | B
	2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6 | C
	0,6,0,8,4,4,6,6,2,5,2,7,5,5,7,7 | D
	2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6 | E
	0,6,0,8,4,4,6,6,2,5,2,7,5,5,7,7 | F

-- 
Shay Green <gblargg@gmail.com>

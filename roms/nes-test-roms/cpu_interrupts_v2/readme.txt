NES CPU Interrupt Tests
-----------------------
Tests behavior and timing of CPU in the presence of interrupts, both IRQ
and NMI.


CLI Latency Summary
-------------------
The RTI instruction affects IRQ inhibition immediately. If an IRQ is
pending and an RTI is executed that clears the I flag, the CPU will
invoke the IRQ handler immediately after RTI finishes executing.

The CLI, SEI, and PLP instructions effectively delay changes to the I
flag until after the next instruction. For example, if an interrupt is
pending and the I flag is currently set, executing CLI will execute the
next instruction before the CPU invokes the IRQ handler. This delay only
affects inhibition, not the value of the I flag itself; CLI followed by
PHP will leave the I flag cleared in the saved status byte on the stack
(bit 2), as expected.


1-cli_latency
-------------
Tests the delay in CLI taking effect, and some basic aspects of IRQ
handling and the APU frame IRQ (needed by the tests). It uses the APU's
frame IRQ and first verifies that it works well enough for the tests.

The later tests execute CLI followed by SEI and equivalent pairs of
instructions (CLI, PLP, where the PLP sets the I flag). These should
only allow at most one invocation of the IRQ handler, even if it doesn't
acknowledge the source of the IRQ. RTI is also tested, which behaves
differently. These tests also *don't* disable interrupts after the first
IRQ, in order to test whether a pair of instructions allows only one
interrupt or causes continuous interrupts that block the main code from
continuing.

2) RTI should not adjust return address (as RTS does)
3) APU should generate IRQ when $4017 = $00
4) Exactly one instruction after CLI should execute before IRQ is taken
5) CLI SEI should allow only one IRQ just after SEI
6) In IRQ allowed by CLI SEI, I flag should be set in saved status flags
7) CLI PLP should allow only one IRQ just after PLP
8) PLP SEI should allow only one IRQ just after SEI
9) PLP PLP should allow only one IRQ just after PLP
10) CLI RTI should not allow any IRQs
11) Unacknowledged IRQ shouldn't let any mainline code run
12) RTI RTI shouldn't let any mainline code run


2-nmi_and_brk
-------------
NMI behavior when it interrupts BRK. Occasionally fails on
NES due to PPU-CPU synchronization.

Result when run:
NMI BRK --
27  36  00 NMI before CLC
26  36  00 NMI after CLC
26  36  00 
36  00  00 NMI interrupting BRK, with B bit set on stack
36  00  00 
36  00  00 
36  00  00 
36  00  00 
27  36  00 NMI after SEC at beginning of IRQ handler
27  36  00 


3-nmi_and_irq
-------------
NMI behavior when it interrupts IRQ vectoring.

Result when run:
NMI IRQ
23  00 NMI occurs before LDA #1
21  00 NMI occurs after LDA #1 (Z flag clear)
21  00
20  00 NMI occurs after CLC, interrupting IRQ
20  00
20  00
20  00
20  00
20  00
20  00 Same result for 7 clocks before IRQ is vectored
25  20 IRQ occurs, then NMI occurs after SEC in IRQ handler
25  20


4-irq_and_dma
-------------
Has IRQ occur at various times around sprite DMA.
First column refers to what instruction IRQ occurred
after. Second column is time of IRQ, in CPU clocks relative
to some arbitrary starting point.

0 +0
1 +1
1 +2
2 +3
2 +4
4 +5
4 +6
7 +7
7 +8
7 +9
7 +10
8 +11
8 +12
8 +13
...
8 +524
8 +525
8 +526
9 +527


5-branch_delays_irq
-------------------
A taken non-page-crossing branch ignores IRQ during
its last clock, so that next instruction executes
before the IRQ. Other instructions would execute the
NMI before the next instruction.

The same occurs for NMI, though that's not tested here.

test_jmp
T+ CK PC
00 02 04 NOP
01 01 04 
02 03 07 JMP
03 02 07 
04 01 07 
05 02 08 NOP
06 01 08 
07 03 08 JMP
08 02 08 
09 01 08 

test_branch_not_taken
T+ CK PC
00 02 04 CLC
01 01 04 
02 02 06 BCS
03 01 06 
04 02 07 NOP
05 01 07 
06 04 0A JMP
07 03 0A 
08 02 0A 
09 01 0A JMP

test_branch_taken_pagecross
T+ CK PC
00 02 0D CLC
01 01 0D 
02 04 00 BCC
03 03 00 
04 02 00 
05 01 00 
06 04 03 LDA $100
07 03 03 
08 02 03 
09 01 03 

test_branch_taken
T+ CK PC
00 02 04 CLC
01 01 04 
02 03 07 BCC
03 02 07 
04 05 0A LDA $100 *** This is the special case
05 04 0A 
06 03 0A 
07 02 0A 
08 01 0A 
09 03 0A JMP

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

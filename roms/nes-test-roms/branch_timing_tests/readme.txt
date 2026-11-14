NES 6502 Branch Timing Test ROMs
--------------------------------
These ROMs test timing of the branch instruction, including edge cases
which an emulator might get wrong. When run on a NES they all give a
passing result. Each ROM runs several tests and reports the result on
screen and by beeping a number of times. See below for the meaning of
failure codes for each test. THE TESTS MUST BE RUN (*AND* *PASS*) IN
ORDER, because some earlier ROMs test things that later ones assume will
work properly.

Source code for each test is included, and most tests are clearly
divided into sections. Support code is also included, but it runs on a
custom devcart and assembler so it will require some effort to assemble.
Contact me if you'd like assistance porting them to your setup.


Branch Timing Summary
---------------------
An untaken branch takes 2 clocks. A taken branch takes 3 clocks. A taken
branch that crosses a page takes 4 clocks. Page crossing occurs when the
high byte of the branch target address is different than the high byte
of address of the next instruction:

branch_target:
	...
	bne branch_target
next_instruction:
	nop
	...
branch_target:


1.Branch_Basics
---------------
Tests branch timing basics and PPU NMI timing, which is needed for the
tests

2) NMI period is too short
3) NMI period is too too long
4) Branch not taken is too long
5) Branch not taken is too short
6) Branch taken is too long
7) Branch taken is too short


2.Backward_Branch
-----------------
Tests backward (negative) branch timing.

2) Branch from $E4FD to $E4FC is too long
3) Branch from $E4FD to $E4FC is too short
4) Branch from $E5FE to $E5FD is too long
5) Branch from $E5FE to $E5FD is too short
6) Branch from $E700 to $E6FF is too long
7) Branch from $E700 to $E6FF is too short
8) Branch from $E801 to $E800 is too long
9) Branch from $E801 to $E800 is too short


3.Forward_Branch
----------------
Tests forward (positive) branch timing.

2) Branch from $E5FC to $E5FF is too long
3) Branch from $E5FC to $E5FF is too short
4) Branch from $E6FD to $E700 is too long
5) Branch from $E6FD to $E700 is too short
6) Branch from $E7FE to $E801 is too long
7) Branch from $E7FE to $E801 is too short
8) Branch from $E8FF to $E902 is too long
9) Branch from $E8FF to $E902 is too short

-- 
Shay Green <gblargg@gmail.com>

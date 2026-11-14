NTSC NES PPU VBL/NMI Timing Tests
---------------------------------
These ROMs test the timing of the VBL flag and NMI to an accuracy of a
single PPU clock, and also check special cases. They have been tested on
an actual NES and all give a passing result. Sometimes the NES starts up
with a different PPU timing that causes some of the tests to fail; these
tests don't check that timing arrangement.

Each ROM runs several tests and reports the result on screen and by
beeping a number of times. See below for the meaning of failure codes
for each test. It's best to run the tests in order, because later ROMs
depend on things tested by earlier ROMs and will give erroneous results
if any earlier ones failed.

Source code for each test is included, and most tests are clearly
divided into sections. Support code is also included, but it runs on a
custom devcart and assembler so it will require some effort to assemble.
Contact me if you'd like assistance porting them to your setup.


1.frame_basics
--------------
Tests basic VBL flag operation and general timing of PPU frames.

2) VBL flag isn't being set
3) VBL flag should be cleared after being read
4) PPU frame with BG enabled is too short
5) PPU frame with BG enabled is too long
6) PPU frame with BG disabled is too short
7) PPU frame with BG disabled is too long


2.vbl_timing
------------
Tests timing of VBL being set, and special case where reading VBL flag
as it would be set causes it to not be set for that frame.

2) Flag should read as clear 3 PPU clocks before VBL
3) Flag should read as set 0 PPU clocks after VBL
4) Flag should read as clear 2 PPU clocks before VBL
5) Flag should read as set 1 PPU clock after VBL
6) Flag should read as clear 1 PPU clock before VBL
7) Flag should read as set 2 PPU clocks after VBL
8) Reading 1 PPU clock before VBL should suppress setting


3.even_odd_frames
-----------------
Test clock skipped when BG is enabled on odd PPU frames. Tests
enable/disable BG during 5 consecutive frames, then see how many clocks
were skipped. Patterns are shown as XXXXX, where each X can either be B
(BG enabled) or - (BG disabled).

2) Pattern ----- should not skip any clocks
3) Pattern BB--- should skip 1 clock
4) Pattern B--B- (one even, one odd) should skip 1 clock
5) Pattern -B--B (one odd, one even) should skip 1 clock
6) Pattern BB-BB (two pairs) should skip 2 clocks


4.vbl_clear_timing
------------------
Tests timing of VBL flag clearing.

2) Cleared 3 or more PPU clocks too early
3) Cleared 2 PPU clocks too early
4) Cleared 1 PPU clock too early 
5) Cleared 3 or more PPU clocks too late
6) Cleared 2 PPU clocks too late
7) Cleared 1 PPU clock too late


5.nmi_suppression
-----------------
Tests timing of NMI suppression when reading VBL flag just as it's set,
and that this doesn't occur when reading one clock before or after.

2) Reading flag 3 PPU clocks before set shouldn't suppress NMI
3) Reading flag when it's set should suppress NMI
4) Reading flag 3 PPU clocks after set shouldn't suppress NMI
5) Reading flag 2 PPU clocks before set shouldn't suppress NMI
6) Reading flag 1 PPU clock after set should suppress NMI
7) Reading flag 4 PPU clocks after set shouldn't suppress NMI
8) Reading flag 4 PPU clocks before set shouldn't suppress NMI
9) Reading flag 1 PPU clock before set should suppress NMI
10)Reading flag 2 PPU clocks after set shouldn't suppress NMI

432101234
---+?+---


6.nmi_disable
-------------
Tests NMI occurrence when disabling NMI just as VBL flag is set, and
just after.

2) NMI shouldn't occur when disabled 0 PPU clocks after VBL
3) NMI should occur when disabled 3 PPU clocks after VBL
4) NMI shouldn't occur when disabled 1 PPU clock after VBL
5) NMI should occur when disabled 4 PPU clocks after VBL
6) NMI shouldn't occur when disabled 1 PPU clock before VBL
7) NMI should occur when disabled 2 PPU clocks after VBL


7.nmi_timing
------------
Tests timing of NMI and immediate occurrence when enabled with VBL flag
already set.

2) NMI occurred 3 or more PPU clocks too early
3) NMI occurred 2 PPU clocks too early
4) NMI occurred 1 PPU clock too early
5) NMI occurred 3 or more PPU clocks too late
6) NMI occurred 2 PPU clocks too late
7) NMI occurred 1 PPU clock too late
8) NMI should occur if enabled when VBL already set
9) NMI enabled when VBL already set should delay 1 instruction
10)NMI should be possible multiple times in VBL

-- 
Shay Green <hotpop.com@blargg> (swap to e-mail)

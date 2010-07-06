 _     _     __     ___
| |   (_)   / /    / __|
| |    _   / /_   | /__
| |   | | |  _ \  |___ \
| |_  | | | (_) | .___) |
 \__|_| |  \___/   \___/
    |__/

LJ65
an NES game
by Damian Yerrick

See the legal section below.

_____________________________________________________________________
Introduction

LJ65 is an action puzzle game for NES comparable to the popular
game Tetris(R), except distributed as free software and with more
responsive movement controls.

_____________________________________________________________________
Installing

LJ65 is designed to run on Nintendo Entertainment System (called
Family Computer in Japan) and accurate NES emulators.  It is
distributed as source code and an iNES format binary, using mapper
0 (NROM).  Separate binaries for NTSC and PAL systems are provided.

This program has been tested on NES using a PowerPak.  It also works
on the current versions of Nintendulator, Nestopia, and FCE Ultra.
(Do not use the outdated Nesticle emulator anymore.)

To run LJ65 on an NES without buying a PowerPak, you'll need to
solder together an NES cartridge with at least 16 KB of PRG space
and 4 KB of CHR space.  A modded NROM-128 or CNROM board should be
fine.  Chris Covell has put together instructions on how to replace
NES Game Paks' mask ROM chips with writable EEPROMs.
http://www.zyx.com/chrisc/solarwarscart.html

To build LJ65 from source code, you will need
  * CC65 (from http://www.cc65.org/ but you don't need the
    non-free C compiler)
  * GNU Make and Coreutils (included with most Linux distributions;
    Windows users can use MSYS from http://www.devkitpro.org/)

Modify the makefile to point to where you have CC65 installed.
Then run make.  (Windows users can run mk.bat instead, which runs
make in the correct folder.)  On a desktop PC from late 2000 with
a Pentium III 866 MHz, recompiling the whole thing takes about one
second.  To build some data conversion tools, you'll need a GNU C
compiler such as MinGW; I have included Windows binaries of the
conversion tools for those who want to quickly get into hacking
on LJ65.

_____________________________________________________________________
Game controls

Title screen:
  Start: Show playfields.
Game over:
  A+B: Join game.
Menu:
  Control Pad up, down: Move cursor.
  Control Pad left, right: Change option at cursor.
  A: Start game.
Game:
  Control Pad left, right, down: Move piece.
  Control Pad up: Move piece to floor.
  Control Pad up, down once landed: Lock piece into place.
  A: Rotate piece clockwise.
  B: Rotate piece anticlockwise.
  Start: Pause game.

_____________________________________________________________________
Play

At first, press Start to skip past each of the informational screens.
Then press Start at the title screen to display the playfields.
At this point, either player can press the A and B buttons at the
same time to begin playing.

The pieces in LJ65 are called tetrominoes.  (The word comes from
tetra-, a Greek prefix meaning four, and -omino, as in domino or
pentomino.)  Each of the seven tetrominoes is made of four square
blocks and named after a letter of the Latin alphabet that it
resembles:
           _           _   ___     ___     _     ___
 _______  | |___   ___| | |   |  _|  _|  _| |_  |_  |_
|_______| |_____| |_____| |___| |___|   |_____|   |___|
    I        J       L      O      S       T       Z

When you start the game, a tetromino will begin to fall slowly into
the bin.  You can move it with the Control Pad and rotate it with
the A or B button.

The goal of LJ65 is to make complete horizontal lines by
packing the pieces into the bin with no holes.  If you complete
a line, everything above it will move down a row.  If you complete
more than one line with a piece, you get more points.

As you play, the pieces will gradually fall faster, making the game
more difficult.  At some point, the pieces will fall so fast that
they appear immediately at the bottom row of the playfield.  If you
fill the bin to the top, to the point where more pieces cannot enter,
you "top out" and the game ends.

If you have an overhang in the blocks, you can slide another
piece under it by holding Left or Right as the new piece passes
by the overhang:
       _
      | |
     _| |
    |___|
   _            _   _        _ _
 _| |     =>  _| | | | =>  _| | |
|  _|        |  _|_| |    |  _| |
|_|          |_| |___|    |_|___|

Or in some cases, you can rotate pieces into very tight spaces:
     _
   _| |
  |_  |
    |_|
 _     ___      _   _ ___      _     ___
| |   |_  | => | |_| |_  | => | |___|_  |
| |_   _| |    | |_  |_| |    | |_   _| |
|___| |___|    |___|_|___|    |___|_|___|

_____________________________________________________________________
Rotation systems

LJ65 supports two rotation systems, which it calls "Center" and
"Bottom".  Center implements rules more familiar to Western players,
while Bottom pleases fans of the Japanese arcade tradition.

In Center, pieces start out with their flat side down, and they
rotate around the center of an imaginary 3x3 or 4x4 cell bounding
box.  If this is blocked, try one square to the right, one square to
the left, and finally one square up.
Up locks a piece into place immediately, and down waits for another
press of up or down before locking the piece.
After a piece locks, the next one comes out immediately, but after
the pieces have sped up enough, the next piece waits a bit.
Colors match the so-called Guideline: I is turquoise.

. [].   . [].   . . .   . [].       . [][]  . [].   . . .   []. .
[][][]  . [][]  [][][]  [][].       [][].   . [][]  . [][]  [][].
. . .   . [].   . [].   . [].       . . .   . . []  [][].   . [].
Figure: T and S rotation in Center

In Bottom, the J, L, S, T, and Z pieces start out with their flat
side up, and they rotate to stay in contact with the bottom of an
imaginary 3x3 cell box.  S and Z pieces also keep a block in the
bottom center of this box.  If this is blocked by a wall or a block
outside the piece's central column, then try one square to the right,
one square to the left, and finally (in the case of T) one square up.
Down locks on contact, and up waits for another press of up or down
to lock.  After a piece locks, the next one waits a bit to come out.
Colors match those from a game with a monkey: I is red.

. . .   . [].   . . .   . [].       . . .   []. .   . . .   []. .
[][][]  [][].   . [].   . [][]      . [][]  [][].   . [][]  [][].
. [].   . [].   [][][]  . [].       [][].   . [].   [][].   . [].
Figure: T and S rotation in Bottom

_____________________________________________________________________
Scoring

Use up or down on the Control Pad to drop pieces, and you'll get
one point per row that the piece moves down.

You also get points for clearing lines.  Clearing more lines
with a single piece is worth more points:

SINGLE   (1 line with any piece)       1 * 1 * 100 =  100 points
DOUBLE   (2 lines with any piece)      2 * 2 * 100 =  400 points
TRIPLE   (3 lines with I, J, or L)     3 * 3 * 100 =  900 points
HOME RUN (4 lines with I only)         4 * 4 * 100 = 1600 points

Making lines with consecutive pieces is called a combo and is
worth even more points.  In general, the score for a line clear
is the number of lines cleared with this piece, times the number
of lines cleared so far in this combo, times 100.  For example,
a double-triple-single combo is worth a total of 2300 points:

2 lines      2 * 2 * 100 =  200 points
3 lines      3 * 5 * 100 = 1500 points
1 line       1 * 6 * 100 =  600 points

When you start clearing lines, the game shows how many lines you
made in this combo.  If you leave a 2-block-wide hole at the side
of the bin, you might manage to make a combo of 12 lines or more.
But then you have to weigh this against keeping your stack low
and earning more drop bonus.

There are some grandmasters who can get millions of points in
some puzzle games.  There exists a known corner case in this
game's score computation, and scoring is expected to fail beyond
6,553,000 points.

If two players are playing, and you have GARBAGE turned on in the
menu, and you complete more than one line with a piece, the other
player's field rises by one or more rows:

DOUBLE:   1 line
TRIPLE:   2 lines
HOME RUN: 4 lines

This is not affected by combos.

_____________________________________________________________________
Keypress codes

Some of the lesser-used features of the game are hidden so that
players interested in the most common features don't become confused.

At title screen:
  * B + Left hides the ghost piece.

_____________________________________________________________________
Questions

Q: Isn't this a copy of Tetris?

Yes, in part, but we don't believe it infringes Tetris Holding's
copyright.  It was developed by people who had not read the source
code of Tetris.  We disagree with Tetris Holding's claim of broad
patent-like rights over the game.  Any similarity between LJ65 and
Tetris is a consequence of common methods of operation, which are
excluded from U.S. copyright (17 USC 102(b)).

Q: Where's (feature that has appeared in another game)?

If it's mentioned in the "future" list at the bottom of CHANGES.txt,
I know about it, and you may see some of those issues resolved in
the next version.  Otherwise, I'd be glad to take suggestions,
provided that they aren't "network play with no lag" or "make the
game just like that Japanese game I saw on YouTube".

Q: Why aren't the blocks square on my TV?

In NTSC, a square pixel is 7/24 of a color subcarrier period wide
in 480i mode or 7/12 of a period in the so-called "240p" mode.
But like the video chipsets in most 8-bit and 16-bit computing
platforms, the NES PPU generates pixels that are not square:
8/12 of a period instead of 7/12.  Games for PC, Apple II, or any
other platform with frame buffer video could correct for this by
drawing differently sized tiles, but games for NES are limited to
an 8x8 pixel tile grid.  PAL video and widescreen televisions make
the problem even more pronounced.

Q: Why do some pieces change color subtly when they land?

The NES's tile size is 8x8 pixels, but the "attribute table"
assigns palettes to 16x16 pixel areas, or clusters of 2x2 tiles.
Only three colors plus the backdrop color can appear in each
color area.  So the game approximates the color of each piece as a
combination of blue, orange, and green throughout the screen.

The MMC5 mapper has ExGrafix, which allows 8x8 pixel color areas.
But the only source of MMC5 hardware is used copies of Castlevania
III: Dracula's Curse and Koei's war sims, unlike the discrete mapper
boards that retrousb.com sells.

Q: Who is the fellow on How to Play, and where are his legs?

Who are you, and where is your tail? ;-)

_____________________________________________________________________
Credits

Program and graphics by Damian Yerrick
Original game design by Alexey Pajitnov
NES assembler toolchain by Ullrich von Bassewitz
NES emulators by Xodnizel, Martin Freij, and Quietust
NES documentation by contributors to http://nesdevwiki.org/

Music:
  TEMP is "Tetris New Melody (OCRemoved)" by Am.Fm.GM
  K.231 is "Leck mich im Arsch" by Wolfgang A. Mozart

_____________________________________________________________________
Legal

Copyright (c) 2009 Damian Yerrick

This manual is under the following license:

  This work is provided 'as-is', without any express or implied
  warranty. In no event will the authors be held liable for any
  damages arising from the use of this work.

  Permission is granted to anyone to use this work for any
  purpose, including commercial applications, and to alter it and
  redistribute it freely, subject to the following restrictions:

   1. The origin of this work must not be misrepresented; you
      must not claim that you wrote the original work. If you use
      this work in a product, an acknowledgment in the product
      documentation would be appreciated but is not required.
   2. Altered source versions must be plainly marked as such,
      and must not be misrepresented as being the original work.
   3. This notice may not be removed or altered from any
      source distribution.

  The term "source" refers to the preferred form of a work for making
  changes to it. 

The LJ65 software described by this manual is distributed under
the GNU General Public License, version 2 or later, with ABSOLUTELY
NO WARRANTY.  See GPL.txt for details.

LJ65 is not a Tetris product and is not endorsed by Tetris Holding.
